import readline from "node:readline";
import { stdin, stdout } from "node:process";
import { parseKnownOptions, parseToolArgs } from "./args.js";
import { formatToolResult, printToolSchema, writeOutput } from "./output.js";
import { tokenizeCommandLine } from "./repl.js";
import { createSelector } from "./select.js";
import { withSpinner } from "./spinner.js";

const CATEGORY_TOOLS = {
  serp: [
    "google_search",
    "google_ai_mode",
    "google_news",
    "google_images",
    "google_maps",
    "google_flights",
    "google_jobs",
    "google_local",
    "google_videos",
    "google_shopping",
    "google_trends",
    "google_play",
    "google_scholar",
    "google_finance",
    "google_hotels",
    "google_patents",
    "google_lens",
    "yandex_search",
    "duckduckgo_search",
    "bing_search",
    "bing_images",
    "bing_maps",
    "bing_news",
    "bing_shopping",
    "bing_videos"
  ],
  scraper: [
    "airbnb_product",
    "amazon_product",
    "amazon_global_product",
    "amazon_comment",
    "amazon_seller",
    "amazon_product_list",
    "booking_hotellist",
    "youtube_video_post",
    "youtube_profiles",
    "youtube_comment",
    "youtube_transcript",
    "youtube_product",
    "youtube_video",
    "youtube_audio",
    "crunchbase_company",
    "facebook_event",
    "facebook_profile",
    "facebook_comment",
    "facebook_post",
    "instagram_profiles",
    "instagram_comment",
    "instagram_reel",
    "reddit_posts",
    "reddit_comment",
    "walmart_product",
    "zillow_product",
    "ebay_info",
    "google_map_details",
    "google_map_comment",
    "google_shopping_info",
    "google_play_store_reviews",
    "google_play_store_information",
    "github_repository",
    "glassdoor_company",
    "glassdoor_joblistings",
    "linkedin_company_information",
    "linkedin_job_listings_information",
    "tiktok_comment",
    "tiktok_posts",
    "tiktok_profiles",
    "tiktok_shop",
    "twitter_post",
    "twitter_profile",
    "indeed_companies_info",
    "indeed_job_listings"
  ],
  webunlock: [
    "request_web_unlocker"
  ]
};

const OPTION_NAMES = new Set(["tool", "raw", "pretty", "output", "help"]);

export async function runCategoryWizard(category, client, tokens, globalOptions = {}) {
  const { options, rest } = parseKnownOptions(tokens, OPTION_NAMES);
  if (optionEnabled(options.help)) {
    process.stdout.write(categoryHelpText(category));
    return;
  }

  const allTools = await withSpinner(`Loading ${category} tools...`, () => client.listTools(), spinnerOptions(globalOptions));
  const tools = categoryTools(category, allTools);
  if (tools.length === 0) {
    throw new Error(`No ${category} tools were returned by the server. Check token/tools permissions.`);
  }

  const selectedTool = await resolveTool(category, tools, options.tool, rest);
  if (!selectedTool) {
    return;
  }

  process.stdout.write(`\nSelected tool: ${selectedTool.name}\n\n`);
  process.stdout.write(printToolSchema(selectedTool));

  const args = await resolveToolArguments(category, selectedTool, rest);
  const result = await withSpinner(`Calling ${selectedTool.name}...`, () => client.callTool(selectedTool.name, args), spinnerOptions(globalOptions));
  if (result?.isError) {
    const text = formatToolResult(result, { raw: optionEnabled(globalOptions.raw) || optionEnabled(options.raw) });
    const error = new Error(text.trim() || `Tool "${selectedTool.name}" returned an error`);
    error.exitCode = 2;
    throw error;
  }

  writeOutput(formatToolResult(result, {
    raw: optionEnabled(globalOptions.raw) || optionEnabled(options.raw),
    pretty: globalOptions.pretty !== "false" && options.pretty !== "false"
  }), globalOptions.output || options.output);
}

function categoryTools(category, allTools) {
  const allowed = new Set(CATEGORY_TOOLS[category] || []);
  return allTools
    .filter((tool) => allowed.has(tool.name))
    .sort((left, right) => left.name.localeCompare(right.name));
}

async function resolveTool(category, tools, explicitTool, rest) {
  const name = lastOption(explicitTool);
  if (name) {
    return findTool(tools, name);
  }

  if (rest[0] && !rest[0].startsWith("-")) {
    return findTool(tools, rest[0]);
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(`Select a tool with dataify ${category} --tool TOOL_NAME in non-interactive mode.`);
  }

  const selector = createSelector();
  try {
    return await selector.selectOne({
      title: `Select a ${category} tool`,
      items: tools.map((tool) => ({
        id: tool.name,
        name: tool.name,
        description: singleLine(tool.description || "")
      })),
      defaultSelected: tools[0]?.name
    }).then((item) => tools.find((tool) => tool.name === item.id));
  } finally {
    selector.close();
  }
}

