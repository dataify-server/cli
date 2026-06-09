# Dataify MCP CLI 使用文档

`dataify-mcp-cli` 是 Dataify MCP 的命令行调用工具。安装后可以在 Windows、macOS、Linux 的终端中使用 `dataify` 命令调用 Dataify MCP 中的工具。

## 环境要求

使用前请先安装 Node.js：

- Node.js 版本要求：`>= 18.17`
- 推荐使用 Node.js LTS 版本

查看当前 Node.js 版本：

```bash
node -v
```

查看当前 npm 版本：

```bash
npm -v
```

## 安装

全局安装：

```bash
npm install -g dataify-mcp-cli
```

安装完成后，命令行中使用的是：

```bash
dataify
```

检查是否安装成功：

```bash
dataify --version
```

查看帮助：

```bash
dataify --help
```

## 配置 API Token

首次使用前需要配置 Dataify API Token：

```bash
dataify config set --token <your_api_token>
```

示例：

```bash
dataify config set --token YOUR_TOKEN
```

查看当前配置：

```bash
dataify config get
```

查看配置文件路径：

```bash
dataify config path
```

配置文件默认保存在用户目录下：

```text
~/.dataify-mcp-cli/config.json
```

## 交互模式

直接执行：

```bash
dataify
```

会进入交互模式：

```text
    ____        __        _ ____     
   / __ \____ _/ /_____ _(_) __/_  __
  / / / / __ `/ __/ __ `/ / /_/ / / /
 / /_/ / /_/ / /_/ /_/ / / __/ /_/ / 
/_____/\__,_/\__/\__,_/_/_/  \__, /  
                             /____/   

Dataify MCP CLI 0.1.9 interactive mode
Common commands:
  /tools                              List available tools
  /schema <tool>                     Show tool parameters
  /call <tool> --param value         Call a tool
  google_search --q "pizza"          Call a tool directly
  /retry                             Run the previous command again
  /clear                             Clear the screen
  /exit                              Quit interactive mode

Tips:
  Commands also work without "/", for example: tools
  Type /help to show this guide again.

dataify>
```

交互模式中可以输入：

```text
/tools
/schema google_search
/call google_search --q "pizza" --arg-json json=1
/retry
/exit
```

也可以省略 `/`，直接输入普通命令：

```text
tools
schema google_search
google_search --q "pizza" --arg-json json=1
```

显式进入交互模式：

```bash
dataify chat
```

或者：

```bash
dataify repl
```

交互模式是轻量 CLI 模式，不接入 AI，不会自动理解自然语言。它只是让用户可以连续执行 Dataify MCP 工具命令。

## 使用 npx 运行

如果不想全局安装，也可以使用 `npx`：

```bash
npx dataify-mcp-cli --help
```

调用工具示例：

```bash
npx dataify-mcp-cli google_search --q "pizza" --json 1
```

如果使用 `npx`，仍然建议先通过全局命令配置 token，或者使用环境变量配置 token。

## 使用环境变量配置 Token

除了 `dataify config set --token`，也可以通过环境变量设置 token。

### Windows PowerShell

```powershell
$env:DATAIFY_MCP_TOKEN="YOUR_TOKEN"
```

### Windows cmd

```bat
set DATAIFY_MCP_TOKEN=YOUR_TOKEN
```

### macOS / Linux

```bash
export DATAIFY_MCP_TOKEN="YOUR_TOKEN"
```

也支持：

```bash
export DATAIFY_API_TOKEN="YOUR_TOKEN"
```

环境变量优先级高于本地配置文件。

## 查询可用工具

查看当前 token 可使用的工具：

```bash
dataify tools
```

如果想查看原始 MCP 返回：

```bash
dataify tools --raw
```

## 查询工具参数

查看某个工具需要哪些参数：

```bash
dataify schema <tool_name>
```

示例：

```bash
dataify schema google_search
```

输出会展示参数名和参数说明，例如：

```text
+-----------+----------+--------+--------------------------------+
| Parameter | Required | Type   | Description                    |
+-----------+----------+--------+--------------------------------+
| q         | yes      | string | Search query text.             |
+-----------+----------+--------+--------------------------------+
| json      | no       | number | Whether to return JSON format. |
+-----------+----------+--------+--------------------------------+
```

## 调用工具

调用工具的基本格式：

```bash
dataify <tool_name> --参数名 参数值
```

示例：

```bash
dataify google_search --q "pizza" --json 1
```

也可以使用通用调用格式：

```bash
dataify call google_search --q "pizza" --json 1
```

