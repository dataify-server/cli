import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * 崩溃日志。
 *
 * 为什么需要它：在 PowerShell 里 CLI 是通过 .ps1 shim 启动的，进程一退出窗口可能
 * 直接消失，stderr 上的报错根本来不及看。所以未捕获异常必须先落到文件里。
 *
 * 优先写 ~/.dataify-mcp-cli/crash.log（和 config.json 同目录），写不进去就退到临时目录。
 */
const LOG_NAME = "crash.log";
// 日志别无限长：超过这个大小就只保留最新一条。
const MAX_LOG_BYTES = 512 * 1024;

function candidateDirs() {
  return [
    path.join(os.homedir(), ".dataify-mcp-cli"),
    os.tmpdir()
  ];
}

export function crashLogPath() {
  for (const dir of candidateDirs()) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      // accessSync 在受限环境下不可靠（目录看起来可写、真写就 EPERM），
      // 所以用一次真实的探针写入来判断。
      const probe = path.join(dir, `.${LOG_NAME}.probe`);
      fs.writeFileSync(probe, "");
      fs.rmSync(probe, { force: true });
      return path.join(dir, LOG_NAME);
    } catch {
      // 换下一个候选目录
    }
  }
  return null;
}

let logFile;
let logFileResolved = false;

function resolveLogFile() {
  if (!logFileResolved) {
    logFile = crashLogPath();
    logFileResolved = true;
  }
  return logFile;
}

function formatLine(kind, detail) {
  const text = detail && detail.stack ? detail.stack : String(detail);
  return `[${new Date().toISOString()}] ${kind}: ${text}\n`;
}

/** 写一条记录（同步写，保证进程立刻退出时也不会丢）。 */
export function recordEvent(kind, detail) {
  const line = formatLine(kind, detail);
  const file = resolveLogFile();
  if (file) {
    try {
      if (fs.existsSync(file) && fs.statSync(file).size > MAX_LOG_BYTES) {
        fs.writeFileSync(file, "[log truncated]\n");
      }
      fs.appendFileSync(file, line);
    } catch {
      // 日志写不进去就算了，绝不能因此再抛一个异常
    }
  }
  return line;
}

/**
 * 安装全局崩溃记录：未捕获异常 / 未处理的 Promise 拒绝都会写日志 + 打一份到 stderr，
 * 然后按默认语义退出（返回 = 不吞掉问题）。
 */
export function installCrashLogger() {
  const report = (kind, error) => {
    const line = recordEvent(kind, error);
    const file = resolveLogFile();
    try {
      process.stderr.write(file ? `${line}(崩溃详情已写入 ${file})\n` : line);
    } catch {
      // 终端可能已经没了
    }
  };

  process.on("uncaughtException", (error) => {
    report("uncaughtException", error);
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    report("unhandledRejection", reason);
    process.exit(1);
  });
}
