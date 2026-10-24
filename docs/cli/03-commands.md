# 命令

> Dataify MCP CLI 全部命令：全局选项、鉴权命令、工具命令、安装命令、交互模式，以及参数传递方式。所有命令都围绕"列出工具 → 查看参数 → 调用工具"这条主线展开。

## 全局选项

下列选项是工具类命令（`tools`/`list`、`balance`、`schema`、`call`、直接调用，以及 `serp`/`scraper`/`webunlock`/`mcp`）通用的全局选项，写在命令名之前或之后均可，例如 `dataify tools --token X` 或 `dataify --token X tools`。`init`/`login`/`logout`/`whoami`/`skill`/`language`/`config` 等子命令另有专属选项，见各自章节：

| 选项 | 说明 |
| --- | --- |
| `--token <TOKEN>` | Dataify API Token，会作为 URL 的 `?token=...` 参数附加到 MCP 请求上。优先级最高。 |
| `--timeout <VALUE>` | 请求超时。支持毫秒数字、`30s`（秒）、`2m`（分钟），例如 `120000`、`30s`、`2m`。默认 `120000` 毫秒。 |
| `--language <zh\|en>` | 覆盖本次命令的界面语言。 |
| `--raw` | 输出完整的 MCP `tool result`（含 `content`、`isError` 等原始字段），而不是只输出 `structuredContent` 或文本内容。 |
| `--output <FILE>` | 把命令输出写入指定文件，而不是打印到终端。 |
| `--header <K=V>` | 追加一个自定义 HTTP 请求头，格式为 `Name=value`，可多次使用。 |
| `--debug` | 把请求 URL（Token 已脱敏）与 JSON-RPC 请求体打印到 stderr，便于排查；不影响实际请求参数与结果。 |
| `--help` | 显示帮助文本。 |
| `--version` | 显示 CLI 版本号（`0.3.8`）。 |

> **关于 MCP 地址与工具列表**：CLI 内部的 MCP 地址固定为 `https://mcp.dataify.com/mcp`，`tools` 查询参数也固定为内置的 27 个工具类别（见文末"固定 MCP 地址"）。历史上出现过的 `--server` / `--endpoint` / `--tools` 选项**已移除**；现在传入会被判为未知选项并报 `Unsupported option`。你只需要配置 Token。

> **未知选项**：不在全局选项白名单里的 `--xxx` 会直接报错 `Unsupported option: --xxx. Run dataify --help to see available options.`，不会再被静默忽略。例外：`call` / 直接调用、`serp` / `scraper` / `webunlock`、`skill` 等命令有各自的参数集合（见下文）。

## 命令一览

| 命令 | 作用 |
| --- | --- |
| `dataify` | 无命令直接运行，交互式 TTY 下进入交互模式，否则打印帮助。 |
| `dataify chat` / `dataify repl` | 显式进入交互模式。 |
| `dataify init` | 初始化向导：Token → MCP → Skill。 |
| `dataify login` / `dataify logout` / `dataify whoami` | 登录、登出、查看当前账号。 |
| `dataify tools` / `dataify list` | 列出当前 Token 可见的工具。 |
| `dataify balance` | 查询账户余额。 |
| `dataify schema <tool>` | 查看某个工具的参数结构。 |
| `dataify call <tool> [--param value]` | 通用调用写法。 |
| `dataify <tool> [--param value]` | 直接以工具名调用（最常用）。 |
| `dataify serp` / `dataify scraper` / `dataify webunlock` | 按分类挑选并调用工具。 |
| `dataify mcp` | 为 Claude Code / Cursor / Codex / VS Code 安装 MCP 配置。 |
| `dataify skill` | 从 GitHub 安装 Dataify Skills。 |
| `dataify language [zh\|en]` | 查看或切换界面语言。 |
| `dataify config [path\|get\|set]` | 查看 / 管理本地配置。 |
| `dataify version` / `dataify help` | 版本号 / 帮助文本。 |

------

## `dataify`（无命令 → 交互模式）

不带任何命令直接运行，若终端是交互式 TTY，则进入交互模式：

```bash
dataify
```

