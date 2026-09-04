import fs from "node:fs";
import path from "node:path";

const DEFAULT_TABLE_WIDTH = 100;
const MIN_DESCRIPTION_WIDTH = 24;

export function formatToolResult(result, options = {}) {
  if (options.raw) {
    return `${JSON.stringify(result, null, options.pretty === false ? 0 : 2)}\n`;
  }

  if (result && Object.prototype.hasOwnProperty.call(result, "structuredContent")) {
    return `${JSON.stringify(result.structuredContent, null, 2)}\n`;
  }

  const content = Array.isArray(result?.content) ? result.content : [];
  const textParts = content
    .filter((item) => item && item.type === "text" && typeof item.text === "string")
    .map((item) => item.text);

  if (textParts.length > 0) {
    const text = textParts.join("\n");
    const parsed = tryParseJson(text);
    if (parsed !== undefined) {
      return `${JSON.stringify(parsed, null, 2)}\n`;
    }
    return text.endsWith("\n") ? text : `${text}\n`;
  }

  return `${JSON.stringify(result, null, 2)}\n`;
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
    return "No tools returned. Check token/tools permissions.\n";
  }

  const rows = tools.map((tool, index) => ({
    "#": String(index + 1),
    Tool: tool.name || "",
    Description: singleLine(tool.description || "")
  }));

  return renderTable(rows, [
    { key: "#", title: "#", align: "right" },
    { key: "Tool", title: "Tool", maxWidth: 32 },
    { key: "Description", title: "Description", flex: true, minWidth: 24 }
  ]);
}

export function printToolSchema(tool) {
  const schema = tool?.inputSchema || tool?.input_schema || {};
  const properties = schema.properties || {};
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  const names = Object.keys(properties);

  if (names.length === 0) {
    return `No parameters found for ${tool?.name || "this tool"}.\n`;
  }

  const rows = names.map((name) => {
    const property = properties[name] || {};
    return {
      Parameter: name,
      Required: required.has(name) ? "yes" : "no",
      Type: schemaType(property),
      Description: singleLine(property.description || "")
    };
  });

  return renderTable(rows, [
    { key: "Parameter", title: "Parameter", maxWidth: 28 },
    { key: "Required", title: "Required" },
    { key: "Type", title: "Type", maxWidth: 18 },
    { key: "Description", title: "Description", flex: true, minWidth: 24 }
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
      Item: "Balance",
      Value: formatAmount(data.balance),
      Description: "Remaining Dataify credits or balance"
    },
    {
      Item: "Total Recharge",
      Value: formatAmount(data.totalRecharge ?? data.total_recharge),
      Description: "Total recharged credits"
    },
    {
      Item: "Total Used",
      Value: formatAmount(data.totalUse ?? data.total_use),
      Description: "Total consumed credits"
    }
  ].filter((row) => row.Value !== "");

  if (!rows.length) {
    return formatToolResult(result, options);
  }

  const message = payload?.message ? `Status: ${payload.message}\n\n` : "";
  return `${message}${renderTable(rows, [
    { key: "Item", title: "Item", maxWidth: 20 },
    { key: "Value", title: "Value", maxWidth: 24, align: "right" },
    { key: "Description", title: "Description", flex: true, minWidth: 24 }
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
    const wrappedColumns = prepared.map((column) => wrapCell(row[column.key] || "", column.width));
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

function wrapCell(value, width) {
  const text = String(value);
  if (!text) {
    return [""];
  }

  const words = text.split(/\s+/);
  const lines = [];
  let current = "";

  for (const word of words) {
    if (!word) {
      continue;
    }
    if (displayWidth(word) > width) {
      if (current) {
        lines.push(current);
        current = "";
      }
      lines.push(...chunkByWidth(word, width));
      continue;
    }

    const next = current ? `${current} ${word}` : word;
    if (displayWidth(next) <= width) {
      current = next;
    } else {
      lines.push(current);
      current = word;
    }
  }

  if (current) {
    lines.push(current);
  }
  return lines.length ? lines : [""];
}

function chunkByWidth(text, width) {
  const chunks = [];
  let current = "";
  for (const char of Array.from(text)) {
    if (displayWidth(current + char) > width) {
      if (current) {
        chunks.push(current);
      }
      current = char;
    } else {
      current += char;
    }
  }
  if (current) {
    chunks.push(current);
  }
  return chunks;
}

function truncateToWidth(text, width) {
  let result = "";
  for (const char of Array.from(text)) {
    if (displayWidth(result + char) > width) {
      break;
    }
    result += char;
  }
  return result;
}

function padEndWidth(text, width) {
  return `${text}${" ".repeat(Math.max(0, width - displayWidth(text)))}`;
}

function padStartWidth(text, width) {
  return `${" ".repeat(Math.max(0, width - displayWidth(text)))}${text}`;
}

function displayWidth(value) {
  return Array.from(String(value)).reduce((width, char) => width + (isWideChar(char) ? 2 : 1), 0);
}

function isWideChar(char) {
  return /[\u1100-\u115f\u2329\u232a\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/u.test(char);
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
