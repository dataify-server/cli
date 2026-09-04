import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { parseKnownOptions } from "./args.js";
import { createSelector } from "./select.js";
import { withSpinner } from "./spinner.js";

const DEFAULT_REPO = "dataify-server/skills";
const DEFAULT_REF = "main";
const DEFAULT_SKILLS_PATH = "skills";
const DEFAULT_CANONICAL_SKILLS_DIR = path.join(".agents", "skills");
const DEFAULT_CANONICAL_SKILLS_LABEL = "./.agents/skills";

const HOME = os.homedir();
const CODEX_HOME = process.env.CODEX_HOME?.trim() || path.join(HOME, ".codex");
const CLAUDE_HOME = process.env.CLAUDE_CONFIG_DIR?.trim() || path.join(HOME, ".claude");

const AGENTS = [
  {
    id: "universal",
    name: "Universal (.agents/skills)",
    description: "Install once into the current project's .agents/skills directory.",
    root: (canonicalRoot) => canonicalRoot,
    detectInstalled: () => true
  },
  {
    id: "claude-code",
    name: "Claude Code",
    description: "Link from .agents/skills into ~/.claude/skills.",
    root: () => path.join(CLAUDE_HOME, "skills"),
    detectInstalled: () => fs.existsSync(CLAUDE_HOME)
  },
  {
    id: "codex",
    name: "Codex",
    description: "Uses the universal .agents/skills directory.",
    root: (canonicalRoot) => canonicalRoot,
    detectInstalled: () => fs.existsSync(CODEX_HOME) || fs.existsSync("/etc/codex")
  },
  {
    id: "cursor",
    name: "Cursor",
    description: "Uses the universal .agents/skills directory.",
    root: (canonicalRoot) => canonicalRoot,
    detectInstalled: () => fs.existsSync(path.join(HOME, ".cursor"))
  }
];

const OPTION_NAMES = new Set(["agent", "agents", "skill", "skills", "all", "dir", "repo", "ref", "github_token", "help"]);

export async function runSkillInstaller(tokens = []) {
  const { options } = parseKnownOptions(tokens, OPTION_NAMES);
  if (optionEnabled(options.help)) {
    process.stdout.write(skillHelpText());
    return;
  }

  const repo = lastOption(options.repo) || DEFAULT_REPO;
  const ref = lastOption(options.ref) || DEFAULT_REF;
  const githubToken = lastOption(options.github_token) || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
  const canonicalInput = lastOption(options.dir) || DEFAULT_CANONICAL_SKILLS_DIR;
  const canonicalRoot = path.resolve(process.cwd(), canonicalInput);
  const canonicalLabel = displayPath(canonicalInput);

  const agentItems = AGENTS.map((agent) => ({
    ...agent,
    description: agent.id === "universal" ? `Install once into ${canonicalLabel}.` : agent.description
  }));

  const source = await withSpinner("Loading Dataify skills...", () => prepareSkillSource({ repo, ref, githubToken }), { delayMs: 0 });
  try {
    const skills = source.skills;
    if (skills.length === 0) {
      throw new Error(`No skills found in ${repo}/${DEFAULT_SKILLS_PATH} at ${ref}.`);
    }

    const selectedAgents = await chooseAgents(agentItems, options);
    const selectedSkills = await chooseSkills(skills, options);
    const targets = buildTargets(selectedAgents, canonicalRoot);

    process.stdout.write("\nInstalling selected skills...\n");
    const results = [];
    for (const skill of selectedSkills) {
      const result = await installSkillWithProgress({ source, repo, ref, githubToken, skill, canonicalRoot, targets });
      results.push(result);
      process.stdout.write(`${formatInstallResult(result)}\n`);
    }

    process.stdout.write("\nDataify skill installation finished.\n\n");
    const succeeded = results.filter((result) => result.ok);
    const failed = results.filter((result) => !result.ok);
    process.stdout.write(`Source: ${source.label}\n`);
    process.stdout.write(`Installed skills: ${succeeded.length ? succeeded.map((result) => result.skill).join(", ") : "none"}\n`);
    process.stdout.write("Target directories:\n");
    for (const target of targets) {
      process.stdout.write(`  ${target.names.join(", ")}: ${target.root}\n`);
    }
    if (failed.length > 0) {
      process.exitCode = 1;
      process.stdout.write("\nFailed skills:\n");
      for (const result of failed) {
        process.stdout.write(`  ${result.skill}: ${result.message}\n`);
      }
      process.stdout.write("\nSome skills were not installed. Fix the failed item and run dataify skill again.\n");
    }
  } finally {
    await cleanupSource(source);
  }
}

