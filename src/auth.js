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

// callback 页面的品牌 logo，内联自 design 导出的 dataify 字标；
// 用 currentColor 让字标跟随深浅色主题（--ink）。
const CALLBACK_LOGO = `<svg viewBox="0 0 490 148" role="img" aria-label="Dataify" focusable="false">
    <path d="M421.527 137.854C421.527 135.671 422.103 133.881 423.254 132.483C424.448 131.13 425.919 130.453 427.667 130.453C429.032 130.453 430.204 130.715 431.185 131.239C432.165 131.763 433.04 132.44 433.807 133.269C434.447 133.924 435.129 134.82 435.854 135.955C436.578 137.09 437.154 138.029 437.58 138.771C439.712 137.592 442.249 134.514 445.191 129.536C448.176 124.558 450.329 120.191 451.651 116.436C447.6 106.087 443.933 96.8299 440.65 88.6643C437.367 80.4986 433.935 72.0492 430.353 63.3159C429.543 61.3073 428.179 59.7571 426.26 58.6655C424.341 57.5301 422.423 56.8096 420.504 56.504V52.181H449.284V56.766C448.005 56.8096 446.47 57.0935 444.68 57.6175C442.889 58.0978 441.993 58.6655 441.993 59.3205C441.993 59.5825 442.079 60.0191 442.249 60.6304C442.462 61.2418 442.697 61.8749 442.953 62.5299C444.573 66.8529 447.046 73.0972 450.372 81.2628C453.697 89.3848 456.277 95.8911 458.11 100.782C460.029 96.1094 462.012 91.2843 464.058 86.3063C466.148 81.2847 468.471 75.3679 471.03 68.5559C471.328 67.7262 471.755 66.5909 472.309 65.1499C472.863 63.6653 473.14 62.3989 473.14 61.3509C473.14 60.2156 472.16 59.1676 470.198 58.207C468.28 57.2026 466.446 56.5913 464.698 56.373V52.181H488.106V56.242C486.827 56.4603 485.143 57.2245 483.053 58.5345C480.964 59.8008 479.408 61.6129 478.385 63.9709C473.311 76.0228 468.791 87.005 464.826 96.9172C460.903 106.829 457.919 114.122 455.872 118.794C453.186 124.907 450.777 129.667 448.645 133.073C446.556 136.523 444.509 139.23 442.505 141.195C440.544 143.029 438.753 144.252 437.133 144.863C435.555 145.518 433.914 145.845 432.208 145.845C428.882 145.845 426.26 145.038 424.341 143.422C422.465 141.806 421.527 139.95 421.527 137.854Z" fill="currentColor"/>
    <path d="M425.434 23.1646C425.434 25.1296 424.922 26.7889 423.899 28.1426C422.875 29.4963 421.319 30.1731 419.23 30.1731C417.908 30.1731 416.736 29.8893 415.712 29.3216C414.732 28.7539 413.815 27.9898 412.962 27.0291C412.109 26.0685 411.321 24.9768 410.596 23.7541C409.871 22.5315 409.253 21.549 408.741 20.8067C405.884 20.9377 403.667 22.99 402.09 26.9636C400.555 30.8936 399.787 37.1815 399.787 45.8275V52.443H416.032V58.7309H399.787V105.105C399.787 106.633 400.064 107.877 400.619 108.838C401.216 109.799 402.132 110.519 403.369 111C404.392 111.393 405.756 111.72 407.462 111.982C409.167 112.2 410.638 112.353 411.875 112.441V116.764H378.618V112.441C379.598 112.353 380.6 112.266 381.624 112.179C382.69 112.091 383.606 111.917 384.374 111.655C385.568 111.262 386.442 110.585 386.996 109.624C387.593 108.62 387.891 107.332 387.891 105.76V58.7309H375.42V52.443H387.891V48.3165C387.891 38.4915 390.364 30.5443 395.31 24.4746C400.299 18.3613 406.524 15.3047 413.986 15.3047C417.78 15.3047 420.637 16.0688 422.556 17.5972C424.474 19.1255 425.434 20.9813 425.434 23.1646Z" fill="currentColor"/>
    <path d="M365.512 116.764H335.004V112.441C335.985 112.353 336.987 112.266 338.01 112.179C339.076 112.091 339.993 111.917 340.761 111.655C341.954 111.262 342.828 110.585 343.383 109.624C343.98 108.62 344.278 107.332 344.278 105.76V65.8704C344.278 64.4731 343.958 63.2067 343.319 62.0714C342.722 60.8924 341.869 59.9099 340.761 59.1239C339.95 58.5999 338.778 58.1633 337.243 57.8139C335.708 57.4209 334.301 57.1808 333.022 57.0934V52.836L355.279 51.395L356.174 52.312V104.974C356.174 106.502 356.451 107.768 357.005 108.773C357.602 109.777 358.519 110.519 359.756 111C360.694 111.393 361.61 111.72 362.506 111.982C363.401 112.2 364.403 112.353 365.512 112.441V116.764ZM357.453 25.9156C357.453 28.4046 356.643 30.5879 355.023 32.4656C353.445 34.2996 351.484 35.2166 349.139 35.2166C346.964 35.2166 345.067 34.3432 343.447 32.5966C341.869 30.8063 341.08 28.7758 341.08 26.5051C341.08 24.1035 341.869 22.0075 343.447 20.2172C345.067 18.4268 346.964 17.5317 349.139 17.5317C351.569 17.5317 353.552 18.3832 355.087 20.0862C356.664 21.7455 357.453 23.6886 357.453 25.9156Z" fill="currentColor"/>
    <path d="M323.37 115.585C321.366 116.327 319.596 116.916 318.061 117.353C316.569 117.833 314.863 118.074 312.945 118.074C309.619 118.074 306.954 117.288 304.95 115.716C302.989 114.1 301.731 111.764 301.177 108.707H300.793C298.022 111.851 295.037 114.253 291.839 115.912C288.684 117.571 284.868 118.401 280.391 118.401C275.658 118.401 271.757 116.916 268.687 113.947C265.66 110.978 264.146 107.091 264.146 102.288C264.146 99.7992 264.487 97.5722 265.169 95.6072C265.851 93.6422 266.875 91.8737 268.239 90.3017C269.305 88.9918 270.712 87.8346 272.46 86.8303C274.208 85.7823 275.85 84.9526 277.385 84.3413C279.304 83.599 283.184 82.2235 289.025 80.2148C294.909 78.2062 298.874 76.6342 300.921 75.4988V69.0144C300.921 68.4467 300.793 67.3551 300.537 65.7394C300.324 64.1237 299.834 62.5954 299.066 61.1544C298.213 59.5388 296.998 58.1414 295.421 56.9625C293.886 55.7398 291.69 55.1285 288.833 55.1285C286.872 55.1285 285.038 55.4778 283.333 56.1765C281.67 56.8315 280.497 57.5301 279.815 58.2724C279.815 59.1458 280.007 60.4339 280.391 62.1369C280.817 63.8399 281.03 65.4119 281.03 66.8529C281.03 68.3812 280.348 69.7785 278.984 71.0449C277.662 72.3112 275.807 72.9444 273.42 72.9444C271.288 72.9444 269.71 72.1802 268.687 70.6519C267.706 69.0799 267.216 67.3332 267.216 65.4119C267.216 63.4033 267.898 61.4819 269.262 59.6479C270.669 57.814 272.482 56.1765 274.699 54.7355C276.617 53.5128 278.941 52.4867 281.67 51.657C284.399 50.7837 287.064 50.347 289.665 50.347C293.246 50.347 296.359 50.609 299.002 51.133C301.688 51.6133 304.119 52.6832 306.293 54.3425C308.468 55.9581 310.109 58.1633 311.218 60.9579C312.369 63.7089 312.945 67.2677 312.945 71.6344C312.945 77.8787 312.881 83.4243 312.753 88.2713C312.625 93.0746 312.561 98.3364 312.561 104.057C312.561 105.76 312.838 107.113 313.392 108.118C313.989 109.122 314.885 109.973 316.079 110.672C316.718 111.065 317.72 111.283 319.085 111.327C320.492 111.371 321.92 111.393 323.37 111.393V115.585ZM301.049 81.0008C297.425 82.0925 294.248 83.1623 291.519 84.2103C288.791 85.2583 286.254 86.5683 283.908 88.1403C281.777 89.6249 280.092 91.3934 278.856 93.4457C277.619 95.4544 277.001 97.856 277.001 100.651C277.001 104.275 277.918 106.939 279.751 108.642C281.627 110.345 283.994 111.196 286.85 111.196C289.878 111.196 292.543 110.454 294.845 108.969C297.147 107.441 299.088 105.65 300.665 103.598L301.049 81.0008Z" fill="currentColor"/>
    <path d="M252.063 113.947C249.292 115.126 246.67 116.109 244.197 116.895C241.724 117.724 238.696 118.139 235.115 118.139C229.828 118.139 226.097 116.785 223.922 114.078C221.79 111.327 220.725 107.463 220.725 102.485V58.731H209.34V52.4431H220.98V32.3347H232.62V52.4431H250.72V58.731H232.748V94.8213C232.748 97.5286 232.834 99.7993 233.004 101.633C233.217 103.424 233.686 104.996 234.411 106.349C235.093 107.616 236.117 108.576 237.481 109.231C238.846 109.886 240.679 110.214 242.981 110.214C244.047 110.214 245.604 110.126 247.65 109.952C249.739 109.733 251.21 109.471 252.063 109.166V113.947Z" fill="currentColor"/>
    <path d="M201.607 115.585C199.603 116.327 197.833 116.916 196.298 117.353C194.806 117.833 193.1 118.074 191.182 118.074C187.856 118.074 185.191 117.288 183.187 115.716C181.226 114.1 179.968 111.764 179.414 108.707H179.03C176.258 111.851 173.274 114.253 170.076 115.912C166.921 117.571 163.105 118.401 158.628 118.401C153.895 118.401 149.994 116.916 146.924 113.947C143.896 110.978 142.383 107.091 142.383 102.288C142.383 99.7992 142.724 97.5722 143.406 95.6072C144.088 93.6422 145.112 91.8737 146.476 90.3017C147.542 88.9918 148.949 87.8346 150.697 86.8303C152.445 85.7823 154.087 84.9526 155.622 84.3413C157.54 83.599 161.421 82.2235 167.262 80.2148C173.146 78.2062 177.111 76.6342 179.158 75.4988V69.0144C179.158 68.4467 179.03 67.3551 178.774 65.7394C178.561 64.1237 178.071 62.5954 177.303 61.1544C176.45 59.5388 175.235 58.1414 173.658 56.9625C172.123 55.7398 169.927 55.1285 167.07 55.1285C165.109 55.1285 163.275 55.4778 161.57 56.1765C159.907 56.8315 158.734 57.5301 158.052 58.2724C158.052 59.1458 158.244 60.4339 158.628 62.1369C159.054 63.8399 159.267 65.4119 159.267 66.8529C159.267 68.3812 158.585 69.7785 157.221 71.0449C155.899 72.3112 154.044 72.9444 151.657 72.9444C149.525 72.9444 147.947 72.1802 146.924 70.6519C145.943 69.0799 145.453 67.3332 145.453 65.4119C145.453 63.4033 146.135 61.4819 147.499 59.6479C148.906 57.814 150.718 56.1765 152.936 54.7355C154.854 53.5128 157.178 52.4867 159.907 51.657C162.636 50.7837 165.301 50.347 167.901 50.347C171.483 50.347 174.596 50.609 177.239 51.133C179.925 51.6133 182.356 52.6832 184.53 54.3425C186.705 55.9581 188.346 58.1633 189.455 60.9579C190.606 63.7089 191.182 67.2677 191.182 71.6344C191.182 77.8787 191.118 83.4243 190.99 88.2713C190.862 93.0746 190.798 98.3364 190.798 104.057C190.798 105.76 191.075 107.113 191.629 108.118C192.226 109.122 193.122 109.973 194.315 110.672C194.955 111.065 195.957 111.283 197.321 111.327C198.728 111.371 200.157 111.393 201.607 111.393V115.585ZM179.286 81.0008C175.661 82.0925 172.485 83.1623 169.756 84.2103C167.027 85.2583 164.49 86.5683 162.145 88.1403C160.013 89.6249 158.329 91.3934 157.093 93.4457C155.856 95.4544 155.238 97.856 155.238 100.651C155.238 104.275 156.155 106.939 157.988 108.642C159.864 110.345 162.231 111.196 165.087 111.196C168.115 111.196 170.779 110.454 173.082 108.969C175.384 107.441 177.324 105.65 178.902 103.598L179.286 81.0008Z" fill="currentColor"/>
    <path d="M56.3797 2.39062H2.23438C7.01871 7.91443 21.1531 22.5131 21.1531 61.5743C21.1531 98.2682 7.01871 113.656 2.23438 118.391H56.3797C51.9941 116.418 38.6571 102.293 38.6571 61.5743C38.6571 20.8559 51.9941 5.15253 56.3797 2.39062Z" fill="currentColor"/>
    <path d="M122.383 61.5743C122.383 16.1212 80.1214 3.17974 58.9905 2.39062C71.7488 5.94165 92.6995 22.7498 92.6995 61.5743C92.6995 100.399 71.7488 115.629 58.9905 118.391C80.1214 118.391 122.383 107.027 122.383 61.5743Z" fill="currentColor"/>
  </svg>`;

// callback 页面账号头像用的品牌图标：128x128 PNG 内联成 data URI，
// 让页面保持自包含（本地回调服务只响应一次请求，外链资源拿不到）。
const CALLBACK_AVATAR =
  "data:image/png;base64,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";

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

  .logo {
    display: inline-flex;
    align-items: center;
    color: var(--ink);
  }

  .logo svg {
    display: block;
    height: 26px;
    width: auto;
  }

  .brand-text {
    display: flex;
    align-items: baseline;
    gap: 7px;
    font-size: 15px;
    letter-spacing: -0.01em;
  }

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
    display: block;
    flex: 0 0 auto;
    width: 42px;
    height: 42px;
    border-radius: 50%;
    overflow: hidden;
    box-shadow: 0 8px 20px -10px var(--brand);
  }

  .avatar img {
    display: block;
    width: 100%;
    height: 100%;
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
            <span class="avatar" aria-hidden="true"><img src="${CALLBACK_AVATAR}" alt="" width="42" height="42"></span>
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
          <span class="logo">${CALLBACK_LOGO}</span>
          <span class="brand-text">
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
