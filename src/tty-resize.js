import { EventEmitter } from "node:events";
import { recordEvent } from "./crash-log.js";

/**
 * 拖动终端窗口时，Windows 上 libuv 会挂一个 WinEvent 钩子监听 conhost 的
 * EVENT_CONSOLE_LAYOUT，连续合成 SIGWINCH；Node 自带的 readline 每收到一次 resize
 * 就把整行提示符重画一遍（onresize -> _refreshLine -> output.write）。
 *
 * 拖拽期间 conhost 处于自己的 modal loop，每次写都要同步走 WriteConsoleW，
 * 几十次连续整行重绘会把事件循环堵住，表现出来就是"拖一下窗口进程就卡死"。
 *
 * 这里给 readline 一个只转发 write 的假 output：尺寸事件先合并，等拖拽停下来
 * 再补发一次 resize，把 N 次整行重绘收敛成 1 次。
 */
const DEFAULT_RESIZE_COALESCE_MS = 250;

export function createCoalescedOutput(stream = process.stdout, options = {}) {
  const waitMs = Number.isFinite(options.waitMs) ? options.waitMs : DEFAULT_RESIZE_COALESCE_MS;
  const output = new EventEmitter();

  // readline 靠 output.isTTY 决定走不走终端分支（raw mode + keypress 编辑）。
  output.isTTY = true;
  output.write = (chunk, ...rest) => stream.write(chunk, ...rest);
  Object.defineProperty(output, "columns", { enumerable: true, get: () => stream.columns });
  Object.defineProperty(output, "rows", { enumerable: true, get: () => stream.rows });

  let timer = null;
  const onResize = () => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      output.emit("resize");
    }, waitMs);
    // 别为了等最后一次重画把进程留在事件循环里。
    if (typeof timer.unref === "function") {
      timer.unref();
    }
  };

  stream.on("resize", onResize);

  return {
    output,
    dispose() {
      stream.off("resize", onResize);
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      output.removeAllListeners();
    }
  };
}

// 终端被关掉、管道断开、控制台正在 resize 时，stdin/stdout/stderr 都可能抛 "error"
// （EPIPE / EINVAL 之类）。没有监听者的话 Node 会把它升级成未捕获异常，整个进程
// 直接退出——在 PowerShell 下表现就是"窗口一关什么也看不到"。这类错误按可恢复处理：
// 记一笔日志然后忽略，其余错误照旧抛出，不掩盖真实问题。
const IGNORED_STREAM_ERROR_CODES = new Set([
  "EPIPE",
  "ENOTCONN",
  "EINVAL",
  "ERR_STREAM_DESTROYED",
  "ERR_STREAM_WRITE_AFTER_END"
]);

export function isIgnorableStreamError(error) {
  return Boolean(error) && IGNORED_STREAM_ERROR_CODES.has(error.code);
}

export function guardStdStreamErrors(streams = [process.stdout, process.stderr, process.stdin]) {
  for (const stream of streams) {
    if (!stream || typeof stream.on !== "function") {
      continue;
    }
    stream.on("error", (error) => {
      if (isIgnorableStreamError(error)) {
        recordEvent("ignoredStreamError", error);
        return;
      }
      throw error;
    });
  }
}

/**
 * readline 会把 input 的 error 原样转发成 Interface 上的 "error" 事件，
 * 没有监听者时同样会升级成未捕获异常，所以拿到 rl 之后要挂一下。
 */
export function guardInterfaceErrors(rl) {
  if (!rl || typeof rl.on !== "function") {
    return rl;
  }
  rl.on("error", (error) => {
    if (isIgnorableStreamError(error)) {
      recordEvent("ignoredInterfaceError", error);
      return;
    }
    throw error;
  });
  return rl;
}
