const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const readline = require('readline');
const { getProfileHomes, compareChatGptIdentity } = require('./profile-isolation');

const HOST = '127.0.0.1';
const PORT = 8766;
const CLI_VERSION = '0.163.0';
const SCRATCH_ROOT = path.join(
  process.env.TMPDIR || path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'hermes', 'cache', 'scratch'),
  'codex-two-profile-test'
);
const HOMES = getProfileHomes(SCRATCH_ROOT);
const UI_PATH = path.join(__dirname, 'index.html');
const accounts = {
  accountA: makeSlot('accountA', HOMES.accountA),
  accountB: makeSlot('accountB', HOMES.accountB)
};
let identityComparison = 'pending';
let closing = false;

function makeSlot(key, home) {
  return { key, home, state: 'idle', usageReadable: false, safeError: '', client: null, identity: null, loginId: null };
}

class CodexAppServer {
  constructor(slot) {
    this.slot = slot;
    this.proc = null;
    this.seq = 0;
    this.pending = new Map();
    this.initPromise = null;
    this.loginCompleted = false;
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      if (!this.proc || !this.proc.stdin.writable) return reject(new Error('server-unavailable'));
      const id = ++this.seq;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('request-timeout'));
      }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  notify(method, params = {}) {
    if (this.proc && this.proc.stdin.writable) this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }

  handleLine(line) {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (message.id !== undefined && this.pending.has(message.id)) {
      const request = this.pending.get(message.id);
      this.pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new Error('rpc-failed'));
      else request.resolve(message.result);
      return;
    }
    if (message.method === 'account/login/completed' && message.params?.success) {
      this.loginCompleted = true;
      completeLogin(this.slot, this).catch(() => {
        this.slot.state = 'failed';
        this.slot.safeError = '認證完成，但官方唯讀檢查失敗。';
      });
    } else if (message.method === 'account/login/completed') {
      this.slot.state = 'failed';
      this.slot.safeError = '官方認證未完成。';
    }
  }

  async start() {
    if (this.initPromise) return this.initPromise;
    this.initPromise = new Promise((resolve, reject) => {
      fs.mkdirSync(this.slot.home, { recursive: true });
      const command = `npm exec --yes --package=@openai/codex@${CLI_VERSION} -- codex app-server --stdio`;
      this.proc = spawn('cmd.exe', ['/d', '/s', '/c', command], {
        stdio: ['pipe', 'pipe', 'ignore'],
        env: { ...process.env, CODEX_HOME: this.slot.home }
      });
      const lines = readline.createInterface({ input: this.proc.stdout });
      lines.on('line', line => this.handleLine(line));
      this.proc.on('error', () => reject(new Error('process-start-failed')));
      this.proc.on('exit', () => {
        for (const request of this.pending.values()) {
          clearTimeout(request.timer);
          request.reject(new Error('server-stopped'));
        }
        this.pending.clear();
        this.proc = null;
        this.initPromise = null;
        if (!['idle', 'cleaned'].includes(this.slot.state) && this.slot.state !== 'authenticated') {
          this.slot.state = 'failed';
          this.slot.safeError ||= 'Codex App Server 已停止。';
        }
      });
      const timeout = setTimeout(() => reject(new Error('initialize-timeout')), 30000);
      setTimeout(async () => {
        try {
          await this.send('initialize', {
            clientInfo: { name: 'codex-profile-isolation-test', title: 'Codex Profile Isolation Test', version: '0.1.0' },
            capabilities: { experimentalApi: false }
          });
          this.notify('initialized', {});
          clearTimeout(timeout);
          resolve();
        } catch (error) {
          clearTimeout(timeout);
          reject(error);
        }
      }, 500);
    });
    return this.initPromise;
  }

  async loginStart() {
    await this.start();
    const result = await this.send('account/login/start', { type: 'chatgptDeviceCode' });
    if (!result || result.type !== 'chatgptDeviceCode' || !result.userCode || !result.verificationUrl || !result.loginId) {
      throw new Error('login-response-invalid');
    }
    const url = new URL(result.verificationUrl);
    const official = url.protocol === 'https:' && (
      url.hostname === 'auth.openai.com' || url.hostname.endsWith('.openai.com') ||
      url.hostname === 'chatgpt.com' || url.hostname.endsWith('.chatgpt.com')
    );
    if (!official) throw new Error('verification-domain-invalid');
    this.slot.loginId = result.loginId;
    return { userCode: result.userCode, verificationUrl: url.href };
  }

  async cleanup() {
    try {
      if (this.proc && this.loginCompleted) await this.send('account/logout', {});
      else if (this.proc && this.slot.loginId) await this.send('account/login/cancel', { loginId: this.slot.loginId });
    } catch {}
    try {
      if (this.proc) spawnSync('taskkill.exe', ['/PID', String(this.proc.pid), '/T', '/F'], { stdio: 'ignore', timeout: 5000 });
    } catch {}
    this.proc = null;
    this.slot.client = null;
    this.slot.loginId = null;
    this.slot.identity = null;
    this.slot.usageReadable = false;
    this.slot.state = 'cleaned';
    try { fs.rmSync(this.slot.home, { recursive: true, force: true }); } catch {}
  }
}

