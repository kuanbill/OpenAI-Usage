const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PROFILE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_ALIAS_LENGTH = 48;

class ProfileStore {
  constructor(rootDir) {
    if (typeof rootDir !== 'string' || rootDir.trim() === '') throw new TypeError('rootDir must be a path');
    this.rootDir = path.resolve(rootDir);
    this.profilesDir = path.join(this.rootDir, 'profiles');
    this.manifestPath = path.join(this.rootDir, 'accounts.json');
    fs.mkdirSync(this.profilesDir, { recursive: true });
    this.accounts = this.#readManifest();
  }

  #readManifest() {
    if (!fs.existsSync(this.manifestPath)) return [];
    let parsed;
    try { parsed = JSON.parse(fs.readFileSync(this.manifestPath, 'utf8')); }
    catch { throw new Error('Account metadata is unreadable; refusing to overwrite it'); }
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.accounts)) {
      throw new Error('Unsupported account metadata format');
    }
    return parsed.accounts.map((item) => {
      if (!item || !PROFILE_ID.test(item.id) || typeof item.alias !== 'string' || typeof item.createdAt !== 'string') {
        throw new Error('Invalid account metadata entry');
      }
      return { id: item.id, alias: item.alias, createdAt: item.createdAt };
    });
  }

  #writeManifest(accounts) {
    fs.mkdirSync(this.rootDir, { recursive: true });
    const tempPath = `${this.manifestPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    const contents = JSON.stringify({ version: 1, accounts }, null, 2);
    try {
      fs.writeFileSync(tempPath, contents, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      fs.renameSync(tempPath, this.manifestPath);
    } catch (error) {
      try { fs.rmSync(tempPath, { force: true }); } catch {}
      throw error;
    }
  }

  #validateId(id) {
    if (typeof id !== 'string' || !PROFILE_ID.test(id)) throw new TypeError('Invalid profile ID');
    return id;
  }

  #validateAlias(alias) {
    if (typeof alias !== 'string') throw new TypeError('Alias must be text');
    const clean = alias.trim();
    if (!clean || [...clean].length > MAX_ALIAS_LENGTH || /[\u0000-\u001f\u007f]/u.test(clean)) {
      throw new TypeError(`Alias must be 1-${MAX_ALIAS_LENGTH} printable characters`);
    }
    if (this.accounts.some((item) => item.alias.toLocaleLowerCase('en-US') === clean.toLocaleLowerCase('en-US'))) {
      throw new Error('An account with this alias already exists');
    }
    return clean;
  }

  addAccount(alias) {
    const cleanAlias = this.#validateAlias(alias);
    const account = { id: crypto.randomUUID(), alias: cleanAlias, createdAt: new Date().toISOString() };
    const home = this.getProfileHome(account.id);
    fs.mkdirSync(home, { recursive: true });
    const next = [...this.accounts, account];
    try { this.#writeManifest(next); }
    catch (error) { try { fs.rmSync(home, { recursive: true, force: true }); } catch {} throw error; }
    this.accounts = next;
    return { ...account };
  }

  listAccounts() {
    return this.accounts.map((item) => ({ ...item }));
  }

  getProfileHome(id) {
    return path.join(this.profilesDir, this.#validateId(id));
  }

  removeAccount(id) {
    this.#validateId(id);
    const index = this.accounts.findIndex((item) => item.id === id);
    if (index < 0) return false;
    const next = this.accounts.filter((item) => item.id !== id);
    fs.rmSync(this.getProfileHome(id), { recursive: true, force: true });
    this.#writeManifest(next);
    this.accounts = next;
    return true;
  }
}

module.exports = { ProfileStore };
