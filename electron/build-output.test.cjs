const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('production asset URLs are relative so Electron can load the file-based build', () => {
  const htmlPath = path.join(__dirname, '..', 'dist', 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const scriptSrc = html.match(/<script[^>]+src="([^"]+)"/)?.[1];
  const stylesheetHref = html.match(/<link[^>]+href="([^"]+)"/)?.[1];
  assert.ok(scriptSrc?.startsWith('./assets/'), `expected relative script path, got ${scriptSrc}`);
  assert.ok(stylesheetHref?.startsWith('./assets/'), `expected relative stylesheet path, got ${stylesheetHref}`);
});

test('production Electron modules resolve when packaged without spikes or tests', () => {
  const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'openai-usage-package-'));
  const packagedElectron = path.join(packageRoot, 'electron');
  fs.mkdirSync(packagedElectron, { recursive: true });
  try {
    for (const entry of fs.readdirSync(__dirname, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.cjs') || entry.name.endsWith('.test.cjs')) continue;
      fs.copyFileSync(path.join(__dirname, entry.name), path.join(packagedElectron, entry.name));
    }
    assert.doesNotThrow(() => require(path.join(packagedElectron, 'usage-adapter.cjs')));
  } finally {
    fs.rmSync(packageRoot, { recursive: true, force: true });
  }
});
