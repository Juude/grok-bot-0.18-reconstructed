# CLI 0.1.0 — Termux preview

首个可直接下载运行的 Grok reconstructed CLI 预览版。

- 单文件 JavaScript，Node.js 22+，无需 npm、原版 App、Electron 或 Cursor 服务端。
- 可配置兼容 Responses API 的 endpoint、API Key 和模型。
- 流式终端对话、文字会话恢复、文件工具、持久化记忆、可选 Shell 执行。
- 提供单文件 SHA-256 校验、完整压缩包、来源记录与中文 Termux 使用说明。
- Android Shell 使用 Termux 的 `$PREFIX/bin/sh`（若设置 PREFIX）。

快速安装：

```sh
pkg install nodejs-lts curl
mkdir -p "$HOME/grok-cli"
cd "$HOME/grok-cli"
curl -fL --retry 3 -O https://github.com/Juude/grok-bot-0.18-reconstructed/releases/download/cli-v0.1.0/grok-reconstructed-cli.mjs
curl -fL --retry 3 -O https://github.com/Juude/grok-bot-0.18-reconstructed/releases/download/cli-v0.1.0/grok-reconstructed-cli.mjs.sha256
sha256sum -c grok-reconstructed-cli.mjs.sha256
node grok-reconstructed-cli.mjs --version
```

然后设置 `OPENAI_API_KEY`、`OPENAI_MODEL` 与可选的 `OPENAI_RESPONSES_URL`，
运行 `node "$HOME/grok-cli/grok-reconstructed-cli.mjs" --cwd "$HOME"`。
完整步骤见附件 TERMUX.md。

仅支持 Responses API，不支持仅有 Chat Completions 接口的服务。默认禁止文件和
记忆写入及 Shell 执行；按需添加 `--allow-write` / `--allow-shell`。

该版本是独立的功能子集，尚未接入完整原版 Agent harness、子 Agent、自动压缩、
MCP 账户或后台自动化。测试使用模拟 API；Linux ARM64 验证不等同于 Termux
真机验证。既有 NOTICE / PROVENANCE 许可声明继续适用。
