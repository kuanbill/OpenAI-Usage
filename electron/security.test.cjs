const test = require('node:test');
const assert = require('node:assert/strict');
const { isAllowedDevNavigation, isAllowedExternalUrl } = require('./security.cjs');

test('permits only the exact local Vite origin during development navigation', () => {
  assert.equal(isAllowedDevNavigation('http://127.0.0.1:5173/src/main.tsx'), true);
  assert.equal(isAllowedDevNavigation('http://127.0.0.1:5173.evil.test/'), false);
  assert.equal(isAllowedDevNavigation('https://127.0.0.1:5173/'), false);
  assert.equal(isAllowedDevNavigation('file:///C:/private.html'), false);
});

test('permits only HTTPS OpenAI and ChatGPT domains for external auth windows', () => {
  assert.equal(isAllowedExternalUrl('https://auth.openai.com/codex/device'), true);
  assert.equal(isAllowedExternalUrl('https://login.chatgpt.com/device'), true);
  assert.equal(isAllowedExternalUrl('https://openai.com.evil.test/'), false);
  assert.equal(isAllowedExternalUrl('https://auth.openai.com:8443/device'), false);
  assert.equal(isAllowedExternalUrl('https://user@auth.openai.com/device'), false);
  assert.equal(isAllowedExternalUrl('http://auth.openai.com/'), false);
  assert.equal(isAllowedExternalUrl('javascript:alert(1)'), false);
});
