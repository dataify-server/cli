import { rejectUnknownOptions } from "./args.js";
import { configPath, readConfig, writeConfig } from "./config.js";
import { getLanguage, languageName, normalizeLanguage, setLanguage, t } from "./i18n.js";
import { createSelector } from "./select.js";

// 选择器里两项都用「目标语言」自我介绍，避免在中文界面里看到英文选项名、反之亦然。
const LANGUAGE_CHOICES = [
  { id: "en", name: "English", description: "Switch the CLI interface to English" },
  { id: "zh", name: "中文", description: "将 CLI 界面切换为中文" }
];

export function saveLanguage(value) {
  const normalized = normalizeLanguage(value);
  if (!normalized) {
    return "";
  }
  return writeConfig({ ...readConfig(), language: normalized });
}

/**
 * 切换语言。不给参数并且 options.select 为真、且当前是交互终端时，弹出选择器让用户自己挑；
 * 其余情况（命令行一次性调用、非 TTY）保持原来的「打印当前语言 + 用法」行为，避免脚本被卡住。
 */
export async function runLanguageCommand(tokens = [], options = {}) {
  rejectUnknownOptions(tokens);
  const write = options.write || ((text) => process.stdout.write(text));
  const values = (Array.isArray(tokens) ? tokens : [tokens]).filter((token) => token && !String(token).startsWith("-"));
  let value = values.at(-1);

  if (!value && options.select && process.stdin.isTTY && process.stdout.isTTY) {
    value = await chooseLanguage();
  }

  if (!value) {
    write(`${t("language.current", { language: languageName(getLanguage()) })}\n`);
    write(`${t("language.usage")}\n`);
    return getLanguage();
  }

  const normalized = normalizeLanguage(value);
  if (!normalized) {
    throw new Error(t("language.invalid", { value }));
  }

  setLanguage(normalized);
  write(`${t("language.changed", { language: languageName(normalized) })}\n`);

  try {
    const file = saveLanguage(normalized);
    write(`${t("language.saved", { file })}\n`);
  } catch (error) {
    write(`${t("language.saveFailed", { file: configPath(), message: error.message })}\n`);
  }

  return normalized;
}

async function chooseLanguage() {
  const selector = createSelector();
  try {
    const picked = await selector.selectOne({
      title: t("language.select"),
      items: LANGUAGE_CHOICES,
      defaultSelected: getLanguage()
    });
    return picked?.id || "";
  } catch (error) {
    if (error?.code === "ERR_USE_AFTER_CLOSE") {
      return "";
    }
    throw error;
  } finally {
    selector.close();
  }
}
