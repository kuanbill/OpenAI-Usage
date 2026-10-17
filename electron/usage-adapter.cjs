const { mapUsageResponse } = require('./usage-model.cjs');
const { randomUUID } = require('node:crypto');

function isOfficialVerificationUrl(value) {
  try {
    const url = new URL(value);
    const officialHost = url.hostname === 'openai.com' || url.hostname.endsWith('.openai.com') ||
      url.hostname === 'chatgpt.com' || url.hostname.endsWith('.chatgpt.com');
    return url.protocol === 'https:' && url.port === '' && !url.username && !url.password && officialHost;
  } catch {
    return false;
  }
}

class UsageAdapter {
  constructor(rpc, onStatus = () => {}) {
    if (!rpc || typeof rpc.request !== 'function' || typeof rpc.onNotification !== 'function') {
      throw new TypeError('A Codex App Server RPC client is required');
    }
    this.rpc = rpc;
    this.onStatus = onStatus;
    this.loginId = null;
    this.authenticated = false;
    this.disposed = false;
    this.lastUsage = null;
    this.resetCreditOptions = null;
    this.resetCreditIdByHandle = new Map();
    this.resetCreditHandleById = new Map();
    this.unsubscribe = rpc.onNotification((method, params) => this.#handleNotification(method, params));
  }

  #updateResetCreditOptions(summary) {
    const credits = summary?.credits;
    if (!Array.isArray(credits)) {
      this.resetCreditIdByHandle.clear();
      this.resetCreditHandleById.clear();
      this.resetCreditOptions = null;
      return;
    }
    const nextIdByHandle = new Map();
    const nextHandleById = new Map();
    this.resetCreditOptions = credits
      .filter((credit) => credit?.status === 'available' && credit.resetType === 'codexRateLimits' &&
        typeof credit.id === 'string' && credit.id.length > 0 &&
        (!Number.isSafeInteger(credit.expiresAt) || credit.expiresAt * 1000 > Date.now()))
      .map((credit) => {
        const handle = this.resetCreditHandleById.get(credit.id) || randomUUID();
        nextIdByHandle.set(handle, credit.id);
        nextHandleById.set(credit.id, handle);
        const expiresAt = credit.expiresAt === null || (Number.isSafeInteger(credit.expiresAt) && credit.expiresAt > 0)
          ? credit.expiresAt
          : null;
        return {
          handle,
          title: typeof credit.title === 'string' ? credit.title : null,
          description: typeof credit.description === 'string' ? credit.description : null,
          grantedAt: Number.isSafeInteger(credit.grantedAt) && credit.grantedAt > 0 ? credit.grantedAt : null,
          expiresAt,
          expirationStatus: credit.expiresAt === null ? 'never' : Number.isSafeInteger(expiresAt) ? 'scheduled' : 'unavailable'
        };
      });
    this.resetCreditIdByHandle = nextIdByHandle;
    this.resetCreditHandleById = nextHandleById;
  }

  getResetCreditOptions() {
    return this.resetCreditOptions?.map((credit) => ({ ...credit })) ?? null;
  }

