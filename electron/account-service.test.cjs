const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { ProfileStore } = require('./profile-store.cjs');
const { AccountService } = require('./account-service.cjs');

const scratchBase = path.join(
  process.env.TMPDIR || path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'hermes', 'cache', 'scratch'),
  'usage-dashboard-account-service-tests'
);

function createFixture(t) {
  fs.mkdirSync(scratchBase, { recursive: true });
  const root = fs.mkdtempSync(path.join(scratchBase, 'case-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const calls = [];
  const clients = [];
  const createClient = (codexHome) => {
    calls.push({ codexHome });
    const emitter = new EventEmitter();
    const client = {
      requests: [],
      async start() {},
      async request(method, params) {
        this.requests.push({ method, params });
        if (method === 'account/login/start') return { type: 'chatgptDeviceCode', loginId: 'transient-login', userCode: 'LOCAL-ONLY-CODE', verificationUrl: 'https://auth.openai.com/codex/device' };
        if (method === 'account/read') return { requiresOpenaiAuth: false, account: { type: 'chatgpt', email: 'private@example.com', planType: 'plus' } };
        if (method === 'account/rateLimits/read') {
          if (this.failUsage) throw new Error('fixture rpc error with refresh_token=secret');
          return this.usageResponse || { accountId: 'private-id', rateLimits: { primary: { usedPercent: 20, resetsAt: 1900000000, windowDurationMins: 300 }, secondary: null }, rateLimitResetCredits: { availableCount: 1 } };
        }
        if (method === 'account/rateLimitResetCredit/consume') {
          if (this.failConsume) throw new Error('fixture timeout');
          const result = this.consumeResponse || { outcome: 'reset' };
          const details = this.usageResponse?.rateLimitResetCredits;
          if (result.outcome === 'reset' && Array.isArray(details?.credits)) {
            this.usageResponse = {
              ...this.usageResponse,
              rateLimitResetCredits: {
                ...details,
                availableCount: Math.max(0, (details.availableCount || 0) - 1),
                credits: details.credits.filter((credit) => credit.id !== params.creditId)
              }
            };
          }
          return result;
        }
        if (method === 'account/login/cancel' || method === 'account/logout') return { success: true };
        throw new Error('fixture rpc error with refresh_token=secret');
      },
      onNotification(listener) { emitter.on('notification', listener); return () => emitter.removeListener('notification', listener); },
      async notify(method, params) { for (const listener of emitter.listeners('notification')) await listener(method, params); },
      async close() { this.closed = true; }
    };
    clients.push(client);
    return client;
  };
  const store = new ProfileStore(path.join(root, 'profile-store'));
  const service = new AccountService({ store, createClient });
  return { root, store, service, calls, clients };
}

test('creates one persistent isolated CODEX_HOME per account and never lists the one-time code', async (t) => {
  const { service, calls } = createFixture(t);
  const first = await service.addAccount('Personal');
  const second = await service.addAccount('Work');
  assert.equal(first.login.userCode, 'LOCAL-ONLY-CODE');
  assert.notEqual(calls[0].codexHome, calls[1].codexHome);
  const publicAccounts = service.listAccounts();
  assert.equal(publicAccounts.length, 2);
  assert.equal(JSON.stringify(publicAccounts).includes('LOCAL-ONLY-CODE'), false);
  assert.equal(JSON.stringify(publicAccounts).includes('private@example.com'), false);
});

test('reopens a stored profile, reads only ChatGPT plan usage, and exposes a safe snapshot', async (t) => {
  const { service, store, clients } = createFixture(t);
  const stored = store.addAccount('Personal');
  const snapshot = await service.refreshAccount(stored.id);
  assert.equal(snapshot.usage.primary.usedPercent, 20);
  assert.equal(snapshot.usage.availableResetCredits, 1);
  assert.equal(JSON.stringify(snapshot).includes('private@example.com'), false);
  assert.equal(clients[0].requests[0].method, 'account/read');
  assert.deepEqual(clients[0].requests[0].params, { refreshToken: false });
  assert.equal(clients[0].requests[1].method, 'account/rateLimits/read');
  assert.deepEqual(clients[0].requests[1].params, { excludeResetCreditDetails: true });
});

test('removing an authenticated account logs out, closes its process, and deletes only its profile', async (t) => {
  const { service, store, clients } = createFixture(t);
  const account = await service.addAccount('Personal');
  const other = store.addAccount('Work');
  await clients[0].notify('account/login/completed', { success: true });
  assert.equal(await service.removeAccount(account.account.id), true);
  assert.equal(clients[0].requests.at(-1).method, 'account/logout');
  assert.equal(clients[0].closed, true);
  assert.equal(fs.existsSync(store.getProfileHome(account.account.id)), false);
  assert.equal(fs.existsSync(store.getProfileHome(other.id)), true);
});

test('retains the last successful snapshot but marks it failed after a refresh error', async (t) => {
  const { service, store, clients } = createFixture(t);
  const stored = store.addAccount('Personal');
  await service.refreshAccount(stored.id);
  clients[0].failUsage = true;
  const failed = await service.refreshAccount(stored.id);
  assert.equal(failed.state, 'failed');
  assert.equal(failed.usageReadable, false);
  assert.equal(failed.usage.primary.usedPercent, 20);
});

test('refreshes every persisted account through its own profile without starting login', async (t) => {
  const { service, store, calls, clients } = createFixture(t);
  store.addAccount('Personal');
  store.addAccount('Work');
  const snapshots = await service.refreshAll();
  assert.equal(snapshots.length, 2);
  assert.notEqual(calls[0].codexHome, calls[1].codexHome);
  assert.ok(clients.every((client) => client.requests[0].method === 'account/read'));
  assert.ok(clients.every((client) => client.requests.every((request) => request.method !== 'account/login/start')));
});

test('loads reset-credit details explicitly, consumes the selected credit, then reads back', async (t) => {
  const { service, store, clients } = createFixture(t);
  const stored = store.addAccount('Personal');
  await service.refreshAccount(stored.id);
  const actualClient = clients.at(-1);
  assert.equal(actualClient.requests.some((request) => request.method === 'account/rateLimitResetCredit/consume'), false);
  actualClient.usageResponse = {
    rateLimits: { primary: { usedPercent: 100, resetsAt: 1900000000, windowDurationMins: 300 }, secondary: null },
    rateLimitResetCredits: { availableCount: 1, credits: [{ id: 'private-credit-id', resetType: 'codexRateLimits', status: 'available', title: 'Free reset', description: 'Earned credit', grantedAt: 1900000000, expiresAt: 1901000000 }] }
  };
  const loaded = await service.refreshResetCredits(stored.id);
  assert.equal(loaded.resetCredits.length, 1);
  assert.equal(loaded.resetCredits[0].expiresAt, 1901000000);
  assert.equal(JSON.stringify(loaded).includes('private-credit-id'), false);
  const result = await service.consumeResetCredit(stored.id, loaded.resetCredits[0].handle);
  assert.equal(result.outcome, 'reset');
  assert.equal(result.account.usageReadable, true);
  assert.equal(result.account.resetCredits.length, 0);
  assert.equal(result.account.resetNeedsRefresh, false);
  const consumeRequest = actualClient.requests.filter((request) => request.method === 'account/rateLimitResetCredit/consume').at(-1);
  assert.deepEqual(consumeRequest.params, { creditId: 'private-credit-id', idempotencyKey: consumeRequest.params.idempotencyKey });
  assert.match(consumeRequest.params.idempotencyKey, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(actualClient.requests.at(-1).method, 'account/rateLimits/read');
  assert.deepEqual(actualClient.requests.at(-1).params, { excludeResetCreditDetails: false });
});

test('requires an explicitly loaded available credit before consuming', async (t) => {
  const { service, store, clients } = createFixture(t);
  const stored = store.addAccount('Personal');
  await service.refreshAccount(stored.id);
  await assert.rejects(service.consumeResetCredit(stored.id, 'unloaded-handle'));
  assert.equal(clients[0].requests.some((request) => request.method === 'account/rateLimitResetCredit/consume'), false);
});

test('blocks a second consume attempt until an uncertain outcome is reloaded', async (t) => {
  const { service, store, clients } = createFixture(t);
  const stored = store.addAccount('Personal');
  await service.refreshAccount(stored.id);
  const client = clients[0];
  client.usageResponse = {
    rateLimits: { primary: { usedPercent: 100, resetsAt: 1900000000, windowDurationMins: 300 }, secondary: null },
    rateLimitResetCredits: { availableCount: 1, credits: [{ id: 'private-credit-id', resetType: 'codexRateLimits', status: 'available', expiresAt: null }] }
  };
  const loaded = await service.refreshResetCredits(stored.id);
  client.failConsume = true;
  await assert.rejects(service.consumeResetCredit(stored.id, loaded.resetCredits[0].handle), /重新載入/);
  await assert.rejects(service.consumeResetCredit(stored.id, loaded.resetCredits[0].handle), /重新載入/);
  assert.equal(client.requests.filter((request) => request.method === 'account/rateLimitResetCredit/consume').length, 1);
});
