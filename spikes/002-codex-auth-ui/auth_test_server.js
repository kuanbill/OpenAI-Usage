const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, spawnSync } = require('child_process');
const readline = require('readline');

const HOST = '127.0.0.1';
const PORT = 8765;
const CLI_VERSION = '0.163.0';
const SCRATCH = process.env.TMPDIR || path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'hermes', 'cache', 'scratch');
const CODEX_HOME = path.join(SCRATCH, 'codex-auth-ui-test');
const HTML_PATH = path.join(__dirname, 'index.html');

let proc = null;
let rpcSeq = 0;
let pending = new Map();
let loginId = null;
let loginCompleted = false;
let state = 'idle';
let usageReadable = false;
let lastError = '';
let initPromise = null;

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    if (!proc || !proc.stdin.writable) return reject(new Error('Codex App Server is not running'));
    const id = ++rpcSeq;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error('Codex App Server request timed out'));
    }, 30000);
    pending.set(id, { resolve, reject, timer });
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}

function notify(method, params = {}) {
  if (proc && proc.stdin.writable) proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
}

function handleLine(line) {
  let msg;
  try { msg = JSON.parse(line); } catch { return; } // never log raw subprocess output
  if (msg.id !== undefined && pending.has(msg.id)) {
    const item = pending.get(msg.id);
    pending.delete(msg.id);
    clearTimeout(item.timer);
    if (msg.error) item.reject(new Error(msg.error.message || 'Codex App Server error'));
    else item.resolve(msg.result);
    return;
  }
  if (msg.method === 'account/login/completed') {
    const p = msg.params || {};
    if (p.success) {
      loginCompleted = true;
      state = 'checking';
      send('account/rateLimits/read', { excludeResetCreditDetails: false })
        .then(result => {
          usageReadable = !!(result && result.rateLimits);
          state = usageReadable ? 'authenticated' : 'failed';
          if (!usageReadable) lastError = '登入完成，但用量資料尚不可讀取';
        })
        .catch(() => { state = 'failed'; lastError = '登入完成，但用量讀取失敗'; });
    } else {
      state = 'failed';
      lastError = '官方認證未完成';
    }
  }
}

