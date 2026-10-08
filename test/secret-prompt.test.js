'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { PassThrough } = require('stream');

const { readSecretRaw, canPromptSecretly } = require('../src/secret-prompt');

// Issue 102 — a secret prompt must not paint what you type.

/* ---------------- the raw reader's own contract ---------------- */

function fakeTty() {
  const s = new PassThrough();
  s.isTTY = true;
  s.raw = [];
  s.setRawMode = (v) => { s.raw.push(v); return s; };
  return s;
}
function sink() {
  const s = new PassThrough();
  s.written = [];
  s.write = (c) => { s.written.push(String(c)); return true; };
  return s;
}

test('102: the typed value is returned but never written to the output', async () => {
  const input = fakeTty();
  const output = sink();
  const p = readSecretRaw({ input, output });
  input.write('hunter2\r');
  assert.equal(await p, 'hunter2');
  // The ONLY thing written is the newline that ends the line.
  assert.deepEqual(output.written, ['\n']);
  assert.equal(output.written.join('').includes('hunter2'), false, 'the secret reached the screen');
});

test('102: raw mode is entered and ALWAYS left, in that order', async () => {
  const input = fakeTty();
  const p = readSecretRaw({ input, output: sink() });
  input.write('x\r');
  await p;
  assert.deepEqual(input.raw, [true, false], 'raw mode must be turned on and then off');
  assert.equal(input.listenerCount('data'), 0, 'the data listener must be removed');
});

test('102: Ctrl-C and Ctrl-D cancel, and STILL restore the terminal', async () => {
  for (const key of ['\u0003', '\u0004']) {
    const input = fakeTty();
    const p = readSecretRaw({ input, output: sink() });
    input.write(`partial${key}`);
    assert.equal(await p, null, 'cancelling returns null, not a partial secret');
    assert.deepEqual(input.raw, [true, false], `${JSON.stringify(key)}: raw mode was left on`);
    assert.equal(input.listenerCount('data'), 0);
  }
});

test('102: backspace edits the value, and prints nothing when unmasked', async () => {
  const input = fakeTty();
  const output = sink();
  const p = readSecretRaw({ input, output });
  input.write('abcd\r');
  assert.equal(await p, 'abd');
  assert.deepEqual(output.written, ['\n'], 'an unmasked prompt draws nothing at all');
});

test('102: a mask draws one character per keystroke and never the value', async () => {
  const input = fakeTty();
  const output = sink();
  const p = readSecretRaw({ input, output, mask: '*' });
  input.write('abc\r');
  await p;
  const drawn = output.written.join('');
  assert.equal(drawn.includes('abc'), false);
  assert.equal((drawn.match(/\*/g) || []).length, 3);
});

test('102: control characters never land inside the secret', async () => {
  // Arrow keys arrive as escape sequences; without the filter they would be stored.
  const input = fakeTty();
  const p = readSecretRaw({ input, output: sink() });
  input.write('a\u001b[Ab\r');
  const v = await p;
  assert.equal(/\u001b/.test(v), false, 'an escape byte got into the value');
  assert.match(v, /^a\[?Ab$/, `unexpected value: ${JSON.stringify(v)}`);
});

test('102: a pipe is never put into raw mode — the deliberate non-interactive way in', () => {
  // `ba7ad47` kept the stdin pipe as the alternative to argv, so it must keep
  // working: `setRawMode` does not exist there and there is no echo to suppress.
  const pipe = new PassThrough();
  assert.equal(canPromptSecretly(pipe), false);
  assert.equal(canPromptSecretly(null), false);
  const tty = fakeTty();
  assert.equal(canPromptSecretly(tty), true);
});

/* ---------------- the reader exposes it ---------------- */

test('102: the standalone reader exposes ask.secret', () => {
  const { createStdinAsk } = require('../src/stdin-ask');
  const standalone = createStdinAsk();
  assert.equal(typeof standalone.secret, 'function', 'the standalone reader needs it too');
  standalone.close();
});

/* ---------------- pty: what was actually broken ---------------- */

const REPO = path.join(__dirname, '..');
function haveExpect() {
  try { return fs.existsSync('/usr/bin/expect'); } catch { return false; }
}

// Drives one of the two readers under a real pty: types a secret, ENTER (or Ctrl-C),
// then a visible value, and returns everything the pty carried.
function underPty({ interrupt = false }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-eval-secret-'));
  const probe = path.join(dir, 'probe.js');
  const driver = path.join(dir, 'drive.exp');
  fs.writeFileSync(probe, `
const { createStdinAsk } = require(${JSON.stringify(path.join(REPO, 'src/stdin-ask.js'))});
const ask = createStdinAsk();
(async () => {
  const secret = await ask.secret('Secret:');
  process.stdout.write('\\n[SECRET]' + JSON.stringify(secret) + '\\n');
  const visible = await ask('Visible:');
  process.stdout.write('\\n[VISIBLE]' + JSON.stringify(visible) + '\\n');
  ask.close();
  process.exit(0);
})();
`);
  fs.writeFileSync(driver, [
    'set timeout 20',
    'log_user 1',
    `spawn -noecho env NO_COLOR=1 node ${probe}`,
    'expect -re "Secret:"',
    'sleep 0.4',
    'send -- "SEKRET-1234"',
    'sleep 0.4',
    interrupt ? 'send -- "\\003"' : 'send -- "\\r"',
    'sleep 0.6',
    'send -- "visible-text\\r"',
    'sleep 0.9',
    'expect eof',
  ].join('\n'));
  const r = spawnSync('/usr/bin/expect', [driver], { encoding: 'utf8', timeout: 40000 });
  fs.rmSync(dir, { recursive: true, force: true });
  return `${r.stdout || ''}${r.stderr || ''}`;
}

for (const reader of ['ask']) {
  test(`102 (pty) [${reader}]: the secret is NOT painted, and the echo comes back`, (t) => {
    if (!haveExpect()) { t.skip('/usr/bin/expect not available'); return; }
    const out = underPty({});
    const beforeMarker = out.split('[SECRET]')[0];
    const after = out.split('[SECRET]')[1] || '';

    // 1. THE BUG: the typed secret must not appear in the bytes the terminal carried.
    assert.equal(/SEKRET-1234/.test(beforeMarker), false,
      `the secret was painted: ${JSON.stringify(beforeMarker.slice(-160))}`);
    // 2. And it was still READ correctly — suppressing the echo must not lose input.
    assert.match(out, /\[SECRET\]"SEKRET-1234"/);
    // 3. THE OTHER HALF: the echo is restored, so the next value is visible...
    assert.match(after, /visible-text/, 'the echo did not come back — mute terminal');
    assert.match(out, /\[VISIBLE\]"visible-text"/);
  });

  test(`102 (pty) [${reader}]: Ctrl-C inside the prompt still restores the terminal`, (t) => {
    if (!haveExpect()) { t.skip('/usr/bin/expect not available'); return; }
    const out = underPty({ interrupt: true });
    // Cancelling yields nothing, never a partial secret...
    assert.match(out, /\[SECRET\]""/);
    assert.equal(/SEKRET-1234/.test(out.split('[SECRET]')[0]), false, 'the partial secret was painted');
    // ...and the terminal is usable afterwards, which is the criterion that guards
    // against the badly-made fix rather than against the bug.
    assert.match(out, /visible-text/, 'after Ctrl-C the terminal stayed mute');
  });
}
