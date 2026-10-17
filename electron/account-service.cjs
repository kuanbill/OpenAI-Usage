const { EventEmitter } = require('node:events');
const { randomUUID } = require('node:crypto');
const { UsageAdapter } = require('./usage-adapter.cjs');

class AccountService extends EventEmitter {
  constructor({ store, createClient }) {
    super();
    if (!store || typeof store.listAccounts !== 'function' || typeof createClient !== 'function') {
      throw new TypeError('Profile store and client factory are required');
    }
    this.store = store;
    this.createClient = createClient;
    this.sessions = new Map();
    this.states = new Map();
    this.resetAttempts = new Map();
    this.poller = null;
  }

  #publish(id, status) {
    const previous = this.states.get(id) || {};
    const safeStatus = {
      state: status.state,
      usageReadable: Boolean(status.usageReadable),
      usage: status.usage || null,
      error: typeof status.error === 'string' ? status.error : '',
      resetCredits: Object.hasOwn(status, 'resetCredits') ? status.resetCredits : previous.resetCredits ?? null,
      resetDetailsLoaded: status.resetDetailsLoaded ?? previous.resetDetailsLoaded ?? false,
      resetNeedsRefresh: status.resetNeedsRefresh ?? previous.resetNeedsRefresh ?? false
    };
    this.states.set(id, safeStatus);
    this.emit('change', this.listAccounts());
  }

  #findAccount(id) {
    if (typeof id !== 'string') throw new TypeError('Invalid account ID');
    const account = this.store.listAccounts().find((item) => item.id === id);
    if (!account) throw new Error('Account not found');
    return account;
  }

  async #createSession(account) {
    const client = this.createClient(this.store.getProfileHome(account.id));
    const adapter = new UsageAdapter(client, (status) => this.#publish(account.id, status));
    const session = { client, adapter };
    this.sessions.set(account.id, session);
    client.on?.('exit', () => {
      if (this.sessions.get(account.id) === session) {
        this.sessions.delete(account.id);
        this.#publish(account.id, { state: 'disconnected', usageReadable: false, usage: null, error: '' });
      }
    });
    try { await client.start(); }
    catch {
      this.sessions.delete(account.id);
      adapter.dispose();
      try { await client.close(); } catch {}
      throw new Error('Codex App Server could not start.');
    }
    return session;
  }

  async #getSession(account) {
    return this.sessions.get(account.id) || this.#createSession(account);
  }

  async #beginLogin(account) {
    const session = await this.#getSession(account);
    try {
      const login = await session.adapter.startDeviceLogin();
      return { account: { id: account.id, alias: account.alias }, login };
    } catch (error) {
      if (error.message === 'Codex App Server could not start.') throw error;
      this.#publish(account.id, { state: 'failed', usageReadable: false, usage: null, error: '無法啟動官方登入流程。' });
      throw new Error('無法啟動官方登入流程。');
    }
  }

  async addAccount(alias) {
    const account = this.store.addAccount(alias);
    return this.#beginLogin(account);
  }

  async startLogin(id) {
    const account = this.#findAccount(id);
    const prior = this.sessions.get(id);
    if (prior) {
      if (prior.adapter.isAuthenticated()) throw new Error('Account is already authenticated');
      try { await prior.adapter.cancelLogin(); } catch {}
      try { await prior.client.close(); } catch {}
      this.sessions.delete(id);
    }
    return this.#beginLogin(account);
  }

  async refreshAccount(id) {
    const account = this.#findAccount(id);
    const previousUsage = this.states.get(id)?.usage || null;
    this.#publish(id, { state: 'checking', usageReadable: Boolean(previousUsage), usage: previousUsage, error: '' });
    let session;
    try {
      session = await this.#getSession(account);
      const usage = session.adapter.isAuthenticated()
        ? await session.adapter.readUsage()
        : await session.adapter.readExistingUsage();
      this.#publish(id, { state: 'authenticated', usageReadable: true, usage, error: '' });
    } catch (error) {
      const authRequired = error.message === 'ChatGPT authentication required';
      this.#publish(id, {
        state: authRequired ? 'login-required' : 'failed',
        usageReadable: false,
        usage: this.states.get(id)?.usage || null,
        error: authRequired ? '此 profile 尚未登入 ChatGPT。' : '無法讀取官方用量。'
      });
    }
    return this.listAccounts().find((item) => item.id === id);
  }

  async refreshAll() {
    return Promise.all(this.store.listAccounts().map((account) => this.refreshAccount(account.id)));
  }

  async refreshResetCredits(id) {
    const account = this.#findAccount(id);
    const session = this.sessions.get(id);
    if (!session?.adapter.isAuthenticated()) throw new Error('ChatGPT authentication required');
    const { usage, resetCredits } = await session.adapter.loadResetCredits();
    for (const attemptKey of this.resetAttempts.keys()) {
      if (attemptKey.startsWith(`${id}:`)) this.resetAttempts.delete(attemptKey);
    }
    this.#publish(id, {
      state: 'authenticated', usageReadable: true, usage, error: '',
      resetCredits, resetDetailsLoaded: Array.isArray(resetCredits), resetNeedsRefresh: false
    });
    return this.listAccounts().find((item) => item.id === account.id);
  }

  async consumeResetCredit(id, handle) {
    const account = this.#findAccount(id);
    const session = this.sessions.get(id);
    if (!session?.adapter.isAuthenticated()) throw new Error('ChatGPT authentication required');
    const current = this.states.get(id);
    if (!current?.resetDetailsLoaded || current.resetNeedsRefresh ||
      !current.resetCredits?.some((credit) => credit.handle === handle)) {
      throw new Error('請先重新載入可用重置額度。');
    }
    const attemptKey = `${id}:${handle}`;
    if (this.resetAttempts.has(attemptKey)) throw new Error('請先重新載入可用重置額度以確認上次結果。');

    // Re-read detailed credits immediately before the explicit consume request.
    const before = await session.adapter.loadResetCredits();
    if (!before.resetCredits?.some((credit) => credit.handle === handle)) {
      this.#publish(id, {
        state: 'authenticated', usageReadable: true, usage: before.usage, error: '此重置額度已不可用，請重新選擇。',
        resetCredits: before.resetCredits, resetDetailsLoaded: Array.isArray(before.resetCredits), resetNeedsRefresh: false
      });
      throw new Error('Selected reset credit is no longer available');
    }

    const attempt = { idempotencyKey: randomUUID() };
    this.resetAttempts.set(attemptKey, attempt);
    this.#publish(id, {
      state: 'authenticated', usageReadable: true, usage: before.usage, error: '',
      resetCredits: before.resetCredits, resetDetailsLoaded: true, resetNeedsRefresh: true
    });
    let result;
    try {
      result = await session.adapter.consumeResetCredit(handle, attempt.idempotencyKey);
    } catch {
      this.#publish(id, {
        state: 'authenticated', usageReadable: true, usage: before.usage,
        error: '重置結果未確認。請先重新載入重置額度，不要直接重試。',
        resetCredits: before.resetCredits, resetDetailsLoaded: true, resetNeedsRefresh: true
      });
      throw new Error('重置結果未確認；請先重新載入重置額度。');
    }

    try {
      const verified = await session.adapter.loadResetCredits();
      this.resetAttempts.delete(attemptKey);
      this.#publish(id, {
        state: 'authenticated', usageReadable: true, usage: verified.usage, error: '',
        resetCredits: verified.resetCredits, resetDetailsLoaded: Array.isArray(verified.resetCredits), resetNeedsRefresh: false
      });
      return { outcome: result.outcome, account: this.listAccounts().find((item) => item.id === account.id) };
    } catch {
      this.#publish(id, {
        state: 'authenticated', usageReadable: true, usage: before.usage,
        error: '重置回應已收到，但無法讀回最新狀態。請先重新載入重置額度，不要再次重置。',
        resetCredits: before.resetCredits, resetDetailsLoaded: true, resetNeedsRefresh: true
      });
      throw new Error('重置回應已收到，但最新狀態讀取失敗；請先重新載入額度。');
    }
  }

  startPolling(intervalMs = 300000) {
    if (this.poller) return;
    if (!Number.isSafeInteger(intervalMs) || intervalMs < 60000) throw new TypeError('Polling interval must be at least one minute');
    this.poller = setInterval(() => { void this.refreshAll(); }, intervalMs);
    this.poller.unref?.();
  }

  stopPolling() {
    if (this.poller) clearInterval(this.poller);
    this.poller = null;
  }

  async removeAccount(id) {
    const account = this.#findAccount(id);
    const session = this.sessions.get(id);
    if (session) {
      try { await session.adapter.logout(); } catch {}
      try { await session.client.close(); } catch {}
      this.sessions.delete(id);
    }
    const removed = this.store.removeAccount(account.id);
    this.states.delete(id);
    for (const attemptKey of this.resetAttempts.keys()) {
      if (attemptKey.startsWith(`${id}:`)) this.resetAttempts.delete(attemptKey);
    }
    this.emit('change', this.listAccounts());
    return removed;
  }

  listAccounts() {
    return this.store.listAccounts().map((account) => ({
      id: account.id,
      alias: account.alias,
      createdAt: account.createdAt,
      ...(this.states.get(account.id) || {
        state: 'not-connected', usageReadable: false, usage: null, error: '',
        resetCredits: null, resetDetailsLoaded: false, resetNeedsRefresh: false
      })
    }));
  }

  async closeAll() {
    this.stopPolling();
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.all(sessions.map(async ({ client, adapter }) => {
      try {
        if (!adapter.isAuthenticated()) await adapter.cancelLogin();
        else adapter.dispose();
      } catch {}
      try { await client.close(); } catch {}
    }));
  }
}

module.exports = { AccountService };
