import { readConfig } from "./config.js";

export const DEFAULT_LANGUAGE = "en";
export const LANGUAGES = ["en", "zh"];

const LANGUAGE_ALIASES = {
  en: ["en", "eng", "en-us", "en_us", "english", "英文", "英语"],
  zh: ["zh", "cn", "zh-cn", "zh_cn", "zh-hans", "zh-hant", "chinese", "中文", "简体", "简体中文", "汉语"]
};

const LANGUAGE_NAMES = {
  en: "English",
  zh: "中文"
};

// 中英切换只覆盖 CLI 自己的文案；工具/参数的 description 由 MCP 服务端返回，
// 不在本模块的范围内（服务端目前只有中文）。
const MESSAGES = {};
MESSAGES.en = {
  "common.yes": "yes",
  "common.no": "no",
  "common.none": "none",
  "common.cancelled": "Cancelled.",
  "common.cancelled": "Cancelled.",
  "common.unknownItem": "Unknown {label}: {items}",
  "common.selectAtLeastOne": "Select at least one {label}.",

  "cli.help": `Dataify MCP CLI {version}

Usage:
  dataify
  dataify chat
  dataify init
  dataify login [--force] [--no-browser]
  dataify logout
  dataify whoami [--json]
  dataify tools [--token TOKEN]
  dataify balance [--token TOKEN]
  dataify serp
  dataify scraper
  dataify webunlock
  dataify mcp [--token TOKEN]
  dataify skill
  dataify language [zh|en]
  dataify schema <tool>
  dataify call <tool> [--param value]
  dataify <tool> [--param value]
  dataify config set --token TOKEN

Common options:
  --token TOKEN      Dataify API token, appended as ?token=...
  --timeout VALUE    Request timeout, e.g. 120000, 30s, 2m
  --language VALUE   Display language, zh or en
  --raw              Print the raw MCP tool result
  --output FILE      Write command output to a file
  --header K=V       Add an HTTP header

Interactive commands:
  /help              Show interactive help
  /init              Run the setup wizard
  /login             Sign in with your browser
  /logout            Sign out and delete the CLI API key
  /whoami            Show the signed-in account
  /tools             List available tools
  /balance           Show account balance
  /serp              Choose and call a SERP tool
  /scraper           Choose and call a scraper tool
  /webunlock         Choose and call a Web Unlocker tool
  /schema <tool>     Show tool parameters
  /call <tool> ...   Call a tool
  /mcp               Install MCP configs for agents
  /skill             Install Dataify skills
  /language [zh|en]  Switch display language
  /retry             Run the previous command again
  /exit              Quit interactive mode

Argument forms:
  --q pizza
  --arg q=pizza
  --arg-json page=1
  --args-json '{"q":"pizza","json":"1"}'
  --args-file params.json
  --stdin            Read a JSON object from stdin and merge it into arguments

Environment:
  DATAIFY_API_TOKEN, DATAIFY_MCP_TIMEOUT, DATAIFY_LANGUAGE

Fixed MCP URL:
  {server}?token=<your_api_token>&tools={tools}

Examples:
  dataify
  dataify init
  dataify login
  dataify whoami
  dataify balance
  dataify serp
  dataify scraper
  dataify webunlock
  dataify mcp
  dataify skill
  dataify language zh
  dataify google_search --q "pizza" --json 1
  dataify request_web_unlocker --url https://example.com --type html
  dataify call query_common_collection_api_task_status --status -1 --page 1 --pageSize 10
`,
  "cli.error.noToken": "No Dataify token found. Run dataify login, or pass --token TOKEN.",
  "cli.error.unknownCommand": `Unknown command "{command}"`,
  "cli.error.unknownConfigCommand": `Unknown config command "{subcommand}"`,
  "cli.error.balanceFailed": "Balance query returned an error",
  "cli.error.toolFailed": `Tool "{tool}" returned an error`,
  "cli.error.schemaUsage": "Usage: dataify schema <tool>",
  "cli.error.toolNotReturned": `Tool "{tool}" was not returned by the server`,
  "cli.error.callUsage": "Usage: dataify call <tool> [--param value]",
  "cli.loading.tools": "Loading tools...",
  "cli.loading.balance": "Loading balance...",
  "cli.loading.schema": "Loading schema for {tool}...",
  "cli.calling": "Calling {tool}...",
  "cli.config.saved": "Saved {file}",

  "language.usage": "Usage: language [zh|en]",
  "language.current": "Current language: {language}",
  "language.changed": "Language switched to {language}.",
  "language.invalid": `Unsupported language "{value}". Use zh or en.`,
  "language.saved": "Saved to {file}",
  "language.select": "Select display language",
  "language.saveFailed": "Language switched for this session, but saving to {file} failed: {message}",

  "repl.subtitle": "Dataify MCP CLI{version} interactive mode",
  "repl.noPrevious": "No previous command to retry.",
  "repl.quickStart": `Common commands:
  /init                              Run the setup wizard
  /login                             Sign in with your browser
  /logout                            Sign out and delete the CLI API key
  /whoami                            Show the signed-in account
  /tools                             List available tools
  /balance                           Show account balance
  /serp                              Choose and call a SERP tool
  /scraper                           Choose and call a scraper tool
  /webunlock                         Choose and call a Web Unlocker tool
  /schema <tool>                     Show tool parameters
  /call <tool> --param value         Call a tool
  /mcp                               Install MCP configs for agents
  /skill                             Install Dataify skills
  /language [zh|en]                  Switch display language
  google_search --q "pizza"          Call a tool directly
  /retry                             Run the previous command again
  /clear                             Clear the screen
  /exit                              Quit interactive mode

Tips:
  Commands also work without "/", for example: tools
  Type /help to show this guide again.`,

  "output.noTools": "No tools returned. Check token/tools permissions.",
  "output.col.tool": "Tool",
  "output.col.description": "Description",
  "output.col.parameter": "Parameter",
  "output.col.required": "Required",
  "output.col.type": "Type",
  "output.col.item": "Item",
  "output.col.value": "Value",
  "output.noParameters": "No parameters found for {tool}.",
  "output.balance.item": "Balance",
  "output.balance.itemDescription": "Remaining Dataify credits or balance",
  "output.balance.totalRecharge": "Total Recharge",
  "output.balance.totalRechargeDescription": "Total recharged credits",
  "output.balance.totalUsed": "Total Used",
  "output.balance.totalUsedDescription": "Total consumed credits",
  "output.balance.status": "Status",

  "category.loading": "Loading {category} tools...",
  "category.noTools": "No {category} tools were returned by the server. Check token/tools permissions.",
  "category.selectTool": "Select a {category} tool",
  "category.nonInteractive": "Select a tool with dataify {category} --tool TOOL_NAME in non-interactive mode.",
  "category.selected": "Selected tool: {tool}",
  "category.editCommand": "Edit the command below, then press Enter to run it.",
  "category.replaceRequired": `Please replace required parameter "{name}" before running the command.`,
  "category.help": `Dataify {category} wizard

Usage:
  dataify {category}
  dataify {category} --tool TOOL_NAME
  dataify {category} TOOL_NAME --param value

Examples:
  dataify {category}
  dataify {category} --tool {example}
`,

  "select.enterNumber": "Enter a number, or press Enter for default: ",
  "select.enterNumbers": "Enter numbers separated by comma, or press Enter for defaults: ",
  "select.invalid": "Invalid selection. Try again.",
  "select.selectOne": "Select one item.",
  "select.selectAtLeastOne": "Select at least one item.",
  "select.checkboxHelp": "Use Up/Down, Space to toggle, A all, N none, Enter confirm.",
  "select.listHelp": "Use Up/Down, Enter confirm.",
  "select.detailsToggle": "Press ? to show/hide details.",
  "select.detailsUsage": "Type ?N to read item N in full, or ? alone to expand everything.",

  "prompt.enterYesNo": "Please enter y or n.",
  "prompt.ttyRequired": "Interactive token input requires a TTY. Pass --token TOKEN instead.",

  "init.title": "Dataify init",
  "init.help": `Dataify init wizard

Usage:
  dataify init
  dataify init --token TOKEN
  dataify init --yes
  dataify init --skip-login
  dataify init --skip-mcp
  dataify init --skip-skill

Options:
  --token TOKEN      Save a Dataify token before running setup.
  --yes, -y          Run setup steps without confirmation prompts.
  --skip-login       Never start a browser login; paste a token manually.
  --skip-mcp         Skip installing MCP into agent tools.
  --skip-skill       Skip installing Dataify skills.
  --github-token TOK GitHub token passed to dataify skill.

Next commands:
  dataify login      Sign in with your browser at any time.
  dataify whoami     Show the signed-in account.

Fixed MCP URL:
  {server}?token=<your_api_token>&tools={tools}
`,
  "init.finished": "Dataify init finished.",
  "init.nextCommands": "Next commands:",
  "init.savedToken": "Saved token to {file}",
  "init.usingToken": "Using existing Dataify token from {source}.",
  "init.source.config": "config",
  "init.source.environment": "environment",
  "init.browserFallback": "Browser login did not produce a token; falling back to manual entry.",
  "init.confirmLogin": "Sign in to Dataify with your browser now",
  "init.step.mcp": "Install Dataify MCP into agent tools",
  "init.step.skill": "Install Dataify skills from GitHub",

  "mcp.selectAgents": "Select agent tools to install Dataify MCP",
  "mcp.selectToolClasses": "Select Dataify tool classes to enable",
  "mcp.installing": "Installing selected MCP configurations...",
  "mcp.finished": "Dataify MCP installation finished.",
  "mcp.enabledClasses": "Enabled tool classes: {classes}",
  "mcp.someFailed": "Some agent tools were not configured. Fix the failed item and run dataify mcp again.",
  "mcp.agent.claude-code": "Install with claude mcp add, user scope.",
  "mcp.agent.cursor": "Write global ~/.cursor/mcp.json.",
  "mcp.agent.codex": "Write global ~/.codex/config.toml.",
  "mcp.agent.vscode": "Write project .vscode/mcp.json for Copilot Agent mode.",
  "mcp.class.user_info": "Account, balance, API key, usage statistics, and task status queries.",
  "mcp.class.web_unlocker": "Fetch protected or JavaScript-rendered web pages as HTML or PNG.",
  "mcp.class.google_serp": "Google Search, Images, News, Shopping, Maps, Trends, Scholar, Patents, and related SERP data.",
  "mcp.class.yandex_serp": "Yandex public web search results.",
  "mcp.class.duckduckgo_serp": "DuckDuckGo public web search results.",
  "mcp.class.bing_serp": "Bing Search, Images, News, Videos, Maps, and Shopping results.",
  "mcp.class.amazon": "Amazon product, list, review, and seller data collection.",
  "mcp.class.youtube": "YouTube video, channel, comment, transcript, audio, and video download tools.",
  "mcp.class.facebook": "Facebook post, comment, profile, and event data collection.",
  "mcp.class.instagram": "Instagram profile, reel, and comment data collection.",
  "mcp.class.reddit": "Reddit post and comment data collection.",
  "mcp.class.walmart": "Walmart product, SKU, category, and keyword product data.",
  "mcp.class.google": "Google Maps details/reviews, Google Play, Google Shopping, and Google local data tools.",
  "mcp.class.booking": "Booking hotel listing and hotel detail data.",
  "mcp.class.indeed": "Indeed company and job listing data.",
  "mcp.class.airbnb": "Airbnb home and property search data.",
  "mcp.class.google_play_store": "Google Play store app information and reviews.",
  "mcp.class.github": "GitHub repository, search, and code URL data.",
  "mcp.class.tiktok": "TikTok profile, post, comment, and shop data.",
  "mcp.class.linkedin": "LinkedIn company and job listing data.",
  "mcp.class.glassdoor": "Glassdoor company overview and job listing data.",
  "mcp.class.twitter": "Twitter/X profile and post data.",
  "mcp.class.crunchbase": "Crunchbase company URL and keyword search data.",
  "mcp.class.zillow": "Zillow property search and listing data.",
  "mcp.class.ebay": "eBay product, category, seller, and listing data.",
  "mcp.class.ebay": "eBay product, category, seller, and listing data.",
  "mcp.restartHint": "Restart selected agent tools if they are already running.",
  "mcp.label.agent": "agent",
  "mcp.label.toolClass": "tool class",
  "mcp.status.ok": "OK",
  "mcp.status.failed": "FAILED",
  "mcp.install.claude": "Installing Claude Code MCP...",
  "mcp.install.cursor": "Updating Cursor MCP config...",
  "mcp.install.codex": "Updating Codex MCP config...",
  "mcp.install.vscode": "Updating VS Code MCP config...",
  "mcp.install.generic": "Installing {name} MCP...",
  "mcp.status.claudeNotFound": "claude command was not found from Node.js. Check that Claude Code is installed and available in PATH.",
  "mcp.status.claudeFailed": "claude mcp add failed.",
  "mcp.status.claudeInstalled": "Installed with claude mcp add --scope user.",
  "mcp.status.updated": "Updated {file}",
  "mcp.status.unknownAgent": "Unknown agent.",
  "mcp.noTokenFound": "No Dataify token found.",
  "mcp.tokenHint": "Run dataify login to sign in with your browser, or paste an API token below.",
  "mcp.tokenSaveHint": "The token will be saved for future dataify commands.",
  "mcp.tokenPrompt": "Dataify API token: ",
  "mcp.noTokenEntered": "No token entered. Run dataify login, or pass --token TOKEN.",

  "skill.loading": "Loading Dataify skills...",
  "skill.installing": "Installing selected skills...",
  "skill.finished": "Dataify skill installation finished.",
  "skill.source": "Source: {source}",
  "skill.installedSkills": "Installed skills: {skills}",
  "skill.targetDirectories": "Target directories:",
  "skill.failedSkills": "Failed skills:",
  "skill.someFailed": "Some skills were not installed. Fix the failed item and run dataify skill again.",
  "skill.noSkills": "No skills found in {repo}/{path} at {ref}.",
  "skill.selectAgents": "Select agent tools to install Dataify skills",
  "skill.selectSkills": "Select Dataify skills to download",
  "skill.agent.universal": "Install once into {dir}.",
  "skill.agent.claude-code": "Link from .agents/skills into ~/.claude/skills.",
  "skill.agent.codex": "Uses the universal .agents/skills directory.",
  "skill.agent.cursor": "Uses the universal .agents/skills directory.",
  "skill.gitCloneFallback": "Trying git clone fallback...",
  "skill.gitCloneFallback": "Trying git clone fallback...",
  "skill.label.agent": "agent",
  "skill.label.skill": "skill",
  "skill.status.ok": "OK",
  "skill.status.failed": "FAILED",
  "skill.none": "none",
  "skill.copyFallback": ", {count} copy fallback(s)",
  "skill.result.ok": "{fileCount} files -> {targetCount} target(s){fallback}",
  "skill.help": `Dataify skill installer

Usage:
  dataify skill
  dataify skill --agent universal,codex --skill serp-google-search
  dataify skill --agent all --all

Options:
  --agent, --agents  Target agents: universal, claude-code, codex, cursor, all
  --skill, --skills  Skill names, separated by comma. Use --all for every skill.
  --all              Download every skill from the GitHub repository.
  --dir DIR          Canonical skills directory. Default: ./.agents/skills
  --repo OWNER/REPO  GitHub repository. Default: {repo}
  --ref REF          Git ref. Default: {ref}
  --github-token TOK GitHub token when unauthenticated API is rate limited. Falls back to git clone if API fails.

Source:
  https://github.com/{repo}/tree/{ref}/{path}
`
};

