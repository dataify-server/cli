import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { DEFAULT_SERVER, readConfig, writeConfig } from "./config.js";
import { t } from "./i18n.js";
import { promptHidden } from "./prompt.js";
import { createSelector } from "./select.js";
import { withSpinner } from "./spinner.js";

const SERVER_NAME = "dataify";

const AGENTS = [
  { id: "claude-code", name: "Claude Code" },
  { id: "cursor", name: "Cursor" },
  { id: "codex", name: "Codex" },
  { id: "vscode", name: "VS Code" }
];

const MCP_CLASSES = [
  "user_info",
  "web_unlocker",
  "google_serp",
  "yandex_serp",
  "duckduckgo_serp",
  "bing_serp",
  "amazon",
  "youtube",
  "facebook",
  "instagram",
  "reddit",
  "walmart",
  "google",
  "booking",
  "indeed",
  "airbnb",
  "google_play_store",
  "github",
  "tiktok",
  "linkedin",
  "glassdoor",
  "twitter",
  "crunchbase",
  "zillow",
  "ebay",
].map((id) => ({ id, name: id }));

function localizeItems(items, prefix) {
  return items.map((item) => ({
    ...item,
    description: t(`${prefix}.${item.id}`)
  }));
}

export async function runMcpInstaller(options = {}) {
  const token = await ensureMcpToken(options.token);

  let agents;
  const agentItems = localizeItems(AGENTS, "mcp.agent");
  const toolClassItems = localizeItems(MCP_CLASSES, "mcp.class");
  const requestedAgents = splitOptionList(options.agent ?? options.agents);
  const requestedToolClasses = splitOptionList(options.toolClass ?? options.toolClasses ?? options.selectedTools);
  const canPrompt = process.stdin.isTTY && process.stdout.isTTY;
  let selectedTools;
  if (requestedAgents.length > 0) {
    agents = selectByIds(agentItems, requestedAgents, t("mcp.label.agent"));
  } else if (!canPrompt) {
    agents = agentItems;
  } else {
    const selector = createSelector();
    try {
      agents = await selector.selectMany({
        title: t("mcp.selectAgents"),
        items: agentItems,
        defaultSelected: []
      });
    } finally {
      selector.close();
    }
  }

  if (requestedToolClasses.length > 0) {
    selectedTools = selectByIds(toolClassItems, requestedToolClasses, t("mcp.label.toolClass"));
  } else if (!canPrompt) {
    selectedTools = toolClassItems;
  } else {
    const selector = createSelector();
    try {
      selectedTools = await selector.selectMany({
        title: t("mcp.selectToolClasses"),
        items: toolClassItems,
        defaultSelected: MCP_CLASSES.map((item) => item.id)
      });
    } finally {
      selector.close();
    }
  }

  const selectedToolIds = selectedTools.map((item) => item.id);
  const mcpUrl = buildMcpUrl({
    server: options.server || DEFAULT_SERVER,
    token,
    tools: selectedToolIds
  });

  const results = [];
  process.stdout.write(`\n${t("mcp.installing")}\n`);
  for (const agent of agents) {
    const result = await installAgentWithProgress(agent, mcpUrl);
    results.push(result);
    process.stdout.write(`${formatInstallStatus(result)}\n`);
  }

  process.stdout.write(`\n${t("mcp.finished")}\n`);
  process.stdout.write(`\n${t("mcp.enabledClasses", { classes: selectedToolIds.join(", ") })}\n`);
  if (results.some((result) => !result.ok)) {
    process.exitCode = process.exitCode || 1;
    process.stdout.write(`${t("mcp.someFailed")}\n`);
  }
  process.stdout.write(`${t("mcp.restartHint")}\n`);
}

export async function ensureMcpToken(token) {
  if (token) {
    return token;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(t("cli.error.noToken"));
  }

  process.stdout.write(`${t("mcp.noTokenFound")}\n`);
  process.stdout.write(`${t("mcp.tokenHint")}\n`);
  process.stdout.write(`${t("mcp.tokenSaveHint")}\n`);
  const input = await promptHidden(t("mcp.tokenPrompt"));
  const nextToken = input.trim();
  if (!nextToken) {
    throw new Error(t("mcp.noTokenEntered"));
  }

  const file = writeConfig({ ...readConfig(), token: nextToken });
  process.stdout.write(`${t("init.savedToken", { file })}\n`);
  return nextToken;
}

export function buildMcpUrl({ server = DEFAULT_SERVER, token, tools }) {
  return `${server}?token=${encodeURIComponent(token)}&tools=${tools.join(",")}`;
}

function splitOptionList(value) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values
    .flatMap((item) => String(item).split(","))
    .map((item) => item.trim())
    .filter(Boolean);
}