function findTool(tools, name) {
  const normalized = String(name).toLowerCase().replace(/-/g, "_");
  const tool = tools.find((item) => item.name.toLowerCase() === normalized);
  if (!tool) {
    throw new Error(`Tool "${name}" is not available in this category.`);
  }
  return tool;
}

async function resolveToolArguments(category, tool, rest) {
  const tokens = dropLeadingToolName(tool.name, rest);
  if (tokens.length > 0) {
    return parseToolArgs(tokens).args;
  }
  if (!stdin.isTTY || !stdout.isTTY) {
    return {};
  }
  return promptForCommandLine(category, tool);
}

function dropLeadingToolName(toolName, tokens) {
  if (tokens[0] && !tokens[0].startsWith("-") && tokens[0].toLowerCase().replace(/-/g, "_") === toolName.toLowerCase()) {
    return tokens.slice(1);
  }
  return tokens;
}

async function promptForCommandLine(category, tool) {
  const schema = tool?.inputSchema || tool?.input_schema || {};
  const properties = schema.properties || {};
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  const defaultCommand = buildDefaultCommand(category, tool.name, properties, required);

  try {
    process.stdout.write("\nEdit the command below, then press Enter to run it.\n");
    const answer = await promptEditableLine("> ", defaultCommand);
    const commandLine = answer.trim() || defaultCommand;
    const tokens = tokenizeCommandLine(commandLine);
    const normalized = tokens[0] === "dataify" ? tokens.slice(1) : tokens;
    const argTokens = dropCategoryAndTool(category, tool.name, normalized);
    const args = parseToolArgs(argTokens).args;
    assertNoPlaceholders(args);
    return args;
  } catch (error) {
    if (error?.code === "ERR_USE_AFTER_CLOSE") {
      return {};
    }
    throw error;
  }
}

function promptEditableLine(prompt, defaultValue) {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({
      input: stdin,
      output: stdout
    });

    rl.on("SIGINT", () => {
      rl.close();
      reject(new Error("Cancelled."));
    });

    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
    rl.write(defaultValue);
  });
}

function buildDefaultCommand(category, toolName, properties, required) {
  const tokens = ["dataify", category, toolName];
  for (const [name, property] of Object.entries(properties)) {
    const defaultValue = defaultParameterValue(name, property, required.has(name));
    if (defaultValue === "") {
      continue;
    }
    tokens.push(`--${name.replace(/_/g, "-")}`, quoteCommandValue(defaultValue));
  }
  return tokens.join(" ");
}

function defaultParameterValue(name, property, required) {
  if (property && Object.prototype.hasOwnProperty.call(property, "default")) {
    return String(property.default);
  }
  const fallback = fallbackDefaultValue(name, property);
  if (fallback !== undefined && fallback !== null && fallback !== "") {
    return String(fallback);
  }
  return required ? `<required:${name}>` : "";
}

function fallbackDefaultValue(name, property) {
  if (name === "json") {
    return "1";
  }
  if (name === "country" || name === "gl" || name === "cc") {
    return "us";
  }
  if (name === "hl") {
    return "en";
  }
  if (name === "device") {
    return "desktop";
  }
  if (name === "js_render" || name === "follow_redirect") {
    return "True";
  }
  if (Array.isArray(property?.enum) && property.enum.length > 0) {
    return property.enum[0];
  }
  return "";
}

function quoteCommandValue(value) {
  const text = String(value);
  if (!text || /[\s"'{}[\],]/.test(text)) {
    return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return text;
}

function dropCategoryAndTool(category, toolName, tokens) {
  const result = [...tokens];
  if (result[0] === category) {
    result.shift();
  }
  if (result[0] && result[0].toLowerCase().replace(/-/g, "_") === toolName.toLowerCase()) {
    result.shift();
  }
  return result;
}

function assertNoPlaceholders(args) {
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === "string" && /^<required:[^>]+>$/.test(value.trim())) {
      throw new Error(`Please replace required parameter "${key}" before running the command.`);
    }
  }
}

function categoryHelpText(category) {
  return `Dataify ${category} wizard

Usage:
  dataify ${category}
  dataify ${category} --tool TOOL_NAME
  dataify ${category} TOOL_NAME --param value

Examples:
  dataify ${category}
  dataify ${category} --tool ${exampleTool(category)}
`;
}

function exampleTool(category) {
  if (category === "serp") {
    return "google_search";
  }
  if (category === "scraper") {
    return "amazon_product";
  }
  return "request_web_unlocker";
}

function optionEnabled(value) {
  if (value === undefined) {
    return false;
  }
  if (Array.isArray(value)) {
    return optionEnabled(value.at(-1));
  }
  if (typeof value === "boolean") {
    return value;
  }
  const text = String(value).toLowerCase();
  return !["false", "0", "no", "off"].includes(text);
}

function lastOption(value) {
  if (Array.isArray(value)) {
    return value.at(-1);
  }
  return value;
}

function singleLine(text) {
  return String(text).replace(/\s+/g, " ").trim();
}

function spinnerOptions(globalOptions) {
  return {
    enabled: !globalOptions.output && !optionEnabled(globalOptions.debug)
  };
}
