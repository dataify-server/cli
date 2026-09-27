import fs from "node:fs";
import os from "node:os";
import readline from "node:readline";
import { t } from "./i18n.js";
import { createInterface as createPromiseInterface } from "node:readline/promises";
import { clipToWidth, displayWidth, truncateToWidth, wrapToWidth } from "./display-width.js";

export function createSelector() {
  if (process.stdin.isTTY && process.stdout.isTTY) {
    if (supportsAnsi()) {
      return {
        selectOne: (options) => listSelectOne(options),
        selectMany: (options) => checkboxSelectMany(options),
        close: () => {}
      };
    }
    return {
      selectOne: (options) => numberedSelectOne(options),
      selectMany: (options) => numberedSelectMany(options),
      close: () => {}
    };
  }

  const answers = readStdinAnswers();

  return {
    selectOne: (options) => promptSelectOneFromAnswers({ ...options, answers }),
    selectMany: (options) => promptSelectManyFromAnswers({ ...options, answers }),
    close: () => {}
  };
}

const FALLBACK_COLUMNS = 80;
const FALLBACK_ROWS = 24;
// 描述至少要有这么多列才值得显示，否则截断工具名，避免出现 " - 当…" 这种噪声。
const MIN_DESCRIPTION_WIDTH = 12;
// 工具名与描述之间的分隔符；固定宽度才能让每行的 "-" 纵向对齐。
const ITEM_SEPARATOR = " - ";
const SEPARATOR_WIDTH = 3;
// 全屏选择器给标题/提示/空行/状态行预留的行数。
const RESERVED_ROWS = 5;

function terminalColumns() {
  // 允许用 DATAIFY_WIDTH 强制指定列数（某些 Windows 控制台报的宽度不准）。
  const override = Math.floor(Number(process.env.DATAIFY_WIDTH));
  if (Number.isFinite(override) && override > 0) {
    return Math.max(20, override);
  }
  const reported = Math.floor(Number(process.stdout.columns));
  const width = Number.isFinite(reported) && reported > 0 ? reported : FALLBACK_COLUMNS;
  // 留 1 列余量：Windows 控制台里把最后一列写满会触发自动换行（pending wrap），
  // 且它报的宽度可能略大于可见窗口，结果就是末尾的 "…" 被挤到屏幕外，看着像被硬切。
  return Math.max(20, width - 1);
}

function terminalRows() {
  return Math.max(6, Number(process.stdout.rows) || FALLBACK_ROWS);
}

