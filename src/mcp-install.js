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

async function installClaudeCode(mcpUrl) {
  const args = ["mcp", "add", "--transport", "http", "--scope", "user", SERVER_NAME, mcpUrl];
  const result = await runClaudeCommand(args);

  if (result.error) {
    return {
      ok: false,
      name: "Claude Code",
      message: t("mcp.status.claudeNotFound")
    };
  }

  if (result.status !== 0) {
    return {
      ok: false,
      name: "Claude Code",
      message: singleLine(result.stderr || result.stdout || t("mcp.status.claudeFailed"))
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

  return spawnCommand(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", commandLine(command, args)]);
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
