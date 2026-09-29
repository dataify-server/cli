import fs from "node:fs";
import { t } from "./i18n.js";

// 全局选项白名单：不在这里的选项一律报错，不再出现「接受但静默丢弃」。
// 说明：--endpoint 会在 setOption 里被归一成 server（历史遗留别名），两者已一并移除。
const GLOBAL_OPTIONS = new Set([
  "token",
  "timeout",
  "raw",
  "pretty",
  "output",
  "header",
  "language",
  "debug",
  "help",
  "version"
]);

const COMMANDS = new Set([
  "call",
  "tools",
  "list",
  "schema",
  "config",
  "mcp",
  "skill",
  "init",
  "login",
  "logout",
  "whoami",
  "balance",
  "language",
  "serp",
  "scraper",
  "webunlock",
  "chat",
  "repl",
  "help",
  "version"
]);

export function parseCli(argv) {
  const result = {
    command: "",
    rest: [],
    options: {},
    global: {},
    // 前置位置出现的、不在白名单里的选项；由调用方决定何时报错（要等语言确定后才能给出本地化提示）
    unknownOptions: []
  };

  let index = 0;
  while (index < argv.length) {
    const token = argv[index];
    if (!token.startsWith("-")) {
      result.command = token;
      result.rest = argv.slice(index + 1);
      break;
    }

    const parsed = readOption(argv, index);
    index = parsed.nextIndex;
    if (!GLOBAL_OPTIONS.has(parsed.key)) {
      result.unknownOptions.push(flagLabel(parsed.key));
    }
    setOption(result.global, parsed.key, parsed.value);
  }

  if (!result.command) {
    result.command = result.global.help ? "help" : "";
    return result;
  }

  if (!COMMANDS.has(result.command)) {
    result.options.tool = result.command;
    result.command = "direct-call";
  }

  return result;
}

export function parseKnownOptions(tokens, known = GLOBAL_OPTIONS) {
  const options = {};
  const rest = [];

  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index];
    if (!token.startsWith("-")) {
      rest.push(token);
      index += 1;
      continue;
    }

    const parsed = readOption(tokens, index);
    index = parsed.nextIndex;
    if (known.has(parsed.key)) {
      setOption(options, parsed.key, parsed.value);
    } else {
      rest.push(token);
      if (!token.includes("=") && parsed.consumedValue) {
        rest.push(String(parsed.value));
      }
    }
  }

  return { options, rest };
}

export function parseToolArgs(tokens) {
  const args = {};
  const meta = {
    raw: false,
    pretty: false,
    output: "",
    argsFile: "",
    stdin: false
  };
  let lastArgKey = "";

  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index];
    if (token === "--") {
      throw new Error("Unexpected positional arguments after --");
    }
    if (!token.startsWith("-")) {
      if (lastArgKey) {
        args[lastArgKey] = `${args[lastArgKey]} ${token}`;
        index += 1;
        continue;
      }
      throw new Error(`Unexpected positional argument "${token}". Quote values containing spaces, e.g. --q "hello world".`);
    }

    const parsed = readOption(tokens, index);
    index = parsed.nextIndex;

    switch (parsed.key) {
      case "arg":
        lastArgKey = applyKeyValue(args, parsed.value, parseStringValue);
        break;
      case "arg_json":
        lastArgKey = "";
        applyKeyValue(args, parsed.value, parseJsonValue);
        break;
      case "args_json":
        lastArgKey = "";
        mergeObject(args, parseJsonObject(parsed.value, "--args-json"));
        break;
      case "args_file":
        lastArgKey = "";
        meta.argsFile = parsed.value;
        mergeObject(args, parseJsonObject(fs.readFileSync(parsed.value, "utf8"), parsed.value));
        break;
      case "stdin":
        lastArgKey = "";
        meta.stdin = true;
        break;
      case "raw":
        lastArgKey = "";
        meta.raw = toBoolean(parsed.value);
        break;
      case "pretty":
        lastArgKey = "";
        meta.pretty = toBoolean(parsed.value);
        break;
      case "output":
        lastArgKey = "";
        meta.output = parsed.value;
        break;
      default:
        setToolArg(args, parsed.key, parsed.value);
        lastArgKey = parsed.key;
    }
  }

  return { args, meta };
}

