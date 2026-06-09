import readline from "node:readline/promises";
import { stdin, stdout, stderr } from "node:process";

const EXIT_COMMANDS = new Set(["exit", "quit"]);

export async function runInteractive(execute, options = {}) {
  const rl = readline.createInterface({
    input: stdin,
    output: stdout,
    historySize: 1000,
    completer
  });

  let lastTokens = null;
  stdout.write(introText(options.version));

  try {
    while (true) {
      let line;
      try {
        line = await rl.question("dataify> ");
      } catch (error) {
        if (error?.code === "ERR_USE_AFTER_CLOSE") {
          break;
        }
        throw error;
      }

      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      const normalizedCommand = normalizeCommandName(trimmed);
      if (EXIT_COMMANDS.has(normalizedCommand)) {
        break;
      }

      if (normalizedCommand === "help" || normalizedCommand === "?") {
        stdout.write(interactiveHelpText());
        continue;
      }

      if (normalizedCommand === "clear") {
        console.clear();
        continue;
      }

      if (normalizedCommand === "retry") {
        if (!lastTokens) {
          stdout.write("No previous command to retry.\n");
          continue;
        }
        await runTokens(execute, lastTokens);
        continue;
      }

      let tokens;
      try {
        tokens = tokenizeCommandLine(normalizeInteractiveInput(trimmed));
      } catch (error) {
        stderr.write(`${error.message}\n`);
        continue;
      }

      if (tokens[0] === "dataify") {
        tokens = tokens.slice(1);
      }
      if (tokens.length === 0) {
        continue;
      }

      lastTokens = tokens;
      await runTokens(execute, tokens);
    }
  } finally {
    rl.close();
  }
}

export function tokenizeCommandLine(line) {
  const tokens = [];
  let current = "";
  let quote = "";

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (quote) {
      if (char === "\\" && quote === '"' && index + 1 < line.length) {
        const next = line[index + 1];
        if (next === '"' || next === "\\") {
          current += next;
          index += 1;
          continue;
        }
      }
      if (char === quote) {
        quote = "";
        continue;
      }
      current += char;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (quote) {
    throw new Error(`Unclosed ${quote} quote`);
  }
  if (current) {
    tokens.push(current);
  }

  return tokens;
}

function normalizeInteractiveInput(input) {
  if (!input.startsWith("/")) {
    return input;
  }
  return input.slice(1).trimStart();
}

function normalizeCommandName(input) {
  const withoutSlash = normalizeInteractiveInput(input);
  const first = withoutSlash.split(/\s+/, 1)[0] || "";
  return first.toLowerCase();
}

async function runTokens(execute, tokens) {
  try {
    await execute(tokens);
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    stderr.write(`${message}\n`);
  }
}

function introText(version) {
  const versionText = version ? ` ${version}` : "";
  return `${logoText()}
Dataify MCP CLI${versionText} interactive mode
${quickStartText()}

`;
}

function logoText() {
  return `
    ____        __        _ ____     
   / __ \\____ _/ /_____ _(_) __/_  __
  / / / / __ \`/ __/ __ \`/ / /_/ / / /
 / /_/ / /_/ / /_/ /_/ / / __/ /_/ / 
/_____/\\__,_/\\__/\\__,_/_/_/  \\__, /  
                             /____/   
`;
}

function interactiveHelpText() {
  return `${quickStartText()}

`;
}

function quickStartText() {
  return `Common commands:
  /tools                              List available tools
  /schema <tool>                     Show tool parameters
  /call <tool> --param value         Call a tool
  google_search --q "pizza"          Call a tool directly
  /retry                             Run the previous command again
  /clear                             Clear the screen
  /exit                              Quit interactive mode

Tips:
  Commands also work without "/", for example: tools
  Type /help to show this guide again.`;
}

function completer(line) {
  const commands = [
    "/help",
    "/tools",
    "/schema",
    "/call",
    "/retry",
    "/clear",
    "/exit",
    "tools",
    "schema",
    "call",
    "config"
  ];
  const hits = commands.filter((command) => command.startsWith(line));
  return [hits.length ? hits : commands, line];
}
