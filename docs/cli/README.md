# Dataify MCP CLI 文档

本目录的文档对照线上文档站（`doc.dataify.com` 的「CLI 命令行」栏目：概述 / 安装 / 命令 / 示例 / 常见问题）重新整理，并按当前代码实现（`dataify-mcp-cli@0.3.8`）修订。

| 页面 | 文件 |
| --- | --- |
| 概述 | [01-overview.md](01-overview.md) |
| 安装 | [02-install.md](02-install.md) |
| 命令 | [03-commands.md](03-commands.md) |
| 示例 | [04-examples.md](04-examples.md) |
| 常见问题 | [05-faq.md](05-faq.md) |

---

## 本次修订要点（相对线上 0.1.9 版本）

线上页面标注的示例版本为 `0.1.9`，而当前代码为 `0.3.8`。以下差异已在新文档中更新：

1. **新增登录鉴权体系**：`dataify login` / `logout` / `whoami`（浏览器 PKCE 授权 + 本机回环回调），不再只依赖手动 Token；`init` 向导可一次完成 Token → MCP → Skill。
2. **新增能力命令**：`dataify balance`、`dataify init`、`dataify mcp`（Claude Code / Cursor / Codex / VS Code）、`dataify skill`、`dataify language`，以及分类向导 `dataify serp` / `scraper` / `webunlock`。
3. **中英双语界面**：`dataify language zh|en`、`--language`、环境变量 `DATAIFY_LANGUAGE`。
4. **`config get` 行为变更**：只输出配置文件内容（Token 打码），**不再**附加固定的 `server` / `tools`。
5. **移除"接受但忽略"的选项**：`--server` / `--endpoint` / `--tools` 已删除，传入会报 `Unsupported option`；未知选项一律报错，不再静默忽略。
6. **新增可写配置字段**：`config set` 支持 `token`、`timeout`、`language`；`login` 追加 `auth` 元信息块。
7. **新增环境变量**：`DATAIFY_LANGUAGE`、`GITHUB_TOKEN` / `GH_TOKEN`、`DATAIFY_WIDTH`、`DATAIFY_TUI`。
8. **示例中的工具名核对**：采集任务状态工具使用服务端实际暴露的 `web_unlock_task`；并补充 `balance`、`mcp`、`skill`、语言切换等配方。（CLI 自身 `--help` 示例已同步修正。）

> 若线上文档仍以 `0.1.9` 为准，请以本目录内容为最新参照。