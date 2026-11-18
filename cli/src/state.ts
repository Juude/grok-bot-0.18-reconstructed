import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface Message { role: 'user' | 'assistant'; content: string }
export async function lockState(dir: string): Promise<() => Promise<void>> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const lock = join(dir, 'cli.lock');
  try { await mkdir(lock, { mode: 0o700 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    throw new Error(`State is locked by another CLI. After a hard crash, remove ${lock} once no CLI is running.`);
  }
  return () => rm(lock, { recursive: true, force: true });
}
export async function loadHistory(file: string): Promise<Message[]> {
  let raw: string;
  try { raw = await readFile(file, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value) || value.some(row => !row || typeof row !== 'object' ||
      !['user', 'assistant'].includes(row.role) || typeof row.content !== 'string')) {
    throw new Error(`Invalid session file: ${file}. The file was left unchanged.`);
  }
  return value as Message[];
}
export async function saveHistory(file: string, messages: readonly Message[]): Promise<void> {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, JSON.stringify(messages) + '\n', { mode: 0o600 }); await rename(temporary, file); }
  finally { await rm(temporary, { force: true }); }
}