进入后会显示欢迎信息与常用命令提示，提示符为 `dataify>`。这是连续执行工具命令的轻量模式（**不接入 AI**，不会理解自然语言）。如果标准输入/输出不是 TTY（例如在管道里），则不进入交互模式，而是直接打印帮助文本。

------

## `dataify chat` / `dataify repl`

显式进入交互模式（与直接运行 `dataify` 效果相同）：

```bash
dataify chat
dataify repl
```

两者等价，都调用同一个交互循环，带命令补全。

------

## `dataify init`

初始化向导，按顺序执行三步：解析/保存 Token、安装 MCP 配置、安装 Dataify Skill。已有 Token 会直接复用；否则在交互终端里优先浏览器登录，可回退到手动粘贴。

| 选项 | 说明 |
| --- | --- |
| `--token TOKEN` | 先保存 Token 再执行后续步骤。 |
| `--yes`, `-y` | 所有步骤不再询问（MCP / Skill 均按"全部"安装）。 |
| `--skip-login` | 绝不启动浏览器登录。 |
| `--skip-mcp` | 跳过 MCP 安装。 |
| `--skip-skill` | 跳过 Skill 安装。 |
| `--github-token TOKEN` | 传给 `dataify skill`。 |

```bash
dataify init
dataify init --token YOUR_TOKEN --yes
dataify init --token YOUR_TOKEN --skip-mcp --skip-skill
```

------

## `dataify login`

浏览器授权登录（PKCE + 本机回环回调），成功后把新的 API Key 写入本地配置。

| 选项 | 说明 |
| --- | --- |
| `--force`, `-f` | 即使已保存的 Token 仍有效，也重新登录并生成新 Key。 |
| `--no-browser` | 只打印登录 URL，不自动打开浏览器。 |
| `--timeout VALUE` | 授权 API 请求超时，例如 `30s`、`2m`。 |

```bash
dataify login
dataify login --no-browser
dataify login --force
```

> 每次登录都会在账号下新建一把 API Key（有效期为 30 天 / 90 天 / 永不过期，在浏览器授权页选择，默认 30 天），可在控制台 API Key 页面查看或删除。只要已保存的 Key 仍有效，重复登录不会新建 Key（会提示已登录）。

------

## `dataify logout`

尽力删除服务端的 CLI API Key，并移除本地保存的 Token。你的其他 API Key 不受影响。

```bash
dataify logout
```

> 如果当前是通过环境变量 `DATAIFY_API_TOKEN` 提供 Token，登出后该变量仍然有效，CLI 会提示你取消它。

------

## `dataify whoami`

查看当前登录账号（账号名、Token 状态、过期时间、配置文件路径）。

| 选项 | 说明 |
| --- | --- |
| `--json` | 输出原始账号 JSON。 |
| `--raw` | 同 `--json`。 |
| `--token TOKEN` | 检查指定 Token，而不是本地保存的那个。 |

```bash
dataify whoami
dataify whoami --json
```

若 Token 已失效，CLI 会自动从本地配置移除该失效 Token，并提示重新 `dataify login`。

------

## `dataify tools` / `dataify list`

列出当前 Token 可见的全部工具（来自 MCP `tools/list`，会自动按游标翻页拉全）。

| 选项 | 说明 |
| --- | --- |
| `--raw` | 输出原始的 `{ tools: [...] }` 结构，而不是对齐后的表格。 |
| `--output <FILE>` | 将结果写入文件。 |
| `--token <TOKEN>` | 覆盖使用的 Token。 |

```bash
# 默认：对齐的表格（# / Tool / Description）
dataify tools

# 查看完整原始返回
dataify tools --raw

# 用临时 Token 查看
dataify tools --token YOUR_TOKEN
```

如果返回 `No tools returned. Check token/tools permissions.`，说明当前 Token 没有可用工具权限，或 Token 不正确。

------

## `dataify balance`

查询当前账号余额（内部调用 `query_user_balance`）。

```bash
dataify balance
```

若未配置 Token，会提示 `No Dataify token found. Run dataify login, or pass --token TOKEN.`。

------

## `dataify schema <tool>`

