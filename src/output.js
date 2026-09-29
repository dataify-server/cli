import fs from "node:fs";
import path from "node:path";
import { displayWidth, truncateToWidth, wrapToWidth } from "./display-width.js";
import { t } from "./i18n.js";

const DEFAULT_TABLE_WIDTH = 100;
const MIN_DESCRIPTION_WIDTH = 24;

export function formatToolResult(result, options = {}) {
  if (options.raw) {
    return `${JSON.stringify(result, null, options.pretty === false ? 0 : 2)}\n`;
  }

  if (result && Object.prototype.hasOwnProperty.call(result, "structuredContent")) {
    return `${JSON.stringify(result.structuredContent, null, 2)}\n`;
  }

  const text = toolTextContent(result);
  if (text !== null) {
    const parsed = tryParseJson(text);
    if (parsed !== undefined) {
      return `${JSON.stringify(parsed, null, 2)}\n`;
    }
    return text.endsWith("\n") ? text : `${text}\n`;
  }

  return `${JSON.stringify(result, null, 2)}\n`;
}

// content 里所有 text 片段拼起来；没有 text 片段时返回 null（区分「空文本」和「没有文本」）。
function toolTextContent(result) {
  const content = Array.isArray(result?.content) ? result.content : [];
  const parts = content
    .filter((item) => item && item.type === "text" && typeof item.text === "string")
    .map((item) => item.text);
  return parts.length > 0 ? parts.join("\n") : null;
}

/**
 * 取工具返回里的「业务载荷」：优先 structuredContent，其次把 text 当 JSON 解析。
 * 返回 undefined 表示这些文本不是 JSON。
 */
export function toolResponseJson(result) {
  if (result && Object.prototype.hasOwnProperty.call(result, "structuredContent")) {
    return result.structuredContent;
  }
  const text = toolTextContent(result);
  if (text === null) {
    return undefined;
  }
  return tryParseJson(text);
}

// 服务端有时把业务失败包在「正常返回」里（例如无效 Token → {"code":400,"data":"验证失败"}），
// 这种既不触发 JSON-RPC error、也不带 isError，CLI 会以退出码 0 结束，脚本会把失败当成功。
// 只认顶层数字型 code（>=400 视为失败），避免误伤工具数据里正常的业务字段。
const BUSINESS_ERROR_CODE_MIN = 400;

export function detectToolBusinessError(result) {
  const payload = toolResponseJson(result);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const code = payload.code;
  const numeric =
    typeof code === "number"
      ? code
      : typeof code === "string" && /^\d+$/.test(code.trim())
        ? Number(code)
        : NaN;
  if (!Number.isFinite(numeric) || numeric < BUSINESS_ERROR_CODE_MIN) {
    return null;
  }
  const detail = singleLine(String(payload.data ?? payload.message ?? ""));
  return { code: numeric, message: detail.slice(0, 200) };
}

export function writeOutput(text, outputFile) {
  if (outputFile) {
    fs.mkdirSync(path.dirname(outputFile), { recursive: true });
    fs.writeFileSync(outputFile, text, "utf8");
    return;
  }
  process.stdout.write(text);
}

export function printTools(tools, options = {}) {
  if (options.raw) {
    return `${JSON.stringify({ tools }, null, 2)}\n`;
  }

  if (!tools.length) {
    return `${t("output.noTools")}\n`;
  }

  const rows = tools.map((tool, index) => ({
    "#": String(index + 1),
    Tool: tool.name || "",
    Description: singleLine(tool.description || "")
  }));

  return renderTable(rows, [
    { key: "#", title: "#", align: "right" },
    // 82 个工具名里最长的是 linkedin_job_listings_information（33 字符），
    // 列宽上限 36 保证它不会被折成两行（用户照表格复制工具名时才不会出错）。
    { key: "Tool", title: t("output.col.tool"), maxWidth: 36 },
    { key: "Description", title: t("output.col.description"), flex: true, minWidth: 24 }
  ]);
}

export function printToolSchema(tool) {
  const schema = tool?.inputSchema || tool?.input_schema || {};
  const properties = schema.properties || {};
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  const names = Object.keys(properties);

  if (names.length === 0) {
    return `${t("output.noParameters", { tool: tool?.name || "this tool" })}\n`;
  }

  const rows = names.map((name) => {
    const property = properties[name] || {};
    return {
      Parameter: name,
      Required: required.has(name) ? t("common.yes") : t("common.no"),
      Type: schemaType(property),
      Description: singleLine(property.description || "")
    };
  });

  return renderTable(rows, [
    { key: "Parameter", title: t("output.col.parameter"), maxWidth: 28 },
    { key: "Required", title: t("output.col.required") },
    { key: "Type", title: t("output.col.type"), maxWidth: 18 },
    { key: "Description", title: t("output.col.description"), flex: true, minWidth: 24 }
  ]);
}

