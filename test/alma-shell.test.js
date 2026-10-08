'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { getCatalog } = require('../src/i18n');
const { runAlmaShell } = require('../src/alma-shell');

function scriptedAsk(lines) {
  let i = 0;
  return async () => (i < lines.length ? lines[i++] : 'salir');
}

function fakeIo(lines) {
  const out = [];
  let i = 0;
  return {
    out,
    ask: async () => (i < lines.length ? lines[i++] : 'exit'),
    notify: (t) => out.push(`notify:${t}`),
    section: (t) => out.push(`section:${t}`),
    warn: (t) => out.push(`warn:${t}`),
    error: (t) => out.push(`error:${t}`),
  };
}

function confirmDeps({ chat, onDecide }) {
  const decided = [];
  return {
    decided,
    deps: {
      askAlma: async ({ onEvent }) => { chat(onEvent); return { ok: true, text: '' }; },
      decideAlma: async ({ approved, onEvent }) => {
        decided.push(approved);
        if (onDecide) onDecide(onEvent);
        return { ok: true, text: 'listo' };
      },
      startSpinner: () => () => {},
      makeStreamReveal: () => ({ push: () => {}, end: async () => {} }),
      withStatus: (_label, fn) => fn(),
      collectContextBlock: () => '',
      sleep: async () => {},
    },
  };
}

function fakeDeps({ askResults }) {
  const sent = [];
  let call = 0;
  return {
    sent,
    deps: {
      askAlma: async ({ hubAccessToken, message, onEvent }) => {
        sent.push({ hubAccessToken, message });
        const r = askResults[call++] || { ok: true, text: 'ok' };
        if (r.ok && onEvent) onEvent({ type: 'text_delta', text: r.text });
        return r;
      },
      startSpinner: () => () => {},
      makeStreamReveal: () => ({ push: () => {}, end: async () => {} }),
      withStatus: (_label, fn) => fn(),
      collectContextBlock: () => '<project-context>repo=demo</project-context>',
      sleep: async () => {},
    },
  };
}

test('alma shell: with context consent granted, turn 1 carries repo context, turn 2 is the bare message, both via the same session', async () => {
  // First line answers the context-consent selector (numbered fallback: "1" = yes).
  const io = fakeIo(['1', 'hola', 'y esto?', 'salir']);
  const { sent, deps } = fakeDeps({ askResults: [{ ok: true, text: 'r1' }, { ok: true, text: 'r2' }] });
  const head = [];

  const res = await runAlmaShell({
    io,
    stdinIsTTY: true,
    rawOut: (s) => head.push(s),
    streamIsTTY: false,
    env: {},
    session: { hubAccessToken: 'H' },
    catalog: getCatalog('es'),
    deps,
  });

  assert.equal(res.ok, true);
  const header = head.join('');
  assert.match(header, /⚡/, 'branded header carries the lightning bolt');
  assert.match(header, /█/, 'big ASCII banner is rendered');
  assert.match(header, /Alma/, 'the Alma title line is shown under the banner');
  assert.equal(sent.length, 2, 'the two messages are sent; "salir" exits without a turn');
  assert.match(sent[0].message, /<project-context>/, 'first turn carries the repo context');
  assert.match(sent[0].message, /hola$/);
  assert.doesNotMatch(sent[1].message, /<project-context>/, 'later turns rely on the server-side conversation, not re-sent context');
  assert.equal(sent[1].message, 'y esto?');
  assert.equal(sent[0].hubAccessToken, 'H');
  assert.equal(sent[1].hubAccessToken, 'H', 'same session Bearer across turns → Alma continues the same conversation server-side');
});

