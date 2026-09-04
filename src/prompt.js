import readline from "node:readline";
import readlinePromises from "node:readline/promises";
import { stdin, stdout } from "node:process";

export async function promptConfirm(question, defaultValue = true) {
  const suffix = defaultValue ? "Y/n" : "y/N";
  const rl = readlinePromises.createInterface({
    input: stdin,
    output: stdout
  });

  try {
    while (true) {
      const answer = (await rl.question(`${question} (${suffix}): `)).trim().toLowerCase();
      if (!answer) {
        return defaultValue;
      }
      if (["y", "yes"].includes(answer)) {
        return true;
      }
      if (["n", "no"].includes(answer)) {
        return false;
      }
      stdout.write("Please enter y or n.\n");
    }
  } finally {
    rl.close();
  }
}

export function promptHidden(question) {
  return new Promise((resolve, reject) => {
    const input = stdin;
    const output = stdout;
    let value = "";

    if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== "function") {
      reject(new Error("Interactive token input requires a TTY. Pass --token TOKEN instead."));
      return;
    }

    const wasRaw = input.isRaw || false;
    readline.emitKeypressEvents(input);
    input.setRawMode(true);
    input.resume();
    output.write(question);

    const cleanup = () => {
      input.off("keypress", onKeypress);
      input.setRawMode(wasRaw);
      output.write("\n");
    };

    const onKeypress = (char, key = {}) => {
      if (key.ctrl && key.name === "c") {
        cleanup();
        reject(new Error("Cancelled."));
        return;
      }
      if (key.name === "return") {
        cleanup();
        resolve(value);
        return;
      }
      if (key.name === "backspace") {
        value = value.slice(0, -1);
        return;
      }
      if (char && !key.ctrl && !key.meta) {
        value += char;
      }
    };

    input.on("keypress", onKeypress);
  });
}
