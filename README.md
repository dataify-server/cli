# Dataify MCP CLI

Cross-platform npm CLI for calling the tools exposed by the `dataify_mcp_api` MCP HTTP service.

中文用户使用文档请查看 [NPM_USAGE.md](NPM_USAGE.md)。

The MCP endpoint is fixed to:

```text
https://mcp.dataify.com/mcp?token=<your_api_token>&tools=user_info,web_unlocker,google_serp,yandex_serp,duckduckgo_serp,bing_serp,amazon,youtube,facebook,instagram,reddit,walmart,google,booking,indeed,airbnb,google_play_store,github,tiktok,linkedin,glassdoor,twitter,crunchbase,zillow,ebay
```

Only `<your_api_token>` is configurable.

## Install

From this package directory:

```bash
npm install -g .
```

Or run without global install:

```bash
npx . tools --token YOUR_TOKEN
```

## Configure

```bash
dataify config set --token YOUR_TOKEN
```

Environment variables also work and override the saved config:

PowerShell:

```powershell
$env:DATAIFY_API_TOKEN="YOUR_TOKEN"
```

cmd.exe:

```bat
set DATAIFY_API_TOKEN=YOUR_TOKEN
```

macOS/Linux shells:

```bash
export DATAIFY_API_TOKEN=YOUR_TOKEN
```

## Commands

Start interactive mode:

```bash
dataify
```

Or explicitly:

```bash
dataify chat
```

List tools visible to the current token:

```bash
dataify tools
```

Show a tool's parameter names and descriptions:

```bash
dataify schema google_search
```

Call a tool:

```bash
dataify google_search --q "pizza" --json 1
```

Equivalent generic form:

```bash
dataify call google_search --q "pizza" --json 1
```

Call the web unlocker:

```bash
dataify request_web_unlocker --url https://example.com --type html
```

## Arguments

Unknown `--name value` flags are sent as MCP tool arguments. Dashes are converted to underscores, so `--no-cache true` becomes `no_cache`.

More explicit forms are available:

```bash
dataify call google_search --arg q=pizza --arg json=1
dataify call google_search --args-json '{"q":"pizza","json":"1"}'
dataify call google_search --args-file params.json
```

Use `--raw` to print the full MCP tool result instead of just `structuredContent` or text content.

## Notes

- The token is passed as the `token` query parameter.
- The MCP URL and `tools` query parameter are fixed in the CLI; only the token changes.
- This CLI requires Node.js 18.17 or newer.
