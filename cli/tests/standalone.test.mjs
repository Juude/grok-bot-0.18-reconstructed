import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, link, access, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const executable = path.join(root, 'dist/main.mjs');

async function fixture(t, handler) {
  const dir = await mkdtemp(path.join(tmpdir(), 'grok-cli-test-'));
  const cwd = path.join(dir, 'workspace'), state = path.join(dir, 'state');
  await mkdir(cwd);
  const standalone = path.join(dir, 'standalone.mjs');
  await copyFile(executable, standalone);
  const requests = [];
  const server = createServer(async (req, res) => {
    try {
      const parts = []; for await (const chunk of req) parts.push(chunk);
      const body = JSON.parse(Buffer.concat(parts).toString('utf8'));
      requests.push(body);
      await handler(body, res, requests);
    } catch (error) { res.writeHead(500); res.end(String(error)); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true, force: true }); });
  const endpoint = `http://127.0.0.1:${server.address().port}/v1/responses`;
  const launch = (args = [], input = '') => {
    const child = spawn(process.execPath, [standalone, '--model', 'test-model', '--endpoint', endpoint, '--cwd', cwd, '--data-dir', state, '--json', ...args], {
      cwd: tmpdir(), env: { ...process.env, OPENAI_API_KEY: '', OPENAI_MODEL: '' }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    const output = [], errors = [];
    child.stdout.on('data', data => output.push(data)); child.stderr.on('data', data => errors.push(data));
    child.stdin.on('error', () => {}); child.stdin.end(input);
    const result = once(child, 'close').then(([code, signal]) => ({ code, signal,
      stdout: Buffer.concat(output).toString('utf8'), stderr: Buffer.concat(errors).toString('utf8'),
      events: Buffer.concat(output).toString('utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)),
    }));
    return { child, result };
  };
  return { dir, cwd, state, requests, launch, run: async (...args) => launch(...args).result };
}

function sse(res, { text = '', calls = [], newline = '\n', usage = { input_tokens: 3, output_tokens: 2 } } = {}) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const events = [
    ...(text ? [{ type: 'response.output_text.delta', delta: text }] : []),
    ...calls.map(item => ({ type: 'response.output_item.done', item })),
    { type: 'response.completed', response: { id: 'response-test', output: calls, usage } },
  ];
  const bytes = Buffer.from(events.map(event => `data: ${JSON.stringify(event)}${newline}${newline}`).join(''));
  // Split unicode and CRLF boundaries independently of SSE event boundaries.
  for (let i = 0; i < bytes.length; i += 5) res.write(bytes.subarray(i, i + 5));
  res.end();
}
const call = (name, args, id = 'call-1') => ({ type: 'function_call', call_id: id, name, arguments: JSON.stringify(args) });
const resultFor = (body, id = 'call-1') => JSON.parse(body.input.find(row => row.type === 'function_call_output' && row.call_id === id).output);

test('standalone executable runs outside repo, streams CRLF/unicode, reports usage and resumes history', async t => {
  const f = await fixture(t, (_body, res) => sse(res, { text: '你好，CLI', newline: '\r\n' }));
  const first = await f.run(['First']);
  assert.equal(first.code, 0, first.stdout + first.stderr);
  assert.equal(first.events.filter(row => row.type === 'text-delta').map(row => row.delta).join(''), '你好，CLI');
  assert.equal(first.events.at(-1).usage.inputTokens, 3);
  assert.deepEqual(f.requests[0].tools.map(tool => tool.name), ['Read', 'List', 'recall_memory']);
  const second = await f.run(['Second']); assert.equal(second.code, 0, second.stdout);
  assert.deepEqual(f.requests[1].input, [
    { role: 'user', content: 'First' }, { role: 'assistant', content: '你好，CLI' }, { role: 'user', content: 'Second' },
  ]);
  const provenance = JSON.parse(await readFile(path.join(root, 'dist/provenance.json'), 'utf8'));
  assert.equal(provenance.upstreamPayloadRequired, false);
  assert.equal(provenance.recoveredInputs.length, 5);
});

test('model tool loop reads the workspace and returns matching call IDs before the final answer', async t => {
  const f = await fixture(t, (body, res, requests) => {
    if (requests.length === 1) sse(res, { calls: [call('Read', { path: 'sample.txt' })] });
    else { assert.equal(resultFor(body).content, 'file evidence'); sse(res, { text: 'Read verified.' }); }
  });
  await writeFile(path.join(f.cwd, 'sample.txt'), 'file evidence');
  const result = await f.run(['Read sample.txt']);
  assert.equal(result.code, 0, result.stdout);
  assert.equal(result.events.find(row => row.type === 'tool').name, 'Read');
  assert.equal(result.events.at(-1).usage.inputTokens, 6);
});

test('write and memory tools persist real files and recall facts across named sessions', async t => {
  const f = await fixture(t, (body, res, requests) => {
    if (requests.length === 1) sse(res, { calls: [
      call('Write', { path: 'notes/new.txt', content: 'saved' }, 'write'),
      call('update_state', { target: 'memory', action: 'write', tier: 'profile', content: 'The user prefers Chinese.' }, 'memory'),
    ] });
    else if (requests.length === 2) {
      assert.equal(resultFor(body, 'write').written, 'notes/new.txt');
      assert.equal(resultFor(body, 'memory').added.content, 'The user prefers Chinese.');
      sse(res, { text: 'Saved.' });
    } else { assert.match(body.instructions, /The user prefers Chinese\./); sse(res, { text: '记住了。' }); }
  });
  assert.equal((await f.run(['--allow-write', 'Write notes and remember language'])).code, 0);
  assert.equal(await readFile(path.join(f.cwd, 'notes/new.txt'), 'utf8'), 'saved');
  assert.equal((await f.run(['--session', 'another', 'What language?'])).code, 0);
  assert.equal(f.requests[2].input.length, 1);
  assert.equal((await f.run(['/memory'])).events[0].message.includes('Chinese'), true);
  assert.equal((await f.run(['--allow-write', '/forget The user prefers Chinese.'])).code, 0);
  assert.equal((await f.run(['/memory'])).events[0].message, '[]');
});

test('file paths cannot traverse outside the workspace or follow symlink/hard-link writes', async t => {
  const f = await fixture(t, (body, res, requests) => {
    if (requests.length === 1) sse(res, { calls: [
      call('Read', { path: '../secret.txt' }, 'traversal'),
      call('Read', { path: 'linked/secret.txt' }, 'symlink'),
      call('Write', { path: 'hard.txt', content: 'changed' }, 'hardlink'),
    ] });
    else {
      for (const id of ['traversal', 'symlink', 'hardlink']) assert.equal(resultFor(body, id).isError, true);
      sse(res, { text: 'Paths rejected.' });
    }
  });
  await writeFile(path.join(f.dir, 'secret.txt'), 'secret');
  await symlink(f.dir, path.join(f.cwd, 'linked'), 'dir');
  await link(path.join(f.dir, 'secret.txt'), path.join(f.cwd, 'hard.txt'));
  const result = await f.run(['--allow-write', 'Try the paths']);
  assert.equal(result.code, 0, result.stdout);
  assert.equal(await readFile(path.join(f.dir, 'secret.txt'), 'utf8'), 'secret');
});

test('disabled mutation tools cannot run even when a model requests them', async t => {
  const f = await fixture(t, (body, res, requests) => {
    if (requests.length === 1) sse(res, { calls: [call('Write', { path: 'oops', content: 'bad' })] });
    else { assert.equal(resultFor(body).isError, true); sse(res, { text: 'Write disabled.' }); }
  });
  assert.equal((await f.run(['Write something'])).code, 0);
  await assert.rejects(access(path.join(f.cwd, 'oops')));
  assert.equal((await f.run(['/remember A durable fact'])).code, 1);
});

test('truncated API streams fail without committing history and release the state lock', async t => {
  const f = await fixture(t, (_body, res, requests) => {
    if (requests.length === 1) { res.writeHead(200); res.end('data: {"type":"response.output_text.delta"'); }
    else sse(res, { text: 'Recovered.' });
  });
  const failed = await f.run(['First']); assert.equal(failed.code, 1);
  assert.match(failed.events.at(-1).message, /incomplete SSE/);
  await assert.rejects(access(path.join(f.state, 'default.json')));
  assert.equal((await f.run(['Second'])).code, 0);
  assert.deepEqual(f.requests[1].input, [{ role: 'user', content: 'Second' }]);
});

test('corrupt sessions fail without overwriting the file', async t => {
  const f = await fixture(t, (_body, res) => sse(res));
  await mkdir(f.state); const file = path.join(f.state, 'default.json'); await writeFile(file, '{broken');
  assert.equal((await f.run(['Hi'])).code, 1);
  assert.equal(await readFile(file, 'utf8'), '{broken'); assert.equal(f.requests.length, 0);
});

test('step guard stops repeated model tool calls', async t => {
  const f = await fixture(t, (_body, res) => sse(res, { calls: [call('List', {})] }));
  const result = await f.run(['--max-steps', '2', 'Keep trying']);
  assert.equal(result.code, 1); assert.equal(f.requests.length, 2);
  assert.match(result.events.at(-1).message, /2-step tool limit/);
});

test('turn deadline aborts a stalled provider and releases the lock', async t => {
  const f = await fixture(t, (_body, res, requests) => { if (requests.length > 1) sse(res, { text: 'OK' }); });
  const result = await f.run(['--timeout', '0.1', 'Hi']);
  assert.equal(result.code, 1); assert.equal(result.events.at(-1).type, 'error');
  assert.equal((await f.run(['Retry'])).code, 0);
});

test('concurrent invocations cannot overwrite the same state', async t => {
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const f = await fixture(t, (_body, _res) => started());
  const first = f.launch(['Hi']); await ready;
  const second = await f.run(['Concurrent']); assert.equal(second.code, 1);
  assert.match(second.events.at(-1).message, /State is locked/);
  first.child.kill('SIGINT'); const result = await first.result; assert.equal(result.code, 130);
  await assert.rejects(access(path.join(f.state, 'cli.lock')));
});

test('shell is explicit, uses workspace cwd, and returns command output to the model', async t => {
  const f = await fixture(t, (body, res, requests) => {
    if (requests.length === 1) sse(res, { calls: [call('Shell', { command: 'pwd' })] });
    else { assert.equal(resultFor(body).output.trim(), f.cwd); assert.equal(resultFor(body).exitCode, 0); sse(res, { text: 'Shell verified.' }); }
  });
  const result = await f.run(['--allow-shell', 'Check cwd']); assert.equal(result.code, 0, result.stdout);
});

test('stdin prompts work and session traversal is rejected before touching files', async t => {
  const f = await fixture(t, (body, res) => { assert.equal(body.input[0].content, 'stdin prompt'); sse(res, { text: 'OK' }); });
  assert.equal((await f.run([], 'stdin prompt')).code, 0);
  const result = await f.run(['--session', '../escape', 'Hi']); assert.equal(result.code, 1);
  assert.match(result.events.at(-1).message, /Session must/);
});
