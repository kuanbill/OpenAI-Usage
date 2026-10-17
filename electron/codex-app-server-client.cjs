const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const readline = require('node:readline');
const { spawn, spawnSync } = require('node:child_process');
const { buildCodexEnvironment } = require('./codex-runtime.cjs');

const CLI_VERSION = '0.163.0';

class CodexAppServerClient extends EventEmitter {
  constructor({ codexHome, codexExecutable, spawnImpl = spawn, spawnSyncImpl = spawnSync, environment = process.env, platform = process.platform }) {
    super();
    if (typeof codexHome !== 'string' || !codexHome.trim()) throw new TypeError('CODEX_HOME is required');
    if (typeof codexExecutable !== 'string' || !codexExecutable.trim()) throw new TypeError('Bundled Codex executable is required');
    this.codexHome = codexHome;
    this.codexExecutable = codexExecutable;
    this.environment = environment;
    this.spawnImpl = spawnImpl;
    this.spawnSyncImpl = spawnSyncImpl;
    this.platform = platform;
    this.process = null;
    this.requestId = 0;
    this.pending = new Map();
    this.startPromise = null;
    this.closed = false;
  }

  async start() {
    if (this.closed) throw new Error('Codex App Server client is closed');
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.#startProcess();
    try { await this.startPromise; }
    catch (error) { this.startPromise = null; throw error; }
  }

  onNotification(listener) {
    if (typeof listener !== 'function') throw new TypeError('Notification listener is required');
    this.on('notification', listener);
    return () => this.removeListener('notification', listener);
  }

  async #startProcess() {
    if (this.platform !== 'win32') throw new Error('This app-server adapter currently supports Windows only');
    fs.mkdirSync(this.codexHome, { recursive: true });
    const child = this.spawnImpl(this.codexExecutable, ['app-server', '--stdio'], {
      stdio: ['pipe', 'pipe', 'ignore'],
      env: buildCodexEnvironment(this.environment, this.codexHome),
      windowsHide: true
    });
    this.process = child;
    const lines = readline.createInterface({ input: child.stdout });
    lines.on('line', (line) => this.#handleLine(line));
    child.on('exit', (code) => {
      for (const entry of this.pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(new Error('Codex App Server stopped'));
      }
      this.pending.clear();
      this.process = null;
      this.startPromise = null;
      this.emit('exit', code);
    });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Codex App Server startup timed out')), 30000);
      child.once('spawn', () => { clearTimeout(timer); resolve(); });
      child.once('error', () => { clearTimeout(timer); reject(new Error('Codex App Server could not start')); });
    });
    await this.request('initialize', {
      clientInfo: { name: 'openai-usage-dashboard', title: 'OpenAI Usage Dashboard', version: '0.1.0' },
      capabilities: { experimentalApi: false }
    });
    this.notify('initialized', {});
  }

  #handleLine(line) {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (message.id !== undefined && this.pending.has(message.id)) {
      const entry = this.pending.get(message.id);
      this.pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error('Codex App Server request failed'));
      else entry.resolve(message.result);
      return;
    }
    if (typeof message.method === 'string') this.emit('notification', message.method, message.params || {});
  }

  request(method, params = {}) {
    return new Promise((resolve, reject) => {
      if (!this.process || !this.process.stdin?.writable || this.closed) return reject(new Error('Codex App Server unavailable'));
      const id = ++this.requestId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Codex App Server request timed out'));
      }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.process.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); }
      catch {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new Error('Codex App Server request failed'));
      }
    });
  }

  notify(method, params = {}) {
    if (!this.process || !this.process.stdin?.writable || this.closed) return false;
    try {
      this.process.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
      return true;
    } catch { return false; }
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    const child = this.process;
    this.process = null;
    if (!child) return;
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error('Codex App Server stopped'));
    }
    this.pending.clear();
    try {
      if (this.platform === 'win32' && child.pid) {
        this.spawnSyncImpl('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', timeout: 5000, windowsHide: true });
      } else if (typeof child.kill === 'function') child.kill();
    } catch {}
  }
}

module.exports = { CodexAppServerClient, CODEX_CLI_VERSION: CLI_VERSION };
