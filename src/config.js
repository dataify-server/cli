import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CONFIG_DIR = ".dataify-mcp-cli";
const CONFIG_FILE = "config.json";
export const DEFAULT_SERVER = "https://mcp.dataify.com/mcp";
export const DEFAULT_TOOLS = "user_info,web_unlocker,google_serp,yandex_serp,duckduckgo_serp,bing_serp,amazon,youtube,facebook,instagram,reddit,walmart,google,booking,indeed,airbnb,google_play_store,github,tiktok,linkedin,glassdoor,twitter,crunchbase,zillow,ebay";
export const DEFAULT_AUTH_API_BASE_URL = "https://api.dataify.com";
export const DEFAULT_DASHBOARD_LOGIN_URL = "https://dashboard.dataify.com/login";

export function configDir() {
  return path.join(os.homedir(), CONFIG_DIR);
}

export function configPath() {
  return path.join(configDir(), CONFIG_FILE);
}

export function readConfig() {
  const file = configPath();
  if (!fs.existsSync(file)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`Failed to read config ${file}: ${error.message}`);
  }
}

export function writeConfig(nextConfig) {
  const file = configPath();
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  restrictPermissions(dir, 0o700);
  fs.writeFileSync(file, `${JSON.stringify(nextConfig, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  restrictPermissions(file, 0o600);
  return file;
}

// Windows 上 chmod 基本是空操作，失败也不该让命令挂掉；POSIX 上按登录接口文档
// 第 16 节的要求把目录收紧到 0700、凭证文件收紧到 0600。
function restrictPermissions(target, mode) {
  try {
    fs.chmodSync(target, mode);
  } catch {
    // ignore: filesystem does not support POSIX permissions
  }
}

export function resolveAuthEndpoints(cliOptions = {}) {
  const config = readConfig();
  const apiBaseUrl = stripTrailingSlash(
    lastOptionValue(cliOptions.auth_api_base_url) ||
      lastOptionValue(cliOptions.auth_api) ||
      config.authApiBaseUrl ||
      DEFAULT_AUTH_API_BASE_URL
  );
  const dashboardLoginUrl =
    lastOptionValue(cliOptions.dashboard_login_url) ||
    lastOptionValue(cliOptions.login_url) ||
    config.dashboardLoginUrl ||
    DEFAULT_DASHBOARD_LOGIN_URL;

  return { apiBaseUrl, dashboardLoginUrl };
}

export function resolveRequestTimeout(cliOptions = {}) {
  const config = readConfig();
  return parseTimeout(
    lastOptionValue(cliOptions.timeout) ||
      process.env.DATAIFY_MCP_TIMEOUT ||
      config.timeout ||
      "120000"
  );
}

export function lastOptionValue(value) {
  if (Array.isArray(value)) {
    return value.at(-1);
  }
  return value;
}

function stripTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

export function resolveRuntimeOptions(cliOptions = {}) {
  const config = readConfig();
  const timeoutValue =
    cliOptions.timeout ||
    process.env.DATAIFY_MCP_TIMEOUT ||
    config.timeout ||
    "120000";

  return {
    server: DEFAULT_SERVER,
    token:
      cliOptions.token ||
      process.env.DATAIFY_API_TOKEN ||
      config.token ||
      "",
    tools: DEFAULT_TOOLS,
    timeoutMs: parseTimeout(timeoutValue),
    debug: parseBooleanOption(cliOptions.debug)
  };
}

export function parseTimeout(value) {
  if (typeof value === "number") {
    return value;
  }
  const text = String(value || "").trim();
  if (!text) {
    return 120000;
  }

  const match = text.match(/^(\d+(?:\.\d+)?)(ms|s|m)?$/i);
  if (!match) {
    throw new Error(`Invalid timeout value "${value}". Use milliseconds, 30s, or 2m.`);
  }

  const amount = Number(match[1]);
  const unit = (match[2] || "ms").toLowerCase();
  if (unit === "ms") {
    return Math.round(amount);
  }
  if (unit === "s") {
    return Math.round(amount * 1000);
  }
  if (unit === "m") {
    return Math.round(amount * 60000);
  }
  return Math.round(amount);
}

function parseBooleanOption(value) {
  if (value === undefined || value === null) {
    return false;
  }
  if (Array.isArray(value)) {
    return parseBooleanOption(value.at(-1));
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
