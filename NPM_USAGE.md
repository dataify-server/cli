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

## 登录

获取 token 最简单的方式是浏览器登录：

```bash
dataify login
```

`dataify login` 会拉起默认浏览器打开 Dataify 登录页。你在浏览器里登录并确认授权后，CLI 会在本机回环地址上收到一次性授权码，用它换取一把新的 API Key 并写入本地配置文件。之后 `tools`、`balance`、`mcp` 以及各类工具调用都可以直接使用。

API Key 的有效期在浏览器授权页选择：30 天（默认）、90 天或永不过期。

如果当前环境拉不起浏览器（比如无图形界面的服务器或 SSH 会话），可以只打印 URL 自己打开：

```bash
dataify login --no-browser
```

登录 URL 里的 `redirect_uri` 指向本机 `127.0.0.1`，所以请在运行 CLI 的同一台机器上打开这个链接。

每次成功登录都会在账号下**新建**一把 API Key，因此在本地 token 仍然有效时重复执行 `dataify login` 不会重新登录，只会提示当前已登录。确实需要换一把新 key 时加 `--force`：

```bash
dataify login --force
```

查看当前登录账号：

```bash
dataify whoami
dataify whoami --json
```

退出登录。这会在服务端删除本次登录创建的 CLI API Key，并清除本地保存的 token，不影响你的其他 API Key：

```bash
dataify logout
```

每次登录创建的 API Key 都能在 Dataify 控制台的 API Key 页面看到，也可以在那里随时删除。

## 配置 API Token

推荐直接用 `dataify login`。如果你已经有 API Token，也可以手动配置：

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

在 macOS / Linux 上，配置文件以 `0600` 权限写入，所在目录为 `0700`，只有当前用户可读。执行 `dataify login` 后，文件里还会多出一个 `auth` 段，保存账号名和 key 到期时间，不会重复保存 token。

Token 使用优先级：

```text
命令行 --token -> 环境变量 DATAIFY_API_TOKEN -> 本地配置文件 token
```

如果在交互终端里直接执行 `dataify mcp` 或 `dataify init` 时还没有配置 token，CLI 会先询问是否用浏览器登录，也可以选择手动粘贴 token 并自动保存。非交互环境请先执行 `dataify login`、`dataify config set --token`，或直接传 `--token`。

## 初始化向导

执行：

```bash
dataify init
```

常见非交互示例：

```bash
dataify init --token YOUR_TOKEN --yes
dataify init --token YOUR_TOKEN --skip-mcp --skip-skill
dataify init --skip-login
dataify init --github-token YOUR_GITHUB_TOKEN
```

初始化向导会优先使用已有 token；在交互终端里如果还没有 token，会先询问是否用浏览器登录，选择不登录时再回落到手动粘贴 token。加 `--skip-login` 可以完全跳过浏览器登录。token 就绪后，可选地安装 MCP 配置和 Dataify skills。

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

Dataify MCP CLI 0.3.2 interactive mode
Common commands:
  /init                              Run the setup wizard
  /login                             Sign in with your browser
  /logout                            Sign out and delete the CLI API key
  /whoami                            Show the signed-in account
  /tools                              List available tools
  /balance                           Show account balance
  /serp                              Choose and call a SERP tool
  /scraper                           Choose and call a scraper tool
  /webunlock                         Choose and call a Web Unlocker tool
  /schema <tool>                     Show tool parameters
  /call <tool> --param value         Call a tool
  /mcp                               Install MCP configs for agents
  /skill                             Install Dataify skills
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
/init
/login
/logout
/whoami
/tools
/balance
/serp
/scraper
/webunlock
/schema google_search
/call google_search --q "pizza" --arg-json json=1
/mcp
/skill
/language zh
/retry
/exit
```

也可以省略 `/`，直接输入普通命令：

```text
tools
balance
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

`serp` / `scraper` / `webunlock` 的工具列表里，每个工具固定占一行，且工具名占一列、左对齐补空格，让每行的 `-` 纵向对齐：

