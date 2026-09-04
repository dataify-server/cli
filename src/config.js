import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CONFIG_DIR = ".dataify-mcp-cli";
const CONFIG_FILE = "config.json";
export const DEFAULT_SERVER = "https://mcp.dataify.com/mcp";
export const DEFAULT_TOOLS = "user_info,web_unlocker,google_serp,yandex_serp,duckduckgo_serp,bing_serp,amazon,youtube,facebook,instagram,reddit,walmart,google,booking,indeed,airbnb,google_play_store,github,tiktok,linkedin,glassdoor,twitter,crunchbase,zillow,ebay";

export function configPath() {
  return path.join(os.homedir(), CONFIG_DIR, CONFIG_FILE);
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
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf8");
  return file;
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
