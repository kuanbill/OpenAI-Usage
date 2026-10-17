const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('production asset URLs are relative so Electron can load the file-based build', () => {
  const htmlPath = path.join(__dirname, '..', 'dist', 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const scriptSrc = html.match(/<script[^>]+src="([^"]+)"/)?.[1];
  const stylesheetHref = html.match(/<link[^>]+href="([^"]+)"/)?.[1];
  assert.ok(scriptSrc?.startsWith('./assets/'), `expected relative script path, got ${scriptSrc}`);
  assert.ok(stylesheetHref?.startsWith('./assets/'), `expected relative stylesheet path, got ${stylesheetHref}`);
});