async function chooseAgents(agentItems, options) {
  const ids = splitOptionList(options.agent ?? options.agents);
  if (ids.length > 0) {
    return selectByIds(agentItems, ids, "agent");
  }

  const defaultSelected = agentItems
    .filter((agent) => agent.id === "universal" || agent.detectInstalled())
    .map((agent) => agent.id);

  const selector = createSelector();
  try {
    return await selector.selectMany({
      title: "Select agent tools to install Dataify skills",
      items: agentItems,
      defaultSelected
    });
  } finally {
    selector.close();
  }
}

async function chooseSkills(skills, options) {
  if (optionEnabled(options.all)) {
    return skills;
  }

  const ids = splitOptionList(options.skill ?? options.skills);
  if (ids.length > 0) {
    return selectByIds(skills, ids, "skill");
  }

  const selector = createSelector();
  try {
    return await selector.selectMany({
      title: "Select Dataify skills to download",
      items: skills,
      defaultSelected: []
    });
  } finally {
    selector.close();
  }
}

async function prepareSkillSource({ repo, ref, githubToken }) {
  try {
    const skills = await listGithubApiSkills({ repo, ref, githubToken });
    return {
      type: "github-api",
      label: `https://github.com/${repo}/tree/${ref}/${DEFAULT_SKILLS_PATH}`,
      root: "",
      skills,
      cleanup: async () => {}
    };
  } catch (apiError) {
    const friendly = friendlyGithubError(apiError, githubToken);
    process.stderr.write(`${friendly}\n`);
    process.stderr.write("Trying git clone fallback...\n");
  }

  return prepareGitSource({ repo, ref });
}

async function prepareGitSource({ repo, ref }) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "dataify-skills-"));
  const repoUrl = `https://github.com/${repo}.git`;
  const clone = await runCommand("git", ["clone", "--depth", "1", "--branch", ref, repoUrl, root]);
  if (clone.error) {
    await cleanupDirectory(root);
    throw new Error("GitHub API failed and git command was not found. Install git or set GITHUB_TOKEN / use --github-token.");
  }
  if (clone.status !== 0) {
    await cleanupDirectory(root);
    throw new Error(`GitHub API failed and git clone fallback failed: ${singleLine(clone.stderr || clone.stdout || "git clone failed.")}`);
  }

  const skillsRoot = path.join(root, DEFAULT_SKILLS_PATH);
  const skills = await listLocalSkills(skillsRoot);
  return {
    type: "git",
    label: `${repo}@${ref} via git clone fallback`,
    root,
    skillsRoot,
    skills,
    cleanup: () => cleanupDirectory(root)
  };
}

