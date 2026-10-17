const test = require('node:test');
const assert = require('node:assert/strict');
const { isTrustedIpcSender } = require('./security.cjs');

test('accepts IPC only from the main dashboard window frame', () => {
  const mainFrame = {};
  const webContents = { mainFrame };
  assert.equal(isTrustedIpcSender({ sender: webContents, senderFrame: mainFrame }, webContents), true);
});

test('rejects IPC from other windows and child frames', () => {
  const mainFrame = {};
  const childFrame = {};
  const webContents = { mainFrame };
  assert.equal(isTrustedIpcSender({ sender: {}, senderFrame: mainFrame }, webContents), false);
  assert.equal(isTrustedIpcSender({ sender: webContents, senderFrame: childFrame }, webContents), false);
  assert.equal(isTrustedIpcSender({ sender: webContents, senderFrame: null }, webContents), false);
});
