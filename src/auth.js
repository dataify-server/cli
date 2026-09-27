import crypto from "node:crypto";
import http from "node:http";
import { spawn } from "node:child_process";

import { VERSION } from "./version.js";

export const CALLBACK_PATH = "/callback";
export const CALLBACK_HOST = "127.0.0.1";
export const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * 收到授权码后最多让浏览器等这么久：正常情况下调用方换完 token 就会立刻回包。
 *
 * 这个值必须大于「换 token 请求的超时」，否则后端一慢，兜底定时器会先开火，
 * 在结果还没出来的时候就给浏览器发页面。调用方应按自己的请求超时推导后传入
 * responseTimeoutMs，这里的常量只作为没传时的下限。兜底页固定是中性的 pending，
 * 不替 CLI 断言成败。
 */
export const RESPONSE_FALLBACK_MS = 30 * 1000;

// 回包写出后等 flush 的上界：正常在个位数毫秒内完成，这里只防调用方 await 无上界。
const RESPONSE_FLUSH_GUARD_MS = 5 * 1000;

export const AUTH_ENDPOINTS = {
  authorize: "/api/v1/auth/cli/authorize",
  exchange: "/api/v1/auth/cli/exchange",
  revoke: "/api/v1/auth/cli/revoke",
  me: "/api/v1/auth/me"
};

