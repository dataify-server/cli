# 示例

> Dataify MCP CLI 的真实工作流与配方：登录、列出工具、查看参数、搜索、解锁网页、查询采集任务状态，以及管道与 CI 自动化。

## 如何登录并查看账号

```bash
# 浏览器登录（生成一把新的 API Key 并保存到本地）
dataify login

# 查看当前账号
dataify whoami

# 以 JSON 查看账号原始信息
dataify whoami --json

# 退出登录（删除该 API Key 并清除本地 Token）
dataify logout
```

如果已有 API Token，也可以直接保存：

```bash
dataify config set --token YOUR_TOKEN
```

## 如何查看账户余额

```bash
dataify balance
```

## 如何列出可用工具

先确认当前 Token 有哪些工具可用：

```bash
# 对齐表格输出（# / Tool / Description）
dataify tools

# 查看完整原始结构
dataify tools --raw
```

如果列表为空，提示 `No tools returned. Check token/tools permissions.`，请检查 Token 是否正确、是否拥有对应工具权限。

## 如何查看工具参数

调用前先用 `schema` 确认参数名、是否必填与类型，避免猜参数：

```bash
# 查看 google_search 的参数
dataify schema google_search

# 查看 Web Unlocker 的参数
dataify schema request_web_unlocker
```

## 如何进行网页搜索

以 Google 搜索为例（工具名以你 `dataify tools` 列出的为准）：

```bash
# 基本搜索：返回文本内容
dataify google_search --q "pizza"

# 要求返回 JSON 格式（该参数在 schema 里声明为 string，用字符串形式的 1）
dataify google_search --q "pizza" --json 1
```

其他搜索引擎工具（同样来自内置 `tools` 列表）：`yandex_search`、`duckduckgo_search`、`bing_search`。它们的参数通过 `dataify schema <tool>` 查看。

## 如何按分类挑选工具

不想记工具名时，用分类向导：

```bash
# 搜索类（SERP）
dataify serp

# 采集类（Scraper）
dataify scraper

# 网页解锁
dataify webunlock
```

进入后按类别列出工具，选一个会自动显示参数结构并给出一行带默认值、可编辑的命令。

也可以直接带工具名跳过选择：

```bash
dataify serp google_search --q "pizza" --json 1
dataify scraper amazon_product --spider-id amazon_product_by-url --url "https://www.amazon.com/dp/example"
dataify webunlock request_web_unlocker --url https://example.com --type html
```

## 如何使用 Web Unlocker

`request_web_unlocker` 用于解锁并抓取网页（`--type` 指定返回类型，例如 `html`）：

```bash
# 抓取网页 HTML
dataify request_web_unlocker --url https://example.com --type html

# 显式调用写法
dataify call request_web_unlocker --url https://example.com --type html
```

## 如何查询采集任务状态

任务状态工具需要整数型参数，推荐用 `--arg-json` 保证类型正确：

```bash
# 混合写法：普通字符串 + JSON 数字
dataify call web_unlock_task --status -1 --page 1 --pageSize 10

# 完全用 JSON 数字形式（类型最明确）
dataify call web_unlock_task \
  --arg-json status=-1 \
  --arg-json page=1 \
  --arg-json pageSize=10
```

## 如何传递数字 / 布尔 / 对象类型参数

普通 `--name value` 一律按**字符串**发送。当工具要求数字、布尔、对象或数组时，用 `--arg-json`：

```bash
# 数字
dataify call some_tool --arg-json page=1

# 布尔
dataify call some_tool --arg-json enabled=true

# 对象 / 数组
dataify call some_tool --args-json '{"filter":{"active":true},"tags":["a","b"]}'
```

| 形式 | 结果类型 |
| --- | --- |
| `--q pizza` | 字符串 `"pizza"` |
| `--arg-json page=1` | 数字 `1` |
| `--arg-json enabled=true` | 布尔 `true` |
| `--args-json '{"a":1}'` | 对象 `{a:1}` |

## 如何从文件或管道读取参数

当参数较多或想在脚本里复用，把它们放进 JSON 文件或用管道喂入。先准备 `params.json`：

```json
{
  "q": "pizza",
  "json": 1
}
```

执行：

```bash
# 从文件读取
dataify google_search --args-file params.json

# 从标准输入读取（--stdin 会合并一个 JSON 对象）
echo '{"q":"pizza","json":1}' | dataify google_search --stdin
```

## 如何输出原始结果或写入文件

默认输出工具返回的主要内容（文本或 `structuredContent`）。需要完整 MCP 结果时用 `--raw`；需要落盘时用 `--output`：

```bash
# 输出完整 MCP tool result
dataify google_search --q "pizza" --json 1 --raw

# 写入文件
dataify google_search --q "pizza" --json 1 --output result.json
```

## 如何为耗时工具设置超时

实时采集类工具可能耗时较长，用 `--timeout` 调整（支持毫秒 / `s` / `m`）：

