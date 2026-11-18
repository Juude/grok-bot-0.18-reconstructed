import { parseArgs } from 'node:util';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';

declare const __CLI_VERSION__: string;
export const VERSION = __CLI_VERSION__;

export function parseOptions(args: string[], env = process.env) {
  const parsed = parseArgs({ args, allowPositionals: true, options: {
    help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' }, model: { type: 'string' },
    endpoint: { type: 'string' }, cwd: { type: 'string' },
    session: { type: 'string', default: 'default' }, 'data-dir': { type: 'string' },
    'max-steps': { type: 'string', default: '8' }, timeout: { type: 'string', default: '120' },
    'allow-write': { type: 'boolean' }, 'allow-shell': { type: 'boolean' },
    json: { type: 'boolean' },
  } });
  const cwd = resolve(parsed.values.cwd ?? process.cwd());
  const session = parsed.values.session!;
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(session)) throw new Error('Session must contain 1–64 letters, digits, underscores or hyphens.');
  const maxSteps = Number(parsed.values['max-steps']);
  const timeout = Number(parsed.values.timeout);
  if (!Number.isSafeInteger(maxSteps) || maxSteps < 1 || maxSteps > 100) throw new Error('--max-steps must be an integer from 1 to 100.');
  if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 3600) throw new Error('--timeout must be between 0 and 3600 seconds (exclusive of 0).');
  const endpoint = new URL(parsed.values.endpoint ?? env.OPENAI_RESPONSES_URL ?? 'https://api.openai.com/v1/responses');
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(endpoint.hostname);
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
      (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && local))) {
    throw new Error('Endpoint must use HTTPS, or HTTP on localhost, with no embedded credentials, query or fragment.');
  }
  const workspaceId = createHash('sha256').update(cwd).digest('hex').slice(0, 16);
  return {
    help: parsed.values.help === true, version: parsed.values.version === true, cwd, session, endpoint: endpoint.href,
    model: parsed.values.model ?? env.OPENAI_MODEL ?? '', apiKey: env.OPENAI_API_KEY ?? '',
    dataDir: resolve(parsed.values['data-dir'] ?? join(homedir(), '.local/share/grok-reconstructed-cli', workspaceId)),
    maxSteps, timeoutMs: timeout * 1000, allowWrite: parsed.values['allow-write'] === true,
    allowShell: parsed.values['allow-shell'] === true, json: parsed.values.json === true,
    prompt: parsed.positionals.join(' '),
  };
}
export type Options = ReturnType<typeof parseOptions>;

export const HELP = `Grok reconstructed CLI ${VERSION} — experimental, source-only

Usage: grok-reconstructed [options] [prompt]
       echo 'Explain this project' | grok-reconstructed [options]
       grok-reconstructed [options]                 # interactive terminal

  --model NAME           Required, or OPENAI_MODEL
  --endpoint URL         Full Responses API URL, or OPENAI_RESPONSES_URL
  --cwd DIRECTORY        Workspace for local tools (default: current directory)
  --session NAME         Resume a named text conversation (default: default)
  --data-dir DIRECTORY   Separate local state directory
  --max-steps N          Maximum model requests per turn (default: 8)
  --timeout SECONDS      Turn deadline (default: 120)
  --allow-write          Enable writing files inside the workspace
  --allow-shell          Enable arbitrary host shell commands; this is NOT a sandbox
  --json                 Emit newline-delimited JSON events
  -v, --version          Show the CLI version
  -h, --help             Show this help

Authentication: OPENAI_API_KEY. Local servers may omit it.
Interactive commands: /memory, /remember FACT, /forget EXACT_FACT, /reset, /exit
Default tools: Read, List, memory recall. Memory/file writes require --allow-write.
No Electron, original installer, desktop login, MCP account reuse or cloud box required.
`;
