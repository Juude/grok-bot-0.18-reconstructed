import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const repo = path.dirname(root);
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) throw new Error('Release version must be MAJOR.MINOR.PATCH.');
const output = path.join(root, 'dist/release');
const stage = path.join(root, 'dist/release-stage');
await rm(output, { recursive: true, force: true });
await rm(stage, { recursive: true, force: true });
await mkdir(output, { recursive: true }); await mkdir(stage, { recursive: true });
const executable = 'grok-reconstructed-cli.mjs';
for (const [from, to] of [
  [path.join(root, 'dist/main.mjs'), executable],
  [path.join(root, 'dist/provenance.json'), 'provenance.json'],
  [path.join(root, 'TERMUX.md'), 'TERMUX.md'],
  [path.join(repo, 'NOTICE.md'), 'NOTICE.md'],
  [path.join(repo, 'PROVENANCE.md'), 'PROVENANCE.md'],
]) await copyFile(from, path.join(stage, to));
const provenance = JSON.parse(await readFile(path.join(stage, 'provenance.json'), 'utf8'));
if (provenance.version !== pkg.version || provenance.upstreamPayloadRequired !== false) throw new Error('Rebuild the source-only CLI before packaging this version.');
const sha256 = async file => createHash('sha256').update(await readFile(file)).digest('hex');
const digest = await sha256(path.join(stage, executable));
await writeFile(path.join(stage, `${executable}.sha256`), `${digest}  ${executable}\n`);
await writeFile(path.join(stage, 'release.json'), JSON.stringify({
  version: pkg.version, tag: `cli-v${pkg.version}`,
  sourceCommit: process.env.GITHUB_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
  runtime: 'Node.js >=22', architecture: 'portable JavaScript; no native addons',
  termuxDeviceTested: false, executableSha256: digest,
}, null, 2) + '\n');
const files = [executable, `${executable}.sha256`, 'provenance.json', 'release.json', 'TERMUX.md', 'NOTICE.md', 'PROVENANCE.md'];
for (const file of files) await copyFile(path.join(stage, file), path.join(output, file));
const archive = `grok-reconstructed-cli-${pkg.version}.tar.gz`;
execFileSync('tar', ['--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner', '-czf', path.join(output, archive), '-C', stage, ...files]);
const hashes = await Promise.all([...files, archive].map(async file => `${await sha256(path.join(output, file))}  ${file}`));
await writeFile(path.join(output, 'SHA256SUMS'), hashes.join('\n') + '\n');
console.log(`Release cli-v${pkg.version}: ${output}`);