export function base64Url(buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

/**
 * 生成一次 CLI 登录会话的 PKCE 材料。
 * state 22 字符、code_verifier 43 字符、code_challenge 43 字符，
 * 与登录接口文档 15.2 的长度约定一致。code_verifier 只留在进程内存中。
 */
export function createPkceSession() {
  const codeVerifier = base64Url(crypto.randomBytes(32));
  return {
    state: base64Url(crypto.randomBytes(16)),
    codeVerifier,
    codeChallenge: base64Url(crypto.createHash("sha256").update(codeVerifier).digest()),
    codeChallengeMethod: "S256"
  };
}

export function buildLoginUrl(dashboardLoginUrl, { redirectUri, state, codeChallenge, codeChallengeMethod }) {
  const url = new URL(dashboardLoginUrl);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", codeChallengeMethod);
  return url.toString();
}

/**
 * 在 127.0.0.1 的随机高位端口上监听一次 CLI 回调。
 *
 * 按登录接口文档第 10 节：只绑 loopback、只处理 GET /callback、必须校验 state、
 * 只接受一次成功匹配、超时后关闭监听、返回给浏览器的页面不回显任何请求参数。
 *
 * 成功分支的 outcome 会多带一个 finish(view, account)：调用方换完 token 之后调用它，
 * 浏览器那一页才会收到响应，从而能显示真实的账号名、key 状态与到期时间。
 * 调用方无论成败都必须调一次 finish，否则 responseTimeoutMs 之后会兜底发出 pending 页。
 */
export function startCallbackServer({
  state,
  timeoutMs = LOGIN_TIMEOUT_MS,
  responseTimeoutMs = RESPONSE_FALLBACK_MS
} = {}) {
  if (!state) {
    throw new Error("startCallbackServer requires a state value");
  }

  const server = http.createServer();
  let settled = false;
  let boundPort = 0;
  let resolveOutcome;
  let rejectOutcome;
  const outcome = new Promise((resolve, reject) => {
    resolveOutcome = resolve;
    rejectOutcome = reject;
  });

  let timer = null;
  let finalView = "";
  let finalAccount = null;
  const clearTimer = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const settle = (action, value) => {
    if (settled) {
      return;
    }
    settled = true;
    clearTimer();
    action(value);
  };

  server.on("request", (request, response) => {
    const requestUrl = new URL(request.url || "/", `http://${CALLBACK_HOST}`);

    if (request.method !== "GET" || requestUrl.pathname !== CALLBACK_PATH) {
      respond(response, 404, callbackPage("not_found"));
      return;
    }

    // 请求能打到这个端口已经说明来源在本机，这里再核一次 Host 头是为了 DNS rebinding：
    // 外部页面把自己的域名解析到 127.0.0.1 时，Host 会是那个域名而不是回环地址。
    if (!isLoopbackHost(request.headers.host, boundPort)) {
      respond(response, 400, callbackPage("not_found"));
      return;
    }

    // 文档第 4 节：拒绝重复的 code/state/error 参数，以及 code 与 error 同时出现的
    // 歧义请求。无效回调不触发兑换。
    const stateValues = requestUrl.searchParams.getAll("state");
    const codeValues = requestUrl.searchParams.getAll("code");
    const errorValues = requestUrl.searchParams.getAll("error");
    if (
      stateValues.length > 1 ||
      codeValues.length > 1 ||
      errorValues.length > 1 ||
      (codeValues.length > 0 && errorValues.length > 0)
    ) {
      respond(response, 400, callbackPage("invalid_request"));
      return;
    }

    // state 不一致时丢弃该请求并继续等待，不消费本次登录流程。
    if (requestUrl.searchParams.get("state") !== state) {
      respond(response, 400, callbackPage("state_mismatch"));
      return;
    }

    // 已经处理过一次匹配的回调（例如浏览器预取或用户刷新了这个标签页）：
    // 直接重放上一次的页面，不再消费流程，也不会挂在那里等调用方回包。
    // finalView 为空说明授权码已收下但调用方还没换完 token，此时结果未知，
    // 只能给中性的 pending 页——绝不能默认成 success，否则会出现同一次登录
    // 两个标签页给出相反结论。
    if (settled) {
      respond(response, 200, callbackPage(finalView || "pending", finalAccount));
      return;
    }

    const error = requestUrl.searchParams.get("error") || "";
    if (error) {
      respond(response, 200, callbackPage("declined"));
      finalView = "declined";
      settle(resolveOutcome, { error });
      return;
    }

    const code = requestUrl.searchParams.get("code") || "";
    if (!code) {
      respond(response, 400, callbackPage("missing_code"));
      return;
    }

    // 成功分支先不回包：把授权码交给调用方去换 token，拿到账号信息后再渲染
    // 带账号卡片的成功页。调用方无论成败都要调一次 finish；真到了兜底时间还没调，
    // 说明这次换 token 慢到超出预期，此时结果未知，只能发 pending 页让用户回终端看，
    // 不能发 success——那等于替 CLI 猜了个结论，而且成功页 10 秒后会自己关掉。
    let responded = false;
    let fallbackTimer = null;

    const finish = (view, account) =>
      new Promise((resolve) => {
        if (responded) {
          resolve();
          return;
        }
        responded = true;
        if (fallbackTimer) {
          clearTimeout(fallbackTimer);
          fallbackTimer = null;
        }
        finalView = view;
        finalAccount = account || null;
        respond(response, 200, callbackPage(view, account), resolve);
        // socket 被对端卡住不读时 flush 回调可能迟迟不来，给调用方的 await 兜个上界。
        const guard = setTimeout(resolve, RESPONSE_FLUSH_GUARD_MS);
        guard.unref?.();
      });

    response.on("close", () => {
      responded = true;
      if (fallbackTimer) {
        clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
    });

    fallbackTimer = setTimeout(() => {
      finish("pending");
    }, responseTimeoutMs);
    fallbackTimer.unref?.();

    settle(resolveOutcome, { code, finish });
  });

  server.on("error", (error) => {
    settle(rejectOutcome, error);
  });

  const listening = new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, CALLBACK_HOST, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  const close = () =>
    new Promise((resolve) => {
      clearTimer();
      server.closeAllConnections?.();
      server.close(() => resolve());
    });

  return listening.then(() => {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    if (!port) {
      throw new Error("Could not determine the local callback port");
    }
    boundPort = port;

    timer = setTimeout(() => {
      settle(rejectOutcome, new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s waiting for the browser login. Please run dataify login again.`));
    }, timeoutMs);
    timer.unref?.();

    return {
      port,
      redirectUri: `http://${CALLBACK_HOST}:${port}${CALLBACK_PATH}`,
      wait: () => outcome,
      close
    };
  });
}

/**
 * 登录态已存在时，单独起一个一次性 loopback 服务，复用成功回调页把当前账号
 * 信息展示在浏览器里。页面发完后服务立即关闭，进程随之退出；浏览器迟迟没来
 * 也会在超时后关闭，避免命令挂着不退出。
 */
export function serveAccountPage(account, { timeoutMs = 15000 } = {}) {
  const server = http.createServer();
  let finished = false;
  let timer = null;

  const closeServer = () => {
    if (finished) {
      return;
    }
    finished = true;
    if (timer) {
      clearTimeout(timer);
    }
    server.close();
  };

  server.on("request", (request, response) => {
    const requestUrl = new URL(request.url || "/", `http://${CALLBACK_HOST}`);
    if (request.method !== "GET" || requestUrl.pathname !== CALLBACK_PATH) {
      respond(response, 404, callbackPage("not_found"));
      return;
    }
    respond(response, 200, callbackPage("success", account), closeServer);
  });

  const listening = new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, CALLBACK_HOST, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  return listening.then(() => {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    if (!port) {
      throw new Error("Could not determine the local account page port");
    }
    timer = setTimeout(closeServer, timeoutMs);
    return {
      url: `http://${CALLBACK_HOST}:${port}${CALLBACK_PATH}`,
      close: closeServer
    };
  });
}

/**
 * Host 头必须指向本机的回调端口。
 *
 * 服务器只绑 127.0.0.1，所以正常回调的 Host 一定是 `127.0.0.1:<port>`。
 * 端口也要比对：否则攻击者把域名解析到 127.0.0.1 后，浏览器会认为
 * `http://evil.example:<port>` 和这一页同源，从而能读到页面内容。
 * 端口和 state 都猜不到时本来就打不进来，这里只是把这条路彻底堵掉。
 */
export function isLoopbackHost(hostHeader, port) {
  if (!hostHeader || !port) {
    return false;
  }

  const text = String(hostHeader).trim().toLowerCase();
  // IPv6 字面量形如 [::1]:1234，冒号不能直接用来切分。
  const match = text.startsWith("[") ? text.match(/^\[([^\]]+)\]:(\d+)$/) : text.match(/^([^:]+):(\d+)$/);
  if (!match) {
    return false;
  }
  if (Number(match[2]) !== Number(port)) {
    return false;
  }
  return ["127.0.0.1", "::1", "localhost"].includes(match[1]);
}

function respond(response, statusCode, html, done) {
  response.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    Connection: "close"
  });
  response.end(html, done);
}

/**
 * 回调页的各种状态。文案、图标、命令列表全部写死在这张表里，
 * callbackPage 只按 key 取用，不接受任何来自请求的字符串，
 * 从结构上杜绝反射型 XSS。
 */
const CALLBACK_VIEWS = {
  success: {
    tone: "success",
    icon: "check",
    status: "已登录",
    title: "Dataify CLI 登录成功",
    heading: "登录成功",
    lead: "CLI 已收到你的授权，并在这台机器上保存了新的 API Key。你可以关闭本页，回到终端继续操作。",
    commandsTitle: "接下来可以做什么",
    commands: [
      ["dataify whoami", "查看当前登录的账号和 Key 到期时间"],
      ["dataify tools", "查看这把 Key 可用的工具"],
      ["dataify balance", "查看当前账号余额"],
      ["dataify logout", "退出登录并删除这把 CLI API Key"]
    ],
    autoCloseSeconds: 10,
    foot: "本页由你本机的 CLI 提供，全程不会展示你的 token。"
  },
  pending: {
    tone: "wait",
    icon: "clock",
    status: "处理中",
    title: "Dataify CLI 登录处理中",
    heading: "已收到授权",
    lead: "CLI 已收到你的授权，正在完成登录。本页无法判断最终结果，请回到终端查看。",
    commandsTitle: "请在终端查看结果",
    commands: [
      ["dataify whoami", "查看当前登录的账号和 Key 到期时间"],
      ["dataify login", "如果终端报错，可重新发起登录"]
    ],
    foot: "本页由你本机的 CLI 提供，全程不会展示你的 token。"
  },
  login_failed: {
    tone: "error",
    icon: "alert",
    status: "未完成",
    title: "Dataify CLI - 登录未完成",
    heading: "登录未完成",
    lead: "浏览器授权已收到，但 CLI 无法把它换成 API Key。具体原因已打印在你启动登录的终端里。",
    commandsTitle: "如何恢复",
    commands: [["dataify login", "重新发起浏览器登录"]],
    foot: "本机没有保存任何 token。授权码是一次性的，且已被消费。"
  },
  declined: {
    tone: "error",
    icon: "alert",
    status: "已拒绝",
    title: "Dataify CLI - 授权已拒绝",
    heading: "授权已拒绝",
    lead: "你拒绝了 Dataify CLI 的授权，因此没有创建任何 API Key。你可以关闭本页。",
    commandsTitle: "如果这不是你的本意",
    commands: [["dataify login", "重新发起浏览器登录"]],
    foot: "本机没有保存任何内容，你的账号上也没有创建 Key。"
  },
  state_mismatch: {
    tone: "error",
    icon: "alert",
    status: "未通过校验",
    title: "Dataify CLI - 无法验证本次登录",
    heading: "无法验证本次登录",
    lead: "这个回调与 CLI 正在等待的登录不匹配，因此已被忽略。通常是因为链接来自更早的一次登录。",
    commandsTitle: "如何恢复",
    commands: [["dataify login", "重新发起一次浏览器登录"]],
    foot: "CLI 仍在等待匹配的回调。请关闭本页，并使用最新一次的登录链接。"
  },
  missing_code: {
    tone: "error",
    icon: "alert",
    status: "不完整",
    title: "Dataify CLI - 登录未完成",
    heading: "登录未完成",
    lead: "回调里没有授权码，因此没有可用于换取 API Key 的内容。",
    commandsTitle: "如何恢复",
    commands: [["dataify login", "重新发起浏览器登录"]],
    foot: "请关闭本页，并在启动登录的终端里执行上面的命令。"
  },
  invalid_request: {
    tone: "error",
    icon: "alert",
    status: "已拒绝",
    title: "Dataify CLI - 非法回调",
    heading: "该回调已被拒绝",
    lead: "回调中包含重复或冲突的参数，已被 CLI 忽略。通常是因为链接被篡改。",
    commandsTitle: "如何恢复",
    commands: [["dataify login", "重新发起一次浏览器登录"]],
    foot: "CLI 没有为这次回调做任何兑换。"
  },
  not_found: {
    tone: "error",
    icon: "alert",
    status: "未找到",
    title: "Dataify CLI - 未找到",
    heading: "这里没有内容",
    lead: "这个本机地址只用于接收 Dataify CLI 的登录回调，不提供其他页面。",
    commandsTitle: "想找登录页？",
    commands: [["dataify login", "打印新的登录链接并打开"]],
    foot: "该监听只绑定 127.0.0.1，登录完成后立即关闭，其他机器无法访问。"
  }
};

const CALLBACK_ICONS = {
  check: `<svg class="glyph" viewBox="0 0 52 52" role="img" aria-label="成功">
  <circle class="glyph-ring" cx="26" cy="26" r="23" />
  <path class="glyph-mark" d="M15.5 27.2 23 34.5 37 19" />
</svg>`,
  alert: `<svg class="glyph" viewBox="0 0 52 52" role="img" aria-label="注意">
  <circle class="glyph-ring" cx="26" cy="26" r="23" />
  <path class="glyph-mark" d="M26 15.5V30" />
  <circle class="glyph-dot" cx="26" cy="36.6" r="2.5" />
</svg>`,
  clock: `<svg class="glyph" viewBox="0 0 52 52" role="img" aria-label="处理中">
  <circle class="glyph-ring" cx="26" cy="26" r="23" />
  <path class="glyph-mark" d="M26 14.5V26.8L34.5 31.5" />
</svg>`
};

const COPY_ICON = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" aria-hidden="true">
  <rect x="9" y="9" width="11" height="11" rx="2.5" stroke="currentColor" stroke-width="1.8"/>
  <path d="M15 5.5H6.5A2 2 0 0 0 4.5 7.5V16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
</svg>`;

const CALLBACK_STYLE = `  :root {
    color-scheme: light dark;
    --bg: #eef2f9;
    --card: #ffffff;
    --ink: #0b1220;
    --ink-soft: #334155;
    --muted: #64748b;
    --line: #e3e9f4;
    --line-soft: #eef2f8;
    --field: #f6f8fc;
    --brand: #1265ff;
    --brand-soft: rgba(18, 101, 255, 0.10);
    --ok: #0f9f6e;
    --ok-soft: #e8fbf3;
    --err: #dc2626;
    --err-soft: #fff1f2;
    --shadow: 0 1px 2px rgba(11, 18, 32, 0.04), 0 18px 40px -12px rgba(11, 18, 32, 0.18), 0 48px 96px -48px rgba(18, 101, 255, 0.45);
  }

  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #060a13;
      --card: #0d1421;
      --ink: #e9eefb;
      --ink-soft: #c7d2e5;
      --muted: #8b9ab4;
      --line: #1d2839;
      --line-soft: #172232;
      --field: #111b2b;
      --brand: #4d8bff;
      --brand-soft: rgba(77, 139, 255, 0.16);
      --ok: #34d399;
      --ok-soft: rgba(52, 211, 153, 0.14);
      --err: #f87171;
      --err-soft: rgba(248, 113, 113, 0.14);
      --shadow: 0 1px 2px rgba(0, 0, 0, 0.4), 0 24px 60px -18px rgba(0, 0, 0, 0.7), 0 60px 120px -60px rgba(77, 139, 255, 0.35);
    }
  }

  * { box-sizing: border-box; }

  html, body { height: 100%; }

  body {
    margin: 0;
    background: var(--bg);
    color: var(--ink);
    font-family: Inter, "Segoe UI", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Roboto, "Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif;
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }

  .backdrop { position: fixed; inset: 0; overflow: hidden; pointer-events: none; }

  .grid {
    position: absolute;
    inset: -2px;
    background-image:
      linear-gradient(to right, color-mix(in srgb, var(--ink) 6%, transparent) 1px, transparent 1px),
      linear-gradient(to bottom, color-mix(in srgb, var(--ink) 6%, transparent) 1px, transparent 1px);
    background-size: 46px 46px;
    mask-image: radial-gradient(circle at 50% 0%, #000 0%, transparent 68%);
    -webkit-mask-image: radial-gradient(circle at 50% 0%, #000 0%, transparent 68%);
    opacity: 0.7;
  }

  .orb { position: absolute; border-radius: 50%; filter: blur(72px); }

  .orb-a {
    width: 460px; height: 460px; top: -180px; left: -120px;
    background: radial-gradient(circle, var(--brand-soft), transparent 68%);
  }

  .orb-b {
    width: 520px; height: 520px; right: -180px; bottom: -260px;
    background: radial-gradient(circle, var(--brand-soft), transparent 70%);
  }

  .shell {
    position: relative;
    min-height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 40px 24px;
  }

  .card {
    width: 100%;
    max-width: 640px;
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: 20px;
    box-shadow: var(--shadow);
    overflow: hidden;
    animation: rise 0.5s cubic-bezier(0.22, 1, 0.36, 1) both;
  }

  @keyframes rise {
    from { opacity: 0; transform: translateY(14px) scale(0.985); }
    to { opacity: 1; transform: none; }
  }

  .card-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 16px 24px;
    border-bottom: 1px solid var(--line-soft);
    background: linear-gradient(180deg, var(--field), var(--card));
  }

  .brand { display: flex; align-items: center; gap: 10px; min-width: 0; }

  .mark {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 9px;
    color: #fff;
    background: linear-gradient(140deg, var(--brand), color-mix(in srgb, var(--brand) 62%, #7c3aed));
    box-shadow: 0 6px 16px -6px var(--brand);
  }

  .brand-text {
    display: flex;
    align-items: baseline;
    gap: 7px;
    font-size: 15px;
    letter-spacing: -0.01em;
  }

  .brand-text strong { font-weight: 700; }

  .brand-text em {
    font-style: normal;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--brand);
    background: var(--brand-soft);
    border-radius: 5px;
    padding: 3px 6px;
  }

  .status {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    flex: 0 0 auto;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    padding: 6px 11px;
    border-radius: 999px;
    border: 1px solid transparent;
  }

  .tone-success .status {
    color: var(--ok);
    background: var(--ok-soft);
    border-color: color-mix(in srgb, var(--ok) 26%, transparent);
  }

  .tone-error .status {
    color: var(--err);
    background: var(--err-soft);
    border-color: color-mix(in srgb, var(--err) 26%, transparent);
  }

  .tone-wait .status {
    color: var(--brand);
    background: var(--brand-soft);
    border-color: color-mix(in srgb, var(--brand) 26%, transparent);
  }

  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: currentColor;
    box-shadow: 0 0 0 0 currentColor;
    animation: pulse 2s ease-out infinite;
  }

  @keyframes pulse {
    0% { box-shadow: 0 0 0 0 color-mix(in srgb, currentColor 45%, transparent); }
    70% { box-shadow: 0 0 0 7px transparent; }
    100% { box-shadow: 0 0 0 0 transparent; }
  }

  .card-body { padding: 34px 28px 8px; }

  .hero { text-align: center; }

  .badge {
    display: inline-grid;
    place-items: center;
    width: 68px;
    height: 68px;
    border-radius: 50%;
    margin-bottom: 18px;
  }

  .tone-success .badge {
    color: var(--ok);
    background: var(--ok-soft);
    box-shadow: 0 0 0 8px color-mix(in srgb, var(--ok) 7%, transparent);
  }

  .tone-error .badge {
    color: var(--err);
    background: var(--err-soft);
    box-shadow: 0 0 0 8px color-mix(in srgb, var(--err) 7%, transparent);
  }

  .tone-wait .badge {
    color: var(--brand);
    background: var(--brand-soft);
    box-shadow: 0 0 0 8px color-mix(in srgb, var(--brand) 7%, transparent);
  }

  .glyph { width: 44px; height: 44px; }

  .glyph-ring, .glyph-mark {
    fill: none;
    stroke-width: 3.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .glyph-ring {
    stroke: currentColor;
    opacity: 0.28;
    stroke-dasharray: 145;
    stroke-dashoffset: 145;
    animation: draw 0.7s cubic-bezier(0.65, 0, 0.35, 1) 0.1s forwards;
  }

  .glyph-mark {
    stroke: currentColor;
    stroke-dasharray: 48;
    stroke-dashoffset: 48;
    animation: draw 0.45s cubic-bezier(0.65, 0, 0.35, 1) 0.45s forwards;
  }

  .glyph-dot {
    fill: currentColor;
    opacity: 0;
    animation: fade 0.3s ease 0.75s forwards;
  }

  @keyframes draw { to { stroke-dashoffset: 0; } }
  @keyframes fade { to { opacity: 1; } }

  h1 {
    margin: 0;
    font-size: 27px;
    line-height: 1.22;
    font-weight: 700;
    letter-spacing: -0.022em;
  }

  .lead {
    margin: 12px auto 0;
    max-width: 460px;
    font-size: 14.5px;
    line-height: 1.65;
    color: var(--muted);
  }

  .account {
    margin-top: 26px;
    border: 1px solid var(--line);
    border-radius: 14px;
    background: var(--field);
    overflow: hidden;
  }

  .account-head {
    display: flex;
    align-items: center;
    gap: 13px;
    padding: 16px 18px;
    border-bottom: 1px solid var(--line);
  }

  .avatar {
    display: grid;
    place-items: center;
    flex: 0 0 auto;
    width: 42px;
    height: 42px;
    border-radius: 50%;
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 0.02em;
    color: #fff;
    background: linear-gradient(140deg, var(--brand), color-mix(in srgb, var(--brand) 55%, #7c3aed));
    box-shadow: 0 8px 20px -10px var(--brand);
  }

  .account-id { min-width: 0; }

  .account-id strong {
    display: block;
    font-size: 15px;
    font-weight: 650;
    letter-spacing: -0.01em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .account-id span {
    display: block;
    margin-top: 2px;
    font-size: 12.5px;
    color: var(--muted);
  }

  .rows { margin: 0; padding: 4px 0; }

  .row {
    display: grid;
    grid-template-columns: 132px 1fr;
    gap: 12px;
    align-items: baseline;
    padding: 9px 18px;
  }

  .row + .row { border-top: 1px dashed var(--line); }

  .row dt { font-size: 12.5px; color: var(--muted); }

  .row dd {
    margin: 0;
    font-size: 13.5px;
    color: var(--ink-soft);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row dd.wrap { white-space: normal; word-break: break-all; line-height: 1.55; }

  .mono {
    font-family: "SFMono-Regular", ui-monospace, "JetBrains Mono", Menlo, Consolas, "Liberation Mono", monospace;
    font-size: 12.5px !important;
  }

  .pill {
    display: inline-block;
    padding: 2px 9px;
    border-radius: 999px;
    font-size: 11.5px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: capitalize;
    border: 1px solid transparent;
  }

  .pill-ok {
    color: var(--ok);
    background: var(--ok-soft);
    border-color: color-mix(in srgb, var(--ok) 24%, transparent);
  }

  .pill-neutral {
    color: var(--muted);
    background: var(--field);
    border-color: var(--line);
  }

  .next { margin-top: 26px; }

  .next h2 {
    margin: 0 0 10px;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--muted);
  }

  .commands { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }

  .cmd {
    position: relative;
    width: 100%;
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 12px;
    padding: 11px 13px;
    border: 1px solid var(--line);
    border-radius: 11px;
    background: var(--card);
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: border-color 0.18s ease, transform 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
  }

  .cmd:hover {
    border-color: color-mix(in srgb, var(--brand) 45%, var(--line));
    box-shadow: 0 8px 22px -14px rgba(11, 18, 32, 0.5);
    transform: translateY(-1px);
  }

  .cmd:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }

  .cmd code {
    font-family: "SFMono-Regular", ui-monospace, "JetBrains Mono", Menlo, Consolas, "Liberation Mono", monospace;
    font-size: 12.5px;
    font-weight: 600;
    color: var(--ink);
    white-space: nowrap;
  }

  .cmd-hint {
    font-size: 12.5px;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .copy {
    display: grid;
    place-items: center;
    width: 27px;
    height: 27px;
    border-radius: 8px;
    color: var(--muted);
    background: var(--field);
    transition: color 0.18s ease, background 0.18s ease;
  }

  .cmd:hover .copy { color: var(--brand); background: var(--brand-soft); }

  .cmd.copied .copy { color: var(--ok); background: var(--ok-soft); }

  .autoclose {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 22px;
    padding: 11px 14px;
    border: 1px solid var(--line);
    border-radius: 11px;
    background: var(--field);
  }

  .autoclose p {
    flex: 1 1 auto;
    margin: 0;
    min-width: 0;
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--muted);
  }

  .autoclose strong {
    color: var(--ink-soft);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }

  .timer { flex: 0 0 auto; display: grid; place-items: center; width: 24px; height: 24px; color: var(--brand); }

  .timer svg { width: 24px; height: 24px; transform: rotate(-90deg); }

  .timer circle { fill: none; stroke-width: 2.6; }

  .timer-track { stroke: currentColor; opacity: 0.2; }

  .timer-run {
    stroke: currentColor;
    stroke-linecap: round;
    stroke-dasharray: 62.83;
    stroke-dashoffset: 0;
    animation: sweep var(--autoclose-duration, 10s) linear forwards;
  }

  @keyframes sweep { to { stroke-dashoffset: 62.83; } }

  .autoclose-actions { flex: 0 0 auto; display: flex; gap: 7px; }

  .ghost {
    padding: 6px 11px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--card);
    color: var(--ink-soft);
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
    transition: border-color 0.18s ease, color 0.18s ease, background 0.18s ease;
  }

  .ghost:hover { border-color: color-mix(in srgb, var(--brand) 45%, var(--line)); color: var(--brand); background: var(--brand-soft); }

  .ghost:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }

  .autoclose.stopped .timer,
  .autoclose.stopped .autoclose-actions { display: none; }

  /* 只给读屏器的状态行：倒计时数字每秒都在变，不能放在朗读区里逐秒重播整句。 */
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .card-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    padding: 16px 28px;
    margin-top: 26px;
    border-top: 1px solid var(--line-soft);
    background: linear-gradient(180deg, var(--card), var(--field));
  }

  .card-foot p { margin: 0; font-size: 12.5px; line-height: 1.6; color: var(--muted); }

  .version {
    flex: 0 0 auto;
    font-size: 11px;
    letter-spacing: 0.04em;
    color: var(--muted);
    opacity: 0.75;
  }

  @media (max-width: 560px) {
    .shell { padding: 18px 14px; }
    .card { border-radius: 16px; }
    .card-head { padding: 14px 16px; }
    .card-body { padding: 26px 18px 6px; }
    h1 { font-size: 23px; }
    .row { grid-template-columns: 1fr; gap: 3px; }
    .row dd { white-space: normal; word-break: break-all; }
    .cmd { grid-template-columns: 1fr auto; }
    .cmd-hint { grid-column: 1 / -1; }
    .autoclose { flex-wrap: wrap; }
    .autoclose p { flex-basis: 100%; order: 2; }
    .card-foot { flex-direction: column; align-items: flex-start; padding: 14px 18px; margin-top: 20px; }
  }

  @media (prefers-reduced-motion: reduce) {
    * { animation-duration: 0.001ms !important; animation-delay: 0ms !important; transition-duration: 0.001ms !important; }
    .glyph-ring, .glyph-mark { stroke-dashoffset: 0; }
    .glyph-dot { opacity: 1; }
    .timer { display: none; }
  }`;

// 页面里只跑这一段脚本：倒计时关闭标签页，以及把静态写死的命令复制到剪贴板。
// 全程不读 URL、不发请求。
const CALLBACK_SCRIPT = `(function () {
  var bar = document.querySelector("[data-autoclose]");
  var note = bar && bar.querySelector("[data-autoclose-note]");
  var status = bar && bar.querySelector("[data-autoclose-status]");
  var ticker = null;

  // 可见文案和读屏器状态行一起改：可见那句带每秒跳动的数字（aria-hidden），
  // 状态行只在停止/关闭这类状态变化时更新，避免逐秒朗读。
  function stop(message) {
    if (ticker) {
      clearInterval(ticker);
      ticker = null;
    }
    if (bar) {
      bar.classList.add("stopped");
    }
    if (message) {
      if (note) {
        note.textContent = message;
      }
      if (status) {
        status.textContent = message;
      }
    }
  }

  function closeNow() {
    stop("正在关闭本页…");
    window.close();
    // 浏览器通常只允许脚本关闭由脚本自己打开的标签页，而这一页是登录页跳转过来的，
    // 所以 window.close() 很可能被忽略。真关不掉就把提示换成让用户手动关。
    window.setTimeout(function () {
      stop("浏览器不允许本页自动关闭，你可以手动关闭这个标签页。");
    }, 500);
  }

  if (bar) {
    var left = parseInt(bar.getAttribute("data-autoclose"), 10) || 0;
    var label = bar.querySelector("[data-countdown]");
    var closeButton = bar.querySelector("[data-close-now]");
    var keepButton = bar.querySelector("[data-keep-open]");

    if (closeButton) {
      closeButton.addEventListener("click", closeNow);
    }
    if (keepButton) {
      keepButton.addEventListener("click", function () {
        stop("已取消自动关闭。完成后可随时关闭本页。");
      });
    }

    if (left > 0) {
      ticker = window.setInterval(function () {
        left -= 1;
        if (left <= 0) {
          closeNow();
          return;
        }
        if (label) {
          label.textContent = String(left);
        }
      }, 1000);
    }
  }

  function legacyCopy(text) {
    var area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    var ok = false;
    try {
      ok = document.execCommand("copy");
    } catch (error) {
      ok = false;
    }
    document.body.removeChild(area);
    return ok;
  }

  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(function () {
        return legacyCopy(text);
      });
    }
    return Promise.resolve(legacyCopy(text));
  }

  Array.prototype.forEach.call(document.querySelectorAll("[data-copy]"), function (button) {
    var timer = null;
    button.addEventListener("click", function () {
      // 用户还在这一页上抄命令，别把标签页关掉。
      stop("已取消自动关闭。完成后可随时关闭本页。");
      copy(button.getAttribute("data-copy") || "").then(function () {
        button.classList.add("copied");
        if (timer) {
          clearTimeout(timer);
        }
        timer = setTimeout(function () {
          button.classList.remove("copied");
        }, 1400);
      });
    });
  });
})();`;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function commandRow([command, hint]) {
  return `            <li>
              <button type="button" class="cmd" data-copy="${escapeHtml(command)}">
                <code>${escapeHtml(command)}</code>
                <span class="cmd-hint">${escapeHtml(hint)}</span>
                <span class="copy" aria-hidden="true">${COPY_ICON}</span>
              </button>
            </li>`;
}

function detailRow(label, valueHtml, valueClass = "") {
  const className = valueClass ? ` class="${valueClass}"` : "";
  return `            <div class="row">
              <dt>${escapeHtml(label)}</dt>
              <dd${className}>${valueHtml}</dd>
            </div>`;
}

/**
 * 成功页上的账号卡片。account 里的字段来自认证接口的响应（不是请求参数），
 * 仍然统一走 escapeHtml，避免服务端返回的昵称里带标签时污染页面。
 */
function accountCard(account) {
  if (!account) {
    return "";
  }

  const name = account.name || "Dataify 账号";
  const initial = (account.name || "D").trim().charAt(0).toUpperCase() || "D";
  const status = account.status || "active";
  const statusTone = String(status).toLowerCase() === "active" ? "pill-ok" : "pill-neutral";

  const rows = [
    detailRow("Token 状态", `<span class="pill ${statusTone}">${escapeHtml(status)}</span>`),
    detailRow("到期时间", escapeHtml(account.expires || "-")),
    detailRow("凭证来源", escapeHtml(account.source || "-")),
    detailRow("配置文件", escapeHtml(account.configFile || "-"), "mono wrap")
  ];

  return `
        <section class="account">
          <div class="account-head">
            <span class="avatar" aria-hidden="true">${escapeHtml(initial)}</span>
            <div class="account-id">
              <strong>${escapeHtml(name)}</strong>
              <span>已登录</span>
            </div>
          </div>
          <dl class="rows">