显示某个工具的参数结构（来自该工具的 `inputSchema`）：参数名、是否必填、类型与说明。

| 参数 / 选项 | 说明 |
| --- | --- |
| `<tool>` | 工具名称，必填。例如 `google_search`。 |
| `--output <FILE>` | 将结果写入文件。 |

```bash
# 查看 google_search 的参数
dataify schema google_search

# 查看 Web Unlocker 的参数
dataify schema request_web_unlocker
```

若工具名不存在，会报错：`Tool "<tool>" was not returned by the server`。先用 `dataify tools` 确认该工具对当前 Token 可用。

输出示例（表格列：`Parameter` / `Required` / `Type` / `Description`）：

```text
+-----------+----------+--------+--------------------------------+
| Parameter | Required | Type   | Description                    |
+-----------+----------+--------+--------------------------------+
| q         | yes      | string | Search query text.             |
| json      | no       | number | Whether to return JSON format. |
+-----------+----------+--------+--------------------------------+
```

> **类型说明**：`Type` 列直接取自工具的 JSON Schema，可能是 `string` / `number` / `boolean` / `array` 等，也可能是 `enum`、`anyOf`、`oneOf`、`allOf` 等组合类型。

------

## `dataify call <tool> [--param value]`

通用调用方式：显式通过 `call` 调用任意工具。第一个位置参数是工具名，其余是工具参数。

```bash
# 显式调用 google_search
dataify call google_search --q "pizza" --json 1

# 等价的简短写法（见下一条）
dataify google_search --q "pizza" --json 1
```

`dataify call <tool> ...` 与 `dataify <tool> ...` 完全等价。

------

## `dataify <tool> [--param value]`（直接调用）

如果你输入的"命令"不在内置命令集合中，CLI 会把它当作**工具名**直接调用，等价于 `dataify call <tool> ...`。这是最常用的写法。

```bash
# 直接以工具名调用
dataify google_search --q "pizza" --json 1

# Web Unlocker
dataify request_web_unlocker --url https://example.com --type html
```

> **参数命名规则**：未知的长选项（`--name value`）会作为工具参数发送，且选项名里的连字符会被转换为下划线。例如 `--no-cache true` 会变成参数 `no_cache`。如果某个工具参数本身就带下划线，直接写 `--no_cache true` 即可。

------

## `dataify serp` / `dataify scraper` / `dataify webunlock`

分类向导：先按类别列出工具，选中一个后打印它的 `schema`，再给出一行**带默认值、可编辑**的命令让你确认执行。

- `serp`：Google / Bing / Yandex / DuckDuckGo 系列搜索类工具。
- `scraper`：Amazon、YouTube、TikTok、LinkedIn、Reddit 等采集类工具。
- `webunlock`：`request_web_unlocker`（网页解锁）。

```bash
# 进入选择界面
dataify serp
dataify scraper
dataify webunlock

# 也可以直接带工具名与参数，跳过选择
dataify serp google_search --q "pizza" --json 1
dataify scraper amazon_product --spider-id amazon_product_by-url --url "https://www.amazon.com/dp/example"
dataify webunlock request_web_unlocker --url https://example.com --type html
```

> 列表为全屏交互界面；描述按终端宽度裁剪，按 `?` 可查看完整描述。若终端不支持全屏重绘（或设置 `DATAIFY_TUI=0`），会退化为普通编号列表：此时输入 `?N` 查看第 N 项完整描述，输入 `?` 展开全部。

------

## `dataify mcp`

把 Dataify MCP 服务写入常见 Agent 工具的 MCP 配置文件。交互式终端下会让你多选要写入的 Agent 与要启用的工具类别，然后按所选 Agent 逐个写入配置。

支持的 Agent 与写入位置：

| Agent | 写入方式 |
| --- | --- |
| Claude Code | 调用 `claude mcp add --transport http --scope user dataify <url>`（需本机已安装 `claude` CLI） |
| Cursor | 写入 `~/.cursor/mcp.json` |
| Codex | 写入 `~/.codex/config.toml` 的 `[mcp_servers.dataify]` |
| VS Code | 写入当前目录 `.vscode/mcp.json` |

