// 终端显示宽度工具。output.js（表格排版）和 select.js（选择器单行截断）共用，
// 避免两处各写一份 CJK 宽度判断后行为漂移。

export function isWideChar(char) {
  return /[\u1100-\u115f\u2329\u232a\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff00-\uff60\uffe0-\uffe6]/u.test(char);
}

export function displayWidth(value) {
  return Array.from(String(value ?? "")).reduce((width, char) => width + (isWideChar(char) ? 2 : 1), 0);
}

export function truncateToWidth(text, width) {
  let result = "";
  for (const char of Array.from(String(text ?? ""))) {
    if (displayWidth(result + char) > width) {
      break;
    }
    result += char;
  }
  return result;
}

// 按显示宽度折行：优先在空白处断，单个词本身就超宽时按字符切。
export function wrapToWidth(value, width) {
  const text = String(value ?? "");
  if (!text) {
    return [""];
  }

  const lines = [];
  let current = "";
  for (const word of text.split(/\s+/)) {
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

// 超宽时截断并补一个省略号，保证返回值的显示宽度不超过 maxWidth。
export function clipToWidth(text, maxWidth) {
  const value = String(text ?? "");
  const limit = Math.floor(Number(maxWidth) || 0);
  if (limit <= 0) {
    return "";
  }
  if (displayWidth(value) <= limit) {
    return value;
  }
  if (limit <= 1) {
    return "…";
  }
  return `${truncateToWidth(value, limit - 1)}…`;
}
