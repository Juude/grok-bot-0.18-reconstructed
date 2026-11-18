import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('release checksums, notices and copied portable executable work without npm or repository access', async t => {
  execFileSync(process.execPath, ['package-release.mjs'], { cwd: root, stdio: 'pipe' });
  const release = path.join(root, 'dist/release');
  execFileSync('sha256sum', ['-c', 'SHA256SUMS'], { cwd: release, stdio: 'pipe' });
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const dir = await mkdtemp(path.join(tmpdir(), 'grok-release-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  execFileSync('tar', ['-xzf', path.join(release, `grok-reconstructed-cli-${pkg.version}.tar.gz`), '-C', dir]);
  const executable = path.join(dir, 'grok-reconstructed-cli.mjs');
  const content = await readFile(executable);
  const checksum = (await readFile(`${executable}.sha256`, 'utf8')).split(/\s+/)[0];
  assert.equal(createHash('sha256').update(content).digest('hex'), checksum);
  const run = args => execFileSync(process.execPath, [executable, ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, OPENAI_API_KEY: '', OPENAI_MODEL: '' } });
  assert.equal(run(['--version']).trim(), pkg.version);
  assert.match(run(['--help']), /Responses API/);
  run(['--json', '--data-dir', path.join(dir, 'state'), '--allow-write', '/remember I use Termux.']);
  assert.match(JSON.parse(run(['--json', '--data-dir', path.join(dir, 'state'), '/memory'])).message, /I use Termux/);
  assert.match(await readFile(path.join(dir, 'NOTICE.md'), 'utf8'), /unofficial reconstruction/);
  const metadata = JSON.parse(await readFile(path.join(dir, 'release.json'), 'utf8'));
  assert.equal(metadata.version, pkg.version);
  assert.equal(metadata.termuxDeviceTested, false);
});
