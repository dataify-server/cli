# Dataify MCP CLI

`dataify-mcp-cli` is a cross-platform command-line tool for calling tools exposed by the Dataify MCP HTTP service. After installation, use the `dataify` command on Windows, macOS, or Linux.

中文用户使用文档请查看 [NPM_USAGE.md](NPM_USAGE.md)。

## Requirements

- Node.js `>= 18.17`
- npm
- A Dataify account (run `dataify login`), or an existing Dataify API token

Check your local versions:

```bash
node -v
npm -v
```

## Install

Install the public npm package globally:

```bash
npm install -g dataify-mcp-cli
```

After installation, the command is:

```bash
dataify
```

Verify the installation:

```bash
dataify --version
dataify --help
```

## Sign In

The fastest way to get a token is a browser login:

```bash
dataify login
```

`dataify login` opens your default browser on the Dataify login page. After you sign in and approve the request, the CLI receives a one-time authorization code on a local loopback address, exchanges it for a new API Key, and saves that key to your config file. Every other command (`tools`, `balance`, `mcp`, tool calls) works immediately afterwards.

On the browser authorization page you choose how long the key stays valid: 30 days (default), 90 days, or never expires.

If the browser cannot be launched — for example on a headless machine or over SSH — print the URL only and open it yourself:

```bash
dataify login --no-browser
```

Repeated logins are a no-op while the saved key still works, because each successful login creates a **new** API Key on your account. Force a fresh one with:

```bash
dataify login --force
```

Show the signed-in account:

```bash
dataify whoami
dataify whoami --json
```

Sign out. This deletes the CLI API Key on the server and removes the saved token locally; your other API Keys are untouched:

```bash
dataify logout
```

Every login is visible on the API Key page of the Dataify console and can be deleted there at any time.

## Configure API Token

`dataify login` is the recommended path. If you already have an API token, save it directly:

```bash
dataify config set --token <your_api_token>
```

Example:

```bash
dataify config set --token YOUR_TOKEN
```

View the current config:

```bash
dataify config get
```

Show the config file path:

```bash
dataify config path
```

The config file is stored under your user home directory:

```text
~/.dataify-mcp-cli/config.json
```

On macOS and Linux the file is written with `0600` permissions and its directory with `0700`, so only your user account can read the saved token. After `dataify login` the file also holds a small `auth` block with the account name and key expiry — never the token in any other field.

Token priority is:

```text
--token -> DATAIFY_API_TOKEN -> saved config
```

## Init

Run the setup wizard:

```bash
dataify init
```

Non-interactive examples:

```bash
dataify init --token YOUR_TOKEN --yes
dataify init --token YOUR_TOKEN --skip-mcp --skip-skill
dataify init --skip-login
dataify init --github-token YOUR_GITHUB_TOKEN
```

The wizard uses an existing token when available. Otherwise, in an interactive terminal, it offers a browser login first and falls back to pasting a token manually. Pass `--skip-login` to never start a browser login. It then installs MCP configs and Dataify skills.

## Quick Start

Sign in and confirm who you are:

```bash
dataify login
dataify whoami
```

List the tools available to your token:

```bash
dataify tools
```

Show your account balance:

```bash
dataify balance
```

Show a tool's parameter names and descriptions:

```bash
dataify schema google_search
```

Choose a SERP, scraper, or web unlocker tool interactively:

```bash
dataify serp
dataify scraper
dataify webunlock
```

Install MCP configs for agent tools:

```bash
dataify mcp
```

Install Dataify skills:

```bash
dataify skill
```

Call a tool directly:

```bash
dataify google_search --q "pizza" --json 1
```

Or use the generic `call` form:

```bash
dataify call google_search --q "pizza" --json 1
```

Call the web unlocker:

```bash
dataify request_web_unlocker --url https://example.com --type html
```

## Interactive Mode

Start interactive mode:

```bash
dataify
```

Or explicitly:

```bash
dataify chat
dataify repl
```

Interactive mode is a lightweight CLI loop. It does not connect to an AI assistant or interpret natural language; it lets you run Dataify MCP tool commands repeatedly.

Interactive commands can use a leading slash:

```text
/help
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
/clear
/exit
```

The slash is optional:

```text
tools
balance
schema google_search
google_search --q "pizza" --arg-json json=1
```

## Run With npx

You can run the CLI without a global install:

```bash
npx dataify-mcp-cli --help
```

Call a tool with `npx`:

```bash
npx dataify-mcp-cli google_search --q "pizza" --json 1 --token YOUR_TOKEN
```

If you use `npx` often, configure the token globally with `dataify config set --token YOUR_TOKEN`, or use the `DATAIFY_API_TOKEN` environment variable.

