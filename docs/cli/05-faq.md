# 常见问题

> 关于 Dataify MCP CLI 的通用问题、登录与 Token 配置、排错与配置相关的答疑。所有回答均基于本 CLI 的真实实现（`0.3.8`）。

## 通用问题

### Dataify MCP CLI 是什么？

它是一个跨平台的命令行工具，用来调用 Dataify MCP HTTP 服务暴露的数据采集工具（搜索、Web Unlocker、采集任务、账户信息等）。它把 MCP 地址和工具列表固定下来，你只需完成登录（或配置 Token）并指定要调用的工具与参数。

### 需要什么运行环境？

- **Node.js**：版本 `>= 18.17`（建议用 LTS 版本）。
- **操作系统**：Windows、macOS、Linux 均可。
- 查看版本：`node -v`、`npm -v`。

### 有没有命令别名？

没有额外的可执行别名：全局安装后命令固定为 `dataify`，`npx` 运行时为 `dataify-mcp-cli`。不过部分内置命令有等价写法：`tools` 等价 `list`，`chat` 等价 `repl`。

### 支持哪些输出形式？

- 默认：输出工具返回的主要内容——优先 `structuredContent`，否则提取文本类型 `content`；若文本能解析成 JSON 则美化输出。
- `--raw`：输出完整的 MCP `tool result`（含 `content`、`isError` 等原始字段）。
- `--output <FILE>`：把结果写入文件而不是打印到终端。

### 支持哪些命令？

内置命令有：`init`、`login` / `logout` / `whoami`、`tools` / `list`、`balance`、`schema`、`call`、`serp` / `scraper` / `webunlock`、`mcp`、`skill`、`language`、`config`、`chat` / `repl`（交互模式）、`version`、`help`。其余你输入的"命令"都会被当作工具名直接调用。

### 界面支持哪些语言？

支持英文（默认）与中文：`dataify language zh` / `dataify language en`，或单条命令 `--language zh`，或环境变量 `DATAIFY_LANGUAGE`。语言切换只覆盖 CLI 自身文案，工具/参数描述按服务端返回原样显示。

## 登录与 Token 配置

### 如何登录？

```bash
dataify login
```

浏览器授权完成后，CLI 自动把生成的 API Key 保存到本地配置。有效期（30 天 / 90 天 / 永不过期）在浏览器授权页选择。需要换一把新 Key 时用 `dataify login --force`；无法打开浏览器时用 `dataify login --no-browser`（只打印 URL）。

### Token 在哪里配置？

有三种等价方式（按优先级覆盖）：

1. 登录或写入配置文件（推荐，最省事）：

```bash
dataify login
# 或
dataify config set --token YOUR_TOKEN
```

2. 单条命令内联：

```bash
dataify tools --token YOUR_TOKEN
```

3. 环境变量（适合 CI / 容器）：

```bash
export DATAIFY_API_TOKEN="YOUR_TOKEN"
```

### 环境变量和配置文件，谁优先？

优先级从高到低：**命令行选项** > **环境变量**（`DATAIFY_API_TOKEN` / `DATAIFY_MCP_TIMEOUT` / `DATAIFY_LANGUAGE`） > **本地配置文件** > **内置默认值**。所以命令行 `--token` 会覆盖环境变量，环境变量会覆盖配置文件。

### 怎么切换不同的 Token？

最简单的方式是重新登录：`dataify login --force`；或重新设置：`dataify config set --token NEW_TOKEN`；或只对某次调用使用不同 Token：`dataify tools --token NEW_TOKEN`。本工具通过 Token 鉴权，没有会话状态，重新设置 Token 即可切换账号。

### 登录会创建什么？

每次成功登录都会在你的账号下**新建一把 API Key**，可在控制台 API Key 页面查看或随时删除。退出登录 `dataify logout` 只删除 CLI 自己创建的那把 Key，不影响你的其他 API Key。

### Token 会不会泄露？

Token 保存在本机用户目录的配置文件中，也会作为 MCP 请求 URL 的 `token` 查询参数发往 Dataify MCP 服务。因此：不要把 Token 提交到 Git 仓库，不要在公开日志中打印 Token。`dataify config get` 会把 Token 打码后再显示，`--debug` 打印的请求 URL 里 Token 也已脱敏。在共享环境用完后删除配置文件（见下"如何重置配置"）。

## 排错

### 安装后提示找不到 `dataify` 命令

先关闭当前终端、重新打开后再试：

```bash
dataify --help
```

若仍找不到，检查 npm 全局安装目录是否在系统 `PATH` 中：

```bash
npm config get prefix
```

把该目录下的 `bin` 路径（例如 `<prefix>/bin`）加入 `PATH` 后重试。

### 报 `Unsupported option: --xxx`

说明你传入了一个不支持的选项。CLI 现在不会静默忽略未知选项。注意 `--server` / `--endpoint` / `--tools` 已被移除，无法再用来改变 MCP 地址或工具列表。运行 `dataify --help` 查看可用选项。

### `dataify tools` 没有返回任何工具

