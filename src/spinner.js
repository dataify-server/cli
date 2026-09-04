const FRAMES = [".", "/", "\\", "."];

export async function withSpinner(message, task, options = {}) {
  const spinner = createSpinner(message, options);
  try {
    spinner.start();
    return await task();
  } finally {
    spinner.stop();
  }
}

export function createSpinner(message, options = {}) {
  const delayMs = options.delayMs ?? 400;
  const intervalMs = options.intervalMs ?? 120;
  const enabled = options.enabled ?? process.stderr.isTTY;
  let timer = null;
  let interval = null;
  let frame = 0;
  let active = false;

  const writeFrame = () => {
    const text = `${FRAMES[frame % FRAMES.length]} ${message}`;
    frame += 1;
    process.stderr.write(`\r${text}`);
  };

  return {
    start() {
      if (!enabled || timer || interval) {
        return;
      }
      timer = setTimeout(() => {
        timer = null;
        active = true;
        writeFrame();
        interval = setInterval(writeFrame, intervalMs);
      }, delayMs);
    },
    stop() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
      if (active) {
        active = false;
        process.stderr.write(`\r${" ".repeat(message.length + 4)}\r`);
      }
    }
  };
}
