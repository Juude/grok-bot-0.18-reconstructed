import { open, readdir, realpath, lstat, mkdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import type { FileMemoryStore } from '../../source/host/extensions/memory/memory-service.js';
import type { CodexDirectTool } from '../../source/host/extensions/inference/codex-direct-responses.js';

const OUTPUT_LIMIT = 64 * 1024;
export function makeTools(options: { cwd: string; memory: FileMemoryStore; allowWrite: boolean; allowShell: boolean;
  signal: AbortSignal; emit: (event: Record<string, unknown>) => void }) {
  const schema = (properties: Record<string, unknown>, required: string[]) => ({ type: 'object', properties, required, additionalProperties: false });
  const string = { type: 'string' };
  const define = (name: string, description: string, parameters: unknown): CodexDirectTool => ({ name, description, parameters, source: {} });
  const tools = [
    define('Read', 'Read a UTF-8 file inside the workspace, up to 64 KiB.', schema({ path: string }, ['path'])),
    define('List', 'List up to 500 directory entries inside the workspace.', schema({ path: string }, [])),
    define('recall_memory', 'List durable facts previously recorded for this workspace.', schema({}, [])),
  ];
  if (options.allowWrite) tools.push(
    define('Write', 'Create or replace a UTF-8 file inside the workspace. Paths through symlinks are rejected.', schema({ path: string, content: string }, ['path', 'content'])),
    define('update_state', 'Write or forget a durable memory fact. This CLI supports only target memory.', schema({ target: { const: 'memory', type: 'string' }, action: { enum: ['write', 'forget'], type: 'string' }, content: string, tier: { enum: ['profile', 'log', 'note'], type: 'string' } }, ['target', 'action', 'content'])),
  );
  if (options.allowShell) tools.push(define('Shell', 'Run a command on the host in the workspace. No sandbox. Maximum 30 seconds and 64 KiB combined output.', schema({ command: string }, ['command'])));

  async function workspacePath(raw: string, writing = false): Promise<string> {
    const root = await realpath(options.cwd);
    const target = resolve(root, raw);
    const rel = relative(root, target);
    if (rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel)) throw new Error('Path is outside the workspace.');
    let current = root;
    for (const part of rel.split(/[\\/]/).filter(Boolean)) {
      current = resolve(current, part);
      try { if ((await lstat(current)).isSymbolicLink()) throw new Error('Symlink paths are not supported by CLI file tools.'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || !writing) throw error; }
    }
    return target;
  }
  const textArg = (args: Record<string, unknown>, name: string) => {
    const value = args[name];
    if (typeof value !== 'string' || value.length === 0) throw new Error(`${name} must be a nonempty string.`);
    return value;
  };
  async function execute(tool: CodexDirectTool, raw: unknown, id: string): Promise<unknown> {
    options.signal.throwIfAborted();
    if (!tools.some(allowed => allowed.name === tool.name)) throw new Error(`Tool is disabled: ${tool.name}`);
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Tool arguments must be an object.');
    const args = raw as Record<string, unknown>;
    options.emit({ type: 'tool', name: tool.name, id });
    if (tool.name === 'Read') {
      const handle = await open(await workspacePath(textArg(args, 'path')), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        if (!(await handle.stat()).isFile()) throw new Error('Read requires a regular file.');
        const buffer = Buffer.alloc(OUTPUT_LIMIT + 1);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        return { content: buffer.subarray(0, Math.min(bytesRead, OUTPUT_LIMIT)).toString('utf8'), truncated: bytesRead > OUTPUT_LIMIT };
      } finally { await handle.close(); }
    }
    if (tool.name === 'List') {
      const entries = await readdir(await workspacePath(typeof args.path === 'string' ? args.path : '.'), { withFileTypes: true });
      return { entries: entries.slice(0, 500).map(entry => ({ name: entry.name, kind: entry.isSymbolicLink() ? 'symlink' : entry.isDirectory() ? 'directory' : 'file' })), truncated: entries.length > 500 };
    }
    if (tool.name === 'Write') {
      const content = args.content;
      if (typeof content !== 'string' || Buffer.byteLength(content) > 1024 * 1024) throw new Error('content must be a string of at most 1 MiB.');
      const rawPath = textArg(args, 'path');
      const target = await workspacePath(rawPath, true);
      await mkdir(dirname(target), { recursive: true });
      await workspacePath(rawPath, true);
      const handle = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.nlink !== 1) throw new Error('Write requires a regular file with no hard links.');
        await handle.truncate(0); await handle.writeFile(content, 'utf8');
      } finally { await handle.close(); }
      return { written: rawPath, bytes: Buffer.byteLength(content) };
    }
    if (tool.name === 'recall_memory') return options.memory.listMemories(100);
    if (tool.name === 'update_state') {
      if (args.target !== 'memory') throw new Error('Only target memory is supported.');
      const content = textArg(args, 'content');
      if (args.action === 'forget') return { removed: options.memory.removeMemoryByContent(content) };
      if (args.action !== 'write' || (args.tier !== undefined && !['profile', 'log', 'note'].includes(String(args.tier)))) throw new Error('Invalid memory action or tier.');
      return { added: options.memory.addMemory(args.tier === 'note' ? `[note] ${content}` : content, Date.now(), args.tier === 'profile' ? 'profile' : 'log') };
    }
    if (tool.name === 'Shell') return runShell(textArg(args, 'command'), options.cwd, options.signal);
    throw new Error(`Unknown tool: ${tool.name}`);
  }
  return { tools, execute };
}

function runShell(command: string, cwd: string, signal: AbortSignal): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const posix = process.platform !== 'win32';
    // Termux installs its shell under PREFIX; /bin/sh is not available on Android.
    const shell = process.platform === 'android' && process.env.PREFIX
      ? join(process.env.PREFIX, 'bin/sh') : true;
    const child = spawn(command, { cwd, shell, detached: posix, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let size = 0, truncated = false, timedOut = false;
    const stop = () => {
      try { if (posix && child.pid !== undefined) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch {}
    };
    const collect = (data: Buffer) => {
      const remaining = OUTPUT_LIMIT - size;
      if (remaining > 0) { const part = data.subarray(0, remaining); chunks.push(part); size += part.length; }
      if (data.length > remaining) { truncated = true; stop(); }
    };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    const timer = setTimeout(() => { timedOut = true; stop(); }, 30_000);
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop();
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', stop); };
    child.on('error', error => { cleanup(); reject(error); });
    child.on('close', (code, killedBy) => {
      cleanup();
      if (signal.aborted) { reject(signal.reason); return; }
      resolve({ exitCode: code, signal: killedBy, output: Buffer.concat(chunks).toString('utf8'), truncated, timedOut });
    });
  });
}
