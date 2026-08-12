import { parseCli, parseHeaders, parseKnownOptions, parseToolArgs, readStdin } from "./args.js";
import { McpHttpClient } from "./client.js";
import { DEFAULT_SERVER, DEFAULT_TOOLS, configPath, readConfig, resolveRuntimeOptions, writeConfig } from "./config.js";
import { formatToolResult, printToolSchema, printTools, writeOutput } from "./output.js";
import { runInteractive } from "./repl.js";

const VERSION = "0.1.9";

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

  const { options: trailingGlobal, rest } = parseKnownOptions(parsed.rest);
  const globalOptions = {
    ...parsed.global,
    ...trailingGlobal
  };

  if (globalOptions.help) {
    process.stdout.write(helpText());
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
      const tools = await client.listTools();
      writeOutput(printTools(tools, { raw: optionEnabled(globalOptions.raw) }), globalOptions.output);
      return;
    }

    if (command === "schema") {
      const toolName = rest[0];
      if (!toolName) {
        throw new Error("Usage: dataify schema <tool>");
      }
      const tools = await client.listTools();
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

  const result = await client.callTool(toolName, args);
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

async function runConfig(tokens) {
  const subcommand = tokens[0] || "get";
  const { options } = parseKnownOptions(tokens.slice(1), new Set(["token", "timeout", "help"]));

  if (subcommand === "path") {
    process.stdout.write(`${configPath()}\n`);
    return;
  }

  if (subcommand === "get") {
    process.stdout.write(`${JSON.stringify({ ...readConfig(), server: DEFAULT_SERVER, tools: DEFAULT_TOOLS }, null, 2)}\n`);
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
  dataify tools [--token TOKEN]
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
  /tools             List available tools
  /schema <tool>     Show tool parameters
  /call <tool> ...   Call a tool
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
  DATAIFY_MCP_TOKEN, DATAIFY_API_TOKEN, DATAIFY_MCP_TIMEOUT

Fixed MCP URL:
  ${DEFAULT_SERVER}?token=<your_api_token>&tools=${DEFAULT_TOOLS}

Examples:
  dataify
  dataify google_search --q "pizza" --json 1
  dataify request_web_unlocker --url https://example.com --type html
`;
}