async function startAppServer() {
  if (initPromise) return initPromise;
  initPromise = new Promise((resolve, reject) => {
    // This profile is isolated from the user's regular Codex home. Clear only this
    // dedicated scratch directory so a prior abandoned test cannot be reused.
    fs.rmSync(CODEX_HOME, { recursive: true, force: true });
    fs.mkdirSync(CODEX_HOME, { recursive: true });
    const command = `npm exec --yes --package=@openai/codex@${CLI_VERSION} -- codex app-server --stdio`;
    proc = spawn('cmd.exe', ['/d', '/s', '/c', command], {
      stdio: ['pipe', 'pipe', 'ignore'],
      env: { ...process.env, CODEX_HOME }
    });
    const rl = readline.createInterface({ input: proc.stdout });
    rl.on('line', handleLine);
    proc.on('error', () => { state = 'failed'; lastError = '無法啟動 Codex App Server'; reject(new Error(lastError)); });
    proc.on('exit', () => {
      for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('Codex App Server stopped')); }
      pending.clear();
      proc = null;
      initPromise = null;
      if (state !== 'cleaned' && state !== 'idle') { state = 'failed'; lastError ||= 'Codex App Server 已停止'; }
    });
    const timer = setTimeout(() => reject(new Error('Codex App Server initialization timed out')), 30000);
    const waitForReady = async () => {
      try {
        await send('initialize', { clientInfo: { name: 'codex-auth-ui-test', title: 'Codex Authentication UI Test', version: '0.1.0' }, capabilities: { experimentalApi: false } });
        notify('initialized', {});
        clearTimeout(timer);
        resolve();
      } catch (e) { clearTimeout(timer); reject(e); }
    };
    // Let the spawned process attach stdio before sending the handshake.
    setTimeout(waitForReady, 500);
  });
  return initPromise;
}

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"
  });
  res.end(data);
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    try {
      const body = fs.readFileSync(HTML_PATH);
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
      });
      return res.end(body);
    } catch { res.writeHead(500); return res.end('UI file missing'); }
  }
  if (req.method === 'GET' && req.url === '/api/status') {
    return json(res, 200, { state, usageReadable, error: lastError });
  }
  if (!['POST'].includes(req.method) || !req.url.startsWith('/api/')) {
    res.writeHead(404); return res.end();
  }
  const origin = req.headers.origin;
  if (origin && origin !== `http://${HOST}:${PORT}`) return json(res, 403, { error: 'Origin rejected' });

  if (req.url === '/api/login/start') {
    if (state !== 'idle') return json(res, 409, { error: 'This one-shot test has already started; clean up and restart to retry' });
    try {
      state = 'starting'; lastError = ''; usageReadable = false;
      await startAppServer();
      const result = await send('account/login/start', { type: 'chatgptDeviceCode' });
      if (!result || result.type !== 'chatgptDeviceCode' || !result.userCode || !result.verificationUrl || !result.loginId) {
        state = 'failed'; lastError = '官方登入流程未回傳預期的裝置代碼資料';
        return json(res, 502, { error: lastError });
      }
      loginId = result.loginId; state = 'pending';
      let safeUrl = '';
      try {
        const u = new URL(result.verificationUrl);
        if (u.protocol === 'https:' && (u.hostname === 'auth.openai.com' || u.hostname.endsWith('.openai.com') || u.hostname === 'chatgpt.com' || u.hostname.endsWith('.chatgpt.com'))) safeUrl = u.href;
      } catch {}
      if (!safeUrl) {
        state = 'failed'; lastError = '驗證網址不是已知的 OpenAI 官方 HTTPS 網域';
        return json(res, 502, { error: lastError });
      }
      // userCode is returned only to the local page, never logged, persisted, or returned by status.
      return json(res, 200, { userCode: result.userCode, verificationUrl: safeUrl });
    } catch (e) {
      state = 'failed'; lastError = e.message || '登入啟動失敗';
      return json(res, 500, { error: lastError });
    }
  }

  if (req.url === '/api/login/cancel') {
    try {
      if (proc && loginId) await send('account/login/cancel', { loginId });
      state = 'cancelled'; loginId = null;
      return json(res, 200, { state });
    } catch {
      state = 'cancelled'; loginId = null;
      return json(res, 200, { state });
    }
  }

  if (req.url === '/api/cleanup') {
    try {
      if (proc && loginCompleted) await send('account/logout', {});
      else if (proc && loginId) await send('account/login/cancel', { loginId });
    } catch {}
    if (proc) {
      try { spawnSync('taskkill.exe', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore', timeout: 5000 }); } catch {}
      proc = null;
    }
    loginId = null; loginCompleted = false; usageReadable = false; state = 'cleaned';
    fs.rmSync(CODEX_HOME, { recursive: true, force: true });
    return json(res, 200, { state, scratchProfileRemoved: true });
  }
  res.writeHead(404); res.end();
});

server.listen(PORT, HOST, () => {
  // Do not print login codes, URLs, account details, or RPC payloads.
  console.log(`Codex auth UI test ready at http://${HOST}:${PORT}`);
});

async function shutdown() {
  try {
    if (proc && loginCompleted) await send('account/logout', {});
    else if (proc && loginId) await send('account/login/cancel', { loginId });
  } catch {}
  try { if (proc) spawnSync('taskkill.exe', ['/PID', String(proc.pid), '/T', '/F'], { stdio: 'ignore', timeout: 5000 }); } catch {}
  try { fs.rmSync(CODEX_HOME, { recursive: true, force: true }); } catch {}
  server.close(() => process.exit(0));
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
