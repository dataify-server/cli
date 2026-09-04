import fs from "node:fs";
import readline from "node:readline";

export function createSelector() {
  if (process.stdin.isTTY && process.stdout.isTTY) {
    return {
      selectOne: (options) => listSelectOne(options),
      selectMany: (options) => checkboxSelectMany(options),
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

async function promptSelectOneFromAnswers({ title, items, defaultSelected, answers }) {
  const defaultIndex = Math.max(0, items.findIndex((item) => item.id === defaultSelected));

  while (true) {
    process.stdout.write(`\n${title}\n`);
    items.forEach((item, index) => {
      const marker = index === defaultIndex ? "*" : " ";
      process.stdout.write(`  ${index + 1}. [${marker}] ${item.name} - ${item.description}\n`);
    });
    process.stdout.write("Enter number, or press Enter for default: ");
    const answer = answers.length ? answers.shift() : "";
    process.stdout.write(`${answer}\n`);
    const selected = parseSingleSelection(answer, items, defaultIndex);
    if (selected) {
      return selected;
    }
    if (!answers.length) {
      throw new Error("Select one item.");
    }
    process.stdout.write("Select one item.\n");
  }
}

async function promptSelectManyFromAnswers({ title, items, defaultSelected, answers }) {
  const selectedDefaults = new Set(defaultSelected);

  while (true) {
    process.stdout.write(`\n${title}\n`);
    items.forEach((item, index) => {
      const checked = selectedDefaults.has(item.id) ? "*" : " ";
      process.stdout.write(`  ${index + 1}. [${checked}] ${item.name} - ${item.description}\n`);
    });
    process.stdout.write("Enter numbers separated by comma, or press Enter for defaults: ");
    const answer = answers.length ? answers.shift() : "";
    process.stdout.write(`${answer}\n`);
    const selected = parseSelection(answer, items, selectedDefaults);
    if (selected.length > 0) {
      return selected;
    }
    if (!answers.length) {
      throw new Error("Select at least one item.");
    }
    process.stdout.write("Select at least one item.\n");
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
      process.stdout.write("Use Up/Down, Space to toggle, A all, N none, Enter confirm.\n\n");
      items.forEach((item, index) => {
        const pointer = index === cursor ? ">" : " ";
        const checked = selected.has(item.id) ? "x" : " ";
        process.stdout.write(`${pointer} [${checked}] ${item.name} - ${item.description}\n`);
      });
      if (message) {
        process.stdout.write(`\n${message}\n`);
      }
    };

    const finish = () => {
      if (done) {
        return;
      }
      if (selected.size === 0) {
        message = "Select at least one item.";
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
        reject(new Error("Cancelled."));
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
      process.stdout.write("Use Up/Down, Enter confirm.\n\n");
      items.forEach((item, index) => {
        const pointer = index === cursor ? ">" : " ";
        process.stdout.write(`${pointer} ${item.name} - ${item.description}\n`);
      });
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

    const onKeypress = (_char, key = {}) => {
      if (key.ctrl && key.name === "c") {
        done = true;
        cleanup();
        reject(new Error("Cancelled."));
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
