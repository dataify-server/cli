import { parseKnownOptions } from "./args.js";
import { logoText } from "./brand.js";
import { DEFAULT_SERVER, DEFAULT_TOOLS, readConfig, writeConfig } from "./config.js";
import { ensureMcpToken, runMcpInstaller } from "./mcp-install.js";
import { promptConfirm } from "./prompt.js";
import { runSkillInstaller } from "./skill-install.js";

const OPTION_NAMES = new Set([
  "token",
  "yes",
  "y",
  "skip_mcp",
  "skip_skill",
  "github_token",
  "help"
]);

export async function runInit(tokens = []) {
  const { options } = parseKnownOptions(tokens, OPTION_NAMES);
  if (optionEnabled(options.help)) {
    process.stdout.write(initHelpText());
    return;
  }

  const yes = optionEnabled(options.yes) || optionEnabled(options.y);
  const skipMcp = optionEnabled(options.skip_mcp);
  const skipSkill = optionEnabled(options.skip_skill);
  const token = lastOption(options.token);

  process.stdout.write(`${logoText()}\nDataify init\n\n`);
  const resolvedToken = await configureToken(token);

  if (!skipMcp && await shouldRunStep("Install Dataify MCP into agent tools", yes)) {
    await runMcpInstaller({
      token: resolvedToken,
      agents: yes ? "all" : undefined,
      toolClasses: yes ? "all" : undefined
    });
  }

  if (!skipSkill && await shouldRunStep("Install Dataify skills from GitHub", yes)) {
    const skillTokens = yes ? ["--agent", "all", "--all"] : [];
    const githubToken = lastOption(options.github_token);
    if (githubToken) {
      skillTokens.push("--github-token", githubToken);
    }
    await runSkillInstaller(skillTokens);
  }

  process.stdout.write("\nDataify init finished.\n\n");
  process.stdout.write("Next commands:\n");
  process.stdout.write("  dataify balance\n");
  process.stdout.write("  dataify tools\n");
  process.stdout.write("  dataify schema google_search\n");
  process.stdout.write("  dataify google_search --q \"pizza\" --json 1\n");
  process.stdout.write("  dataify mcp\n");
  process.stdout.write("  dataify skill\n");
}

async function configureToken(token) {
  const config = readConfig();
  const existingToken = config.token || process.env.DATAIFY_API_TOKEN || "";

  if (token) {
    const file = writeConfig({ ...config, token });
    process.stdout.write(`Saved token to ${file}\n`);
    return token;
  }

  if (existingToken) {
    process.stdout.write(`Using existing Dataify token from ${existingToken === config.token ? "config" : "environment"}.\n`);
    return existingToken;
  }

  return ensureMcpToken("");
}

async function shouldRunStep(question, yes) {
  if (yes) {
    return true;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return false;
  }
  return promptConfirm(question, true);
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

function lastOption(value) {
  if (Array.isArray(value)) {
    return value.at(-1);
  }
  return value;
}

function initHelpText() {
  return `Dataify init wizard

Usage:
  dataify init
  dataify init --token TOKEN
  dataify init --yes
  dataify init --skip-mcp
  dataify init --skip-skill

Options:
  --token TOKEN      Save a Dataify token before running setup.
  --yes, -y          Run setup steps without confirmation prompts.
  --skip-mcp         Skip installing MCP into agent tools.
  --skip-skill       Skip installing Dataify skills.
  --github-token TOK GitHub token passed to dataify skill.

Fixed MCP URL:
  ${DEFAULT_SERVER}?token=<your_api_token>&tools=${DEFAULT_TOOLS}
`;
}