## Category Wizards

The `serp`, `scraper`, and `webunlock` commands first list the tools in that category, then print the selected tool schema, then open one editable command line with defaults filled in.

Each tool takes exactly one line, and tool names share one aligned column so every `-` lines up:

```text
> amazon_product         - 当用户需要 Amazon 产品详情、商品详情、商品信息…
  amazon_global_product  - 当用户需要 Amazon 全球产品详情、Amazon 全球商品…
```

Descriptions are clipped to the terminal width, so they never wrap into a wall of text. To read one in full, press `?` while it is highlighted (press `?` again to hide it) — the full description is shown in a box below the list. The name column is as wide as the longest tool name in that list; it is only narrowed (clipping the longest names) when the terminal is too narrow to leave room for descriptions.

Windows 10 and later use the same full-screen list in PowerShell and cmd, so the `?` panel works there too. If a terminal cannot handle full-screen redraws (or you just prefer plain output), set `DATAIFY_TUI=0` and the wizard falls back to a numbered list instead: there, type `?N` to read item N in full, or `?` on its own to expand every item; both return to the same prompt afterwards.

Example:

```bash
dataify serp google_search --q "pizza" --json 1
dataify scraper amazon_product --url "https://www.amazon.com/dp/example"
dataify webunlock request_web_unlocker --url https://example.com --type html
```

## Environment Variables

Environment variables override the saved config file.

Windows PowerShell:

```powershell
$env:DATAIFY_API_TOKEN="YOUR_TOKEN"
```

Windows cmd.exe:

```bat
set DATAIFY_API_TOKEN=YOUR_TOKEN
```

macOS/Linux shells:

```bash
export DATAIFY_API_TOKEN="YOUR_TOKEN"
```

Terminal size overrides (the wizard leaves one column of slack so long lines never wrap):

```powershell
$env:DATAIFY_WIDTH="100"
$env:DATAIFY_TUI="0"
```

```bash
export DATAIFY_WIDTH="100"
export DATAIFY_TUI="0"
```

`DATAIFY_WIDTH` forces the column count, and `DATAIFY_TUI=0` forces the plain numbered list instead of the full-screen one.

Optional request timeout:

Windows PowerShell:

```powershell
$env:DATAIFY_MCP_TIMEOUT="3m"
```

Windows cmd.exe:

```bat
set DATAIFY_MCP_TIMEOUT=3m
```

macOS/Linux shells:

```bash
export DATAIFY_MCP_TIMEOUT="3m"
```

Optional GitHub token for `dataify skill`:

```powershell
$env:GITHUB_TOKEN="YOUR_GITHUB_TOKEN"
```

```bat
set GITHUB_TOKEN=YOUR_GITHUB_TOKEN
```

```bash
export GITHUB_TOKEN="YOUR_GITHUB_TOKEN"
```

## Display Language

The CLI interface can be shown in English (default) or Chinese:

```bash
dataify language zh
dataify language en
```

Inside interactive mode:

```text
/language zh
/language en
/language
```

In interactive mode, `/language` without an argument opens a picker with `English` and `中文`, with
the current language preselected; pick one and the CLI switches immediately. The one-shot command
`dataify language` without an argument keeps printing the current language and usage instead, so
scripts never block on a prompt.

The choice is saved to the config file, and the `DATAIFY_LANGUAGE` environment variable overrides
it. `--language zh` changes the language for a single command.

The language switch covers the CLI's own text: help output, table headers, wizard prompts, and
status messages. Tool and parameter descriptions come from the MCP server and are shown as
returned by the server.

## List Tools

View tools available to the current token:

```bash
dataify tools
```

Print the raw MCP response:

```bash
dataify tools --raw
```

## Show Tool Schema

View the parameters for a tool:

```bash
dataify schema <tool_name>
```

Example:

```bash
dataify schema google_search
```

The output includes parameter names, required flags, types, and descriptions.

## Call Tools

The basic form is:

```bash
dataify <tool_name> --param value
```

Example:

```bash
dataify google_search --q "pizza" --json 1
```

The generic form is equivalent:

```bash
dataify call google_search --q "pizza" --json 1
```

Unknown `--name value` flags are sent as MCP tool arguments. Dashes are converted to underscores, so `--no-cache true` becomes `no_cache`.

## Argument Forms

Plain arguments are passed as strings:

```bash
dataify google_search --q "pizza" --json 1
```

This sends:

```json
{
  "q": "pizza",
  "json": "1"
}
```

Use `--arg-json` for numbers, booleans, objects, arrays, or other JSON values:

