const test = require('node:test');
const assert = require('node:assert/strict');
const { UsageAdapter } = require('./usage-adapter.cjs');

const officialLogin = {
  type: 'chatgptDeviceCode',
  loginId: 'login-in-memory-only',
  userCode: 'NEVER-PERSIST-THIS',
  verificationUrl: 'https://auth.openai.com/codex/device'
};

function stubRpc(responses = {}) {
  const calls = [];
  const listeners = new Set();
  return {
    calls,
    request: async (method, params) => {
      calls.push({ method, params });
      if (method in responses) return responses[method];
      throw new Error('unexpected-rpc');
    },
    onNotification(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async notify(method, params) { for (const listener of listeners) await listener(method, params); }
  };
}

test('starts only official device-code login and returns the code only to its caller', async () => {
  const rpc = stubRpc({ 'account/login/start': officialLogin });
  const adapter = new UsageAdapter(rpc);
  const result = await adapter.startDeviceLogin();
  assert.deepEqual(rpc.calls, [{ method: 'account/login/start', params: { type: 'chatgptDeviceCode' } }]);
  assert.deepEqual(result, { userCode: 'NEVER-PERSIST-THIS', verificationUrl: officialLogin.verificationUrl });
  assert.equal(Object.hasOwn(adapter, 'userCode'), false);
});

test('reads and allow-lists usage fields after auth completion', async () => {
  const rpc = stubRpc({
    'account/rateLimits/read': {
      accountId: 'private-id',
      rateLimits: { primary: { usedPercent: 25, resetsAt: 1900000000, windowDurationMins: 300 }, secondary: null },
      rateLimitResetCredits: { availableCount: 0, credits: [{ id: 'private-credit-id' }] }
    }
  });
  const events = [];
  const adapter = new UsageAdapter(rpc, (event) => events.push(event));
  await rpc.notify('account/login/completed', { success: true });
  assert.equal(events.at(-1).state, 'authenticated');
  assert.equal(events.at(-1).usage.primary.usedPercent, 25);
  assert.equal(events.at(-1).usage.secondary, null);
  assert.equal(events.at(-1).usage.availableResetCredits, 0);
  assert.equal(JSON.stringify(events).includes('private-id'), false);
  assert.equal(JSON.stringify(events).includes('private-credit-id'), false);
});

test('rejects non-OpenAI verification URLs before returning a device code', async () => {
  const rpc = stubRpc({ 'account/login/start': { ...officialLogin, verificationUrl: 'https://auth.openai.com.evil.invalid/' } });
  const adapter = new UsageAdapter(rpc);
  await assert.rejects(adapter.startDeviceLogin(), /official/i);
  const portRpc = stubRpc({ 'account/login/start': { ...officialLogin, verificationUrl: 'https://auth.openai.com:8443/device' } });
  await assert.rejects(new UsageAdapter(portRpc).startDeviceLogin(), /official/i);
});

test('adopts an existing ChatGPT profile without retaining its email', async () => {
  const rpc = stubRpc({
    'account/read': { requiresOpenaiAuth: false, account: { type: 'chatgpt', email: 'private@example.com', planType: 'plus' } },
    'account/rateLimits/read': { rateLimits: { primary: { usedPercent: 10 }, secondary: null }, rateLimitResetCredits: { availableCount: 0 } }
  });
  const adapter = new UsageAdapter(rpc);
  const usage = await adapter.readExistingUsage();
  assert.equal(usage.primary.usedPercent, 10);
  assert.deepEqual(rpc.calls.map((call) => call.method), ['account/read', 'account/rateLimits/read']);
  assert.deepEqual(rpc.calls[0].params, { refreshToken: false });
  assert.equal(JSON.stringify(usage).includes('private@example.com'), false);
  assert.equal(adapter.isAuthenticated(), true);
});

test('reuses a persisted ChatGPT profile when read-only usage succeeds despite a refresh-required flag', async () => {
  const rpc = stubRpc({
    'account/read': { requiresOpenaiAuth: true, account: { type: 'chatgpt', email: 'private@example.com' } },
    'account/rateLimits/read': { rateLimits: { primary: { usedPercent: 10 }, secondary: null } }
  });
  const adapter = new UsageAdapter(rpc);
  const usage = await adapter.readExistingUsage();

  assert.equal(usage.primary.usedPercent, 10);
  assert.equal(adapter.isAuthenticated(), true);
  assert.deepEqual(rpc.calls.map((call) => call.method), ['account/read', 'account/rateLimits/read']);
  assert.equal(JSON.stringify(usage).includes('private@example.com'), false);
});

test('refuses to read usage from an unauthenticated or non-ChatGPT profile', async () => {
  const rpc = stubRpc({ 'account/read': { requiresOpenaiAuth: true, account: null } });
  const adapter = new UsageAdapter(rpc);
  await assert.rejects(adapter.readExistingUsage(), /authentication required/i);
  assert.deepEqual(rpc.calls.map((call) => call.method), ['account/read']);
});

test('refetches a complete snapshot when the server sends a sparse rate-limit update', async () => {
  const rpc = stubRpc({
    'account/read': { requiresOpenaiAuth: false, account: { type: 'chatgpt', email: null, planType: 'plus' } },
    'account/rateLimits/read': { rateLimits: { primary: { usedPercent: 25 }, secondary: null } }
  });
  const events = [];
  const adapter = new UsageAdapter(rpc, (event) => events.push(event));
  await adapter.readExistingUsage();
  await rpc.notify('account/rateLimits/updated', { rateLimits: { primary: { usedPercent: 99 } } });
  assert.equal(rpc.calls.filter((call) => call.method === 'account/rateLimits/read').length, 2);
  assert.equal(events.at(-1).usage.primary.usedPercent, 25);
});

test('loads only available reset credits with expiry metadata and keeps backend IDs private', async () => {
  const rpc = stubRpc({
    'account/read': { requiresOpenaiAuth: false, account: { type: 'chatgpt' } },
    'account/rateLimits/read': {
      rateLimits: { primary: { usedPercent: 100 }, secondary: null },
      rateLimitResetCredits: {
        availableCount: 2,
        credits: [
          { id: 'private-credit-1', resetType: 'codexRateLimits', status: 'available', title: 'Free reset', description: 'Earned credit', grantedAt: 1900000000, expiresAt: 1901000000 },
          { id: 'private-credit-2', resetType: 'codexRateLimits', status: 'redeemed', title: 'Used', description: null, grantedAt: 1800000000, expiresAt: null },
          { id: 'private-credit-3', resetType: 'unknown', status: 'available', title: null, description: null, grantedAt: 1900000000, expiresAt: null }
        ]
      }
    }
  });
  const adapter = new UsageAdapter(rpc);
  await adapter.readExistingUsage();
  const result = await adapter.loadResetCredits();
  assert.deepEqual(rpc.calls.at(-1), { method: 'account/rateLimits/read', params: { excludeResetCreditDetails: false } });
  assert.equal(result.usage.availableResetCredits, 2);
  assert.equal(result.resetCredits.length, 1);
  assert.equal(result.resetCredits[0].title, 'Free reset');
  assert.equal(result.resetCredits[0].expiresAt, 1901000000);
  assert.equal(JSON.stringify(result).includes('private-credit-1'), false);
});

test('consumes only the explicitly selected reset credit with an idempotency key', async () => {
  const rpc = stubRpc({
    'account/read': { requiresOpenaiAuth: false, account: { type: 'chatgpt' } },
    'account/rateLimits/read': {
      rateLimits: { primary: { usedPercent: 100 }, secondary: null },
      rateLimitResetCredits: { availableCount: 1, credits: [{ id: 'private-credit-id', resetType: 'codexRateLimits', status: 'available', title: 'Earned reset', description: null, grantedAt: 1900000000, expiresAt: null }] }
    },
    'account/rateLimitResetCredit/consume': { outcome: 'reset' }
  });
  const adapter = new UsageAdapter(rpc);
  await adapter.readExistingUsage();
  const details = await adapter.loadResetCredits();
  const outcome = await adapter.consumeResetCredit(details.resetCredits[0].handle, '11111111-1111-4111-8111-111111111111');
  assert.deepEqual(outcome, { outcome: 'reset' });
  assert.deepEqual(rpc.calls.at(-1), {
    method: 'account/rateLimitResetCredit/consume',
    params: { creditId: 'private-credit-id', idempotencyKey: '11111111-1111-4111-8111-111111111111' }
  });
});

test('cancels a pending login and logs out only a completed login', async () => {
  const rpc = stubRpc({
    'account/login/start': officialLogin,
    'account/login/cancel': { success: true },
    'account/rateLimits/read': { rateLimits: { primary: null, secondary: null } },
    'account/logout': { success: true }
  });
  const adapter = new UsageAdapter(rpc);
  await adapter.startDeviceLogin();
  await adapter.cancelLogin();
  assert.equal(rpc.calls.at(-1).method, 'account/login/cancel');

  const secondRpc = stubRpc({
    'account/login/start': officialLogin,
    'account/rateLimits/read': { rateLimits: { primary: null, secondary: null } },
    'account/logout': { success: true }
  });
  const second = new UsageAdapter(secondRpc);
  await second.startDeviceLogin();
  await secondRpc.notify('account/login/completed', { success: true });
  assert.equal(second.isAuthenticated(), true);
  await second.logout();
  assert.equal(secondRpc.calls.at(-1).method, 'account/logout');
});
