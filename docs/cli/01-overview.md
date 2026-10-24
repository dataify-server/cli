# 概述

> Dataify MCP CLI 是什么、能做什么、如何工作。一次配置，即可在终端调用 Dataify MCP 服务暴露的数据采集工具，并把结构化结果直接交给下游脚本或 AI。

## Dataify MCP CLI

Dataify MCP CLI（`dataify-mcp-cli`）是一个跨平台的命令行工具，封装了 Dataify MCP 服务的 JSON-RPC 调用（`initialize` → `tools/list` → `tools/call`）。它把"连哪个服务、带哪些工具、用什么 Token"这些细节都固定下来，你只需要关心 **调哪个工具、传什么参数**。

它同时覆盖了**登录鉴权、工具浏览、参数查询、工具调用、账户余额、MCP 配置安装、Skill 安装、分类向导与交互模式**，并在中英文之间自由切换。

本文示例版本：`0.3.8`｜要求 Node.js `>= 18.17`｜许可证：MIT。

## 你能用它做什么

下面列出 CLI 真实支持的能力：

| 能力 | 说明 |
| --- | --- |
| **登录 / 登出** | 用 `dataify login` 在浏览器完成授权，自动把 API Key 写入本地配置；`dataify logout` 删除该 Key，`dataify whoami` 查看当前账号。 |
| **一次配置，随处可用** | 用 `dataify init` 向导一次性完成 Token、MCP 安装与 Skill 安装，或手动 `dataify config set --token ...`。 |
| **浏览可用工具** | 用 `dataify tools`（别名 `list`）列出当前 Token 有权限调用的全部工具（来自 MCP `tools/list`，自动翻页拉全）。 |
| **查看工具参数** | 用 `dataify schema <tool>` 查看参数名、是否必填、类型与说明（来自工具 `inputSchema`）。 |
| **调用任意工具** | 用 `dataify <tool> --参数 值` 或 `dataify call <tool> ...` 直接发起 MCP `tools/call`。 |
| **分类向导** | `dataify serp` / `dataify scraper` / `dataify webunlock` 按类别列出工具，选一个后自动带出参数并进入可编辑命令行。 |
| **查看账户余额** | `dataify balance` 查询当前账号余额。 |
| **安装 MCP 配置** | `dataify mcp` 把 Dataify MCP 服务写入 Claude Code、Cursor、Codex、VS Code 的配置。 |
| **安装 Skill** | `dataify skill` 从 `dataify-server/skills` 下载并安装 Dataify Skills 到通用/Claude Code/Codex/Cursor 目录。 |
| **交互式连续操作** | 直接运行 `dataify`（或 `dataify chat` / `dataify repl`）进入交互模式，连续执行命令、查看工具、重试上一条命令。 |
| **多种参数传递方式** | 普通字符串参数、`--arg k=v`、`--arg-json k=v`、`--args-json '{...}'`、`--args-file file.json`、`--stdin`，适配字符串 / 数字 / 布尔 / 对象 / 数组。 |
| **灵活的输出格式** | 默认输出工具返回的主要内容（`structuredContent` 或文本）；`--raw` 输出完整 MCP 结果；`--output` 写入文件。 |
| **中英双语界面** | 用 `dataify language zh\|en` 切换 CLI 自身文案；工具/参数描述仍按服务端返回原样显示。 |
| **超时与调试** | `--timeout 30s` 调整请求超时；`--debug` 把请求 URL（Token 已脱敏）与 JSON-RPC 请求体打印到 stderr。 |

## CLI 长什么样

```bash
# 完整初始化向导（登录 / Token、MCP、Skill）
dataify init

# 浏览器登录，并查看当前账号
dataify login
dataify whoami

# 查看账户余额
dataify balance

# 列出当前 Token 可用的工具
dataify tools

# 查看某个工具的参数
dataify schema google_search

# 按分类挑工具（交互式）
dataify serp
dataify scraper
dataify webunlock

# 直接调用一个工具
dataify google_search --q "pizza" --json 1

# 等价的通用调用写法
dataify call google_search --q "pizza" --json 1

# 调用 Web Unlocker 解锁并抓取网页
dataify request_web_unlocker --url https://example.com --type html

# 查询采集任务状态（带整数型参数）
dataify call web_unlock_task --status -1 --page 1 --pageSize 10

# 安装 MCP 配置 / Skill
dataify mcp
dataify skill

# 切换界面语言
dataify language zh

# 进入交互模式（不接 AI，只是连续执行命令）
dataify
```

> **提示**：在本机全局安装后，命令就是 `dataify`；用 `npx` 运行则是 `npx dataify-mcp-cli ...`。

## 工作原理

Dataify MCP CLI 把 Dataify MCP 服务封装成简单的终端命令。它在底层做了这些事：

1. **固定接入地址**：CLI 内部写死 MCP 地址 `https://mcp.dataify.com/mcp`，并在 URL 上固定拼好 `tools` 查询参数（共 27 个工具类别）。你只需要提供 Token。
2. **建立会话（initialize）**：每次运行命令先发 `initialize` 请求，声明协议版本与客户端信息，拿到会话 ID 与协商后的协议版本，再发 `notifications/initialized` 完成握手。
3. **鉴权**：Token 作为 URL 的 `token` 查询参数附带。Token 可来自 `--token`、环境变量 `DATAIFY_API_TOKEN` 或本地配置文件；也可以先用 `dataify login` 通过浏览器授权自动生成。
4. **路由请求**：`tools` / `schema` 走 `tools/list`（按 `nextCursor` 自动翻页拉全）；`call` / 直接调用走 `tools/call`，把你的参数原样作为 `arguments` 发出。
5. **解析并返回结果**：服务端返回后，CLI 优先取 `structuredContent` 或文本内容；能解析成 JSON 就美化输出，否则原样输出文本；`--raw` 则把完整的 MCP `result` 打印出来。工具返回错误（`isError` 或业务错误）时以退出码 `2` 结束。
6. **本地化与交互**：CLI 自身文案支持 `en` / `zh`（`dataify language` 切换）；交互模式下可连续执行、`/retry` 重跑上一条命令。

> **零额外配置即可上手**：`dataify init`（或 `dataify login`）之后，绝大多数命令开箱即用——MCP 地址和 `tools` 列表都已固定，你无需关心服务端接入细节。

## 资源

| 资源 | 说明 | 链接 |
| :--- | :--- | :--- |
| 📘 **GitHub 仓库** | 查看源码、示例并做出贡献 | [GitHub](https://github.com/dataify-server/cli) |
| 📦 **CLI 模块** | 包说明、版本与发布信息 | [dataify-mcp-cli](https://www.npmjs.com/package/dataify-mcp-cli) |