这两种写法等价。

## 参数传递方式

### 普通参数

```bash
dataify google_search --q "pizza" --json 1
```

普通参数会以字符串形式传给 MCP 工具：

```json
{
  "q": "pizza",
  "json": "1"
}
```

### 传递数字、布尔值或 JSON 值

如果工具要求参数是数字或布尔值，建议使用 `--arg-json`：

```bash
dataify google_search --q "pizza" --arg-json json=1
```

布尔值示例：

```bash
dataify example_tool --arg-json enabled=true
```

对象或数组参数也可以用 JSON 方式传递。

### 使用完整 JSON 参数

Windows PowerShell：

```powershell
dataify google_search --args-json '{\"q\":\"pizza\",\"json\":1}'
```

macOS / Linux：

```bash
dataify google_search --args-json '{"q":"pizza","json":1}'
```

### 从 JSON 文件读取参数

创建 `params.json`：

```json
{
  "q": "pizza",
  "json": 1
}
```

执行：

```bash
dataify google_search --args-file params.json
```

## 常用示例

### Google Search

```bash
dataify google_search --q "pizza" --arg-json json=1
```

### Web Unlocker

```bash
dataify request_web_unlocker --url https://example.com --type html
```

### 查询任务状态

```bash
dataify query_common_collection_api_task_status --status -1 --page 1 --pageSize 10
```

如果 `page`、`pageSize` 需要数字类型，可以写成：

```bash
dataify query_common_collection_api_task_status --arg-json status=-1 --arg-json page=1 --arg-json pageSize=10
```

## 输出原始结果

默认情况下，CLI 会尽量输出工具返回的主要内容。

如果需要查看完整 MCP tool result：

```bash
dataify google_search --q "pizza" --json 1 --raw
```

## 写入文件

将结果保存到文件：

```bash
dataify google_search --q "pizza" --arg-json json=1 --output result.json
```

## 设置超时时间

实时采集类工具可能需要更长时间，可以通过 `--timeout` 设置超时时间。

```bash
dataify google_search --q "pizza" --arg-json json=1 --timeout 3m
```

支持格式：

```text
120000
30s
2m
```

## 调试请求

如果调用失败，可以加 `--debug` 查看请求 URL 和 JSON-RPC 请求体：

```bash
dataify google_search --q "pizza" --arg-json json=1 --debug
```

注意：`--debug` 只会打印调试信息，不会改变实际请求参数。

## 更新

更新到最新版：

```bash
npm install -g dataify-mcp-cli@latest
```

查看当前安装版本：

```bash
dataify --version
```

## 卸载

```bash
npm uninstall -g dataify-mcp-cli
```

## 固定 MCP 地址

CLI 内部使用固定 MCP 地址：

```text
https://mcp.dataify.com/mcp?token=<your_api_token>&tools=user_info,web_unlocker,google_serp,yandex_serp,duckduckgo_serp,bing_serp,amazon,youtube,facebook,instagram,reddit,walmart,google,booking,indeed,airbnb,google_play_store,github,tiktok,linkedin,glassdoor,twitter,crunchbase,zillow,ebay
```

用户只需要配置 `<your_api_token>`，不需要手动配置 MCP 地址或 tools 参数。

## 常见问题

### 1. 安装后提示找不到 dataify 命令

请先关闭当前终端，重新打开后再执行：

```bash
dataify --help
```

如果仍然找不到，请检查 npm 全局安装目录是否在系统 PATH 中：

```bash
npm config get prefix
```

### 2. tools 没有返回工具

请检查 token 是否正确：

```bash
dataify config get
```

也可以直接重新设置 token：

```bash
dataify config set --token YOUR_TOKEN
```

### 3. schema 查询不到工具

请先查看当前 token 可用工具：

```bash
dataify tools
```

如果工具不在列表中，说明当前 token 或 MCP 服务端没有返回该工具。

### 4. 调用 google_search 偶尔返回 Collection failed

`google_search` 属于实时采集类工具，可能受到目标站、代理、网络、采集队列等因素影响。

可以尝试：

```bash
dataify google_search --q "pizza" --arg-json json=1 --timeout 3m
```

如果需要排查请求内容：

```bash
dataify google_search --q "pizza" --arg-json json=1 --debug
```

### 5. token 会不会暴露

token 会保存在本机用户目录的配置文件中，也会作为 MCP 请求 URL 的 `token` 参数发送到 Dataify MCP 服务。

请不要把 token 提交到 GitHub，也不要在公开日志中暴露 token。
