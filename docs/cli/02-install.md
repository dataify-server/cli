# 安装

> 通过 npm 全局安装或 `npx` 直接运行 Dataify MCP CLI，完成登录或 Token 配置，并了解配置文件位置与优先级。

## 环境要求

- **Node.js**：`>= 18.17`（建议使用 LTS 版本）。
- **npm**：随 Node.js 一起安装。
- **操作系统**：Windows、macOS、Linux 均可。

查看本地版本：

```bash
node -v
npm -v
```

## 安装 CLI

最快的方式是用 `npx` 直接运行，无需全局安装即可体验最新版：

```bash
npx dataify-mcp-cli --help
```

文档里任何命令都可以用 `npx dataify-mcp-cli` 前缀来运行，例如：

```bash
npx dataify-mcp-cli tools --token YOUR_TOKEN
```

如果你希望有一个常驻的 `dataify` 命令、启动更快，则选择全局安装（推荐）：

```bash
# npm（推荐）
npm install -g dataify-mcp-cli

# 或者从该包源码目录安装
npm install -g .
```

验证全局安装是否成功：

```bash
dataify --version
# 输出：0.3.9
```

> **说明**：全局安装后命令就是 `dataify`。

## 更新 CLI

用安装时相同的包管理器升级到最新版本：

```bash
npm install -g dataify-mcp-cli@latest
```

查看你安装的版本与 npm 上最新版本：

```bash
dataify --version                  # 你本地安装的版本
npm view dataify-mcp-cli version   # npm 上的最新版本
```

## 卸载 CLI

```bash
npm uninstall -g dataify-mcp-cli
```

## 登录（推荐）

`dataify login` 会打开默认浏览器跳转到 Dataify 登录页。登录并确认后，CLI 通过本机回环地址收到一次性授权码（PKCE），换取一个新的 API Key 并写入本地配置文件。之后 `tools`、`balance`、`mcp`、工具调用等所有命令都立即可用。

```bash
dataify login
```

在浏览器的授权页面上，你可以选择这把 Key 的有效期：**30 天（默认）**、90 天，或永不过期。每次登录都会在你的账号下**新建一把 API Key**，可在 Dataify 控制台的 API Key 页面查看或随时删除。

如果浏览器无法启动（例如无界面的服务器或 SSH 环境），只打印 URL 让你自己打开：

```bash
dataify login --no-browser
```

只要已保存的 Key 仍然有效，重复执行 `dataify login` 不会新建 Key（会提示你已登录）；需要强制换一把新 Key 时：

```bash
dataify login --force
```

查看当前登录的账号：

```bash
dataify whoami
dataify whoami --json
```

退出登录（尽力删除服务端的 CLI API Key，并移除本地保存的 Token；不影响你的其他 API Key）：

```bash
dataify logout
```

## 配置 Token

`dataify login` 是推荐方式。如果你已经有 API Token，也可以直接保存。Token 通过 URL 的 `token` 查询参数发送，有三种等价方式（按优先级覆盖）。

### 方式一：本地配置文件（推荐，最省事）

把 Token 保存到本机用户目录下的配置文件，之后所有命令自动读取：

```bash
dataify config set --token YOUR_TOKEN
# 输出：Saved <用户目录>/.dataify-mcp-cli/config.json
```

查看已保存的配置（Token 会被打码显示）：

```bash
dataify config get
```

只查看配置文件路径：

```bash
dataify config path
```

### 方式二：单条命令内联 Token

只在某一次调用时传入 Token，不影响本地配置：

```bash
dataify tools --token YOUR_TOKEN
dataify google_search --token YOUR_TOKEN --q "pizza" --json 1
```

### 方式三：环境变量（适合 CI / 容器 / 临时使用）

使用环境变量注入 Token，优先级高于本地配置文件。支持的环境变量为 `DATAIFY_API_TOKEN`：

Windows PowerShell：

```powershell
$env:DATAIFY_API_TOKEN="YOUR_TOKEN"
```

Windows cmd：

```bat
set DATAIFY_API_TOKEN=YOUR_TOKEN
```

macOS / Linux：

```bash
export DATAIFY_API_TOKEN="YOUR_TOKEN"
```

在 CI 中直接前缀使用：

```bash
DATAIFY_API_TOKEN=YOUR_TOKEN dataify tools
```

