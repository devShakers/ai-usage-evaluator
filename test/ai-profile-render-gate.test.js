'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { shouldRenderAiProfile, maybeRenderAiProfile } = require('../src/usage-run-steps');
const { getCatalog } = require('../src/i18n');
const { normalizeProfile } = require('../src/ai-profile-preview');

// The "My work with AI" note (being-evaluated / setup-only) must NOT appear when
// this run's ai-usage submit failed — it would contradict the "could not send
// your report" message. A profile that is already `ready` still shows.

test('submit ok -> the note shows for any profile status', () => {
  assert.equal(shouldRenderAiProfile({ submitOk: true, status: 'pending' }), true);
  assert.equal(shouldRenderAiProfile({ submitOk: true, status: 'unavailable' }), true);
  assert.equal(shouldRenderAiProfile({ submitOk: true, status: 'ready' }), true);
});

test('submit failed -> suppress unless the profile is already ready', () => {
  assert.equal(shouldRenderAiProfile({ submitOk: false, status: 'pending' }), false, 'no "being evaluated" when nothing was sent');
  assert.equal(shouldRenderAiProfile({ submitOk: false, status: 'unavailable' }), false);
  assert.equal(shouldRenderAiProfile({ submitOk: false, status: null }), false);
  assert.equal(shouldRenderAiProfile({ submitOk: false, status: 'ready' }), true, 'a prior successful submit already produced a profile');
});

const READY_PREVIEW = normalizeProfile({
  setup: { tier: 'T7', level: 'ORCHESTRATED' },
  usage: { level: 'DELIBERATE' },
  cell: 'AI Native',
  vision: { text: 'AI augments craft.' },
  howIWork: { body: 'I pair with agents on every task.' },
});

function gateDeps({ resolve, out }) {
  return {
    resolve,
    out,
    spin: (_label, task) => task(),
    loadSession: () => ({ accessToken: 'a', hubAccessToken: 'h', expiresAt: new Date(Date.now() + 3600e3).toISOString() }),
    consentDecision: () => 'granted',
  };
}

test('maybeRenderAiProfile: profile populated -> renders the full matrix/vision/how-I-work block', async () => {
  const lines = [];
  await maybeRenderAiProfile(
    { report: {}, maturity: {}, lang: 'en', root: null, save: false, submitOk: true, catalog: getCatalog('en') },
    gateDeps({ resolve: async () => ({ status: 'ready', preview: READY_PREVIEW }), out: { write: (s) => lines.push(s) } }),
  );
  const text = lines.join('');
  assert.match(text, /AI Native/);
  assert.match(text, /AI augments craft\./);
  assert.match(text, /I pair with agents on every task\./);
});

test('maybeRenderAiProfile: still pending after the window -> prints the fallback, never silently drops it', async () => {
  const lines = [];
  await maybeRenderAiProfile(
    { report: {}, maturity: {}, lang: 'en', root: null, save: false, submitOk: true, catalog: getCatalog('en') },
    gateDeps({ resolve: async () => ({ status: 'pending', preview: null }), out: { write: (s) => lines.push(s) } }),
  );
  assert.match(lines.join(''), /still being generated; re-run `report`/);
});