function singleLine(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

/**
 * 名字列宽度：取整个列表里最长的工具名，让每行的 "-" 纵向对齐。
 * 但至少给描述留 MIN_DESCRIPTION_WIDTH 列，窄终端下宁可截断名字。
 */
function nameColumnWidth(items, prefixWidth = 0) {
  const widest = items.reduce(
    (max, item) => Math.max(max, displayWidth(singleLine(item?.name || ""))),
    0
  );
  const budget = Math.max(1, terminalColumns() - prefixWidth);
  return Math.min(widest, Math.max(1, budget - SEPARATOR_WIDTH - MIN_DESCRIPTION_WIDTH));
}

/**
 * 渲染一个选项，保证只占一行且显示宽度不超过终端宽度：
 * 名字列（固定宽度，左对齐补空格）+ " - " + 按剩余宽度截断的描述。
 */
function itemLine(item, prefix = "", nameWidth = 0) {
  const budget = Math.max(1, terminalColumns() - displayWidth(prefix));
  const name = singleLine(item?.name || "");
  const description = singleLine(item?.description || "");

  if (!description) {
    return `${prefix}${clipToWidth(name, budget)}`;
  }

  const cap = Math.max(1, budget - SEPARATOR_WIDTH - MIN_DESCRIPTION_WIDTH);
  const column = Math.min(Math.max(nameWidth, displayWidth(name)), cap);
  const cell = clipToWidth(name, column);
  const padded = `${cell}${" ".repeat(Math.max(0, column - displayWidth(cell)))}`;
  const descriptionBudget = budget - column - SEPARATOR_WIDTH;
  if (descriptionBudget < 1) {
    return `${prefix}${padded.trimEnd()}`;
  }
  return `${prefix}${padded}${ITEM_SEPARATOR}${clipToWidth(description, descriptionBudget)}`;
}

// 全屏选择器的可视窗口，保证光标始终落在窗口内。
function visibleWindow(items, cursor, rows) {
  if (items.length <= rows) {
    return { start: 0, end: items.length, scrolled: false };
  }
  const half = Math.floor(rows / 2);
  const start = Math.min(Math.max(0, cursor - half), items.length - rows);
  return { start, end: start + rows, scrolled: true };
}

function scrollHint(cursor, total, rows) {
  return total > rows ? `  (${cursor + 1}/${total})` : "";
}

/**
 * 按 ? 展开的完整描述面板：撑满终端宽度，内容按显示宽度折行，
 * 行数不够时截断并补省略号，避免把列表挤出屏幕。
 */
function detailsPanel(item) {
  const columns = terminalColumns();
  const inner = Math.max(10, columns - 4);
  const maxBody = Math.max(3, terminalRows() - RESERVED_ROWS - 6);
  const name = clipToWidth(singleLine(item?.name || ""), Math.max(1, columns - 8));

  let body = wrapToWidth(singleLine(item?.description || ""), inner);
  let truncated = false;
  if (body.length > maxBody) {
    body = body.slice(0, maxBody);
    truncated = true;
  }

  const fill = "─".repeat(Math.max(0, columns - displayWidth(name) - 5));
  const out = [`┌─ ${name} ${fill}┐`];
  body.forEach((line, index) => {
    const isLast = index === body.length - 1;
    const text = truncated && isLast ? `${truncateToWidth(line, inner - 1)}…` : line;
    out.push(`│ ${text}${" ".repeat(Math.max(0, inner - displayWidth(text)))} │`);
  });
  out.push(`└${"─".repeat(Math.max(0, columns - 2))}┘`);
  return out;
}

// 数字选择器没有光标，用 ?N 指定看第几项；只输入 ? 表示全部展开。
function parseDetailRequest(answer, total) {
  if (!answer.startsWith("?")) {
    return null;
  }
  const rest = answer.slice(1).trim();
  if (!rest) {
    return Array.from({ length: total }, (_, index) => index);
  }
  const number = Number(rest);
  if (Number.isInteger(number) && number >= 1 && number <= total) {
    return [number - 1];
  }
  return [];
}

function writeDetails(indexes, items) {
  const width = Math.max(20, terminalColumns() - 4);
  for (const index of indexes) {
    const item = items[index];
    process.stdout.write(`\n${index + 1}. ${singleLine(item?.name || "")}\n`);
    for (const line of wrapToWidth(singleLine(item?.description || ""), width)) {
      process.stdout.write(`   ${line}\n`);
    }
  }
  process.stdout.write("\n");
}

/**
 * 数字列表的排版参数：序号左对齐补零宽（1 位 vs 2 位不会错位），
 * 名字列宽度按同一前缀宽度计算，保证 "-" 纵向对齐。
 */
function numberedLayout(items) {
  const indexWidth = String(items.length).length;
  const prefixWidth = displayWidth(`  ${"9".repeat(indexWidth)}. [*] `);
  return {
    label: (index) => String(index + 1).padStart(indexWidth),
    nameWidth: nameColumnWidth(items, prefixWidth)
  };
}

/**
 * 能否使用全屏列表选择器（清屏、光标移动、? 展开描述那一套）。
 *
 * 早先这里只在 TERM / WT_SESSION 等变量存在时才认 ANSI，导致传统 conhost 里的
 * PowerShell / cmd 被降级成“打印一长串编号”的列表。实际上 Windows 10 起 conhost
 * 已经支持 VT 序列，Node 也会为 TTY 打开 ENABLE_VIRTUAL_TERMINAL_PROCESSING，
 * 所以这里按系统版本判断即可。
 *
 * 万一某个终端仍然不吃这些转义序列，可以用 DATAIFY_TUI=0 退回编号列表；
 * DATAIFY_TUI=1 则强制全屏列表。
 */
function supportsAnsi() {
  const override = String(process.env.DATAIFY_TUI ?? "").trim().toLowerCase();
  if (["0", "false", "no", "off"].includes(override)) {
    return false;
  }
  if (["1", "true", "yes", "on"].includes(override)) {
    return true;
  }
  if (process.platform !== "win32") {
    return true;
  }
  // 终端自己报了身份（Windows Terminal / VS Code / ConEmu / ANSICON）也算数。
  if (
    process.env.TERM ||
    process.env.TERM_PROGRAM ||
    process.env.WT_SESSION ||
    process.env.COLORTERM ||
    process.env.ConEmuANSI === "ON" ||
    process.env.ANSICON
  ) {
    return true;
  }
  // 都没有时按系统版本判断：os.release() 在 Windows 上形如 "10.0.22631"，
  // 主版本 >= 10 即 Win10/11/Server 2016+，这些 conhost 支持 VT 序列。
  const major = Number.parseInt(String(os.release()).split(".")[0], 10);
  return Number.isFinite(major) && major >= 10;
}

async function numberedSelectOne({ title, items, defaultSelected }) {
  const defaultIndex = Math.max(0, items.findIndex((item) => item.id === defaultSelected));
  const rl = createPromiseInterface({ input: process.stdin, output: process.stdout });

  const layout = numberedLayout(items);
  process.stdout.write(`\n${title}\n`);
  items.forEach((item, index) => {
    const marker = index === defaultIndex ? "*" : " ";
    process.stdout.write(`${itemLine(item, `  ${layout.label(index)}. [${marker}] `, layout.nameWidth)}\n`);
  });
  process.stdout.write(`${t("select.detailsUsage")}\n`);

  try {
    while (true) {
      const answer = (await rl.question(t("select.enterNumber"))).trim();
      const detailRequest = parseDetailRequest(answer, items.length);
      if (detailRequest) {
        if (detailRequest.length === 0) {
          process.stdout.write(`${t("select.detailsUsage")}\n`);
        } else {
          writeDetails(detailRequest, items);
        }
        continue;
      }
      const selected = parseSingleSelection(answer, items, defaultIndex);
      if (selected) {
        return selected;
      }
      process.stdout.write(`${t("select.invalid")}\n`);
    }
  } finally {
    rl.close();
  }
}

async function numberedSelectMany({ title, items, defaultSelected }) {
  const selectedDefaults = new Set(defaultSelected);
  const rl = createPromiseInterface({ input: process.stdin, output: process.stdout });

  const layout = numberedLayout(items);
  process.stdout.write(`\n${title}\n`);
  items.forEach((item, index) => {
    const checked = selectedDefaults.has(item.id) ? "*" : " ";
    process.stdout.write(`${itemLine(item, `  ${layout.label(index)}. [${checked}] `, layout.nameWidth)}\n`);
  });

  try {
    while (true) {
      const answer = (await rl.question(t("select.enterNumbers"))).trim();
      const selected = parseSelection(answer, items, selectedDefaults);
      if (selected.length > 0) {
        return selected;
      }
      process.stdout.write(`${t("select.invalid")}\n`);
    }
  } finally {
    rl.close();
  }
}

async function promptSelectOneFromAnswers({ title, items, defaultSelected, answers }) {
  const defaultIndex = Math.max(0, items.findIndex((item) => item.id === defaultSelected));
  const layout = numberedLayout(items);

  while (true) {
    process.stdout.write(`\n${title}\n`);
    items.forEach((item, index) => {
      const marker = index === defaultIndex ? "*" : " ";
      process.stdout.write(`${itemLine(item, `  ${layout.label(index)}. [${marker}] `, layout.nameWidth)}\n`);
    });
    process.stdout.write(t("select.enterNumber"));
    const answer = answers.length ? answers.shift() : "";
    process.stdout.write(`${answer}\n`);
    const selected = parseSingleSelection(answer, items, defaultIndex);
    if (selected) {
      return selected;
    }
    if (!answers.length) {
      throw new Error(t("select.selectOne"));
    }
    process.stdout.write(`${t("select.selectOne")}\n`);
  }
}

async function promptSelectManyFromAnswers({ title, items, defaultSelected, answers }) {
  const selectedDefaults = new Set(defaultSelected);
  const layout = numberedLayout(items);

  while (true) {
    process.stdout.write(`\n${title}\n`);
    items.forEach((item, index) => {
      const checked = selectedDefaults.has(item.id) ? "*" : " ";
      process.stdout.write(`${itemLine(item, `  ${layout.label(index)}. [${checked}] `, layout.nameWidth)}\n`);
    });
    process.stdout.write(t("select.enterNumbers"));
    const answer = answers.length ? answers.shift() : "";
    process.stdout.write(`${answer}\n`);
    const selected = parseSelection(answer, items, selectedDefaults);
    if (selected.length > 0) {
      return selected;
    }
    if (!answers.length) {
      throw new Error(t("select.selectAtLeastOne"));
    }
    process.stdout.write(`${t("select.selectAtLeastOne")}\n`);
  }
}

function readStdinAnswers() {
  try {
    return fs.readFileSync(0, "utf8").split(/\r?\n/);
  } catch {
    return [];
  }
}

function checkboxSelectMany({ title, items, defaultSelected }) {
  return new Promise((resolve, reject) => {
    const selected = new Set(defaultSelected);
    let cursor = 0;
    let message = "";
    const windowRows = Math.max(3, terminalRows() - RESERVED_ROWS);
    let done = false;

    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();

    const cleanup = () => {
      process.stdin.off("keypress", onKeypress);
      process.stdin.setRawMode(false);
      process.stdout.write("\x1b[?25h");
    };

    const render = () => {
      process.stdout.write("\x1b[2J\x1b[H\x1b[?25l");
      process.stdout.write(`${title}\n`);
      const window = visibleWindow(items, cursor, windowRows);
      const nameWidth = nameColumnWidth(items, displayWidth("> [x] "));
      process.stdout.write(`${t("select.checkboxHelp")}${scrollHint(cursor, items.length, windowRows)}\n\n`);
      for (let index = window.start; index < window.end; index += 1) {
        const item = items[index];
        const pointer = index === cursor ? ">" : " ";
        const checked = selected.has(item.id) ? "x" : " ";
        process.stdout.write(`${itemLine(item, `${pointer} [${checked}] `, nameWidth)}\n`);
      }
      if (message) {
        process.stdout.write(`\n${message}\n`);
      }
    };

    const finish = () => {
      if (done) {
        return;
      }
      if (selected.size === 0) {
        message = t("select.selectAtLeastOne");
        render();
        return;
      }
      done = true;
      cleanup();
      process.stdout.write("\n");
      resolve(items.filter((item) => selected.has(item.id)));
    };

    const onKeypress = (_char, key = {}) => {
      message = "";
      if (key.ctrl && key.name === "c") {
        done = true;
        cleanup();
        reject(new Error(t("common.cancelled")));
        return;
      }
      if (key.name === "up") {
        cursor = (cursor - 1 + items.length) % items.length;
      } else if (key.name === "down") {
        cursor = (cursor + 1) % items.length;
      } else if (key.name === "space") {
        const item = items[cursor];
        if (selected.has(item.id)) {
          selected.delete(item.id);
        } else {
          selected.add(item.id);
        }
      } else if (key.name === "a") {
        for (const item of items) {
          selected.add(item.id);
        }
      } else if (key.name === "n") {
        selected.clear();
      } else if (key.name === "return") {
        finish();
        return;
      }
      render();
    };

    process.stdin.on("keypress", onKeypress);
    render();
  });
}

function listSelectOne({ title, items, defaultSelected }) {
  return new Promise((resolve, reject) => {
    let cursor = Math.max(0, items.findIndex((item) => item.id === defaultSelected));
    let done = false;
    let showDetails = false;

    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();

    const cleanup = () => {
      process.stdin.off("keypress", onKeypress);
      process.stdin.setRawMode(false);
      process.stdout.write("\x1b[?25h");
    };

    const render = () => {
      process.stdout.write("\x1b[2J\x1b[H\x1b[?25l");
      process.stdout.write(`${title}\n`);
      const panel = showDetails ? detailsPanel(items[cursor]) : [];
      const panelRows = panel.length ? panel.length + 1 : 0;
      const windowRows = Math.max(3, terminalRows() - RESERVED_ROWS - panelRows);
      const window = visibleWindow(items, cursor, windowRows);
      const nameWidth = nameColumnWidth(items, displayWidth("> "));
      process.stdout.write(`${t("select.listHelp")} ${t("select.detailsToggle")}${scrollHint(cursor, items.length, windowRows)}\n\n`);
      for (let index = window.start; index < window.end; index += 1) {
        const item = items[index];
        const pointer = index === cursor ? ">" : " ";
        process.stdout.write(`${itemLine(item, `${pointer} `, nameWidth)}\n`);
      }
      if (panel.length) {
        process.stdout.write(`\n${panel.join("\n")}\n`);
      }
    };

    const finish = () => {
      if (done) {
        return;
      }
      done = true;
      cleanup();
      process.stdout.write("\n");
      resolve(items[cursor]);
    };

    const onKeypress = (char, key = {}) => {
      if (key.ctrl && key.name === "c") {
        done = true;
        cleanup();
        reject(new Error(t("common.cancelled")));
        return;
      }
      if (char === "?" || key.name === "?") {
        showDetails = !showDetails;
        render();
        return;
      }
      if (key.name === "up") {
        cursor = (cursor - 1 + items.length) % items.length;
      } else if (key.name === "down") {
        cursor = (cursor + 1) % items.length;
      } else if (key.name === "return") {
        finish();
        return;
      }
      render();
    };

    process.stdin.on("keypress", onKeypress);
    render();
  });
}

function parseSelection(answer, items, selectedDefaults) {
  const text = String(answer || "").trim();
  if (!text) {
    return items.filter((item) => selectedDefaults.has(item.id));
  }

  const selectedIndexes = new Set();
  for (const part of text.split(",")) {
    const number = Number(part.trim());
    if (Number.isInteger(number) && number >= 1 && number <= items.length) {
      selectedIndexes.add(number - 1);
    }
  }

  return items.filter((_item, index) => selectedIndexes.has(index));
}

function parseSingleSelection(answer, items, defaultIndex) {
  const text = String(answer || "").trim();
  if (!text) {
    return items[defaultIndex] || items[0];
  }

  const number = Number(text);
  if (Number.isInteger(number) && number >= 1 && number <= items.length) {
    return items[number - 1];
  }
  return null;
}
