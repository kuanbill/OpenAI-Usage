const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const manifest = require('../package.json');
const { buildCodexEnvironment, resolveCodexExecutable } = require('./codex-runtime.cjs');

test('resolves the bundled Codex binary from app resources after installation', () => {
  const resourcesPath = path.join('C:', 'Program Files', 'OpenAI Usage Dashboard', 'resources');
  assert.equal(
    resolveCodexExecutable({ isPackaged: true, resourcesPath, appPath: 'unused' }),
    path.join(resourcesPath, 'codex', 'bin', 'codex.exe')
  );
});

test('resolves the pinned Windows package binary in development', () => {
  const appPath = path.join('C:', 'work', 'openai-usage-dashboard');
  assert.equal(
    resolveCodexExecutable({ isPackaged: false, resourcesPath: 'unused', appPath }),
    path.join(appPath, 'node_modules', '@openai', 'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe')
  );
});

test('passes only allowlisted system and profile variables to Codex', () => {
  const environment = buildCodexEnvironment({
    Path: 'C:\\Windows\\System32;C:\\Node',
    SystemRoot: 'C:\\Windows',
    TEMP: 'C:\\temp',
    USERPROFILE: 'C:\\Users\\test',
    SSL_CERT_FILE: 'C:\\certs\\root.pem',
    OPENAI_API_KEY: 'test-only-do-not-forward',
    GITHUB_TOKEN: 'test-only-do-not-forward',
    HTTPS_PROXY: 'https://proxy.example.test',
    NODE_OPTIONS: '--require test-only'
  }, 'C:\\profiles\\account-a');

  assert.deepEqual(environment, {
    PATH: 'C:\\Windows\\System32;C:\\Node',
    SYSTEMROOT: 'C:\\Windows',
    TEMP: 'C:\\temp',
    USERPROFILE: 'C:\\Users\\test',
    SSL_CERT_FILE: 'C:\\certs\\root.pem',
    CODEX_HOME: 'C:\\profiles\\account-a'
  });
});

test('copies the pinned Windows Codex runtime to Electron resources outside ASAR', () => {
  const resources = manifest.build.extraResources;
  const runtime = resources.find((resource) => resource.to === 'codex');
  assert.equal(runtime.from, 'node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc');
  assert.deepEqual(runtime.filter, ['**/*']);
  assert.equal(manifest.devDependencies['@openai/codex-win32-x64'], 'npm:@openai/codex@0.163.0-win32-x64');
  const license = resources.find((resource) => resource.to === 'codex/LICENSE-APACHE-2.0.txt');
  assert.equal(license.from, 'third_party_licenses/OPENAI-CODEX-CLI-0.163.0-LICENSE.txt');
  assert.match(fs.readFileSync(path.join(__dirname, '..', license.from), 'utf8'), /Copyright 2025 OpenAI/);
});
