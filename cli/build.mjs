import { build } from 'esbuild';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const result = await build({
  absWorkingDir: root, entryPoints: ['src/main.ts'], outfile: 'dist/main.mjs',
  bundle: true, platform: 'node', format: 'esm', target: 'node22',
  metafile: true, banner: { js: '#!/usr/bin/env node' },
});
const inputs = Object.keys(result.metafile.inputs);
const allowedRecovered = new Set([
  '../source/host/extensions/inference/codex-direct-responses.ts',
  '../source/host/extensions/memory/memory-service.ts',
  '../source/host/runner/sand-memory.ts',
  '../source/host/watched-directory.ts',
  '../source/internal/scheduling.ts',
]);
for (const input of inputs) {
  if (!input.startsWith('src/') && !allowedRecovered.has(input)) {
    throw new Error(`Unexpected CLI dependency: ${input}`);
  }
}
for (const output of Object.values(result.metafile.outputs)) {
  for (const dependency of output.imports) {
    if (!dependency.path.startsWith('node:')) throw new Error(`Non-builtin runtime import: ${dependency.path}`);
  }
}
await mkdir(path.join(root, 'dist'), { recursive: true });
await writeFile(path.join(root, 'dist/provenance.json'), JSON.stringify({
  schemaVersion: 1, runtimeDependencies: 'Node.js builtins only',
  recoveredInputs: inputs.filter(input => allowedRecovered.has(input)),
  newInputs: inputs.filter(input => input.startsWith('src/')),
  upstreamPayloadRequired: false, licenseGrant: false,
}, null, 2) + '\n');
await chmod(path.join(root, 'dist/main.mjs'), 0o755);