${rows.join("\n")}
          </dl>
        </section>
`;
}

/**
 * 成功页底部的自动关闭倒计时。秒数是代码内常量，这里再取一次整数做保险。
 * 关不掉标签页时（浏览器基本只允许脚本关闭自己打开的窗口）由脚本改成手动关闭提示。
 *
 * 只有确实拿到账号信息（即调用方显式调过 finish("success", account)）时才渲染，
 * 见 callbackPage 里的调用点：结论未定的页面不能 10 秒后自我销毁。
 */
function autoCloseBar(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  if (!total) {
    return "";
  }

  return `
        <div class="autoclose" data-autoclose="${total}" style="--autoclose-duration: ${total}s">
          <span class="timer" aria-hidden="true">
            <svg viewBox="0 0 24 24">
              <circle class="timer-track" cx="12" cy="12" r="10" />
              <circle class="timer-run" cx="12" cy="12" r="10" />
            </svg>
          </span>
          <p data-autoclose-note aria-hidden="true">本页将在 <strong data-countdown>${total}</strong> 秒后自动关闭。</p>
          <p class="sr-only" role="status" data-autoclose-status>本页将在 ${total} 秒后自动关闭。选择“保持打开”可取消。</p>
          <span class="autoclose-actions">
            <button type="button" class="ghost" data-close-now>立即关闭</button>
            <button type="button" class="ghost" data-keep-open>保持打开</button>
          </span>
        </div>
