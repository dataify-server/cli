import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { DEFAULT_SERVER, readConfig, writeConfig } from "./config.js";
import { promptHidden } from "./prompt.js";
import { createSelector } from "./select.js";
import { withSpinner } from "./spinner.js";

const SERVER_NAME = "dataify";

const AGENTS = [
  {
    id: "claude-code",
    name: "Claude Code",
    description: "Install with claude mcp add, user scope."
  },
  {
    id: "cursor",
    name: "Cursor",
    description: "Write global ~/.cursor/mcp.json."
  },
  {
    id: "codex",
    name: "Codex",
    description: "Write global ~/.codex/config.toml."
  },
  {
    id: "vscode",
    name: "VS Code",
    description: "Write project .vscode/mcp.json for Copilot Agent mode."
  }
];

const MCP_CLASSES = [
  ["user_info", "Account, balance, API key, usage statistics, and task status queries."],
  ["web_unlocker", "Fetch protected or JavaScript-rendered web pages as HTML or PNG."],
  ["google_serp", "Google Search, Images, News, Shopping, Maps, Trends, Scholar, Patents, and related SERP data."],
  ["yandex_serp", "Yandex public web search results."],
  ["duckduckgo_serp", "DuckDuckGo public web search results."],
  ["bing_serp", "Bing Search, Images, News, Videos, Maps, and Shopping results."],
  ["amazon", "Amazon product, list, review, and seller data collection."],
  ["youtube", "YouTube video, channel, comment, transcript, audio, and video download tools."],
  ["facebook", "Facebook post, comment, profile, and event data collection."],
  ["instagram", "Instagram profile, reel, and comment data collection."],
  ["reddit", "Reddit post and comment data collection."],
  ["walmart", "Walmart product, SKU, category, and keyword product data."],
  ["google", "Google Maps details/reviews, Google Play, Google Shopping, and Google local data tools."],
  ["booking", "Booking hotel listing and hotel detail data."],
  ["indeed", "Indeed company and job listing data."],
  ["airbnb", "Airbnb home and property search data."],
  ["google_play_store", "Google Play store app information and reviews."],
  ["github", "GitHub repository, search, and code URL data."],
  ["tiktok", "TikTok profile, post, comment, and shop data."],
  ["linkedin", "LinkedIn company and job listing data."],
  ["glassdoor", "Glassdoor company overview and job listing data."],
  ["twitter", "Twitter/X profile and post data."],
  ["crunchbase", "Crunchbase company URL and keyword search data."],
  ["zillow", "Zillow property search and listing data."],
  ["ebay", "eBay product, category, seller, and listing data."]
].map(([id, description]) => ({ id, name: id, description }));

export async function runMcpInstaller(options = {}) {
  const token = await ensureMcpToken(options.token);

  let agents;
  const requestedAgents = splitOptionList(options.agent ?? options.agents);
  const requestedToolClasses = splitOptionList(options.toolClass ?? options.toolClasses ?? options.selectedTools);
  const canPrompt = process.stdin.isTTY && process.stdout.isTTY;
  let selectedTools;
  if (requestedAgents.length > 0) {
    agents = selectByIds(AGENTS, requestedAgents, "agent");
  } else if (!canPrompt) {
    agents = AGENTS;
  } else {
    const selector = createSelector();
    try {
      agents = await selector.selectMany({
        title: "Select agent tools to install Dataify MCP",
        items: AGENTS,
        defaultSelected: []
      });
    } finally {
      selector.close();
    }
  }

  if (requestedToolClasses.length > 0) {
    selectedTools = selectByIds(MCP_CLASSES, requestedToolClasses, "tool class");
  } else if (!canPrompt) {
    selectedTools = MCP_CLASSES;
  } else {
    const selector = createSelector();
    try {
      selectedTools = await selector.selectMany({
        title: "Select Dataify tool classes to enable",
        items: MCP_CLASSES,
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
  process.stdout.write("\nInstalling selected MCP configurations...\n");
  for (const agent of agents) {
    const result = await installAgentWithProgress(agent, mcpUrl);
    results.push(result);
    process.stdout.write(`${formatInstallStatus(result)}\n`);
  }

  process.stdout.write("\nDataify MCP installation finished.\n");
  process.stdout.write(`\nEnabled tool classes: ${selectedToolIds.join(", ")}\n`);
  if (results.some((result) => !result.ok)) {
    process.exitCode = process.exitCode || 1;
    process.stdout.write("Some agent tools were not configured. Fix the failed item and run dataify mcp again.\n");
  }
  process.stdout.write("Restart selected agent tools if they are already running.\n");
}

export async function ensureMcpToken(token) {
  if (token) {
    return token;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("No Dataify token found. Run dataify config set --token TOKEN first, or pass --token TOKEN.");
  }

  process.stdout.write("No Dataify token found.\n");
  process.stdout.write("Please paste your Dataify API token. It will be saved for future dataify commands.\n");
  const input = await promptHidden("Dataify API token: ");
  const nextToken = input.trim();
  if (!nextToken) {
    throw new Error("No token entered. Run dataify config set --token TOKEN first, or pass --token TOKEN.");
  }

  const file = writeConfig({ ...readConfig(), token: nextToken });
  process.stdout.write(`Saved token to ${file}\n`);
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
    throw new Error(`Unknown ${label}: ${missing.join(", ")}`);
  }
  if (selected.length === 0) {
    throw new Error(`Select at least one ${label}.`);
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
        message: "Unknown agent."
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
      return "Installing Claude Code MCP...";
    case "cursor":
      return "Updating Cursor MCP config...";
    case "codex":
      return "Updating Codex MCP config...";
    case "vscode":
      return "Updating VS Code MCP config...";
    default:
      return `Installing ${agent.name} MCP...`;
  }
}

function formatInstallStatus(result) {
  const status = result.ok ? "OK" : "FAILED";
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
      message: "claude command was not found from Node.js. Check that Claude Code is installed and available in PATH."
    };
  }

  if (result.status !== 0) {
    return {
      ok: false,
      name: "Claude Code",
      message: singleLine(result.stderr || result.stdout || "claude mcp add failed.")
    };
  }

  return {
    ok: true,
    name: "Claude Code",
    message: "Installed with claude mcp add --scope user."
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
    message: `Updated ${file}`
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
    message: `Updated ${file}`
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
    message: `Updated ${file}`
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
