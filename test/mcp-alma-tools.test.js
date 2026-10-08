'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { makeAlmaTools } = require('../src/mcp-alma-tools');

const active = { loadAuthSession: () => ({ hubAccessToken: 'H' }), sessionStatus: () => 'active' };
const byName = (deps) => Object.fromEntries(makeAlmaTools(deps).map((t) => [t.name, t]));

test('alma_chat: returns pendingConfirmation (do-not-auto-execute) when Alma proposes an action', async () => {
  const tools = byName({
    ...active,
    askAlma: async ({ hubAccessToken, message, onEvent }) => {
      assert.equal(hubAccessToken, 'H');
      assert.equal(message, 'sube mi tarifa');
      onEvent({ type: 'confirmation_required', text: 'Cambiaré tu tarifa a 50/h', detail: 'Esta acción es irreversible' });
      onEvent({ type: 'link', data: { to: 'edit_profile', params: { section: 'rate' } } });
      return { ok: true, text: '¿Confirmas?' };
    },
  });
  const out = await tools.alma_chat.handler({ message: 'sube mi tarifa' });
  assert.equal(out.ok, true);
  assert.equal(out.answer, '¿Confirmas?');
  assert.deepEqual(out.pendingConfirmation, { text: 'Cambiaré tu tarifa a 50/h', irreversible: true });
  assert.deepEqual(out.webLinks, ['edit_profile']);
});

test('alma_chat: no pendingConfirmation when Alma just answers', async () => {
  const tools = byName({ ...active, askAlma: async () => ({ ok: true, text: 'Tu tarifa es 40/h.' }) });
  const out = await tools.alma_chat.handler({ message: 'cuál es mi tarifa?' });
  assert.equal(out.answer, 'Tu tarifa es 40/h.');
  assert.equal('pendingConfirmation' in out, false);
  assert.equal('webLinks' in out, false);
});

test('alma_decision: posts the approval to /alma/decision and relays the result', async () => {
  const decided = [];
  const tools = byName({
    ...active,
    decideAlma: async ({ hubAccessToken, approved }) => { assert.equal(hubAccessToken, 'H'); decided.push(approved); return { ok: true, text: 'Listo.' }; },
  });
  const yes = await tools.alma_decision.handler({ approved: true });
  const no = await tools.alma_decision.handler({ approved: false });
  assert.equal(yes.ok, true);
  assert.equal(yes.answer, 'Listo.');
  assert.deepEqual(decided, [true, false]);
});

test('alma_decision: rejects a non-boolean decision', async () => {
  const tools = byName({ ...active, decideAlma: async () => ({ ok: true, text: 'x' }) });
  const out = await tools.alma_decision.handler({});
  assert.equal(out.ok, false);
  assert.equal(out.reason, 'no-decision');
});

test('alma_chat / alma_decision require an active session', async () => {
  const tools = byName({ loadAuthSession: () => null, sessionStatus: () => 'none' });
  await assert.rejects(tools.alma_chat.handler({ message: 'hi' }), /call the login tool/);
  await assert.rejects(tools.alma_decision.handler({ approved: true }), /call the login tool/);
});
