import { parseCli, parseHeaders, parseKnownOptions, parseToolArgs, readStdin } from "./args.js";
import { runCategoryWizard } from "./category.js";
import { McpHttpClient } from "./client.js";
import { DEFAULT_SERVER, DEFAULT_TOOLS, configPath, readConfig, resolveRuntimeOptions, writeConfig } from "./config.js";
import { formatToolResult, printBalance, printToolSchema, printTools, writeOutput } from "./output.js";
import { runInit } from "./init.js";
import { runInteractive } from "./repl.js";
import { runMcpInstaller } from "./mcp-install.js";
import { runSkillInstaller } from "./skill-install.js";
import { withSpinner } from "./spinner.js";
import { VERSION } from "./version.js";

const BLOCKED_COMMANDS = new Set(["login", "logout", "whoami"]);

export async function main(argv, options = {}) {
  const parsed = parseCli(argv);
  const command = parsed.command;

  if (parsed.global.version || command === "version") {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  if (!command) {
    if (options.interactive !== false && process.stdin.isTTY && process.stdout.isTTY) {
      await runInteractive((tokens) => main(tokens, { interactive: false }), { version: VERSION });
      return;
    }
    process.stdout.write(helpText());
    return;
  }

  if (command === "chat" || command === "repl") {
    await runInteractive((tokens) => main(tokens, { interactive: false }), { version: VERSION });
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

  if (command === "skill") {
    await runSkillInstaller(parsed.rest);
    return;
  }

  const { options: trailingGlobal, rest } = parseKnownOptions(parsed.rest);
  const globalOptions = {
    ...parsed.global,
    ...trailingGlobal
  };

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
      const tools = await withSpinner("Loading tools...", () => client.listTools(), spinnerOptions(globalOptions));
      writeOutput(printTools(tools, { raw: optionEnabled(globalOptions.raw) }), globalOptions.output);
      return;
    }

    if (command === "balance") {
      if (!runtime.token) {
        throw new Error("No Dataify token found. Run dataify config set --token TOKEN first, or pass --token TOKEN.");
      }
      const result = await withSpinner("Loading balance...", () => client.callTool("query_user_balance", {}), spinnerOptions(globalOptions));
      if (result?.isError) {
        const text = formatToolResult(result, { raw: optionEnabled(globalOptions.raw) });
        const error = new Error(text.trim() || "Balance query returned an error");
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
        throw new Error("Usage: dataify schema <tool>");
      }
      const tools = await withSpinner(`Loading schema for ${toolName}...`, () => client.listTools(), spinnerOptions(globalOptions));
      const tool = tools.find((item) => item.name === toolName);
      if (!tool) {
        throw new Error(`Tool "${toolName}" was not returned by the server`);
      }
      writeOutput(printToolSchema(tool), globalOptions.output);
      return;
    }

    if (command === "call") {
      const toolName = rest[0];
      if (!toolName) {
        throw new Error("Usage: dataify call <tool> [--param value]");
      }
      await runToolCall(client, toolName, rest.slice(1), globalOptions);
      return;
    }

    if (command === "direct-call") {
      if (BLOCKED_COMMANDS.has(parsed.options.tool)) {
        throw new Error("This command is not available in this build.");
      }
      await runToolCall(client, parsed.options.tool, rest, globalOptions);
      return;
    }

    throw new Error(`Unknown command "${command}"`);
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

  const result = await withSpinner(`Calling ${toolName}...`, () => client.callTool(toolName, args), spinnerOptions(globalOptions));
  if (result?.isError) {
    const text = formatToolResult(result, { raw: optionEnabled(globalOptions.raw) || meta.raw });
    const error = new Error(text.trim() || `Tool "${toolName}" returned an error`);
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
  const { options } = parseKnownOptions(tokens.slice(1), new Set(["token", "timeout", "help"]));

  if (subcommand === "path") {
    process.stdout.write(`${configPath()}\n`);
    return;
  }

  if (subcommand === "get") {
    const config = redactConfigForDisplay(readConfig());
    process.stdout.write(`${JSON.stringify({ ...config, server: DEFAULT_SERVER, tools: DEFAULT_TOOLS }, null, 2)}\n`);
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
    const file = writeConfig(next);
    process.stdout.write(`Saved ${file}\n`);
    return;
  }

  throw new Error(`Unknown config command "${subcommand}"`);
}

function helpText() {
  return `Dataify MCP CLI ${VERSION}

Usage:
  dataify
  dataify chat
  dataify init
  dataify tools [--token TOKEN]
  dataify balance [--token TOKEN]
  dataify serp
  dataify scraper
  dataify webunlock
  dataify mcp [--token TOKEN]
  dataify skill
  dataify schema <tool>
  dataify call <tool> [--param value]
  dataify <tool> [--param value]
  dataify config set --token TOKEN

Common options:
  --token TOKEN      Dataify API token, appended as ?token=...
  --timeout VALUE    Request timeout, e.g. 120000, 30s, 2m
  --raw              Print the raw MCP tool result
  --output FILE      Write command output to a file
  --header K=V       Add an HTTP header

Interactive commands:
  /help              Show interactive help
  /init              Run the setup wizard
  /tools             List available tools
  /balance           Show account balance
  /serp              Choose and call a SERP tool
  /scraper           Choose and call a scraper tool
  /webunlock         Choose and call a Web Unlocker tool
  /schema <tool>     Show tool parameters
  /call <tool> ...   Call a tool
  /mcp               Install MCP configs for agents
  /skill             Install Dataify skills
  /retry             Run the previous command again
  /exit              Quit interactive mode

Argument forms:
  --q pizza
  --arg q=pizza
  --arg-json page=1
  --args-json '{"q":"pizza","json":"1"}'
  --args-file params.json
  --stdin            Read a JSON object from stdin and merge it into arguments

Environment:
  DATAIFY_API_TOKEN, DATAIFY_MCP_TIMEOUT

Fixed MCP URL:
  ${DEFAULT_SERVER}?token=<your_api_token>&tools=${DEFAULT_TOOLS}

Examples:
  dataify
  dataify init
  dataify balance
  dataify serp
  dataify scraper
  dataify webunlock
  dataify mcp
  dataify skill
  dataify google_search --q "pizza" --json 1
  dataify request_web_unlocker --url https://example.com --type html
  dataify call query_common_collection_api_task_status --status -1 --page 1 --pageSize 10
`;
}