```bash
dataify google_search --q "pizza" --arg-json json=1
dataify example_tool --arg-json enabled=true
```

Use a full JSON object in PowerShell, macOS, or Linux shells:

```bash
dataify google_search --args-json '{"q":"pizza","json":1}'
```

For cmd.exe, prefer `--args-file` to avoid JSON quote escaping issues.

Use a JSON file:

```json
{
  "q": "pizza",
  "json": 1
}
```

```bash
dataify google_search --args-file params.json
```

## Common Examples

Google Search:

```bash
dataify google_search --q "pizza" --arg-json json=1
```

Web Unlocker:

```bash
dataify request_web_unlocker --url https://example.com --type html
```

## Output Options

Print the full MCP tool result:

```bash
dataify google_search --q "pizza" --json 1 --raw
```

Write output to a file:

```bash
dataify google_search --q "pizza" --arg-json json=1 --output result.json
```

## Timeout

Some real-time collection tools can take longer to finish. Set a timeout with `--timeout`:

```bash
dataify google_search --q "pizza" --arg-json json=1 --timeout 3m
```

Supported timeout formats:

```text
120000
30s
2m
```

## Debug

Use `--debug` to print the request URL and JSON-RPC request body to stderr:

```bash
dataify google_search --q "pizza" --arg-json json=1 --debug
```

Debug output can include your token in the request URL. Do not share debug logs publicly.

## Update

Update to the latest version:

```bash
npm install -g dataify-mcp-cli@latest
```

Check the installed version:

```bash
dataify --version
```

## Uninstall

```bash
npm uninstall -g dataify-mcp-cli
```

## Fixed MCP Endpoint

The CLI uses a fixed MCP endpoint:

```text
https://mcp.dataify.com/mcp?token=<your_api_token>&tools=user_info,web_unlocker,google_serp,yandex_serp,duckduckgo_serp,bing_serp,amazon,youtube,facebook,instagram,reddit,walmart,google,booking,indeed,airbnb,google_play_store,github,tiktok,linkedin,glassdoor,twitter,crunchbase,zillow,ebay
```

Only `<your_api_token>` is configurable. The MCP server URL and `tools` query parameter are fixed in the CLI.

## Local Development

Use these commands only when working from this repository checkout:

```bash
git clone https://github.com/dataify-server/cli.git
cd cli
npm install
npm install -g .
```

Run the local checkout without global installation:

```bash
npx . tools --token YOUR_TOKEN
```

Validate JavaScript syntax:

```bash
npm run check
```

## Troubleshooting

### dataify command not found

Close and reopen your terminal, then try:

```bash
dataify --help
```

If the command is still missing, check whether your npm global install directory is in `PATH`:

```bash
npm config get prefix
```

### tools returns no tools

Check whether the token is configured correctly:

```bash
dataify config get
```

Confirm the token is still accepted by the server:

```bash
dataify whoami
```

Set the token again if needed:

```bash
dataify config set --token YOUR_TOKEN
```

### login does not open a browser

Print the URL and open it manually:

```bash
dataify login --no-browser
```

The URL is always printed, even when a browser was launched, so you can copy it to another machine. The login page must be able to reach the printed `redirect_uri` on `127.0.0.1`, so open it on the same machine that is running the CLI.

### login says you are already logged in

That is expected while the saved key still works, because each login creates a new API Key. Sign in again with:

```bash
dataify login --force
```

### login times out

The CLI waits five minutes for the browser callback, then stops listening. Run `dataify login` again. If the callback never arrives, check that a local firewall is not blocking loopback connections and that no proxy is rewriting `127.0.0.1` traffic.

### whoami says the token is no longer valid

The key expired or was deleted from the API Key page of the console. The CLI removes the stale token from your config automatically; sign in again:

```bash
dataify login
```

### schema cannot find a tool

List the tools available to the current token:

```bash
dataify tools
```

If the tool is not listed, the current token or MCP service did not return that tool.

### google_search returns Collection failed

`google_search` is a real-time collection tool. Target-site behavior, proxy/network conditions, or collection queues can affect a request.

Try a longer timeout:

```bash
dataify google_search --q "pizza" --arg-json json=1 --timeout 3m
```

Use debug output to inspect the request:

```bash
dataify google_search --q "pizza" --arg-json json=1 --debug
```

### Token safety

Your token is stored in your local user config file and is sent to the Dataify MCP service as the `token` query parameter. Do not commit tokens to GitHub or share logs that contain tokens.

The login flow itself never puts a token in a URL. The authorization code travels in the loopback callback query string and is single-use; the token is only ever returned in a POST response body and written to the config file. `dataify login` and `dataify whoami` never print the token, and `dataify config get` redacts it.
