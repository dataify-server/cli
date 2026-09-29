import { parseCli, parseHeaders, parseKnownOptions, parseToolArgs, readStdin, rejectUnknownOptions } from "./args.js";
import { runLogin, runLogout, runWhoami } from "./auth-commands.js";
import { runCategoryWizard } from "./category.js";
import { McpHttpClient } from "./client.js";
import { DEFAULT_SERVER, DEFAULT_TOOLS, configPath, lastOptionValue, readConfig, resolveRuntimeOptions, writeConfig } from "./config.js";
import { detectToolBusinessError, formatToolResult, printBalance, printToolSchema, printTools, writeOutput } from "./output.js";
import { getLanguage, normalizeLanguage, resolveLanguage, setLanguage, t } from "./i18n.js";
import { runInit } from "./init.js";
import { runLanguageCommand } from "./language-command.js";
import { runInteractive } from "./repl.js";
import { runMcpInstaller } from "./mcp-install.js";
import { runSkillInstaller } from "./skill-install.js";
import { withSpinner } from "./spinner.js";
import { VERSION } from "./version.js";

// 这些命令名后面的 --xxx 是传给 MCP 工具的「工具参数」，不是 CLI 选项，不能当成未知选项报错。
const TOOL_ARG_COMMANDS = new Set(["call", "direct-call", "serp", "scraper", "webunlock"]);

export function noTokenMessage() {
  return t("cli.error.noToken");
}

// 兼容旧的具名导出：固定为默认语言（英文）的文案。新代码请用 noTokenMessage()。
export const NO_TOKEN_MESSAGE = noTokenMessage();