```bash
dataify mcp
```

生成并写入的 MCP URL 形如：

```text
https://mcp.dataify.com/mcp?token=<your_api_token>&tools=<你勾选的工具类别>
```

> `dataify mcp` 没有额外的命令行选项（只有全局选项）；Agent 与工具类别在交互界面中选择。若未检测到 Token，会提示你当场输入并保存。写入完成后重启对应 Agent 生效。

------

## `dataify skill`

从 GitHub 仓库 `dataify-server/skills` 下载并安装 Dataify Skills 到目标 Agent 的 skills 目录。

| 选项 | 说明 |
| --- | --- |
| `--agent`, `--agents` | 目标 Agent：`universal`、`claude-code`、`codex`、`cursor`，或 `all`。逗号分隔可多选。 |
| `--skill`, `--skills` | 要安装的 Skill 名称，逗号分隔。 |
| `--all` | 安装仓库里的全部 Skill。 |
| `--dir DIR` | 通用 skills 目录，默认 `./.agents/skills`。 |
| `--repo OWNER/REPO` | GitHub 仓库，默认 `dataify-server/skills`。 |
| `--ref REF` | Git ref，默认 `main`。 |
| `--github-token TOKEN` | 未认证 API 限流时使用的 GitHub Token；失败会回退到 `git clone`。 |

```bash
dataify skill
dataify skill --agent universal,codex --skill serp-google-search
dataify skill --agent all --all
```

安装目录：通用/Codex/Cursor 写入 `./.agents/skills`（可用 `--dir` 修改），Claude Code 写入 `~/.claude/skills`。可用 `GITHUB_TOKEN` / `GH_TOKEN` 环境变量替代 `--github-token`。

------

## `dataify language [zh|en]`

查看或切换 CLI 界面语言。

```bash
dataify language        # 打印当前语言与用法
dataify language zh     # 切换为中文
dataify language en     # 切换为英文
```

选择会写入配置文件；`--language zh` 只影响单条命令；环境变量 `DATAIFY_LANGUAGE` 覆盖配置文件。在交互模式中，`/language`（不带参数）会弹出语言选择器。

> 语言切换只覆盖 CLI 自身文案（帮助、表头、向导提示、状态信息）。工具与参数描述来自 MCP 服务端，按原样显示。

------

## `dataify config`

查看和管理本地 CLI 配置（`~/.dataify-mcp-cli/config.json`）。无子命令时默认执行 `get`。

| 子命令 | 说明 |
| --- | --- |
| `path` | 打印配置文件绝对路径。 |
| `get` | 打印当前配置文件内容（`token` 已打码）。 |
| `set` | 写入配置。支持 `--token`、`--timeout`、`--language`，可同时指定。 |

```bash
dataify config path
dataify config get
dataify config set --token YOUR_TOKEN
dataify config set --timeout 3m
dataify config set --language zh
```

> **注意**：`config get` 只输出配置文件本身的内容（`token` 已替换为 `[redacted]`），不再附加固定的 `server` / `tools`。`server` 与 `tools` 无法通过 `set` 修改。

------

## `dataify version` / `dataify help`

```bash
dataify version
dataify --version

dataify help
dataify --help
```

------

## 交互模式命令

在 `dataify`（或 `dataify chat` / `dataify repl`）进入的交互模式下，可使用以下命令。所有命令都**可以不带前导 `/`** 直接输入（例如输入 `tools` 等价于 `/tools`）。

| 命令 | 说明 |
| --- | --- |
| `/help`（或 `?`） | 显示交互模式帮助。 |
| `/init` | 运行初始化向导。 |
| `/login` / `/logout` / `/whoami` | 登录 / 登出 / 查看账号。 |
| `/tools` | 列出当前 Token 可用的工具。 |
| `/balance` | 查看账户余额。 |
| `/serp` / `/scraper` / `/webunlock` | 按分类选择并调用工具。 |
| `/schema <tool>` | 显示某个工具的参数结构。 |
| `/call <tool> ...` | 调用某个工具，例如 `/call google_search --q "pizza"`。 |
| `工具名 ...` | 直接调用工具，例如 `google_search --q "pizza" --json 1`。 |
| `/mcp` | 安装 MCP 配置。 |
| `/skill` | 安装 Dataify Skills。 |
| `/language [zh\|en]` | 查看/切换界面语言（不带参数时弹出选择器）。 |
| `/retry` | 重新执行上一条命令。 |
| `/clear` | 清屏。 |
| `/exit`（或 `/quit`、`exit`、`quit`） | 退出交互模式。 |