async function listLocalSkills(skillsRoot) {
  const entries = await fsp.readdir(skillsRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      id: entry.name,
      name: entry.name,
      path: path.join(DEFAULT_SKILLS_PATH, entry.name).replace(/\\/g, "/"),
      localPath: path.join(skillsRoot, entry.name),
      description: path.join(DEFAULT_SKILLS_PATH, entry.name).replace(/\\/g, "/")
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function buildTargets(selectedAgents, canonicalRoot) {
  const targets = [];
  const byRoot = new Map();

  for (const agent of selectedAgents) {
    const root = path.resolve(agent.root(canonicalRoot));
    const key = root.toLowerCase();
    const current = byRoot.get(key);
    if (current) {
      current.names.push(agent.name);
      current.agentIds.push(agent.id);
      continue;
    }

    const target = {
      root,
      canonical: root === canonicalRoot,
      names: [agent.name],
      agentIds: [agent.id]
    };
    byRoot.set(key, target);
    targets.push(target);
  }

  if (!targets.some((target) => target.root === canonicalRoot)) {
    targets.unshift({
      root: canonicalRoot,
      canonical: true,
      names: ["Universal (.agents/skills)"],
      agentIds: ["universal"]
    });
  }

  return targets;
}

async function listGithubApiSkills({ repo, ref, githubToken }) {
  const entries = await fetchJson(githubContentsUrl({ repo, ref, pathName: DEFAULT_SKILLS_PATH }), { githubToken });
  if (!Array.isArray(entries)) {
    throw new Error(`Unexpected GitHub response for ${repo}/${DEFAULT_SKILLS_PATH}.`);
  }

  return entries
    .filter((entry) => entry.type === "dir")
    .map((entry) => ({
      id: entry.name,
      name: entry.name,
      path: entry.path,
      description: entry.path
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

async function installSkillWithProgress({ source, repo, ref, githubToken, skill, canonicalRoot, targets }) {
  const startedAt = Date.now();
  try {
    const files = source.type === "git"
      ? await withSpinner(`Reading skill "${skill.name}"...`, () => readLocalSkillFiles(skill), { delayMs: 0 })
      : await withSpinner(`Fetching skill "${skill.name}"...`, () => fetchSkillFiles({ repo, ref, githubToken, skill }), { delayMs: 0 });
    const installResult = await withSpinner(`Installing ${skill.name}...`, () => installSkill({ skill, files, canonicalRoot, targets }), { delayMs: 0 });
    return {
      ok: true,
      skill: skill.name,
      fileCount: files.size,
      targetCount: installResult.targets,
      copiedFallbacks: installResult.copiedFallbacks,
      durationMs: Date.now() - startedAt
    };
  } catch (error) {
    return {
      ok: false,
      skill: skill.name,
      message: error.message,
      durationMs: Date.now() - startedAt
    };
  }
}

async function readLocalSkillFiles(skill) {
  const files = new Map();
  await readLocalSkillDirectory(skill.localPath, "", files);
  if (files.size === 0) {
    throw new Error(`No files found for ${skill.name}.`);
  }
  return files;
}

async function readLocalSkillDirectory(directory, prefix, files) {
  const entries = await fsp.readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await readLocalSkillDirectory(fullPath, relativePath, files);
    } else if (entry.isFile()) {
      files.set(safeRelativePath(relativePath), await fsp.readFile(fullPath));
    }
  }
}

async function fetchSkillFiles({ repo, ref, githubToken, skill }) {
  const pendingPaths = [skill.path];
  const files = new Map();

  while (pendingPaths.length > 0) {
    const currentPath = pendingPaths.pop();
    const entries = await fetchJson(githubContentsUrl({ repo, ref, pathName: currentPath }), { githubToken });
    if (!Array.isArray(entries)) {
      throw new Error(`Unexpected GitHub response for ${currentPath}.`);
    }

    for (const entry of entries) {
      if (entry.type === "dir") {
        pendingPaths.push(entry.path);
        continue;
      }
      if (entry.type !== "file" || !entry.download_url) {
        continue;
      }

      const relativePath = entry.path.startsWith(`${skill.path}/`)
        ? entry.path.slice(skill.path.length + 1)
        : entry.name;
      files.set(safeRelativePath(relativePath), await fetchBytes(entry.download_url, { githubToken }));
    }
  }

  if (files.size === 0) {
    throw new Error(`No files found for ${skill.name}.`);
  }
  return files;
}

async function installSkill({ skill, files, canonicalRoot, targets }) {
  const skillName = sanitizeName(skill.name);
  const canonicalDir = safeJoin(canonicalRoot, skillName);
  await cleanAndCreateDirectory(canonicalDir);
  await writeSkillFiles(canonicalDir, files);

  let installedTargets = 0;
  let copiedFallbacks = 0;
  for (const target of targets) {
    const targetDir = safeJoin(target.root, skillName);
    if (path.resolve(targetDir) === path.resolve(canonicalDir)) {
      installedTargets += 1;
      continue;
    }

    const linked = await createSymlink(canonicalDir, targetDir);
    if (!linked) {
      await cleanAndCreateDirectory(targetDir);
      await writeSkillFiles(targetDir, files);
      copiedFallbacks += 1;
    }
    installedTargets += 1;
  }

  return {
    targets: installedTargets,
    copiedFallbacks
  };
}

async function writeSkillFiles(targetDir, files) {
  await fsp.mkdir(targetDir, { recursive: true });
  for (const [relativePath, content] of files.entries()) {
    const destination = safeJoin(targetDir, relativePath);
    await fsp.mkdir(path.dirname(destination), { recursive: true });
    await fsp.writeFile(destination, content);
  }
}

async function createSymlink(sourceDir, targetDir) {
  try {
    const source = path.resolve(sourceDir);
    const target = path.resolve(targetDir);
    if (source === target) {
      return true;
    }

    await fsp.rm(target, { recursive: true, force: true });
    await fsp.mkdir(path.dirname(target), { recursive: true });
    const linkTarget = process.platform === "win32" ? source : path.relative(path.dirname(target), source) || ".";
    const linkType = process.platform === "win32" ? "junction" : "dir";
    await fsp.symlink(linkTarget, target, linkType);
    return true;
  } catch {
    return false;
  }
}

async function cleanAndCreateDirectory(directory) {
  await fsp.rm(directory, { recursive: true, force: true });
  await fsp.mkdir(directory, { recursive: true });
}

async function cleanupDirectory(directory) {
  await fsp.rm(directory, { recursive: true, force: true });
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

function sanitizeName(name) {
  const sanitized = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9._]+/g, "-")
    .replace(/^[.-]+|[.-]+$/g, "");
  return sanitized.slice(0, 255) || "unnamed-skill";
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

function splitOptionList(value) {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values
    .flatMap((item) => String(item).split(","))
    .map((item) => item.trim())
    .filter(Boolean);
}

function lastOption(value) {
  if (Array.isArray(value)) {
    return value.at(-1);
  }
  return value;
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

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: githubHeaders(options.githubToken)
  });
  if (!response.ok) {
    const text = await response.text();
    const error = new Error(`GitHub request failed ${response.status}: ${singleLine(text)}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

async function fetchBytes(url, options = {}) {
  const response = await fetch(url, {
    headers: githubHeaders(options.githubToken)
  });
  if (!response.ok) {
    const text = await response.text();
    const error = new Error(`GitHub download failed ${response.status}: ${singleLine(text)}`);
    error.status = response.status;
    throw error;
  }
  return Buffer.from(await response.arrayBuffer());
}

function githubHeaders(githubToken) {
  const headers = {
    "User-Agent": "dataify-mcp-cli",
    Accept: "application/vnd.github+json"
  };
  if (githubToken) {
    headers.Authorization = `Bearer ${githubToken}`;
  }
  return headers;
}

function githubContentsUrl({ repo, ref, pathName }) {
  return `https://api.github.com/repos/${repo}/contents/${encodePath(pathName)}?ref=${encodeURIComponent(ref)}`;
}

function encodePath(pathName) {
  return String(pathName).split("/").map(encodeURIComponent).join("/");
}

function safeRelativePath(value) {
  const parts = String(value).split("/").filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === "..")) {
    throw new Error(`Unsafe skill file path "${value}".`);
  }
  return parts.join("/");
}

function safeJoin(root, relativePath) {
  const destination = path.resolve(root, ...safeRelativePath(relativePath).split("/"));
  const resolvedRoot = path.resolve(root);
  if (destination !== resolvedRoot && !destination.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Unsafe destination path "${relativePath}".`);
  }
  return destination;
}

function formatInstallResult(result) {
  const status = result.ok ? "OK" : "FAILED";
  if (!result.ok) {
    return `${status} ${result.skill} (${formatDuration(result.durationMs)}): ${result.message}`;
  }
  const fallback = result.copiedFallbacks > 0 ? `, ${result.copiedFallbacks} copy fallback(s)` : "";
  return `${status} ${result.skill} (${formatDuration(result.durationMs)}): ${result.fileCount} files -> ${result.targetCount} target(s)${fallback}`;
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

function singleLine(text) {
  return String(text).replace(/\s+/g, " ").trim();
}

function friendlyGithubError(error, githubToken) {
  const message = error instanceof Error ? error.message : String(error);
  if (error?.status === 403 && !githubToken) {
    return [
      "GitHub anonymous API rate limit exceeded.",
      "Set a GitHub token and try again:",
      "  PowerShell: $env:GITHUB_TOKEN=\"YOUR_GITHUB_TOKEN\"",
      "  Or: dataify skill --github-token YOUR_GITHUB_TOKEN"
    ].join("\n");
  }
  return `GitHub API request failed: ${message}`;
}

function skillHelpText() {
  return `Dataify skill installer

Usage:
  dataify skill
  dataify skill --agent universal,codex --skill serp-google-search
  dataify skill --agent all --all

Options:
  --agent, --agents  Target agents: universal, claude-code, codex, cursor, all
  --skill, --skills  Skill names, separated by comma. Use --all for every skill.
  --all              Download every skill from the GitHub repository.
  --dir DIR          Canonical skills directory. Default: ./.agents/skills
  --repo OWNER/REPO  GitHub repository. Default: ${DEFAULT_REPO}
  --ref REF          Git ref. Default: ${DEFAULT_REF}
  --github-token TOK GitHub token when unauthenticated API is rate limited. Falls back to git clone if API fails.

Source:
  https://github.com/${DEFAULT_REPO}/tree/${DEFAULT_REF}/${DEFAULT_SKILLS_PATH}
`;
}

function displayPath(value) {
  const text = String(value || "").replace(/\\/g, "/");
  if (path.isAbsolute(text)) {
    return text;
  }
  if (text.startsWith("./") || text.startsWith("../")) {
    return text;
  }
  if (text === DEFAULT_CANONICAL_SKILLS_DIR.replace(/\\/g, "/")) {
    return DEFAULT_CANONICAL_SKILLS_LABEL;
  }
  return `./${text}`;
}

async function cleanupSource(source) {
  try {
    await source.cleanup();
  } catch (error) {
    process.stderr.write(`Failed to clean up temporary skill source: ${error.message}\n`);
  }
}
