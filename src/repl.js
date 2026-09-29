import readline from "node:readline/promises";
import { stdin, stdout, stderr } from "node:process";
import { logoText } from "./brand.js";
import { getLanguage, setLanguage, t } from "./i18n.js";
import { runLanguageCommand } from "./language-command.js";
import { createCoalescedOutput, guardInterfaceErrors } from "./tty-resize.js";
import { recordEvent } from "./crash-log.js";

const EXIT_COMMANDS = new Set(["exit", "quit"]);

export async function runInteractive(execute, options = {}) {
  let lastTokens = null;
  const history = [];
  stdout.write(introText(options.version));

  while (true) {
    let line;
    try {
      line = await promptInteractiveLine(history);
    } catch (error) {
      if (error?.code === "ERR_USE_AFTER_CLOSE") {
        // 输入流被关掉（窗口被关、或控制台 resize 把 input 打坏了）时 readline 会走到
        // 这里，看上去就是"莫名其妙自己退出"。记一笔现场方便事后定位。
        recordEvent("replExit", new Error(`readline closed: ${error.message || error.code}`));
        break;
      }
      throw error;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    rememberHistory(history, line);

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

    if (normalizedCommand === "language" || normalizedCommand === "lang") {
      try {
        await runLanguageCommand(trimmed.replace(/^\//, "").trim().split(/\s+/).slice(1), { select: true });
      } catch (error) {
        stderr.write(`${error.message}\n`);
      }
      continue;
    }

    if (normalizedCommand === "retry") {
      if (!lastTokens) {
        stdout.write(`${t("repl.noPrevious")}\n`);
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
}

async function promptInteractiveLine(history) {
  // 直接把 process.stdout 交给 readline 的话，它会挂在每次 resize 上整行重画提示符；
  // 拖拽窗口时 conhost 在 modal loop 里，连续同步写会把事件循环堵死（见 tty-resize.js）。
  const { output, dispose } = createCoalescedOutput(stdout);
  const rl = readline.createInterface({
    input: stdin,
    output,
    history: [...history],
    historySize: 1000,
    completer
  });

  guardInterfaceErrors(rl);

  rl.on("SIGINT", () => {
    rl.close();
  });

  try {
    return await rl.question("dataify> ");
  } finally {
    rl.close();
    dispose();
  }
}

function rememberHistory(history, line) {
  history.unshift(line);
  if (history.length > 1000) {
    history.pop();
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
  // `--language X` 只应影响这一条命令的输出：会话语言只能在交互模式里用 /language 切换。
  // （/language 走的是 repl 自己的分支，不经过 execute，所以这里统一还原是安全的。）
  const sessionLanguage = getLanguage();
  try {
    await execute(tokens);
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    stderr.write(`${message}\n`);
  } finally {
    setLanguage(sessionLanguage);
  }
}

function introText(version) {
  const versionText = version ? ` ${version}` : "";
  return `${logoText()}
${t("repl.subtitle", { version: versionText })}
${quickStartText()}

`;
}

function interactiveHelpText() {
  return `${quickStartText()}

`;
}

function quickStartText() {
  return t("repl.quickStart");
}

function completer(line) {
  const commands = [
    "/help",
    "/init",
    "/login",
    "/logout",
    "/whoami",
    "/tools",
    "/balance",
    "/serp",
    "/scraper",
    "/webunlock",
    "/schema",
    "/call",
    "/mcp",
    "/skill",
    "/language",
    "/retry",
    "/clear",
    "/exit",
    "tools",
    "init",
    "login",
    "logout",
    "whoami",
    "balance",
    "serp",
    "scraper",
    "webunlock",
    "schema",
    "call",
    "mcp",
    "skill",
    "language",
    "config"
  ];
  const hits = commands.filter((command) => command.startsWith(line));
  return [hits.length ? hits : commands, line];
}