  #publish(status) {
    try { this.onStatus(status); } catch {}
  }

  async startDeviceLogin() {
    if (this.disposed) throw new Error('Adapter is closed');
    if (this.loginId || this.authenticated) throw new Error('Login already started');
    this.#publish({ state: 'starting', usageReadable: false, usage: null, error: '' });
    const result = await this.rpc.request('account/login/start', { type: 'chatgptDeviceCode' });
    if (!result || result.type !== 'chatgptDeviceCode' || typeof result.userCode !== 'string' ||
      typeof result.loginId !== 'string' || !isOfficialVerificationUrl(result.verificationUrl)) {
      this.#publish({ state: 'failed', usageReadable: false, usage: null, error: '官方裝置代碼登入資料無效。' });
      throw new Error('Official device-code login response is invalid');
    }
    this.loginId = result.loginId;
    this.#publish({ state: 'pending', usageReadable: false, usage: null, error: '' });
    // userCode is intentionally returned only to the local UI caller; it is not retained here.
    return { userCode: result.userCode, verificationUrl: result.verificationUrl };
  }

  async #handleNotification(method, params = {}) {
    if (this.disposed) return;
    if (method === 'account/rateLimits/updated' && this.authenticated) {
      try {
        const usage = await this.readUsage();
        this.#publish({ state: 'authenticated', usageReadable: true, usage, error: '' });
      } catch {
        this.#publish({ state: 'authenticated', usageReadable: Boolean(this.lastUsage), usage: this.lastUsage, error: '用量更新失敗。' });
      }
      return;
    }
    if (method !== 'account/login/completed') return;
    if (params.loginId && this.loginId && params.loginId !== this.loginId) return;
    if (!params.success) {
      this.#publish({ state: 'failed', usageReadable: false, usage: null, error: '官方登入未完成。' });
      return;
    }
    this.authenticated = true;
    this.#publish({ state: 'checking', usageReadable: false, usage: null, error: '' });
    try {
      const usage = await this.readUsage();
      this.#publish({ state: 'authenticated', usageReadable: true, usage, error: '' });
    } catch {
      this.#publish({ state: 'failed', usageReadable: false, usage: null, error: '已登入，但官方用量讀取失敗。' });
    }
  }

  async readUsage({ includeResetCreditDetails = false } = {}) {
    if (!this.authenticated) throw new Error('Authentication required');
    const response = await this.rpc.request('account/rateLimits/read', { excludeResetCreditDetails: !includeResetCreditDetails });
    if (!response || !response.rateLimits || typeof response.rateLimits !== 'object') {
      throw new Error('Usage response unavailable');
    }
    if (includeResetCreditDetails) this.#updateResetCreditOptions(response.rateLimitResetCredits);
    this.lastUsage = mapUsageResponse(response, new Date().toISOString());
    return this.lastUsage;
  }

  async loadResetCredits() {
    const usage = await this.readUsage({ includeResetCreditDetails: true });
    return { usage, resetCredits: this.getResetCreditOptions() };
  }

  async consumeResetCredit(handle, idempotencyKey) {
    if (!this.authenticated || this.disposed) throw new Error('Authenticated account required');
    const creditId = this.resetCreditIdByHandle.get(handle);
    if (!creditId || !this.resetCreditOptions?.some((credit) => credit.handle === handle)) {
      throw new Error('Selected reset credit is unavailable');
    }
    if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) throw new TypeError('Idempotency key is required');
    const result = await this.rpc.request('account/rateLimitResetCredit/consume', { creditId, idempotencyKey });
    const outcomes = ['reset', 'nothingToReset', 'noCredit', 'alreadyRedeemed'];
    if (!result || !outcomes.includes(result.outcome)) throw new Error('Reset outcome unavailable');
    return { outcome: result.outcome };
  }

  async readExistingUsage() {
    if (this.disposed) throw new Error('Adapter is closed');
    let accountResponse;
    try { accountResponse = await this.rpc.request('account/read', { refreshToken: false }); }
    catch { throw new Error('ChatGPT authentication required'); }
    if (accountResponse?.account?.type !== 'chatgpt') {
      throw new Error('ChatGPT authentication required');
    }
    this.authenticated = true;
    try {
      return await this.readUsage();
    } catch (error) {
      this.authenticated = false;
      if (accountResponse.requiresOpenaiAuth) throw new Error('ChatGPT authentication required');
      throw error;
    }
  }

  isAuthenticated() {
    return this.authenticated;
  }

  async cancelLogin() {
    if (this.disposed) return;
    if (this.loginId && !this.authenticated) {
      try { await this.rpc.request('account/login/cancel', { loginId: this.loginId }); } catch {}
    }
    this.loginId = null;
    this.#publish({ state: 'cancelled', usageReadable: false, usage: null, error: '' });
    this.dispose();
  }

  async logout() {
    if (this.disposed) return;
    if (this.authenticated) await this.rpc.request('account/logout', {});
    else if (this.loginId) await this.rpc.request('account/login/cancel', { loginId: this.loginId });
    this.loginId = null;
    this.authenticated = false;
    this.#publish({ state: 'cleaned', usageReadable: false, usage: null, error: '' });
    this.dispose();
  }

  dispose() {
    this.disposed = true;
    if (typeof this.unsubscribe === 'function') this.unsubscribe();
  }
}

module.exports = { UsageAdapter, isOfficialVerificationUrl };
