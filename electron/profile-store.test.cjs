const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ProfileStore } = require('./profile-store.cjs');

const scratchBase = path.join(
  process.env.TMPDIR || path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'hermes', 'cache', 'scratch'),
  'usage-dashboard-profile-store-tests'
);

function newRoot(t) {
  fs.mkdirSync(scratchBase, { recursive: true });
  const root = fs.mkdtempSync(path.join(scratchBase, 'case-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('persists aliases and generated IDs while keeping the profile home isolated', (t) => {
  const root = newRoot(t);
  const store = new ProfileStore(root);
  const account = store.addAccount(' Personal ');
  const home = store.getProfileHome(account.id);
  const persisted = fs.readFileSync(path.join(root, 'accounts.json'), 'utf8');
  const reloaded = new ProfileStore(root).listAccounts();

  assert.equal(account.alias, 'Personal');
  assert.match(account.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.equal(path.dirname(home), path.join(root, 'profiles'));
  assert.equal(fs.existsSync(home), true);
  assert.equal(reloaded.length, 1);
  assert.deepEqual(Object.keys(reloaded[0]).sort(), ['alias', 'createdAt', 'id']);
  assert.doesNotMatch(persisted, /access[_-]?token|refresh[_-]?token|password|cookie/i);
});

test('rejects blank, overlong, control-character, and duplicate aliases', (t) => {
  const store = new ProfileStore(newRoot(t));
  assert.throws(() => store.addAccount('   '), /alias/i);
  assert.throws(() => store.addAccount('x'.repeat(49)), /alias/i);
  assert.throws(() => store.addAccount('bad\nname'), /alias/i);
  store.addAccount('Work');
  assert.throws(() => store.addAccount(' work '), /already exists/i);
});

test('rejects path traversal IDs and removes only the selected profile', (t) => {
  const root = newRoot(t);
  const store = new ProfileStore(root);
  const first = store.addAccount('Personal');
  const second = store.addAccount('Work');
  assert.throws(() => store.getProfileHome('../outside'), /invalid/i);
  assert.throws(() => store.removeAccount('../outside'), /invalid/i);
  fs.writeFileSync(path.join(store.getProfileHome(first.id), 'test-marker'), 'fixture');
  fs.writeFileSync(path.join(store.getProfileHome(second.id), 'test-marker'), 'fixture');

  assert.equal(store.removeAccount(first.id), true);
  assert.equal(fs.existsSync(path.join(root, 'profiles', first.id)), false);
  assert.equal(fs.existsSync(path.join(root, 'profiles', second.id, 'test-marker')), true);
  assert.deepEqual(store.listAccounts().map((item) => item.id), [second.id]);
});