`;
}

/**
 * 渲染回调页。viewName 只能是 CALLBACK_VIEWS 的 key，页面主体文案全部来自
 * 代码内常量，不拼接任何请求参数，避免反射型 XSS。
 * account 是可选的账号卡片数据，只有换 token 成功之后才会传进来；倒计时也绑在
 * 它身上——没有账号信息就说明结果未定，页面不该自己关掉。
 */
function callbackPage(viewName, account = null) {
  const view = CALLBACK_VIEWS[viewName] || CALLBACK_VIEWS.not_found;

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(view.title)}</title>
<style>
${CALLBACK_STYLE}
</style>
</head>
<body class="tone-${view.tone}">
  <div class="backdrop" aria-hidden="true">
    <span class="orb orb-a"></span>
    <span class="orb orb-b"></span>
    <span class="grid"></span>
  </div>

  <main class="shell" role="main">
    <section class="card">
      <header class="card-head">
        <div class="brand">
          <span class="mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
              <path d="M5 5h6a7 7 0 0 1 0 14H5V5Z" stroke="currentColor" stroke-width="2.1" stroke-linejoin="round"/>
              <path d="M5 12h6" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"/>
            </svg>
          </span>
          <span class="brand-text">
            <strong>Dataify</strong>
            <em>CLI</em>
          </span>
        </div>
        <div class="status">
          <span class="dot" aria-hidden="true"></span>
          <span>${escapeHtml(view.status)}</span>
        </div>
      </header>

      <div class="card-body">
${autoCloseBar(account ? view.autoCloseSeconds : 0)}        <div class="hero">
          <span class="badge" aria-hidden="true">${CALLBACK_ICONS[view.icon]}</span>
          <h1>${escapeHtml(view.heading)}</h1>
          <p class="lead">${escapeHtml(view.lead)}</p>
        </div>
${accountCard(account)}
        <section class="next">
          <h2>${escapeHtml(view.commandsTitle)}</h2>
          <ul class="commands">
${view.commands.map(commandRow).join("\n")}
          </ul>
        </section>
      </div>

      <footer class="card-foot">
        <p>${escapeHtml(view.foot)}</p>
        <span class="version">Dataify CLI v${escapeHtml(VERSION)}</span>
      </footer>
    </section>
  </main>

<script>
${CALLBACK_SCRIPT}
</script>
</body>
</html>
`;
}