MESSAGES.zh = {
  "common.yes": "是",
  "common.no": "否",
  "common.none": "无",
  "common.cancelled": "已取消。",
  "common.cancelled": "已取消。",
  "common.unknownItem": "未知的{label}: {items}",
  "common.selectAtLeastOne": "请至少选择一个{label}。",

  "cli.help": `Dataify MCP CLI {version}

用法:
  dataify
  dataify chat
  dataify init
  dataify login [--force] [--no-browser]
  dataify logout
  dataify whoami [--json]
  dataify tools [--token TOKEN]
  dataify balance [--token TOKEN]
  dataify serp
  dataify scraper
  dataify webunlock
  dataify mcp [--token TOKEN]
  dataify skill
  dataify language [zh|en]
  dataify schema <tool>
  dataify call <tool> [--param value]
  dataify <tool> [--param value]
  dataify config set --token TOKEN

通用参数:
  --token TOKEN      Dataify API Token，会拼接到 ?token=...
  --timeout VALUE    请求超时，例如 120000、30s、2m
  --language VALUE   界面语言，可选 zh 或 en
  --raw              输出 MCP 工具的原始结果
  --output FILE      将命令输出写入文件
  --header K=V       追加一个 HTTP 请求头

交互模式命令:
  /help              查看交互模式帮助
  /init              运行初始化向导
  /login             使用浏览器登录
  /logout            退出登录并删除 CLI API Key
  /whoami            查看当前登录账号
  /tools             列出可用工具
  /balance           查看账户余额
  /serp              选择并调用 SERP 工具
  /scraper           选择并调用采集工具
  /webunlock         选择并调用网页解锁工具
  /schema <tool>     查看工具参数
  /call <tool> ...   调用工具
  /mcp               为 AI 客户端安装 MCP 配置
  /skill             安装 Dataify 技能
  /language [zh|en]  切换界面语言
  /retry             重试上一条命令
  /exit              退出交互模式

参数写法:
  --q pizza
  --arg q=pizza
  --arg-json page=1
  --args-json '{"q":"pizza","json":"1"}'
  --args-file params.json
  --stdin            从标准输入读取 JSON 对象并合并到参数中

环境变量:
  DATAIFY_API_TOKEN, DATAIFY_MCP_TIMEOUT, DATAIFY_LANGUAGE

固定 MCP 地址:
  {server}?token=<your_api_token>&tools={tools}

示例:
  dataify
  dataify init
  dataify login
  dataify whoami
  dataify balance
  dataify serp
  dataify scraper
  dataify webunlock
  dataify mcp
  dataify skill
  dataify language zh
  dataify google_search --q "pizza" --json 1
  dataify request_web_unlocker --url https://example.com --type html
  dataify call query_common_collection_api_task_status --status -1 --page 1 --pageSize 10
`,
  "cli.error.noToken": "未找到 Dataify Token。请运行 dataify login，或通过 --token TOKEN 传入。",
  "cli.error.unknownCommand": `未知命令 "{command}"`,
  "cli.error.unknownConfigCommand": `未知的 config 子命令 "{subcommand}"`,
  "cli.error.balanceFailed": "余额查询返回错误",
  "cli.error.toolFailed": `工具 "{tool}" 返回错误`,
  "cli.error.schemaUsage": "用法: dataify schema <tool>",
  "cli.error.toolNotReturned": `服务端未返回工具 "{tool}"`,
  "cli.error.callUsage": "用法: dataify call <tool> [--param value]",
  "cli.loading.tools": "正在加载工具...",
  "cli.loading.balance": "正在加载余额...",
  "cli.loading.schema": "正在加载 {tool} 的参数...",
  "cli.calling": "正在调用 {tool}...",
  "cli.config.saved": "已保存 {file}",

  "language.usage": "用法: language [zh|en]",
  "language.current": "当前语言: {language}",
  "language.changed": "已切换语言为 {language}。",
  "language.invalid": `不支持的语言 "{value}"，请使用 zh 或 en。`,
  "language.saved": "已保存到 {file}",
  "language.select": "选择界面语言",
  "language.saveFailed": "本次会话已切换语言，但写入 {file} 失败: {message}",

  "repl.subtitle": "Dataify MCP CLI{version} 交互模式",
  "repl.noPrevious": "没有可重试的上一条命令。",
  "repl.quickStart": `常用命令:
  /init                              运行初始化向导
  /login                             使用浏览器登录
  /logout                            退出登录并删除 CLI API Key
  /whoami                            查看当前登录账号
  /tools                             列出可用工具
  /balance                           查看账户余额
  /serp                              选择并调用 SERP 工具
  /scraper                           选择并调用采集工具
  /webunlock                         选择并调用网页解锁工具
  /schema <tool>                     查看工具参数
  /call <tool> --param value         调用工具
  /mcp                               为 AI 客户端安装 MCP 配置
  /skill                             安装 Dataify 技能
  /language [zh|en]                  切换界面语言
  google_search --q "pizza"          直接调用工具
  /retry                             重试上一条命令
  /clear                             清屏
  /exit                              退出交互模式

提示:
  命令也可以不带 "/"，例如: tools
  输入 /help 可再次查看本说明。`,

  "output.noTools": "未返回任何工具，请检查 token/tools 权限。",
  "output.col.tool": "工具",
  "output.col.description": "描述",
  "output.col.parameter": "参数",
  "output.col.required": "必填",
  "output.col.type": "类型",
  "output.col.item": "项目",
  "output.col.value": "数值",
  "output.noParameters": "未找到 {tool} 的参数。",
  "output.balance.item": "余额",
  "output.balance.itemDescription": "Dataify 剩余积分或余额",
  "output.balance.totalRecharge": "累计充值",
  "output.balance.totalRechargeDescription": "累计充值的积分",
  "output.balance.totalUsed": "累计使用",
  "output.balance.totalUsedDescription": "累计消耗的积分",
  "output.balance.status": "状态",

  "category.loading": "正在加载 {category} 工具...",
  "category.noTools": "服务端未返回 {category} 工具，请检查 token/tools 权限。",
  "category.selectTool": "选择 {category} 工具",
  "category.nonInteractive": "非交互模式下请使用 dataify {category} --tool TOOL_NAME 指定工具。",
  "category.selected": "已选择工具: {tool}",
  "category.editCommand": "编辑下面的命令，按回车执行。",
  "category.replaceRequired": `请在执行前替换必填参数 "{name}"。`,
  "category.help": `Dataify {category} 向导

用法:
  dataify {category}
  dataify {category} --tool TOOL_NAME
  dataify {category} TOOL_NAME --param value

示例:
  dataify {category}
  dataify {category} --tool {example}
`,

  "select.enterNumber": "输入序号，直接回车使用默认值: ",
  "select.enterNumbers": "输入序号（逗号分隔），直接回车使用默认值: ",
  "select.invalid": "选择无效，请重试。",
  "select.selectOne": "请选择一项。",
  "select.selectAtLeastOne": "请至少选择一项。",
  "select.checkboxHelp": "上下键移动，空格切换，A 全选，N 全不选，回车确认。",
  "select.listHelp": "上下键移动，回车确认。",
  "select.detailsToggle": "按 ? 开启/关闭完整描述",
  "select.detailsUsage": "输入 ?N 查看第 N 项完整描述，输入 ? 展开全部。",

  "prompt.enterYesNo": "请输入 y 或 n。",
  "prompt.ttyRequired": "交互式输入 Token 需要 TTY，请改用 --token TOKEN。",

  "init.title": "Dataify init",
  "init.help": `Dataify init 向导

用法:
  dataify init
  dataify init --token TOKEN
  dataify init --yes
  dataify init --skip-login
  dataify init --skip-mcp
  dataify init --skip-skill

参数:
  --token TOKEN      在初始化前保存 Dataify Token。
  --yes, -y          跳过确认提示，直接执行各步骤。
  --skip-login       不启动浏览器登录，改为手动输入 Token。
  --skip-mcp         跳过为 AI 客户端安装 MCP。
  --skip-skill       跳过安装 Dataify 技能。
  --github-token TOK 传给 dataify skill 的 GitHub Token。

后续命令:
  dataify login      随时使用浏览器登录。
  dataify whoami     查看当前登录账号。

固定 MCP 地址:
  {server}?token=<your_api_token>&tools={tools}
`,
  "init.finished": "Dataify init 已完成。",
  "init.nextCommands": "后续命令:",
  "init.savedToken": "已保存 Token 到 {file}",
  "init.usingToken": "使用已有的 Dataify Token（来源: {source}）。",
  "init.source.config": "配置文件",
  "init.source.environment": "环境变量",
  "init.browserFallback": "浏览器登录未获取到 Token，改为手动输入。",
  "init.confirmLogin": "现在使用浏览器登录 Dataify",
  "init.step.mcp": "将 Dataify MCP 安装到 AI 客户端",
  "init.step.skill": "从 GitHub 安装 Dataify 技能",

  "mcp.selectAgents": "选择要安装 Dataify MCP 的 AI 客户端",
  "mcp.selectToolClasses": "选择要启用的 Dataify 工具类别",
  "mcp.installing": "正在安装选中的 MCP 配置...",
  "mcp.finished": "Dataify MCP 安装完成。",
  "mcp.enabledClasses": "已启用的工具类别: {classes}",
  "mcp.someFailed": "部分 AI 客户端未配置成功，请修复失败项后重新运行 dataify mcp。",
  "mcp.agent.claude-code": "通过 claude mcp add 安装到 user 作用域。",
  "mcp.agent.cursor": "写入全局 ~/.cursor/mcp.json。",
  "mcp.agent.codex": "写入全局 ~/.codex/config.toml。",
  "mcp.agent.vscode": "写入项目内 .vscode/mcp.json，供 Copilot Agent 模式使用。",
  "mcp.class.user_info": "账号、余额、API Key、用量统计与任务状态查询。",
  "mcp.class.web_unlocker": "抓取受保护或需要 JavaScript 渲染的网页，返回 HTML 或 PNG。",
  "mcp.class.google_serp": "Google 搜索、图片、新闻、购物、地图、趋势、学术、专利等 SERP 数据。",
  "mcp.class.yandex_serp": "Yandex 公开网页搜索结果。",
  "mcp.class.duckduckgo_serp": "DuckDuckGo 公开网页搜索结果。",
  "mcp.class.bing_serp": "Bing 搜索、图片、新闻、视频、地图与购物结果。",
  "mcp.class.amazon": "Amazon 商品、列表、评论与卖家数据采集。",
  "mcp.class.youtube": "YouTube 视频、频道、评论、字幕、音频与视频下载工具。",
  "mcp.class.facebook": "Facebook 帖子、评论、主页与活动数据采集。",
  "mcp.class.instagram": "Instagram 主页、Reels 与评论数据采集。",
  "mcp.class.reddit": "Reddit 帖子与评论数据采集。",
  "mcp.class.walmart": "Walmart 商品、SKU、类别与关键词商品数据。",
  "mcp.class.google": "Google 地图详情/评论、Google Play、Google 购物与 Google 本地数据工具。",
  "mcp.class.booking": "Booking 酒店列表与酒店详情数据。",
  "mcp.class.indeed": "Indeed 公司与职位列表数据。",
  "mcp.class.airbnb": "Airbnb 房源与房产搜索数据。",
  "mcp.class.google_play_store": "Google Play 应用信息与评论。",
  "mcp.class.github": "GitHub 仓库、搜索与代码 URL 数据。",
  "mcp.class.tiktok": "TikTok 主页、帖子、评论与店铺数据。",
  "mcp.class.linkedin": "LinkedIn 公司与职位列表数据。",
  "mcp.class.glassdoor": "Glassdoor 公司概况与职位列表数据。",
  "mcp.class.twitter": "Twitter/X 主页与帖子数据。",
  "mcp.class.crunchbase": "Crunchbase 公司 URL 与关键词搜索数据。",
  "mcp.class.zillow": "Zillow 房源搜索与列表数据。",
  "mcp.class.ebay": "eBay 商品、类别、卖家与列表数据。",
  "mcp.class.ebay": "eBay 商品、类别、卖家与列表数据。",
  "mcp.restartHint": "如果对应的 AI 客户端已在运行，请重启后再使用。",
  "mcp.label.agent": "客户端",
  "mcp.label.toolClass": "工具类别",
  "mcp.status.ok": "成功",
  "mcp.status.failed": "失败",
  "mcp.install.claude": "正在安装 Claude Code MCP...",
  "mcp.install.cursor": "正在更新 Cursor MCP 配置...",
  "mcp.install.codex": "正在更新 Codex MCP 配置...",
  "mcp.install.vscode": "正在更新 VS Code MCP 配置...",
  "mcp.install.generic": "正在安装 {name} MCP...",
  "mcp.status.claudeNotFound": "从 Node.js 中未找到 claude 命令，请确认 Claude Code 已安装且位于 PATH 中。",
  "mcp.status.claudeFailed": "claude mcp add 执行失败。",
  "mcp.status.claudeInstalled": "已通过 claude mcp add --scope user 安装。",
  "mcp.status.updated": "已更新 {file}",
  "mcp.status.unknownAgent": "未知的客户端。",
  "mcp.noTokenFound": "未找到 Dataify Token。",
  "mcp.tokenHint": "运行 dataify login 使用浏览器登录，或在下方粘贴 API Token。",
  "mcp.tokenSaveHint": "该 Token 会保存下来，供后续 dataify 命令使用。",
  "mcp.tokenPrompt": "Dataify API Token: ",
  "mcp.noTokenEntered": "未输入 Token。请运行 dataify login，或通过 --token TOKEN 传入。",

  "skill.loading": "正在加载 Dataify 技能...",
  "skill.installing": "正在安装选中的技能...",
  "skill.finished": "Dataify 技能安装完成。",
  "skill.source": "来源: {source}",
  "skill.installedSkills": "已安装技能: {skills}",
  "skill.targetDirectories": "目标目录:",
  "skill.failedSkills": "安装失败的技能:",
  "skill.someFailed": "部分技能未安装成功，请修复失败项后重新运行 dataify skill。",
  "skill.noSkills": "在 {repo}/{path} 的 {ref} 分支下没有找到任何技能。",
  "skill.selectAgents": "选择要安装 Dataify 技能的 AI 客户端",
  "skill.selectSkills": "选择要下载的 Dataify 技能",
  "skill.agent.universal": "安装一次到 {dir}。",
  "skill.agent.claude-code": "从 .agents/skills 链接到 ~/.claude/skills。",
  "skill.agent.codex": "复用通用的 .agents/skills 目录。",
  "skill.agent.cursor": "复用通用的 .agents/skills 目录。",
  "skill.gitCloneFallback": "正在尝试改用 git clone...",
  "skill.gitCloneFallback": "正在尝试改用 git clone...",
  "skill.label.agent": "客户端",
  "skill.label.skill": "技能",
  "skill.status.ok": "成功",
  "skill.status.failed": "失败",
  "skill.none": "无",
  "skill.copyFallback": "，{count} 个复制回退",
  "skill.result.ok": "{fileCount} 个文件 -> {targetCount} 个目标{fallback}",
  "skill.help": `Dataify 技能安装器

用法:
  dataify skill
  dataify skill --agent universal,codex --skill serp-google-search
  dataify skill --agent all --all

参数:
  --agent, --agents  目标客户端: universal、claude-code、codex、cursor、all
  --skill, --skills  技能名称，多个用英文逗号分隔；用 --all 表示全部。
  --all              下载 GitHub 仓库中的全部技能。
  --dir DIR          通用技能目录，默认: ./.agents/skills
  --repo OWNER/REPO  GitHub 仓库，默认: {repo}
  --ref REF          Git 分支/标签，默认: {ref}
  --github-token TOK 未登录 API 触发限流时使用的 GitHub Token；API 失败时会回退到 git clone。

来源:
  https://github.com/{repo}/tree/{ref}/{path}
`
};