```bash
# 3 分钟超时
dataify google_search --q "pizza" --json 1 --timeout 3m

# 等价的毫秒写法
dataify google_search --q "pizza" --json 1 --timeout 180000

# 30 秒
dataify google_search --q "pizza" --json 1 --timeout 30s
```

| 写法 | 含义 |
| --- | --- |
| `120000` | 120000 毫秒（120 秒，默认） |
| `30s` | 30 秒 |
| `2m` | 2 分钟（120 秒） |

也可通过环境变量 `DATAIFY_MCP_TIMEOUT` 统一设置，优先级低于命令行 `--timeout`。

## 如何调试一次失败调用

加 `--debug` 把请求 URL 与 JSON-RPC 请求体打印到 stderr，不影响实际请求参数与结果：

```bash
dataify google_search --q "pizza" --json 1 --debug
```

如果工具返回错误（`isError` 或业务错误），CLI 会以退出码 `2` 结束并把错误信息打印到 stderr。

> **说明**：`--debug` 打印的请求 URL 里 Token 已脱敏（只保留首尾各 4 位，形如 `abcd****7890`），不会输出完整 Token。

## 如何安装 MCP 配置

`dataify mcp` 把 Dataify MCP 服务写入 Agent 工具：

```bash
dataify mcp
```

交互式终端下会让你多选要写入的 Agent（Claude Code / Cursor / Codex / VS Code）与要启用的工具类别，然后逐个写入配置。写入后重启对应 Agent 生效。

## 如何安装 Skill

`dataify skill` 从 `dataify-server/skills` 下载并安装 Skills：

```bash
# 交互式选择
dataify skill

# 非交互：安装到多个 Agent
dataify skill --agent universal,codex --skill serp-google-search

# 安装仓库里的全部 Skill 到全部 Agent
dataify skill --agent all --all
```

## 如何切换界面语言

```bash
# 一次性：本次命令使用中文
dataify google_search --q "pizza" --language zh

# 持久化：写入配置
dataify language zh
dataify language en
```

## 管道与自动化

CLI 的设计便于管道串联。当标准输出不是 TTY 时，结果以纯文本/JSON 输出，方便下游处理。

### 用 jq 提取字段

> 需要本机安装 [jq](https://jqlang.github.io/jq/)，Windows 上可用 `choco install jq` 或直接使用 PowerShell 解析。

```bash
# 假设 google_search 返回 JSON，提取某个字段
dataify google_search --q "pizza" --json 1 --raw | jq '.structuredContent'

# 先落盘（加 --raw 以保留 content/structuredContent 完整结构）再处理
dataify google_search --q "pizza" --json 1 --raw --output out.json && jq '.content' out.json
```

### 在脚本 / CI 中使用

```bash
# 用环境变量注入 Token（无需本地配置文件）
export DATAIFY_API_TOKEN="YOUR_TOKEN"

# 调用并把结果落盘，供后续步骤使用
dataify google_search --q "pizza" --json 1 --output search.json

# 超时统一用环境变量控制
export DATAIFY_MCP_TIMEOUT=180000
dataify call web_unlock_task --arg-json status=-1 --arg-json page=1 --arg-json pageSize=10 --output status.json
```

### 交互模式批量调试

```bash
dataify
# 进入后连续操作，/retry 重跑上一条：
dataify> /tools
dataify> /schema google_search
dataify> google_search --q "pizza" --json 1
dataify> /retry
dataify> /exit
```

## 支持的环境变量

可用环境变量覆盖本地配置：

| 变量 | 用途 |
| --- | --- |
| `DATAIFY_API_TOKEN` | API Token。 |
| `DATAIFY_MCP_TIMEOUT` | 请求超时（毫秒数字，或带 `s` / `m` 后缀，例如 `180000`、`30s`、`2m`）。 |
| `DATAIFY_LANGUAGE` | 界面语言（`zh` / `en`）。 |
| `GITHUB_TOKEN` / `GH_TOKEN` | `dataify skill` 访问 GitHub 的备用令牌。 |
| `DATAIFY_WIDTH` | 强制终端列宽。 |
| `DATAIFY_TUI=0` | 关闭全屏列表，改用普通编号列表。 |

```bash
# CI 中无需登录，直接注入 Token 运行
DATAIFY_API_TOKEN=your_key dataify tools

# 用环境变量覆盖超时（适合大任务）
DATAIFY_MCP_TIMEOUT=180000 dataify call web_unlock_task --arg-json status=-1 --arg-json page=1 --arg-json pageSize=10
```

## 资源

| 资源 | 说明 | 链接 |
| :--- | :--- | :--- |
| 📘 **GitHub 仓库** | 查看源码、示例并做出贡献 | [GitHub](https://github.com/dataify-server/cli) |
| 📦 **CLI 模块** | 包说明、版本与发布信息 | [dataify-mcp-cli](https://www.npmjs.com/package/dataify-mcp-cli) |