> **安全提示**：Token 会保存在本机配置文件中，也会作为请求 URL 的 `token` 参数发往 Dataify MCP 服务。请勿把 Token 提交到 Git 仓库，也不要在公开日志中暴露。

## 一键初始化向导

`dataify init` 会依次完成：解析/保存 Token（已有则直接复用，否则优先浏览器登录，可回退到手动粘贴）→ 安装 MCP 配置 → 安装 Dataify Skill。

```bash
dataify init
```

非交互 / 跳过步骤：

```bash
dataify init --token YOUR_TOKEN --yes
dataify init --token YOUR_TOKEN --skip-mcp --skip-skill
dataify init --skip-login
dataify init --github-token YOUR_GITHUB_TOKEN
```

| 选项 | 说明 |
| --- | --- |
| `--token TOKEN` | 先保存 Token 再执行后续步骤。 |
| `--yes`, `-y` | 所有步骤都不再询问（MCP / Skill 均按"全部"安装）。 |
| `--skip-login` | 绝不启动浏览器登录，改为手动粘贴 Token。 |
| `--skip-mcp` | 跳过 MCP 配置安装。 |
| `--skip-skill` | 跳过 Skill 安装。 |
| `--github-token TOKEN` | 传给 `dataify skill`，用于缓解 GitHub 未认证限流。 |

## 验证你的环境

配置 Token 或登录后，确认一切正常：

```bash
# 查看当前账号（验证 Token 是否有效）
dataify whoami

# 列出当前 Token 可用的工具（验证连通性与权限）
dataify tools

# 查看账户余额
dataify balance

# 试调一个工具
dataify google_search --q "pizza" --json 1
```

如果 `dataify tools` 没有任何工具返回，通常是 Token 不正确或该 Token 没有对应工具的权限。可以重新 `dataify config set --token ...`，或用 `dataify login` 重新登录。

## 配置文件保存在哪里

CLI 把配置保存在用户主目录下：

| 项目 | 值 |
| --- | --- |
| 配置文件路径 | `~/.dataify-mcp-cli/config.json` |
| 可通过 `config set` 写入的字段 | `token`、`timeout`、`language` |
| `login` 追加的字段 | `auth`（账号名、Key 过期时间等元信息；不包含 Token 副本） |
| `timeout` 默认值 | `120000`（毫秒，即 120 秒） |
| `server` / `tools` | 固定的，不写入配置文件，每次运行都使用内置默认值 |

配置文件内容示例：

```json
{
  "token": "YOUR_TOKEN",
  "timeout": 120000,
  "language": "zh",
  "auth": {
    "source": "cli-login",
    "name": "your-account",
    "expires_at": 1767225600,
    "updated_at": 1735689600
  }
}
```

在 macOS 和 Linux 上，配置文件以 `0600` 权限写入，目录以 `0700` 写入，只有当前用户可读。`dataify config get` 只输出**这个文件的内容**（Token 已打码），不会附加 `server` / `tools`。

### 配置优先级（从高到低）

1. **命令行选项**：`--token`、`--timeout`、`--language` 等
2. **环境变量**：`DATAIFY_API_TOKEN` / `DATAIFY_MCP_TIMEOUT` / `DATAIFY_LANGUAGE`
3. **本地配置文件**：`~/.dataify-mcp-cli/config.json`
4. **内置默认值**：`server` 固定为 `https://mcp.dataify.com/mcp`，`timeout` 默认 `120000` 毫秒，语言默认 `en`

> 任何一层都可以按命令粒度覆盖上一层。注意：`server`（MCP 地址）和 `tools`（工具列表）始终固定，`--server` / `--endpoint` / `--tools` 这些选项**已不再支持**，传入会报"Unsupported option"。

## 支持的环境变量

| 变量 | 用途 |
| --- | --- |
| `DATAIFY_API_TOKEN` | API Token（优先级高于配置文件）。 |
| `DATAIFY_MCP_TIMEOUT` | 请求超时（毫秒数字，或带 `s` / `m` 后缀，例如 `180000`、`30s`、`2m`）。 |
| `DATAIFY_LANGUAGE` | 界面语言（`zh` / `en`）。 |
| `GITHUB_TOKEN` / `GH_TOKEN` | `dataify skill` 访问 GitHub 时的备用令牌。 |
| `DATAIFY_WIDTH` | 强制终端列宽（向导用它计算排版）。 |
| `DATAIFY_TUI=0` | 关闭全屏列表，向导退化为普通编号列表。 |