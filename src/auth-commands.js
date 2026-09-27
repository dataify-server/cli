import { parseKnownOptions } from "./args.js";
import {
  AUTH_ENDPOINTS,
  LOGIN_TIMEOUT_MS,
  authApiPost,
  buildLoginUrl,
  createPkceSession,
  formatExpiry,
  formatIdentity,
  isSuccess,
  isUnauthorized,
  openBrowser,
  serveAccountPage,
  startCallbackServer
} from "./auth.js";
import {
  configPath,
  lastOptionValue,
  readConfig,
  resolveAuthEndpoints,
  resolveRequestTimeout,
  writeConfig
} from "./config.js";

const ENDPOINT_OPTIONS = ["auth_api_base_url", "auth_api", "dashboard_login_url", "login_url", "timeout"];

const LOGIN_OPTIONS = new Set([...ENDPOINT_OPTIONS, "force", "f", "no_browser", "help"]);
const LOGOUT_OPTIONS = new Set([...ENDPOINT_OPTIONS, "help"]);
const WHOAMI_OPTIONS = new Set([...ENDPOINT_OPTIONS, "token", "json", "raw", "help"]);

export async function runLogin(tokens = []) {
  const { options } = parseKnownOptions(tokens, LOGIN_OPTIONS);
  if (optionEnabled(options.help)) {
    process.stdout.write(loginHelpText());
    return;
  }

  const force = optionEnabled(options.force) || optionEnabled(options.f);
  const useBrowser = !optionEnabled(options.no_browser);
  const { apiBaseUrl, dashboardLoginUrl } = resolveAuthEndpoints(options);
  const timeoutMs = resolveRequestTimeout(options);

  if (!force) {
    const existingToken = currentToken();
    if (existingToken) {
      const account = await lookupAccount(apiBaseUrl, existingToken, timeoutMs);
      if (account) {
        process.stdout.write(`Already logged in as ${formatIdentity(account)}.\n`);
        if (useBrowser) {
          const page = await serveAccountPage(
            {
              name: account.name,
              status: account.status,
              expires: formatExpiry(account.expiresAt),
              source: "已保存到本地配置文件",
              configFile: configPath()
            },
            { timeoutMs: 15000 }
          );
          process.stdout.write("Opening the saved sign-in page...\n");
          openBrowser(page.url);
          process.stdout.write(`Open this URL to view the saved sign-in:\n${page.url}\n`);
        } else {
          process.stdout.write("Run dataify login --force to sign in again.\n");
        }
        return;
      }
      forgetStaleToken(existingToken, "The saved Dataify token is no longer valid; starting a new login.");
    }
  }

  const pkce = createPkceSession();
  // 兜底回包必须晚于换 token 的请求超时，否则后端一慢，浏览器会先收到一个
  // 结论未定的页面（详见 startCallbackServer 里 responseTimeoutMs 的说明）。
  const callback = await startCallbackServer({
    state: pkce.state,
    timeoutMs: LOGIN_TIMEOUT_MS,
    responseTimeoutMs: timeoutMs + 15000
  });
  const loginUrl = buildLoginUrl(dashboardLoginUrl, {
    redirectUri: callback.redirectUri,
    state: pkce.state,
    codeChallenge: pkce.codeChallenge,
    codeChallengeMethod: pkce.codeChallengeMethod
  });

  let outcome = null;
  // 已经从服务端换到、但还没成功落盘的 token：一旦后续失败，要把它撤销掉，
  // 否则用户控制台里会多出一把自己不知道的 API Key。
  let unsavedToken = "";

  try {
    if (useBrowser) {
      process.stdout.write("Opening browser for Dataify login...\n");
      openBrowser(loginUrl);
    }
    process.stdout.write("Open this URL to continue:\n");
    process.stdout.write(`${loginUrl}\n`);

    outcome = await callback.wait();
    if (outcome.error) {
      const error = new Error("Authorization was declined in the browser. Nothing was saved.");
      error.exitCode = 1;
      throw error;
    }

    const result = await authApiPost(
      apiBaseUrl,
      AUTH_ENDPOINTS.exchange,
      {
        code: outcome.code,
        code_verifier: pkce.codeVerifier,
        state: pkce.state,
        redirect_uri: callback.redirectUri
      },
      { timeoutMs }
    );

    if (!isSuccess(result) || !result.data?.token) {
      const error = new Error(result.message || "Could not exchange the authorization code. Please run dataify login again.");
      error.exitCode = 1;
      throw error;
    }

    const expiresIn = Number(result.data.expires_in) || 0;
    unsavedToken = result.data.token;
    const identity = {
      name: result.data.user?.name || ""
    };
    const expiresAt = expiresIn > 0 ? Math.floor(Date.now() / 1000) + expiresIn : 0;

    const file = writeConfig({
      ...readConfig(),
      token: result.data.token,
      auth: {
        source: "cli-login",
        name: identity.name,
        expires_at: expiresAt,
        updated_at: Math.floor(Date.now() / 1000)
      }
    });

    // 落盘成功，这把 token 已经归本机所有，不再需要善后撤销。
    unsavedToken = "";

    // 换完 token 才回包，让浏览器那一页能显示真实账号信息。
    await outcome.finish("success", {
      name: identity.name,
      status: result.data.token_status || "active",
      expires: formatExpiry(expiresAt),
      source: "已保存到本地配置文件",
      configFile: file
    });

    process.stdout.write(`Saved login to ${file}\n`);
    process.stdout.write(`Logged in as ${formatIdentity(identity)}\n`);
    process.stdout.write(
      expiresAt ? `This CLI API key expires at ${formatExpiry(expiresAt)}.\n` : "This CLI API key never expires.\n"
    );
  } catch (error) {
    // 授权码已经收下但后续失败了：告诉浏览器那一页，别让它一直转圈或误报成功。
    await outcome?.finish?.("login_failed");

    // token 换到了却没能落盘（比如写配置文件权限不足）：服务端那把 key 就成了
    // 谁都管不到的孤儿，best-effort 撤销一次。撤销本身失败不覆盖原始错误。
    if (unsavedToken) {
      try {
        await authApiPost(apiBaseUrl, AUTH_ENDPOINTS.revoke, { dataify_api_token: unsavedToken }, { timeoutMs });
        process.stderr.write("Deleted the new CLI API key on the server because it could not be saved locally.\n");
      } catch (revokeError) {
        process.stderr.write(
          `Could not delete the new CLI API key on the server (${revokeError.message}). Please remove it from the API Key page.\n`
        );
      }
    }

    throw error;
  } finally {
    // code_verifier 与未落盘的 token 用完即从内存清除（登录接口文档第 10 节）。
    pkce.codeVerifier = "";
    unsavedToken = "";
    await callback.close();
  }
}