function selectByIds(items, ids, label) {
  const normalized = new Set(ids.map((id) => id.toLowerCase()));
  if (normalized.has("all")) {
    return items;
  }

  const selected = items.filter((item) => normalized.has(item.id.toLowerCase()));
  const selectedIds = new Set(selected.map((item) => item.id.toLowerCase()));
  const missing = ids.filter((id) => !selectedIds.has(id.toLowerCase()));
  if (missing.length > 0) {
    throw new Error(t("common.unknownItem", { label, items: missing.join(", ") }));
  }
  if (selected.length === 0) {
    throw new Error(t("common.selectAtLeastOne", { label }));
  }
  return selected;
}

async function installAgent(agentId, mcpUrl) {
  switch (agentId) {
    case "claude-code":
      return installClaudeCode(mcpUrl);
    case "cursor":
      return installCursor(mcpUrl);
    case "codex":
      return installCodex(mcpUrl);
    case "vscode":
      return installVsCode(mcpUrl);
    default:
      return {
        ok: false,
        name: agentId,
        message: t("mcp.status.unknownAgent")
      };
  }
}

async function installAgentWithProgress(agent, mcpUrl) {
  const startedAt = Date.now();
  try {
    const result = await withSpinner(installMessage(agent), () => installAgent(agent.id, mcpUrl), { delayMs: 0 });
    return {
      ...result,
      durationMs: Date.now() - startedAt
    };
  } catch (error) {
    return {
      ok: false,
      name: agent.name,
      message: error.message,
      durationMs: Date.now() - startedAt
    };
  }
}

function installMessage(agent) {
  switch (agent.id) {
    case "claude-code":
      return t("mcp.install.claude");
    case "cursor":
      return t("mcp.install.cursor");
    case "codex":
      return t("mcp.install.codex");
    case "vscode":
      return t("mcp.install.vscode");
    default:
      return t("mcp.install.generic", { name: agent.name });
  }
}

function formatInstallStatus(result) {
  const status = result.ok ? t("mcp.status.ok") : t("mcp.status.failed");
  return `${status} ${result.name} (${formatDuration(result.durationMs)}): ${result.message}`;
}

function formatDuration(durationMs) {
  const ms = Math.max(0, Number(durationMs) || 0);
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const seconds = ms / 1000;
  if (seconds < 10) {
    return `${seconds.toFixed(1)}s`;
  }
  return `${Math.round(seconds)}s`;
}

/**
 * 子进程输出可能是本地代码页（中文 Windows 上 cmd.exe 的报错是 GBK），按 UTF-8 解码会得到
 * 一串 U+FFFD。这里不猜代码页，只把「确定是乱码」的部分清掉并限长，避免把一屏方块丢给用户。
 */
function cleanChildOutput(text) {
  return singleLine(String(text || "").replace(/\uFFFD+/g, " ")).slice(0, 200);
}

/** 判断子进程输出是不是「命令不存在」（兼容 cmd 与 PowerShell 的中英文措辞）。 */
function isCommandNotFoundOutput(text) {
  return /不是内部或外部命令|is not recognized as an internal or external command|无法将.*识别为|CommandNotFoundException/i.test(String(text || ""));
}

async function installClaudeCode(mcpUrl) {
  const args = ["mcp", "add", "--transport", "http", "--scope", "user", SERVER_NAME, mcpUrl];
  const result = await runClaudeCommand(args);
  const output = `${result.stderr || ""}${result.stdout || ""}`;

  if (result.error || isCommandNotFoundOutput(output)) {
    // 「命令不存在」必须和「命令执行失败」区分开：ENOENT 以前会被 cmd 兜底包装成一条
    // 本地化的「不是内部或外部命令」，既变成乱码、又丢掉了 not-found 语义。
    const notFound = result.error?.code === "ENOENT" || isCommandNotFoundOutput(output);
    return {
      ok: false,
      name: "Claude Code",
      message: notFound
        ? t("mcp.status.claudeNotFound")
        : cleanChildOutput(result.error?.message) || t("mcp.status.claudeFailed")
    };
  }

  if (result.status !== 0) {
    return {
      ok: false,
      name: "Claude Code",
      message: cleanChildOutput(output) || t("mcp.status.claudeFailed")
    };
  }

  return {
    ok: true,
    name: "Claude Code",
    message: t("mcp.status.claudeInstalled")
  };
}

async function runClaudeCommand(args) {
  if (process.platform === "win32") {
    const powershell = await spawnCommand("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      powershellCommand("claude", args)
    ]);
    if (!powershell.error && powershell.status === 0) {
      return powershell;
    }
  }

  return runCommand("claude", args);
}

function powershellCommand(command, args) {
  return `& ${quotePowerShellArg(command)} ${args.map(quotePowerShellArg).join(" ")}`;
}