async function completeLogin(slot, client) {
  slot.state = 'checking';
  const [accountResult, usageResult] = await Promise.all([
    client.send('account/read', {}),
    client.send('account/rateLimits/read', { excludeResetCreditDetails: true })
  ]);
  slot.identity = accountResult?.account || null;
  slot.usageReadable = !!usageResult?.rateLimits;
  if (!slot.usageReadable) {
    slot.state = 'failed';
    slot.safeError = '認證完成，但官方用量資料不可讀取。';
    return;
  }
  slot.state = 'authenticated';
  slot.safeError = '';
  updateIdentityComparison();
}

function updateIdentityComparison() {
  if (accounts.accountA.state !== 'authenticated' || accounts.accountB.state !== 'authenticated') return;
  identityComparison = compareChatGptIdentity(accounts.accountA.identity, accounts.accountB.identity);
  // Drop account objects as soon as comparison is complete. PII is neither sent to
  // the UI nor written to disk/logs; only the comparison enum remains in memory.
  accounts.accountA.identity = null;
  accounts.accountB.identity = null;
}

function statusPayload() {
  return {
    accounts: {
      accountA: { state: accounts.accountA.state, usageReadable: accounts.accountA.usageReadable, error: accounts.accountA.safeError },
      accountB: { state: accounts.accountB.state, usageReadable: accounts.accountB.usageReadable, error: accounts.accountB.safeError }
    },
    identityComparison
  };
}

function sendJson(res, code, payload) {
  const data = JSON.stringify(payload);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"
  });
  res.end(data);
}

const server = http.createServer(async (req, res) => {
  if (req.headers.host !== `${HOST}:${PORT}`) return sendJson(res, 403, { error: 'Local host rejected' });
  if (req.method === 'GET' && req.url === '/') {
    try {
      const body = fs.readFileSync(UI_PATH);
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length,
        'Cache-Control': 'no-store, max-age=0', 'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
      });
      return res.end(body);
    } catch { res.writeHead(500); return res.end('UI file missing'); }
  }
  if (req.method === 'GET' && req.url === '/api/status') return sendJson(res, 200, statusPayload());
  if (req.method !== 'POST' || !req.url.startsWith('/api/')) return res.writeHead(404).end();
  const origin = req.headers.origin;
  if (origin !== `http://${HOST}:${PORT}`) return sendJson(res, 403, { error: 'Origin rejected' });

  const loginRoute = req.url.match(/^\/api\/(accountA|accountB)\/login\/start$/);
  if (loginRoute) {
    const slot = accounts[loginRoute[1]];
    if (slot.state !== 'idle') return sendJson(res, 409, { error: 'This account slot has already been used; restart the test to retry.' });
    slot.state = 'starting';
    slot.safeError = '';
    slot.client = new CodexAppServer(slot);
    try {
      const result = await slot.client.loginStart();
      slot.state = 'pending';
      return sendJson(res, 200, result);
    } catch {
      slot.state = 'failed';
      slot.safeError = '無法啟動此帳號的官方裝置代碼登入。';
      return sendJson(res, 500, { error: slot.safeError });
    }
  }

  const cancelRoute = req.url.match(/^\/api\/(accountA|accountB)\/login\/cancel$/);
  if (cancelRoute) {
    const slot = accounts[cancelRoute[1]];
    if (slot.client) await slot.client.cleanup();
    slot.state = 'cancelled';
    return sendJson(res, 200, { state: slot.state });
  }

  if (req.url === '/api/cleanup') {
    for (const slot of Object.values(accounts)) {
      if (slot.client) await slot.client.cleanup();
      else {
        slot.state = 'cleaned';
        try { fs.rmSync(slot.home, { recursive: true, force: true }); } catch {}
      }
    }
    try { fs.rmSync(SCRATCH_ROOT, { recursive: true, force: true }); } catch {}
    identityComparison = 'pending';
    return sendJson(res, 200, { state: 'cleaned', scratchProfilesRemoved: true });
  }
  return res.writeHead(404).end();
});

// This exact directory is dedicated to this disposable two-profile test.
// Removing stale test credentials is safe; never point this constant at the user's normal CODEX_HOME.
fs.rmSync(SCRATCH_ROOT, { recursive: true, force: true });
server.listen(PORT, HOST, () => console.log(`Codex two-profile isolation UI ready at http://${HOST}:${PORT}`));

async function shutdown() {
  if (closing) return;
  closing = true;
  for (const slot of Object.values(accounts)) {
    if (slot.client) await slot.client.cleanup();
    else { try { fs.rmSync(slot.home, { recursive: true, force: true }); } catch {} }
  }
  try { fs.rmSync(SCRATCH_ROOT, { recursive: true, force: true }); } catch {}
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
