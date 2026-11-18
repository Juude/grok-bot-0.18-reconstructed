# Standalone reconstructed CLI

This is an experimental terminal application built entirely from readable source.
It does not download, extract, import, or run the original Grok Bot application,
Electron, its renderer, or any `src/app/dist` payload. The bundled executable has
no third-party runtime dependencies beyond Node.js 22 or later.

**Source-only is not a new license grant.** This experiment reuses reconstructed
code. The repository's [NOTICE](../NOTICE.md) and [PROVENANCE](../PROVENANCE.md)
still apply. This package deliberately does not declare an open-source license
for material whose licensing has not been established.

Prebuilt portable releases are available under the `cli-v*` tags. For Android,
see the Chinese [Termux installation guide](TERMUX.md). Downloaded releases need
only Node.js 22+, with no build dependencies or npm installation on the device.

## Build and run

Install from this subdirectory; the root desktop dependency installation is not
required. No macOS tools, Docker, native addons, or original installer are needed.

```sh
cd cli
npm ci
npm run typecheck
npm test
export OPENAI_API_KEY='your-key'
export OPENAI_MODEL='your-responses-compatible-model'
node dist/main.mjs --cwd /path/to/project 'Explain the project structure'
```

The default endpoint is `https://api.openai.com/v1/responses`. Use a different
**Responses API** endpoint with `--endpoint https://example.com/v1/responses`
or `OPENAI_RESPONSES_URL`. Chat Completions-only endpoints are not supported.
HTTP is accepted only for localhost servers. A local server may omit the key.
Credentials are read from the environment and never saved by the CLI.

```sh
node dist/main.mjs --session my-project                 # interactive conversation
node dist/main.mjs --session my-project 'Continue'      # resume text history
echo 'List the files' | node dist/main.mjs --json        # NDJSON for other programs
node dist/main.mjs --allow-write '/remember I prefer Chinese explanations'
node dist/main.mjs '/memory'
node dist/main.mjs --allow-write 'Update the README with installation instructions'
node dist/main.mjs --allow-shell 'Run the project tests and explain failures'
```

The default model tools are `Read`, `List`, and `recall_memory`. `--allow-write`
adds `Write` and `update_state` for explicit durable memory changes. `--allow-shell`
adds `Shell`. These switches authorize tools for the entire invocation; there
is no per-call confirmation. Shell commands run on the host and **are not
sandboxed**. File tools reject paths outside the workspace and symlink paths;
they are not a security boundary against concurrent filesystem mutations.
Do not use this CLI to isolate untrusted processes.

Interactive commands: `/memory`, `/remember FACT`, `/forget EXACT_FACT`, `/reset`,
and `/exit`. Memory commands that change facts require `--allow-write`. `/reset`
clears the current conversation but retains durable memory.

Data is stored under `~/.local/share/grok-reconstructed-cli/<workspace-hash>/`,
or `--data-dir`. Sessions are text conversations; memory is shared by all sessions
in that data directory and uses the reconstructed `profile.md` and dated log
format. Use a different data directory to isolate memory. One process holds a
directory lock while running. After SIGKILL or a crash, remove `cli.lock` only
after confirming no CLI is using that data directory. Failed turns do not commit
text history; file, shell, and memory effects already performed are not rolled back.
Full tool transcripts and encrypted reasoning are not restored between turns.
Conversation input above 200,000 characters is rejected instead of silently
truncated. Automatic context compaction is not implemented.

## What is reused and what is new?

| Component | Implementation |
| --- | --- |
| Responses streaming, function-call execution loop, usage totals, step limit | Existing `source/host/extensions/inference/codex-direct-responses.ts`; supplied with a CLI API-key transport, no desktop/Codex login |
| Durable fact store, deduplication, profile/log recall | Existing `source/host/extensions/memory/memory-service.ts` |
| Memory prompt rendering | Existing `source/host/runner/sand-memory.ts` |
| Memory filesystem and scheduling support | Existing `source/host/watched-directory.ts`, `source/internal/scheduling.ts` |
| Terminal interaction, session persistence/locking, local tools, API configuration | New `cli/src/` code |

This is **not the complete original AnysphereAgent harness**. The full
`AnysphereAgent.runStream` composition, automatic memory extraction/synthesis,
context compression, subagents, background jobs, MCP OAuth/account lifecycle,
automations, browser/computer use, and remote boxes are not wired into this CLI.
Those features need additional headless adapters and behavioral tests. Existing
desktop plugin accounts are not read or reused.

`npm run build` generates `dist/provenance.json` and rejects any dependency outside
the CLI source, the five listed reconstructed modules, and Node.js builtins.
The build and integration tests run without the root desktop dependencies or
upstream application payload. The tests use a local mock Responses server;
they do not demonstrate compatibility with a paid/live provider.