export async function runLogout(tokens = []) {
  const { options } = parseKnownOptions(tokens, LOGOUT_OPTIONS);
  if (optionEnabled(options.help)) {
    process.stdout.write(logoutHelpText());
    return;
  }

  const config = readConfig();
  const savedToken = config.token || "";
  const envToken = process.env.DATAIFY_API_TOKEN || "";

  if (!savedToken && !envToken) {
    process.stdout.write("Not logged in. Nothing to do.\n");
    return;
  }

  const { apiBaseUrl } = resolveAuthEndpoints(options);
  const timeoutMs = resolveRequestTimeout(options);
  const tokenToRevoke = savedToken || envToken;

  // best-effort：撤销失败不阻塞本地登出。
  try {
    await authApiPost(apiBaseUrl, AUTH_ENDPOINTS.revoke, { dataify_api_token: tokenToRevoke }, { timeoutMs });
    process.stdout.write("Revoked the CLI API key on the server.\n");
  } catch (error) {
    process.stderr.write(`Could not reach the Dataify auth API (${error.message}). Removing the local token anyway.\n`);
  }

  if (savedToken) {
    const next = { ...config };
    delete next.token;
    delete next.auth;
    const file = writeConfig(next);
    process.stdout.write(`Removed the saved token from ${file}\n`);
  }

  if (envToken) {
    process.stderr.write("DATAIFY_API_TOKEN is still set in this environment; unset it to finish signing out.\n");
  }

  process.stdout.write("Logged out.\n");
}