test('alma shell: declining context consent sends the first turn WITHOUT the repo context', async () => {
  // "2" answers the consent selector = no.
  const io = fakeIo(['2', 'hola', 'salir']);
  const { sent, deps } = fakeDeps({ askResults: [{ ok: true, text: 'r1' }] });
  const head = [];
  const res = await runAlmaShell({
    io, stdinIsTTY: true, rawOut: (s) => head.push(s), streamIsTTY: false, env: {},
    session: { hubAccessToken: 'H' }, catalog: getCatalog('es'), deps,
  });
  assert.equal(res.ok, true);
  assert.equal(sent.length, 1);
  assert.doesNotMatch(sent[0].message, /<project-context>/, 'no context is sent when consent is declined');
  assert.equal(sent[0].message, 'hola');
  assert.ok(io.out.some((l) => /notify:/.test(l)), 'a declined note is shown');
});

function fakeJwt(payload) {
  const seg = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${seg({ alg: 'none' })}.${seg(payload)}.sig`;
}

function capturingAsk(lines) {
  const prompts = [];
  let i = 0;
  const ask = async (p) => { prompts.push(p); return i < lines.length ? lines[i++] : 'salir'; };
  return { ask, prompts };
}

const bareIo = () => ({ out: [], notify: () => {}, section: () => {}, warn: () => {}, error: () => {} });

test('alma shell: prompt uses the first name from the session, Alma reply is labeled INLINE on one line', async () => {
  const { ask, prompts } = capturingAsk(['hola', 'salir']);
  const { deps } = fakeDeps({ askResults: [{ ok: true, text: 'r1' }] });
  const head = [];
  await runAlmaShell({
    io: bareIo(), ask, rawOut: (s) => head.push(s), session: { hubAccessToken: fakeJwt({ name: 'Alex Delgado' }) },
    catalog: getCatalog('es'), deps,
  });
  assert.match(prompts[0], /⚡ Alex:/, 'prompt is the FIRST name only');
  assert.doesNotMatch(prompts[0], /Delgado/, 'never the full name');
  assert.match(head.join(''), /⚡ Alma: r1/, 'the Alma label sits inline before the first reply line');
});

test('alma shell: the message prompt is read through the raw ask (single-indent), same indent as the reply', async () => {
  const { ask, prompts } = capturingAsk(['hola', 'salir']);
  const { deps } = fakeDeps({ askResults: [{ ok: true, text: 'hi' }] });
  const head = [];
  await runAlmaShell({
    io: bareIo(), ask, rawOut: (s) => head.push(s), session: { hubAccessToken: fakeJwt({ name: 'Alex Delgado' }) },
    catalog: getCatalog('es'), deps,
  });
  // The reply line indent (2 spaces before ⚡) is what the prompt indent must equal.
  const replyLine = head.join('').split('\n').find((l) => /⚡ Alma:/.test(l));
  assert.match(replyLine, /^ {2}⚡ Alma:/, 'reply ⚡ sits at column 2');
  assert.match(prompts[0], /⚡ Alex:/);
  assert.doesNotMatch(prompts[0], /^ /, 'the prompt string is unindented; the single ask wrapper adds the same 2 spaces the reply uses, so the two ⚡ align');
});

test('alma shell: a multi-paragraph reply is a HANGING INDENT — later paragraphs align under the first line text, not the ⚡', async () => {
  const { ask } = capturingAsk(['hola', 'salir']);
  const { deps } = fakeDeps({ askResults: [{ ok: true, text: 'First paragraph here.\n\nBy the way, second paragraph.' }] });
  const head = [];
  await runAlmaShell({
    io: bareIo(), ask, rawOut: (s) => head.push(s), session: { hubAccessToken: fakeJwt({ name: 'Alex Delgado' }) },
    catalog: getCatalog('es'), deps,
  });
  const out = head.join('');
  assert.match(out, /^ {2}⚡ Alma: First paragraph here\.$/m, 'label inline on line 0');
  assert.match(out, /^ {11}By the way, second paragraph\.$/m, 'second paragraph hangs under the first line text (display width of "  ⚡ Alma: " = 2 + 2 for ⚡ + 1 + "Alma:"=5 + 1 = 11), not the ⚡ column');
  assert.doesNotMatch(out, /^ {2}By the way/m, 'the continuation is NOT back at the 2-space ⚡ indent');
});

test('alma shell: prompt falls back to the tú/you label when the session carries no name', async () => {
  const { ask, prompts } = capturingAsk(['hola', 'salir']);
  const { deps } = fakeDeps({ askResults: [{ ok: true, text: 'r1' }] });
  await runAlmaShell({ io: bareIo(), ask, rawOut: () => {}, session: { hubAccessToken: 'H' }, catalog: getCatalog('es'), deps });
  assert.match(prompts[0], /tú:/, 'no name → the i18n prompt label');
});

test('alma shell: a failed turn keeps the shell alive (non-fatal), never crashes', async () => {
  const io = fakeIo(['q1', 'q2', 'exit']);
  const { sent, deps } = fakeDeps({ askResults: [{ ok: false, reason: 'network-error' }, { ok: true, text: 'r2' }] });

  const res = await runAlmaShell({
    io,
    rawOut: () => {},
    streamIsTTY: false,
    env: {},
    session: { hubAccessToken: 'H' },
    catalog: getCatalog('en'),
    deps,
  });

  assert.equal(res.ok, true, 'the shell survived the failed turn');
  assert.equal(sent.length, 2, 'it kept going after the failure');
  assert.ok(io.out.some((l) => l.startsWith('error:')), 'the failure was surfaced, not swallowed');
});

test('alma shell: confirmation_required → arrow selector Sí → relays /alma/decision {approved:true}; irreversible is surfaced', async () => {
  const io = fakeIo(['añade React a mi perfil', 'salir']);
  const { decided, deps } = confirmDeps({
    chat: (onEvent) => onEvent({ type: 'confirmation_required', text: 'Añadiré la skill React a tu perfil', detail: 'Esta acción es irreversible' }),
  });
  const out = [];
  const res = await runAlmaShell({
    io, ask: scriptedAsk(['añade React a mi perfil', '1', 'salir']), stdinIsTTY: false, rawOut: (s) => out.push(s), streamIsTTY: false,
    env: {}, session: { hubAccessToken: 'H' }, catalog: getCatalog('es'), deps,
  });
  assert.equal(res.ok, true);
  assert.deepEqual(decided, [true], 'Sí relays approved:true');
  assert.match(out.join(''), /Añadiré la skill React/, 'the confirmation summary is shown');
  assert.ok(io.out.some((l) => l.startsWith('warn:') && /irreversible/i.test(l)), 'irreversible warning surfaced');
});

test('alma shell: confirmation_required → arrow selector No → relays /alma/decision {approved:false}', async () => {
  const io = fakeIo(['borra mi CV', 'salir']);
  const { decided, deps } = confirmDeps({
    chat: (onEvent) => onEvent({ type: 'confirmation_required', text: 'Borraré tu CV', detail: '' }),
  });
  const res = await runAlmaShell({
    io, ask: scriptedAsk(['borra mi CV', '2', 'salir']), stdinIsTTY: false, rawOut: () => {}, streamIsTTY: false,
    env: {}, session: { hubAccessToken: 'H' }, catalog: getCatalog('es'), deps,
  });
  assert.equal(res.ok, true);
  assert.deepEqual(decided, [false], 'No relays approved:false');
});

test('alma shell: a link event prints the web one-liner and never blocks', async () => {
  const io = fakeIo(['llévame a la posición X', 'salir']);
  const { deps } = confirmDeps({ chat: (onEvent) => onEvent({ type: 'link', data: { to: 'position', params: { position_id: 'p1' } } }) });
  const out = [];
  await runAlmaShell({
    io, ask: scriptedAsk(['llévame a la posición X', 'salir']), stdinIsTTY: false, rawOut: (s) => out.push(s), streamIsTTY: false,
    env: {}, session: { hubAccessToken: 'H' }, catalog: getCatalog('es'), deps,
  });
  assert.match(out.join(''), /En la web esto abriría: position/);
});