function quotePowerShellArg(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function runCommand(command, args) {
  const direct = await spawnCommand(command, args);

  if (!direct.error || process.platform !== "win32") {
    return direct;
  }

  // Windows 上 .cmd/.bat 不能直接 spawn（Node 会报 ENOENT —— 与「命令不存在」是同一个错误码），
  // 所以不能只看错误码，得自己确认命令是否真的在 PATH 里（见 commandExistsOnPath）：
  //   在   → 退回 cmd.exe 执行（.cmd/.bat 的正路）
  //   不在 → 保留 ENOENT 语义，让上层给出「未找到命令」，而不是把 cmd 的本地化报错当结果
  if (direct.error.code === "ENOENT" && !commandExistsOnPath(command)) {
    return direct;
  }

  return spawnCommand(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", commandLine(command, args)]);
}

/**
 * Windows：命令是否真的存在于 PATH。
 * 自己按 PATHEXT 逐个查，不用 `where`：`where <name>` 不会自动补 .cmd/.bat 后缀
 * （只有显式写 `where npm.cmd` 才命中），拿它判断会把「存在的 .cmd」误判成不存在。
 */
function commandExistsOnPath(command) {
  const exts = String(process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
  const dirs = String(process.env.PATH || "").split(path.delimiter).filter(Boolean);
  const names = [command, ...exts.map((ext) => `${command}${ext.toLowerCase()}`)];
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
          return true;
        }
      } catch {
        // 目录不存在/无权限 → 继续找下一个
      }
    }
  }
  return false;
}

function spawnCommand(command, args) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true
      });
    } catch (error) {
      resolve({
        error,
        status: null,
        stdout: "",
        stderr: ""
      });
      return;
    }

    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      resolve({
        error,
        status: null,
        stdout,
        stderr
      });
    });
    child.on("close", (status) => {
      resolve({
        error: null,
        status,
        stdout,
        stderr
      });
    });
  });
}

function commandLine(command, args) {
  return [command, ...args.map(quoteCmdArg)].join(" ");
}

function quoteCmdArg(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

async function installCursor(mcpUrl) {
  const file = path.join(os.homedir(), ".cursor", "mcp.json");
  const config = await readJsonFile(file, { mcpServers: {} });
  config.mcpServers = config.mcpServers && typeof config.mcpServers === "object" ? config.mcpServers : {};
  config.mcpServers[SERVER_NAME] = { url: mcpUrl };
  await writeJsonFile(file, config);

  return {
    ok: true,
    name: "Cursor",
    message: t("mcp.status.updated", { file })
  };
}

async function installCodex(mcpUrl) {
  const file = path.join(os.homedir(), ".codex", "config.toml");
  const current = fs.existsSync(file) ? await fsp.readFile(file, "utf8") : "";
  const next = upsertTomlSection(current, "mcp_servers.dataify", [
    `[mcp_servers.${SERVER_NAME}]`,
    `url = "${escapeTomlString(mcpUrl)}"`,
    "enabled = true"
  ]);
  await writeTextFile(file, next);

  return {
    ok: true,
    name: "Codex",
    message: t("mcp.status.updated", { file })
  };
}

async function installVsCode(mcpUrl) {
  const file = path.join(process.cwd(), ".vscode", "mcp.json");
  const config = await readJsonFile(file, { servers: {} });
  config.servers = config.servers && typeof config.servers === "object" ? config.servers : {};
  config.servers[SERVER_NAME] = {
    type: "http",
    url: mcpUrl
  };
  await writeJsonFile(file, config);

  return {
    ok: true,
    name: "VS Code",
    message: t("mcp.status.updated", { file })
  };
}

async function readJsonFile(file, fallback) {
  if (!fs.existsSync(file)) {
    return fallback;
  }
  try {
    return JSON.parse(await fsp.readFile(file, "utf8"));
  } catch (error) {
    throw new Error(`Failed to read ${file}: ${error.message}`);
  }
}

async function writeJsonFile(file, data) {
  await writeTextFile(file, `${JSON.stringify(data, null, 2)}\n`);
}

async function writeTextFile(file, text) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, text, "utf8");
}

function upsertTomlSection(content, section, lines) {
  const escaped = escapeRegExp(section);
  const sectionPattern = new RegExp(`\\n?\\[${escaped}(?:\\.[^\\]]+)?\\]\\n[\\s\\S]*?(?=\\n\\[[^\\]]+\\]|$)`, "g");
  const withoutSection = content.replace(sectionPattern, "").trimEnd();
  return `${withoutSection ? `${withoutSection}\n\n` : ""}${lines.join("\n")}\n`;
}

function escapeTomlString(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function singleLine(text) {
  return String(text).replace(/\s+/g, " ").trim();
}