export function printBalance(result, options = {}) {
  if (options.raw) {
    return formatToolResult(result, options);
  }

  const payload = extractResultPayload(result);
  const data = payload?.data && typeof payload.data === "object" ? payload.data : payload;
  if (!data || typeof data !== "object") {
    return formatToolResult(result, options);
  }

  const rows = [
    {
      Item: t("output.balance.item"),
      Value: formatAmount(data.balance),
      Description: t("output.balance.itemDescription")
    },
    {
      Item: t("output.balance.totalRecharge"),
      Value: formatAmount(data.totalRecharge ?? data.total_recharge),
      Description: t("output.balance.totalRechargeDescription")
    },
    {
      Item: t("output.balance.totalUsed"),
      Value: formatAmount(data.totalUse ?? data.total_use),
      Description: t("output.balance.totalUsedDescription")
    }
  ].filter((row) => row.Value !== "");

  if (!rows.length) {
    return formatToolResult(result, options);
  }

  const message = payload?.message ? `${t("output.balance.status")}: ${payload.message}\n\n` : "";
  return `${message}${renderTable(rows, [
    { key: "Item", title: t("output.col.item"), maxWidth: 20 },
    { key: "Value", title: t("output.col.value"), maxWidth: 24, align: "right" },
    { key: "Description", title: t("output.col.description"), flex: true, minWidth: 24 }
  ])}`;
}

function singleLine(text) {
  return String(text).replace(/\s+/g, " ").trim();
}

function extractResultPayload(result) {
  if (result && Object.prototype.hasOwnProperty.call(result, "structuredContent")) {
    return result.structuredContent;
  }

  const content = Array.isArray(result?.content) ? result.content : [];
  const text = content
    .filter((item) => item && item.type === "text" && typeof item.text === "string")
    .map((item) => item.text)
    .join("\n");
  if (text) {
    const parsed = tryParseJson(text);
    if (parsed !== undefined) {
      return parsed;
    }
  }

  return result;
}

function formatAmount(value) {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "object" && value !== null) {
    if (typeof value.String === "string") {
      return value.String;
    }
    if (typeof value.value === "string" || typeof value.value === "number") {
      return String(value.value);
    }
    if (typeof value.amount === "string" || typeof value.amount === "number") {
      return String(value.amount);
    }
  }
  return String(value);
}

function schemaType(property) {
  if (Array.isArray(property.type)) {
    return property.type.join("|");
  }
  if (property.type) {
    return String(property.type);
  }
  if (Array.isArray(property.enum)) {
    return "enum";
  }
  if (property.anyOf) {
    return "anyOf";
  }
  if (property.oneOf) {
    return "oneOf";
  }
  if (property.allOf) {
    return "allOf";
  }
  return "";
}

function renderTable(rows, columns) {
  if (!rows.length) {
    return "\n";
  }

  const prepared = prepareColumns(rows, columns);
  const border = tableBorder(prepared);
  const output = [
    border.top,
    tableRow(
      prepared.map((column) => column.title),
      prepared
    ),
    border.middle
  ];

  for (const row of rows) {
    const wrappedColumns = prepared.map((column) => wrapToWidth(row[column.key] || "", column.width));
    const height = Math.max(...wrappedColumns.map((lines) => lines.length));
    for (let lineIndex = 0; lineIndex < height; lineIndex += 1) {
      output.push(tableRow(wrappedColumns.map((lines) => lines[lineIndex] || ""), prepared));
    }
    output.push(border.middle);
  }

  output[output.length - 1] = border.bottom;
  return `${output.join("\n")}\n`;
}

function prepareColumns(rows, columns) {
  const terminalWidth = Math.max(60, process.stdout.columns || DEFAULT_TABLE_WIDTH);
  const fixedColumns = columns.filter((column) => !column.flex);
  const flexColumns = columns.filter((column) => column.flex);

  const preparedFixed = fixedColumns.map((column) => ({
    ...column,
    width: contentWidth(rows, column, column.maxWidth || 36)
  }));

  const borderWidth = columns.length + 1;
  const paddingWidth = columns.length * 2;
  const fixedWidth = preparedFixed.reduce((total, column) => total + column.width, 0);
  const availableFlexWidth = terminalWidth - borderWidth - paddingWidth - fixedWidth;
  const flexMinWidth = Math.max(...flexColumns.map((column) => column.minWidth || MIN_DESCRIPTION_WIDTH), MIN_DESCRIPTION_WIDTH);
  const flexWidth = Math.max(flexMinWidth, Math.floor(availableFlexWidth / Math.max(1, flexColumns.length)));

  return columns.map((column) => {
    if (column.flex) {
      return {
        ...column,
        width: Math.max(contentWidth(rows, column, column.minWidth || MIN_DESCRIPTION_WIDTH), flexWidth)
      };
    }
    return preparedFixed.find((item) => item.key === column.key);
  });
}

function contentWidth(rows, column, maxWidth = 36) {
  const values = [column.title, ...rows.map((row) => row[column.key] || "")];
  const widest = Math.max(...values.map((value) => displayWidth(value)));
  return Math.min(Math.max(widest, displayWidth(column.title)), maxWidth);
}

function tableBorder(columns) {
  const parts = columns.map((column) => "-".repeat(column.width + 2));
  return {
    top: `+${parts.join("+")}+`,
    middle: `+${parts.join("+")}+`,
    bottom: `+${parts.join("+")}+`
  };
}

function tableRow(values, columns) {
  const cells = values.map((value, index) => {
    const column = columns[index];
    const text = truncateToWidth(String(value), column.width);
    const padded = column.align === "right" ? padStartWidth(text, column.width) : padEndWidth(text, column.width);
    return ` ${padded} `;
  });
  return `|${cells.join("|")}|`;
}

function padEndWidth(text, width) {
  return `${text}${" ".repeat(Math.max(0, width - displayWidth(text)))}`;
}

function padStartWidth(text, width) {
  return `${" ".repeat(Math.max(0, width - displayWidth(text)))}${text}`;
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