/**
 * 拼出拉起默认浏览器的命令。抽成纯函数是为了能直接断言 Windows 下的命令行形状。
 *
 * Windows 上必须把 URL 放进双引号里：cmd.exe 会把裸 & 当成命令分隔符，
 * 登录 URL 的 &state=... 之后会被整段截断，浏览器只收到第一个参数。
 * 同时用 windowsVerbatimArguments 阻止 Node 再按 C 运行时规则转义引号
 * （cmd 不认 \" 这种写法）。start 的第一个引号参数是窗口标题，
 * 这个空标题不能省，否则 start 会把带引号的 URL 当作标题而什么都不打开。
 */
export function browserCommand(url, platform = process.platform) {
  if (platform === "win32") {
    return {
      command: process.env.COMSPEC || "cmd.exe",
      args: ["/d", "/s", "/c", `start "" "${url}"`],
      options: { windowsVerbatimArguments: true, windowsHide: true }
    };
  }

  if (platform === "darwin") {
    return { command: "open", args: [url], options: { detached: true } };
  }

  return { command: "xdg-open", args: [url], options: { detached: true } };
}

/**
 * 跨平台拉起默认浏览器。项目不引入第三方依赖，所以直接调系统命令；
 * 拉不起来时返回 false，由调用方提示用户手动复制 URL。
 */
