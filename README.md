# Dataify MCP CLI

`dataify-mcp-cli` is a cross-platform command-line tool for calling tools exposed by the Dataify MCP HTTP service. After installation, use the `dataify` command on Windows, macOS, or Linux.

中文用户使用文档请查看 [NPM_USAGE.md](NPM_USAGE.md)。

## Requirements

- Node.js `>= 18.17`
- npm
- A valid Dataify API token

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

## Configure API Token

Set your Dataify API token before calling tools:

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
dataify init --github-token YOUR_GITHUB_TOKEN
```

The wizard uses an existing token when available; in an interactive terminal it can prompt for a token, save it, then install MCP configs and Dataify skills.

## Quick Start

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
/tools
/balance
/serp
/scraper
/webunlock
/schema google_search
/call google_search --q "pizza" --arg-json json=1
/mcp
/skill
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

Set the token again if needed:

```bash
dataify config set --token YOUR_TOKEN
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
