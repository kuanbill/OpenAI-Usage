const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const { resolveCodexExecutable } = require('./codex-runtime.cjs');

const appPath = path.resolve(__dirname, '..');
const executable = resolveCodexExecutable({ isPackaged: false, appPath });
const supportedHost = process.platform === 'win32' && process.arch === 'x64' && fs.existsSync(executable);

test('runs the bundled Codex App Server without Node.js or npm on PATH', { skip: !supportedHost }, async (t) => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-dashboard-codex-test-'));
  const tempDir = path.join(profile, 'tmp');
  const codexHome = path.join(profile, 'codex-home');
  fs.mkdirSync(tempDir);
  fs.mkdirSync(codexHome);
  const child = spawn(executable, ['app-server', '--stdio'], {
    env: {
      CODEX_HOME: codexHome,
      HOME: profile,
      USERPROFILE: profile,
      APPDATA: profile,
      LOCALAPPDATA: profile,
      TEMP: tempDir,
      TMP: tempDir,
      SystemRoot: process.env.SystemRoot,
      WINDIR: process.env.WINDIR,
      PATH: path.join(process.env.SystemRoot || 'C:\\Windows', 'System32')
    },
    stdio: ['pipe', 'pipe', 'ignore'],
    windowsHide: true
  });
  const lines = readline.createInterface({ input: child.stdout });
  const pending = new Map();
  let nextId = 0;
  lines.on('line', (line) => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error('Codex App Server returned an error'));
    else request.resolve(message.result);
  });
  t.after(async () => {
    lines.close();
    const waitForExit = (timeoutMs) => new Promise((resolve) => {
      if (child.exitCode !== null) return resolve(true);
      const onExit = () => {
        clearTimeout(timer);
        resolve(true);
      };
      const timer = setTimeout(() => {
        child.removeListener('exit', onExit);
        resolve(false);
      }, timeoutMs);
      child.once('exit', onExit);
    });
    if (child.exitCode === null) {
      child.stdin.end();
      if (!(await waitForExit(5000))) {
        child.kill();
        await waitForExit(5000);
      }
    }
    if (child.exitCode !== null) fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  await new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', () => reject(new Error('Bundled Codex executable could not start')));
  });

  function request(method, params) {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Bundled Codex App Server timed out at ${method}`));
      }, 20000);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  const initialized = await request('initialize', {
    clientInfo: { name: 'openai-usage-dashboard-test', version: '0.1.2' },
    capabilities: { experimentalApi: false }
  });
  assert.ok(initialized);
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'initialized', params: {} })}\n`);
  const account = await request('account/read', { refreshToken: false });
  assert.equal(account.requiresOpenaiAuth, true);
});