```text
dataify> /tools
dataify> /schema google_search
dataify> /call google_search --q "pizza" --json 1
dataify> google_search --q "pizza" --json 1
dataify> /retry
dataify> /exit
```

> **提示**：交互模式会记住上一条成功解析的命令，`/retry` 可一键重跑；输入为空则忽略；未闭合的引号会报错提示。

------

## 参数传递方式

调用工具时，参数有几种写法，用来适配不同类型（字符串 / 数字 / 布尔 / 对象 / 数组）：

| 形式 | 作用 | 示例 |
| --- | --- | --- |
| `--name value` | 作为**字符串**参数发送（选项名里的连字符会转成下划线）。 | `dataify google_search --q "pizza"` |
| `--arg k=v` | 显式以**字符串**设置参数 `k`。 | `dataify call google_search --arg q=pizza --arg json=1` |
| `--arg-json k=v` | 把 `v` 当作 **JSON** 解析后设置参数 `k`（得到数字 / 布尔 / 对象等）。 | `dataify call web_unlock_task --arg-json page=1` |
| `--args-json '{...}'` | 用一个 **JSON 对象**整体合并进参数。 | `dataify call google_search --args-json '{"q":"pizza","json":"1"}'` |
| `--args-file file.json` | 从 **JSON 文件**读取对象并合并进参数。 | `dataify call google_search --args-file params.json` |
| `--stdin` | 从**标准输入**读取一个 JSON 对象并合并进参数。 | `echo '{"q":"pizza"}' \| dataify google_search --stdin` |

补充说明：

- 普通 `--name value` 得到的是**字符串**值。若工具要求数字或布尔，更稳妥的是用 `--arg-json`（例如 `--arg-json page=1` 得到数字 `1`；`--arg-json enabled=true` 得到布尔 `true`）。
- `--args-json` 必须是 JSON 对象（不能是数组或原始值），否则报错。
- `--args-file` 与 `--args-json` 会"合并"进已设置的参数；后面出现的同名键会覆盖前面的。
- 工具参数里**不接受额外的位置参数**：紧跟在某个 `--name value` 之后的裸字符串会被追加到该参数值上（例如 `--q pizza extra` 得到 `q="pizza extra"`），而出现在任何参数之前的裸字符串会直接报错；`--` 之后也不能继续传参。
- 输出控制 `--raw` / `--output` 既可以作为全局选项，也可以作为工具参数位置上的"元选项"出现，效果一致。

```bash
# 普通字符串参数
dataify google_search --q "pizza" --json 1

# 显式字符串形式
dataify call google_search --arg q=pizza --arg json=1

# JSON 数字形式
dataify call web_unlock_task --arg-json status=-1 --arg-json page=1 --arg-json pageSize=10

# 整段 JSON 对象
dataify call google_search --args-json '{"q":"pizza","json":"1"}'

# 从文件读取参数（创建 params.json 后）
dataify call google_search --args-file params.json

# 从管道读取 JSON
echo '{"q":"pizza","json":1}' | dataify google_search --stdin
```

## 固定 MCP 地址

CLI 始终向以下地址发请求（仅 `<your_api_token>` 由你提供）：

```text
https://mcp.dataify.com/mcp?token=<your_api_token>&tools=user_info,web_unlocker,google_serp,yandex_serp,duckduckgo_serp,bing_serp,amazon,youtube,facebook,instagram,reddit,walmart,google,booking,indeed,airbnb,google_play_store,github,tiktok,linkedin,glassdoor,twitter,crunchbase,zillow,ebay,chatgpt,ai_web
```

你无需（也无法）修改 MCP 地址或 `tools` 列表，只需确保 Token 正确即可。