通常是 Token 不正确，或该 Token 没有对应工具的权限。请检查：

```bash
dataify config get                       # 确认已保存的 token（打码）
dataify whoami                           # 用服务端确认 Token 是否有效
dataify tools --token YOUR_TOKEN         # 用已知有效的 token 直接验证
```

### `schema` 查不到某个工具

先用 `dataify tools` 看当前 Token 实际能用的工具列表。如果该工具不在列表里，说明当前 Token 或 MCP 服务端没有返回它——`schema` 只能查服务端确实返回的工具，否则会报 `Tool "<tool>" was not returned by the server`。

### 登录时浏览器没打开

用 `--no-browser` 只打印 URL，手动复制到浏览器打开：

```bash
dataify login --no-browser
```

登录页需要能访问打印出的 `127.0.0.1` 回调地址，因此请在**运行 CLI 的同一台机器**上打开该 URL。URL 无论是否自动打开浏览器都会打印，方便你复制到别处。

### 登录提示已经登录

这是预期的：只要已保存的 Key 仍然有效，重复登录不会新建 Key（避免反复新建 Key），只会提示你已登录。需要强制换新 Key 时：

```bash
dataify login --force
```

### 登录超时

CLI 会等待浏览器回调一段时间后停止监听。重新运行 `dataify login` 即可。若回调始终不到，检查本机防火墙是否拦截了回环（`127.0.0.1`）连接，或是否有代理改写了回环流量。

### `whoami` 提示 Token 已失效

说明这把 Key 已过期，或在控制台的 API Key 页面被删除。CLI 会自动从本地配置移除这个失效 Token，重新登录即可：

```bash
dataify login
```

### 调用 `google_search` 时返回失败或报错

`google_search` 属于实时采集类工具，返回结果可能受目标站点、代理、网络、采集队列等因素影响而失败或报错。可以尝试：

```bash
dataify google_search --q "pizza" --json 1 --timeout 3m
```

如需排查请求内容，加 `--debug`：

```bash
dataify google_search --q "pizza" --json 1 --debug
```

### 工具报参数类型错误 / 数字参数没生效

普通 `--name value` 一律按**字符串**发送。如果工具要求数字或布尔，务必用 `--arg-json`：

```bash
# 错误：page 变成字符串 "1"
dataify call some_tool --page 1

# 正确：page 是数字 1
dataify call some_tool --arg-json page=1
```

### 参数名里有连字符会怎样？

未知选项的连字符会被转换成下划线。例如 `--no-cache true` 会作为 `no_cache` 参数发送。如果参数本来就带下划线，直接写 `--no_cache true` 即可。

### 调用失败，如何看底层请求？

加 `--debug`，会把请求 URL 和 JSON-RPC 请求体打印到 stderr（不影响实际请求与结果）。若工具返回 `isError` 或业务错误，CLI 会以退出码 `2` 结束并把错误信息写到 stderr。

## 配置

### 配置文件保存在哪里？

```text
~/.dataify-mcp-cli/config.json
```

可用 `dataify config path` 查看绝对路径。

### MCP 地址和工具列表能改吗？

不能。MCP 地址固定为 `https://mcp.dataify.com/mcp`，`tools` 查询参数固定为内置的 27 个工具类别（包含 `user_info`、`web_unlocker`、`google_serp`、`amazon`、`youtube`、`linkedin`、`github`、`chatgpt`、`ai_web` 等）。`--server` / `--endpoint` / `--tools` 选项已被移除，传入会报 `Unsupported option`。你只需保证 Token 正确。

### 配置优先级是怎样的？

从高到低：**命令行选项** > **环境变量** > **本地配置文件** > **内置默认值**。每一项都可以按命令粒度覆盖上一项。

### 默认超时是多少？怎么改？

默认超时 `120000` 毫秒（120 秒）。修改方式（优先级同上）：

```bash
# 命令行
dataify google_search --q "pizza" --timeout 3m

# 环境变量
export DATAIFY_MCP_TIMEOUT=180000

# 写入配置文件
dataify config set --timeout 180000
```

支持的格式：`120000`（毫秒）、`30s`（秒）、`2m`（分钟）。

### 如何重置所有配置？

删除配置文件即可，之后重新 `dataify login` 或 `dataify config set --token ...`：

```bash
# macOS / Linux
rm -f ~/.dataify-mcp-cli/config.json

# Windows PowerShell
Remove-Item "$env:USERPROFILE/.dataify-mcp-cli/config.json"
```

### `config set` 能写哪些字段？

支持 `token`、`timeout`、`language` 三个字段。`server` 与 `tools` 是固定的，无法通过 `set` 修改。`login` 还会写入一个 `auth` 元信息块（账号名、Key 过期时间等）。

### `config get` 会显示 `server` / `tools` 吗？

不会。`config get` 只输出配置文件本身的内容（`token` 已打码），不再附加固定的 `server` / `tools`。如需确认接入点，请参考本文档或 `dataify --help` 的"Fixed MCP URL"。