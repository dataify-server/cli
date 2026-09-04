import fs from "node:fs";

const GLOBAL_OPTIONS = new Set([
  "server",
  "endpoint",
  "token",
  "tools",
  "timeout",
  "raw",
  "pretty",
  "output",
  "header",
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
  "balance",
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
    global: {}
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

  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index];
    if (token === "--") {
      throw new Error("Unexpected positional arguments after --");
    }
    if (!token.startsWith("-")) {
      throw new Error(`Unexpected positional argument "${token}"`);
    }

    const parsed = readOption(tokens, index);
    index = parsed.nextIndex;

    switch (parsed.key) {
      case "arg":
        applyKeyValue(args, parsed.value, parseStringValue);
        break;
      case "arg_json":
        applyKeyValue(args, parsed.value, parseJsonValue);
        break;
      case "args_json":
        mergeObject(args, parseJsonObject(parsed.value, "--args-json"));
        break;
      case "args_file":
        meta.argsFile = parsed.value;
        mergeObject(args, parseJsonObject(fs.readFileSync(parsed.value, "utf8"), parsed.value));
        break;
      case "stdin":
        meta.stdin = true;
        break;
      case "raw":
        meta.raw = toBoolean(parsed.value);
        break;
      case "pretty":
        meta.pretty = toBoolean(parsed.value);
        break;
      case "output":
        meta.output = parsed.value;
        break;
      default:
        setToolArg(args, parsed.key, parsed.value);
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

function isOptionValue(token) {
  if (!token.startsWith("-")) {
    return true;
  }
  return /^-\d/.test(token);
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
  target[normalizeKey(text.slice(0, index))] = parser(text.slice(index + 1));
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