export function parseHeaders(values) {
  const headers = {};
  const list = Array.isArray(values) ? values : values ? [values] : [];
  for (const item of list) {
    const index = String(item).indexOf("=");
    if (index <= 0) {
      throw new Error(`Invalid header "${item}". Use --header Name=value.`);
    }
    headers[item.slice(0, index)] = item.slice(index + 1);
  }
  return headers;
}

export function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("error", reject);
    process.stdin.on("end", () => resolve(data));
  });
}

function readOption(tokens, index) {
  const token = tokens[index];
  const prefix = token.startsWith("--") ? "--" : token.startsWith("-") ? "-" : "";
  if (!prefix) {
    throw new Error(`Expected option at "${token}"`);
  }

  let keyValue = token.slice(prefix.length);
  let value;
  let consumedValue = false;
  const equalIndex = keyValue.indexOf("=");
  if (equalIndex >= 0) {
    value = keyValue.slice(equalIndex + 1);
    keyValue = keyValue.slice(0, equalIndex);
  } else if (tokens[index + 1] !== undefined && isOptionValue(tokens[index + 1])) {
    value = tokens[index + 1];
    consumedValue = true;
  } else {
    value = "true";
  }

  const key = normalizeKey(keyValue);
  return {
    key,
    value,
    consumedValue,
    nextIndex: index + 1 + (consumedValue ? 1 : 0)
  };
}

function normalizeKey(key) {
  return key.replace(/^-+/, "").replace(/-/g, "_");
}

/** 判断是不是「选项」token；负数（如 -1）算值，不算选项。 */
export function isFlagToken(token) {
  const text = String(token ?? "");
  return text.startsWith("-") && !/^-\d/.test(text);
}

function isOptionValue(token) {
  return !isFlagToken(token);
}

/** key（已归一化）→ 面向用户的 --kebab-case 写法。 */
function flagLabel(key) {
  return `--${String(key).replace(/_/g, "-")}`;
}

/**
 * 各子命令用各自的已知选项集合解析完之后，用它检查剩下的 token：
 * 还残留 --xxx 就说明用户传了不支持的选项，直接报错而不是静默丢弃。
 */
export function rejectUnknownOptions(tokens) {
  const list = Array.isArray(tokens) ? tokens : [tokens];
  const flags = list.filter((token) => isFlagToken(token));
  if (flags.length > 0) {
    throw new Error(t("cli.error.unknownOption", { options: flags.join(", ") }));
  }
}

function setOption(target, key, value) {
  const normalized = key === "endpoint" ? "server" : key;
  if (target[normalized] === undefined) {
    target[normalized] = value;
    return;
  }
  if (!Array.isArray(target[normalized])) {
    target[normalized] = [target[normalized]];
  }
  target[normalized].push(value);
}

function setToolArg(target, key, value) {
  target[key] = parseStringValue(value);
}

function parseStringValue(value) {
  if (value === undefined) {
    return "true";
  }
  return String(value);
}

function parseJsonValue(value) {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`Invalid JSON value "${value}": ${error.message}`);
  }
}

function parseJsonObject(value, label) {
  const parsed = parseJsonValue(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must contain a JSON object`);
  }
  return parsed;
}

function applyKeyValue(target, raw, parser) {
  const text = String(raw);
  const index = text.indexOf("=");
  if (index <= 0) {
    throw new Error(`Invalid key/value "${raw}". Use key=value.`);
  }
  const key = normalizeKey(text.slice(0, index));
  target[key] = parser(text.slice(index + 1));
  return key;
}

function mergeObject(target, source) {
  for (const [key, value] of Object.entries(source)) {
    target[key] = value;
  }
}

function toBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }
  const text = String(value).toLowerCase();
  return !["false", "0", "no", "off"].includes(text);
}