export async function runWhoami(tokens = []) {
  const { options } = parseKnownOptions(tokens, WHOAMI_OPTIONS);
  if (optionEnabled(options.help)) {
    process.stdout.write(whoamiHelpText());
    return;
  }

  const asJson = optionEnabled(options.json) || optionEnabled(options.raw);
  const token = lastOptionValue(options.token) || currentToken();
  if (!token) {
    const error = new Error("Not logged in. Run dataify login.");
    error.exitCode = 1;
    throw error;
  }

  const { apiBaseUrl } = resolveAuthEndpoints(options);
  const timeoutMs = resolveRequestTimeout(options);
  const result = await authApiPost(apiBaseUrl, AUTH_ENDPOINTS.me, { dataify_api_token: token }, { timeoutMs });

  if (isUnauthorized(result)) {
    forgetStaleToken(token, "Removed the invalid token from the local config.");
    const error = new Error("Your Dataify token is no longer valid. Run dataify login.");
    error.exitCode = 1;
    throw error;
  }

  if (!isSuccess(result) || !result.data) {
    const error = new Error(result.message || "Could not read the current Dataify account.");
    error.exitCode = 1;
    throw error;
  }

  if (asJson) {
    process.stdout.write(`${JSON.stringify(result.data, null, 2)}\n`);
    return;
  }

  const rows = [
    ["Account", result.data.name || "-"],
    ["Token status", result.data.token_status || "-"],
    ["Expires", formatExpiry(Number(result.data.expires_at) || 0)],
    ["Config", configPath()]
  ];
  const width = Math.max(...rows.map(([label]) => label.length));
  for (const [label, value] of rows) {
    process.stdout.write(`${label.padEnd(width)}  ${value}\n`);
  }
}

/**
 * 登录后 token 复用 config.token，因此这里的优先级与 resolveRuntimeOptions 保持一致：
 * 环境变量 > 配置文件。
 */
function currentToken() {
  return process.env.DATAIFY_API_TOKEN || readConfig().token || "";
}

async function lookupAccount(apiBaseUrl, token, timeoutMs) {
  let result;
  try {
    result = await authApiPost(apiBaseUrl, AUTH_ENDPOINTS.me, { dataify_api_token: token }, { timeoutMs });
  } catch (error) {
    process.stderr.write(`Could not verify the saved token (${error.message}); continuing with a fresh login.\n`);
    return null;
  }

  if (!isSuccess(result) || !result.data) {
    return null;
  }
  return {
    name: result.data.name || "",
    status: result.data.token_status || "active",
    expiresAt: Number(result.data.expires_at) || 0
  };
}

// 只清理配置文件里那把失效的 token，环境变量和用户其他配置不动。
function forgetStaleToken(token, notice) {
  const config = readConfig();
  if (!config.token || config.token !== token) {
    return;
  }
  const next = { ...config };
  delete next.token;
  delete next.auth;
  writeConfig(next);
  if (notice) {
    process.stdout.write(`${notice}\n`);
  }
}

function optionEnabled(value) {
  if (value === undefined || value === null) {
    return false;
  }
  if (Array.isArray(value)) {
    return optionEnabled(value.at(-1));
  }
  if (typeof value === "boolean") {
    return value;
  }
  const text = String(value).trim().toLowerCase();
  if (!text) {
    return true;
  }
  return !["false", "0", "no", "off"].includes(text);
}

function loginHelpText() {
  return `Dataify login

Usage:
  dataify login
  dataify login --force
  dataify login --no-browser

Options:
  --force, -f        Sign in again even if the saved token still works.
  --no-browser       Only print the login URL, do not launch a browser.
  --timeout VALUE    Auth API request timeout, e.g. 30s, 2m.

Notes:
  Each login creates a new API Key under your account. It is visible on the
  API Key page of the Dataify console and can be deleted there at any time.
  The key expiry (30 days / 90 days / never) is chosen on the browser
  authorization page; 30 days is the default.
`;
}

function logoutHelpText() {
  return `Dataify logout

Usage:
  dataify logout

Deletes the CLI API Key on the server (best effort) and removes the saved
token from the local config. Your other API Keys are not affected.
`;
}

function whoamiHelpText() {
  return `Dataify whoami

Usage:
  dataify whoami
  dataify whoami --json

Options:
  --json             Print the raw account payload.
  --token TOKEN      Check a specific token instead of the saved one.
`;
}
