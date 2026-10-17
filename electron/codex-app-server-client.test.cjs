const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { CodexAppServerClient } = require('./codex-app-server-client.cjs');

function fakeSpawn(responder = (request) => ({ result: request.method === 'initialize' ? { serverInfo: { name: 'fixture' } } : { ok: true } })) {
  const spawned = [];
  const spawn = (command, args, options) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stdin = {
      writable: true,
      write(line) {
        const request = JSON.parse(line);
        spawned.at(-1).messages.push(request);
        if (request.id !== undefined) {
          const payload = responder(request);
          queueMicrotask(() => child.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, ...payload }) + String.fromCharCode(10)));
        }
        return true;
      }
    };
    child.kill = () => { child.emit('exit', 0, null); return true; };
    spawned.push({ command, args, options, child, messages: [] });
    queueMicrotask(() => child.emit('spawn'));
    return child;
  };
  return { spawn, spawned };
}

test('provides the notification subscription contract required by UsageAdapter', () => {
  const client = new CodexAppServerClient({ codexHome: 'C:/isolated/unused-profile' });
  const events = [];
  const unsubscribe = client.onNotification((method, params) => events.push({ method, params }));
  client.emit('notification', 'account/login/completed', { success: true });
  unsubscribe();
  client.emit('notification', 'account/login/completed', { success: true });
  assert.deepEqual(events, [{ method: 'account/login/completed', params: { success: true } }]);
});

test('initializes a pinned App Server with an isolated CODEX_HOME and sends requests', async () => {
  const fake = fakeSpawn();
  const client = new CodexAppServerClient({ codexHome: 'C:/isolated/profile-a', spawnImpl: fake.spawn, platform: 'win32' });
  await client.start();
  const result = await client.request('account/rateLimits/read', { excludeResetCreditDetails: true });
  assert.equal(fake.spawned[0].command, 'cmd.exe');
  assert.ok(fake.spawned[0].args.join(' ').includes('@openai/codex@0.163.0'));
  assert.equal(fake.spawned[0].options.env.CODEX_HOME, 'C:/isolated/profile-a');
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(fake.spawned[0].messages.map((item) => item.method), ['initialize', 'initialized', 'account/rateLimits/read']);
});

test('does not expose raw RPC error text in rejected requests', async () => {
  const fake = fakeSpawn((request) => request.method === 'initialize'
    ? { result: { serverInfo: { name: 'fixture' } } }
    : { error: { code: -1, message: 'refresh_token=secret-value' } });
  const client = new CodexAppServerClient({ codexHome: 'C:/isolated/profile-b', spawnImpl: fake.spawn, platform: 'win32' });
  await client.start();
  await assert.rejects(client.request('account/rateLimits/read'), (error) => {
    assert.equal(error.message.includes('secret-value'), false);
    return error.message === 'Codex App Server request failed';
  });
});
