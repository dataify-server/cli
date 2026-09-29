import { parseKnownOptions, rejectUnknownOptions } from "./args.js";
import { runLogin } from "./auth-commands.js";
import { logoText } from "./brand.js";
import { t } from "./i18n.js";
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
  "skip_login",
  "github_token",
  "help"
]);

export async function runInit(tokens = []) {
  const { options, rest } = parseKnownOptions(tokens, OPTION_NAMES);
  rejectUnknownOptions(rest);
  if (optionEnabled(options.help)) {
    process.stdout.write(initHelpText());
    return;
  }

  const yes = optionEnabled(options.yes) || optionEnabled(options.y);
  const skipMcp = optionEnabled(options.skip_mcp);
  const skipSkill = optionEnabled(options.skip_skill);
  const skipLogin = optionEnabled(options.skip_login);
  const token = lastOption(options.token);

  process.stdout.write(`${logoText()}\n${t("init.title")}\n\n`);
  const resolvedToken = await configureToken(token, { yes, skipLogin });

  if (!skipMcp && await shouldRunStep(t("init.step.mcp"), yes)) {
    await runMcpInstaller({
      token: resolvedToken,
      agents: yes ? "all" : undefined,
      toolClasses: yes ? "all" : undefined
    });
  }

  if (!skipSkill && await shouldRunStep(t("init.step.skill"), yes)) {
    const skillTokens = yes ? ["--agent", "all", "--all"] : [];
    const githubToken = lastOption(options.github_token);
    if (githubToken) {
      skillTokens.push("--github-token", githubToken);
    }
    await runSkillInstaller(skillTokens);
  }

  process.stdout.write(`\n${t("init.finished")}\n\n`);
  process.stdout.write(`${t("init.nextCommands")}\n`);
  process.stdout.write("  dataify whoami\n");
  process.stdout.write("  dataify balance\n");
  process.stdout.write("  dataify tools\n");
  process.stdout.write("  dataify schema google_search\n");
  process.stdout.write("  dataify google_search --q \"pizza\" --json 1\n");
  process.stdout.write("  dataify mcp\n");
  process.stdout.write("  dataify skill\n");
}

async function configureToken(token, { yes = false, skipLogin = false } = {}) {
  const config = readConfig();
  const existingToken = config.token || process.env.DATAIFY_API_TOKEN || "";

  if (token) {
    const file = writeConfig({ ...config, token });
    process.stdout.write(`${t("init.savedToken", { file })}\n`);
    return token;
  }

  if (existingToken) {
    process.stdout.write(`${t("init.usingToken", { source: existingToken === config.token ? t("init.source.config") : t("init.source.environment") })}\n`);
    return existingToken;
  }

  const canPrompt = process.stdin.isTTY && process.stdout.isTTY;
  if (!skipLogin && canPrompt) {
    const useBrowserLogin = yes || (await promptConfirm(t("init.confirmLogin"), true));
    if (useBrowserLogin) {
      await runLogin([]);
      const loggedInToken = readConfig().token || "";
      if (loggedInToken) {
        return loggedInToken;
      }
      process.stdout.write(`${t("init.browserFallback")}\n`);
    }
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
  return t("init.help", { server: DEFAULT_SERVER, tools: DEFAULT_TOOLS });
}