export async function main(argv, options = {}) {
  const parsed = parseCli(argv);
  const command = parsed.command;
  // 语言优先级：显式 --language > 交互会话语言（options.language，由 REPL 注入）> 环境变量/配置。
  // 以前是 options.language 优先，导致交互模式里 `--language en` 被会话语言静默压掉。
  // 会话语言仍然保留为兜底，这样 /language 切换在配置不可写时也不会丢。
  setLanguage(normalizeLanguage(parsed.global.language) || options.language || resolveLanguage(parsed.global));

  // 前置位置出现未知全局选项时直接报错：以前会被静默接受再丢掉，用户以为生效了。
  // 放在 setLanguage 之后，保证提示语言与用户选择一致。
  if (parsed.unknownOptions.length > 0) {
    throw new Error(t("cli.error.unknownOption", { options: parsed.unknownOptions.join(", ") }));
  }

  if (parsed.global.version || command === "version") {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  if (!command) {
    if (options.interactive !== false && process.stdin.isTTY && process.stdout.isTTY) {
      await runInteractive((tokens) => main(tokens, { interactive: false, language: getLanguage() }), { version: VERSION });
      return;
    }
    process.stdout.write(helpText());
    return;
  }

  if (command === "chat" || command === "repl") {
    rejectUnknownOptions(parsed.rest);
    await runInteractive((tokens) => main(tokens, { interactive: false, language: getLanguage() }), { version: VERSION });
    return;
  }

  if (command === "help" || parsed.global.help) {
    process.stdout.write(helpText());
    return;
  }

  if (command === "config") {
    await runConfig(parsed.rest);
    return;
  }

  if (command === "init") {
    await runInit(parsed.rest);
    return;
  }

  if (command === "login") {
    await runLogin(parsed.rest);
    return;
  }

  if (command === "logout") {
    await runLogout(parsed.rest);
    return;
  }

  if (command === "whoami") {
    await runWhoami(parsed.rest);
    return;
  }

  if (command === "skill") {
    await runSkillInstaller(parsed.rest);
    return;
  }

  if (command === "language") {
    await runLanguageCommand(parsed.rest);
    return;
  }

  const { options: trailingGlobal, rest } = parseKnownOptions(parsed.rest);
  const globalOptions = {
    ...parsed.global,
    ...trailingGlobal
  };

  // --language 允许写在子命令之后（dataify schema x --language en），但上面那次 setLanguage
  // 只看得到前置参数，尾部参数要到 parseKnownOptions 之后才合并进来，所以这里再定一次。
  // 前置/后置的显式 --language 同样优先于交互会话语言。
  setLanguage(normalizeLanguage(globalOptions.language) || options.language || resolveLanguage(globalOptions));

  // 走到这里的命令里，只有这几个的尾部 --xxx 是「工具参数」，其余命令残留的选项都算不支持。
  if (!TOOL_ARG_COMMANDS.has(command)) {
    rejectUnknownOptions(rest);
  }

  if (globalOptions.help) {
    process.stdout.write(helpText());
    return;
  }

  if (command === "mcp") {
    const runtime = resolveRuntimeOptions(globalOptions);
    await runMcpInstaller(runtime);
    return;
  }

  const runtime = resolveRuntimeOptions(globalOptions);
  const headers = parseHeaders(globalOptions.header);
  const client = new McpHttpClient({
    ...runtime,
    headers
  });

  try {
    if (command === "tools" || command === "list") {
      const tools = await withSpinner(t("cli.loading.tools"), () => client.listTools(), spinnerOptions(globalOptions));
      writeOutput(printTools(tools, { raw: optionEnabled(globalOptions.raw) }), globalOptions.output);
      return;
    }

    if (command === "balance") {
      if (!runtime.token) {
        throw new Error(noTokenMessage());
      }
      const result = await withSpinner(t("cli.loading.balance"), () => client.callTool("query_user_balance", {}), spinnerOptions(globalOptions));
      if (result?.isError) {
        const text = formatToolResult(result, { raw: optionEnabled(globalOptions.raw) });
        const error = new Error(text.trim() || t("cli.error.balanceFailed"));
        error.exitCode = 2;
        throw error;
      }
      writeOutput(printBalance(result, { raw: optionEnabled(globalOptions.raw) }), globalOptions.output);
      return;
    }

    if (command === "serp" || command === "scraper" || command === "webunlock") {
      await runCategoryWizard(command, client, rest, globalOptions);
      return;
    }

    if (command === "schema") {
      const toolName = rest[0];
      if (!toolName) {
        throw new Error(t("cli.error.schemaUsage"));
      }
      const tools = await withSpinner(t("cli.loading.schema", { tool: toolName }), () => client.listTools(), spinnerOptions(globalOptions));
      const tool = tools.find((item) => item.name === toolName);
      if (!tool) {
        throw new Error(t("cli.error.toolNotReturned", { tool: toolName }));
      }
      writeOutput(printToolSchema(tool), globalOptions.output);
      return;
    }

    if (command === "call") {
      const toolName = rest[0];
      if (!toolName) {
        throw new Error(t("cli.error.callUsage"));
      }
      await runToolCall(client, toolName, rest.slice(1), globalOptions);
      return;
    }

    if (command === "direct-call") {
      await runToolCall(client, parsed.options.tool, rest, globalOptions);
      return;
    }

    throw new Error(t("cli.error.unknownCommand", { command }));
  } finally {
    await client.close();
  }
}

async function runToolCall(client, toolName, tokens, globalOptions) {
  const { args, meta } = parseToolArgs(tokens);
  if (meta.stdin) {
    const stdin = await readStdin();
    if (stdin.trim()) {
      Object.assign(args, JSON.parse(stdin));
    }
  }

  const result = await withSpinner(t("cli.calling", { tool: toolName }), () => client.callTool(toolName, args), spinnerOptions(globalOptions));
  if (result?.isError) {
    const text = formatToolResult(result, { raw: optionEnabled(globalOptions.raw) || meta.raw });
    const error = new Error(text.trim() || t("cli.error.toolFailed", { tool: toolName }));
    error.exitCode = 2;
    throw error;
  }

  // 服务端把鉴权/参数失败包在正常返回里（code=400）时，也必须以非 0 退出码结束。
  const businessError = detectToolBusinessError(result);
  if (businessError) {
    const error = new Error(businessError.message || t("cli.error.toolFailed", { tool: toolName }));
    error.exitCode = 2;
    throw error;
  }

  const output = formatToolResult(result, {
    raw: optionEnabled(globalOptions.raw) || meta.raw,
    pretty: globalOptions.pretty !== "false" && meta.pretty !== false
  });
  writeOutput(output, globalOptions.output || meta.output);
}

function optionEnabled(value) {
  if (value === undefined) {
    return false;
  }
  if (Array.isArray(value)) {
    return optionEnabled(value.at(-1));
  }
  if (typeof value === "boolean") {
    return value;
  }
  const text = String(value).toLowerCase();
  return !["false", "0", "no", "off"].includes(text);
}

function redactConfigForDisplay(config) {
  const next = { ...config };
  if (typeof next.token === "string" && next.token) {
    next.token = "[redacted]";
  }
  return next;
}

function spinnerOptions(globalOptions) {
  return {
    enabled: !globalOptions.output && !optionEnabled(globalOptions.debug)
  };
}

async function runConfig(tokens) {
  const subcommand = tokens[0] || "get";
  const { options, rest } = parseKnownOptions(tokens.slice(1), new Set(["token", "timeout", "language", "help"]));
  rejectUnknownOptions(rest);

  if (subcommand === "path") {
    process.stdout.write(`${configPath()}\n`);
    return;
  }

  if (subcommand === "get") {
    const config = redactConfigForDisplay(readConfig());
    process.stdout.write(`${JSON.stringify(config, null, 2)}\n`);
    return;
  }

  if (subcommand === "set") {
    const current = readConfig();
    const next = { ...current };
    for (const key of ["token", "timeout"]) {
      if (options[key] !== undefined) {
        next[key] = Array.isArray(options[key]) ? options[key].at(-1) : options[key];
      }
    }
    const languageValue = lastOptionValue(options.language);
    if (languageValue !== undefined) {
      const normalized = normalizeLanguage(languageValue);
      if (!normalized) {
        throw new Error(t("language.invalid", { value: languageValue }));
      }
      next.language = normalized;
      setLanguage(normalized);
    }
    const file = writeConfig(next);
    process.stdout.write(`${t("cli.config.saved", { file })}\n`);
    return;
  }

  throw new Error(t("cli.error.unknownConfigCommand", { subcommand }));
}

function helpText() {
  return t("cli.help", { version: VERSION, server: DEFAULT_SERVER, tools: DEFAULT_TOOLS });
}
