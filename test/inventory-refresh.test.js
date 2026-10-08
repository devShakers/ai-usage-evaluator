'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { requestDiscoveredInventoryWithRefresh } = require('../src/inventory-client');

test('inventory read: a 401 refreshes the token and retries once with it -> recovers', async () => {
  const tokensSeen = [];
  let refreshed = 0;
  const res = await requestDiscoveredInventoryWithRefresh(
    {
      accessToken: 'stale',
      refreshToken: async () => { refreshed++; return { accessToken: 'fresh', hubAccessToken: 'fresh' }; },
    },
    {
      endpoint: 'http://x/discovered-inventory',
      request: async ({ accessToken }) => {
        tokensSeen.push(accessToken);
        return accessToken === 'fresh'
          ? { ok: true, skills: [], agents: [{ name: 'a' }] }
          : { ok: false, reason: 'http-401' };
      },
    },
  );
  assert.equal(res.ok, true);
  assert.equal(refreshed, 1, 'the 401 triggered exactly one refresh');
  assert.deepEqual(tokensSeen, ['stale', 'fresh'], 'retried immediately with the fresh token');
});

test('inventory read: a non-401 failure is NOT retried (surfaced as-is for the caller to flag)', async () => {
  let calls = 0;
  const res = await requestDiscoveredInventoryWithRefresh(
    { accessToken: 'tok', refreshToken: async () => assert.fail('must not refresh on a non-401') },
    {
      endpoint: 'http://x/discovered-inventory',
      request: async () => { calls++; return { ok: false, reason: 'http-500' }; },
    },
  );
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'http-500');
  assert.equal(calls, 1, 'a server error is returned without a retry');
});

test('inventory read: a 401 with no working refresh returns the 401 (no throw)', async () => {
  const res = await requestDiscoveredInventoryWithRefresh(
    { accessToken: 'stale', refreshToken: async () => null },
    {
      endpoint: 'http://x/discovered-inventory',
      request: async () => ({ ok: false, reason: 'http-401' }),
    },
  );
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'http-401');
});
