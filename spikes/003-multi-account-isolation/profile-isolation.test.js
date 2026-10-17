const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { getProfileHomes, compareChatGptIdentity } = require('./profile-isolation');

const scratchRoot = 'C:/HermesScratch/codex-two-profile-test';

test('two test accounts map to distinct isolated homes under scratch root', () => {
  const homes = getProfileHomes(scratchRoot);
  const values = Object.values(homes).map(value => path.resolve(value));
  assert.deepEqual(Object.keys(homes), ['accountA', 'accountB']);
  assert.equal(new Set(values).size, 2);
  for (const home of values) {
    assert.notEqual(home, path.resolve(scratchRoot));
    assert.ok(home.startsWith(path.resolve(scratchRoot) + path.sep));
  }
});

test('identity comparison reports distinct normalized ChatGPT emails without returning them', () => {
  const result = compareChatGptIdentity(
    { type: 'chatgpt', email: 'A@example.test', planType: 'plus' },
    { type: 'chatgpt', email: 'b@example.test', planType: 'plus' }
  );
  assert.equal(result, 'different');
});

test('identity comparison treats case-only email differences as the same account', () => {
  assert.equal(
    compareChatGptIdentity(
      { type: 'chatgpt', email: 'Person@example.test' },
      { type: 'chatgpt', email: ' person@EXAMPLE.test ' }
    ),
    'same'
  );
});

test('identity comparison is unavailable when a reliable ChatGPT email is absent', () => {
  assert.equal(compareChatGptIdentity({ type: 'chatgpt', email: null }, { type: 'chatgpt', email: 'b@example.test' }), 'unavailable');
  assert.equal(compareChatGptIdentity({ type: 'apiKey' }, { type: 'chatgpt', email: 'b@example.test' }), 'unavailable');
});