```text
> amazon_product         - 当用户需要 Amazon 产品详情、商品详情、商品信息…
  amazon_global_product  - 当用户需要 Amazon 全球产品详情、Amazon 全球商品…
```

描述会按终端宽度截断，不会换行堆成一大片。想看完整描述，把光标移到该工具后按 `?`，列表下方会弹出一个带边框的完整描述框，再按一次 `?` 收起。名字列宽度取该列表里最长的工具名；只有当终端窄到不足以给描述留出空间时，才会收窄名字列并截断偏长的名字。

Windows 10 及以上的 PowerShell / cmd 也会走同一套全屏列表，`?` 面板在里面同样可用。如果某个终端不支持全屏重绘（或者你更想要朴素的输出），设置 `DATAIFY_TUI=0`，向导会退回编号列表：此时输入 `?N` 查看第 N 项的完整描述，输入 `?` 展开全部，看完会回到同一个输入提示。

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
$env:DATAIFY_API_TOKEN="YOUR_TOKEN"
```

### Windows cmd

```bat
set DATAIFY_API_TOKEN=YOUR_TOKEN
```

### macOS / Linux

```bash
export DATAIFY_API_TOKEN="YOUR_TOKEN"
```

环境变量优先级高于本地配置文件。

## 界面语言

CLI 界面支持英文（默认）和中文两种语言：

```bash
dataify language zh
dataify language en
```

交互模式中可以直接输入：

```text
/language zh
/language en
/language
```

交互模式下不带参数的 `/language` 会弹出选择列表（English / 中文），当前语言为默认项，选中后立即生效；
一次性命令 `dataify language` 不带参数时仍然只打印当前语言和用法，避免脚本被卡住。

语言选择会写入配置文件；环境变量 `DATAIFY_LANGUAGE` 的优先级高于配置文件；`--language zh` 只对当前
这条命令生效。

语言切换覆盖的是 CLI 自身的文案，包括帮助信息、表格表头、向导提示和状态信息。工具与参数
的 description 由 MCP 服务端返回，展示内容以服务端返回为准。

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
dataify google_search --args-json '{"q":"pizza","json":1}'
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

## 终端尺寸覆盖

向导默认按终端宽度排版，并留 1 列余量，避免长行被挤到屏幕外。需要手动指定时：

```powershell
$env:DATAIFY_WIDTH="100"
$env:DATAIFY_TUI="0"
```

`DATAIFY_WIDTH` 强制指定列数；`DATAIFY_TUI=0` 强制使用朴素的编号列表而不是全屏列表。

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

也可以确认服务端是否还认这把 token：

```bash
dataify whoami
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

登录流程本身不会把 token 放进任何 URL：授权码只出现在本机回环回调里且只能使用一次，token 只在 POST 响应体中返回并写入配置文件。`dataify login` 和 `dataify whoami` 都不会打印 token，`dataify config get` 会对 token 做脱敏。

### 6. login 没有自动打开浏览器

改成只打印链接，自己复制到浏览器打开：

```bash
dataify login --no-browser
```

即使成功拉起了浏览器，CLI 也会同时把完整登录 URL 打印出来。注意这个链接里的回调地址指向本机 `127.0.0.1`，必须在运行 CLI 的同一台机器上打开。

### 7. login 提示已经登录

这是预期行为：本地 token 仍然有效时不会重复登录，避免在账号下堆积一堆 API Key。确实要换新 key 时执行：

```bash
dataify login --force
```

### 8. login 一直等不到回调

CLI 最多等待 5 分钟，超时后会关闭本地监听并提示重新执行 `dataify login`。如果始终收不到回调，请检查本机防火墙是否拦截了回环连接，以及是否有代理软件改写了 `127.0.0.1` 的流量。

### 9. whoami 提示 token 已失效

说明 key 已过期，或者已在控制台 API Key 页面被删除。CLI 会自动清掉配置文件里那把失效的 token，重新登录即可：

```bash
dataify login
```