let activeLanguage = DEFAULT_LANGUAGE;

export function normalizeLanguage(value) {
  if (value === undefined || value === null) {
    return null;
  }
  if (Array.isArray(value)) {
    return normalizeLanguage(value.at(-1));
  }
  const text = String(value).trim().toLowerCase();
  if (!text) {
    return null;
  }
  for (const language of LANGUAGES) {
    if (LANGUAGE_ALIASES[language].includes(text)) {
      return language;
    }
  }
  return null;
}

export function languageName(value) {
  return LANGUAGE_NAMES[normalizeLanguage(value) || DEFAULT_LANGUAGE];
}

export function getLanguage() {
  return activeLanguage;
}

export function setLanguage(value) {
  const normalized = normalizeLanguage(value);
  if (normalized) {
    activeLanguage = normalized;
  }
  return activeLanguage;
}

export function resolveLanguage(cliOptions = {}) {
  const explicit =
    normalizeLanguage(cliOptions.language) ||
    normalizeLanguage(cliOptions.lang) ||
    normalizeLanguage(process.env.DATAIFY_LANGUAGE) ||
    normalizeLanguage(process.env.DATAIFY_LANG);
  if (explicit) {
    return explicit;
  }
  let stored = null;
  try {
    stored = normalizeLanguage(readConfig().language);
  } catch {
    // 配置文件不可读时不影响启动，退回默认语言。
    stored = null;
  }
  return stored || DEFAULT_LANGUAGE;
}

export function t(key, params = {}) {
  const table = MESSAGES[activeLanguage] || MESSAGES[DEFAULT_LANGUAGE];
  const fallback = MESSAGES[DEFAULT_LANGUAGE] || {};
  const text = table[key] ?? fallback[key];
  if (text === undefined) {
    return key;
  }
  return String(text).replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
  );
}