export function openBrowser(url, platform = process.platform) {
  // buildLoginUrl 走的是 URL 序列化，正常不可能带空白或引号；
  // 真出现了说明调用方传错了，此时宁可不拉浏览器，也不要拼出一条被截断的命令。
  if (!url || /["'\s]/.test(url)) {
    return false;
  }

  const { command, args, options } = browserCommand(url, platform);
  try {
    const child = spawn(command, args, { stdio: "ignore", ...options });
    child.on("error", () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}

/**
 * 调用认证后端。所有 CLI 认证接口都返回 { code, data, message, timestamp }，
 * 这里统一解析出 httpStatus / code / data / message 交给调用方判断。
 */
export async function authApiPost(apiBaseUrl, endpoint, body, { timeoutMs = 120000 } = {}) {
  const url = `${String(apiBaseUrl).replace(/\/+$/, "")}${endpoint}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  let text;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    text = await response.text();
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`Request to ${url} timed out after ${timeoutMs}ms`);
    }
    throw new Error(`Request to ${url} failed: ${error?.message || error}`);
  } finally {
    clearTimeout(timer);
  }

  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(`Unexpected non-JSON response from ${url} (HTTP ${response.status})`);
    }
  }

  return {
    httpStatus: response.status,
    code: typeof payload?.code === "number" ? payload.code : response.status,
    data: payload?.data ?? null,
    message: typeof payload?.message === "string" ? payload.message : ""
  };
}

export function isSuccess(result) {
  return result.httpStatus >= 200 && result.httpStatus < 300 && result.code === 200;
}

export function isUnauthorized(result) {
  return result.httpStatus === 401 || result.code === 401;
}

export function formatExpiry(expiresAt) {
  if (!expiresAt) {
    return "永不过期";
  }
  // expiresAt 是 Unix 秒。展示统一按 UTC+8（东八区，无夏令时），手动偏移 8 小时。
  const shifted = new Date(expiresAt * 1000 + 8 * 3600 * 1000);
  const pad = (value) => String(value).padStart(2, "0");
  const date = [shifted.getUTCFullYear(), pad(shifted.getUTCMonth() + 1), pad(shifted.getUTCDate())].join("-");
  const time = [pad(shifted.getUTCHours()), pad(shifted.getUTCMinutes()), pad(shifted.getUTCSeconds())].join(":");
  return `${date} ${time} UTC+8`;
}

export function formatIdentity(identity) {
  return identity?.name || "unknown account";
}
