#!/usr/bin/env node

import { main } from "../src/cli.js";
import { guardStdStreamErrors } from "../src/tty-resize.js";
import { installCrashLogger } from "../src/crash-log.js";

// 终端被关掉/管道断开/控制台 resize 时，stdin/stdout 的 EPIPE、EINVAL 会变成
// 未捕获异常直接结束进程；先装日志，保证窗口被关掉时现场还留在文件里。
installCrashLogger();
guardStdStreamErrors();

main(process.argv.slice(2)).catch((error) => {
  const message = error && error.message ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = error && Number.isInteger(error.exitCode) ? error.exitCode : 1;
});
