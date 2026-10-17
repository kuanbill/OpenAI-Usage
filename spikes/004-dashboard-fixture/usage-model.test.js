const test = require('node:test');
const assert = require('node:assert/strict');
const { mapUsageResponse } = require('./usage-model');

test('maps official rate-limit windows without leaking account identity fields', () => {
  const view = mapUsageResponse({
    accountId: 'must-not-escape',
    rateLimits: {
      primary: { usedPercent: 42, resetsAt: 1900000000, windowDurationMins: 300 },
      secondary: { usedPercent: 0, resetsAt: null, windowDurationMins: 10080 }
    },
    rateLimitResetCredits: { availableCount: 2, credits: null }
  }, '2026-10-16T08:00:00.000Z');
  assert.deepEqual(view.primary, { usedPercent: 42, resetsAt: 1900000000, windowDurationMins: 300 });
  assert.deepEqual(view.secondary, { usedPercent: 0, resetsAt: null, windowDurationMins: 10080 });
  assert.equal(view.availableResetCredits, 2);
  assert.equal(Object.hasOwn(view, 'accountId'), false);
});

test('keeps absent usage windows unavailable instead of converting them to zero', () => {
  const view = mapUsageResponse({ rateLimits: { primary: null, secondary: undefined } });
  assert.equal(view.primary, null);
  assert.equal(view.secondary, null);
  assert.equal(view.availableResetCredits, null);
});

test('preserves a real zero reset-credit count and rejects out-of-range usage percentages', () => {
  const view = mapUsageResponse({
    rateLimits: { primary: { usedPercent: 130, resetsAt: null, windowDurationMins: null } },
    rateLimitResetCredits: { availableCount: 0 }
  });
  assert.equal(view.primary, null);
  assert.equal(view.availableResetCredits, 0);
});

test('returns an unavailable model for a malformed or missing response', () => {
  assert.deepEqual(mapUsageResponse(null), {
    primary: null, secondary: null, availableResetCredits: null, syncedAt: null
  });
});
