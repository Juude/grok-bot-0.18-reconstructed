# Termux 使用说明

这是 Grok reconstructed CLI 0.1.0 预览版。它直接调用你配置的 Responses API，
不需要 Cursor 服务端、桌面登录、原版安装包或 Electron。

## 下载并验证

在 Termux 中运行以下命令；如果已经安装 Node.js 22 以上版本，可以跳过安装它。

```sh
pkg install nodejs-lts curl
mkdir -p "$HOME/grok-cli"
cd "$HOME/grok-cli"
curl -fL --retry 3 -O https://github.com/Juude/grok-bot-0.18-reconstructed/releases/download/cli-v0.1.0/grok-reconstructed-cli.mjs
curl -fL --retry 3 -O https://github.com/Juude/grok-bot-0.18-reconstructed/releases/download/cli-v0.1.0/grok-reconstructed-cli.mjs.sha256
sha256sum -c grok-reconstructed-cli.mjs.sha256
node grok-reconstructed-cli.mjs --version
```

无需 npm install，也无需 clang、Python 或 root。发布的是单个 JavaScript 文件，
不绑定 x64 或 ARM64；Node.js 使用 Termux 自己的安装包。
用 `node 文件名.mjs` 启动，避免 Android 上 `/usr/bin/env` shebang 路径的问题。
请把程序和会话数据放在 Termux 的 `$HOME` 下，不要放在 Android 共享存储中。

## 配置模型服务并启动

把下面三个值改为你实际使用的配置。endpoint 必须是完整的 `/v1/responses`
URL。只提供 `/v1/chat/completions` 的服务不能直接使用。

```sh
export OPENAI_API_KEY='你的 API Key'
export OPENAI_MODEL='服务端支持的模型名'
export OPENAI_RESPONSES_URL='https://你的服务地址/v1/responses'
node "$HOME/grok-cli/grok-reconstructed-cli.mjs" --cwd "$HOME"
```

如果使用 OpenAI 官方服务，省略 `OPENAI_RESPONSES_URL` 即使用默认地址。
本机服务可以使用 `http://127.0.0.1:端口/v1/responses`，无需 API Key 时可
`unset OPENAI_API_KEY`。模型服务需要实现流式 Responses 事件（包括
`response.output_text.delta` 和 `response.completed`），并支持 function calling
及 `function_call_output` 才能使用本地工具；同时需要接受本客户端发送的
`store: false` 和 `include: ["reasoning.encrypted_content"]` 等字段。

单次请求、选择会话、允许修改文件或执行命令：

```sh
node "$HOME/grok-cli/grok-reconstructed-cli.mjs" --cwd "$HOME" '列出当前目录并解释主要文件'
node "$HOME/grok-cli/grok-reconstructed-cli.mjs" --cwd "$HOME" --session android
node "$HOME/grok-cli/grok-reconstructed-cli.mjs" --cwd "$HOME" --allow-write --allow-shell
```

默认只能读取文件和查看记忆。`--allow-write` 开启文件和记忆写入；
`--allow-shell` 允许模型直接执行 Termux 命令，权限持续整个进程，没有逐次确认。
Shell 是宿主机执行，未提供沙箱。Android 下优先使用 `$PREFIX/bin/sh`。

## 会话与记忆

- `/memory`：查看持久化记忆。
- `/remember 内容`：记录事实，需要 `--allow-write`。
- `/forget 原文`：删除对应事实，需要 `--allow-write`。
- `/reset`：清空当前对话，保留记忆。
- `/exit`：退出。

会话默认按工作目录隔离；改变 `--cwd` 会改变默认数据位置。同一个工作目录下
不同 `--session` 共享记忆。数据默认放在
`~/.local/share/grok-reconstructed-cli/`，可用 `--data-dir` 指定位置。

## 验证范围与限制

发布工作流在 Linux x64/ARM64 上运行构建、类型检查和模拟 API 端到端测试。
这不是 Android/Termux 真机测试，也没有代替你验证真实模型服务的兼容性。
第一版不包含完整原版 harness、子 Agent、自动上下文压缩、自动记忆合成、
MCP 登录、后台自动化或桌面控制。会话恢复的是文字记录，不是完整工具轨迹。

程序需要联网访问你自己的模型服务。API Key 从环境变量读取，不写入会话文件。
源码可见不构成新的开源许可；请同时阅读发布包中的 NOTICE.md 与 PROVENANCE.md。
