'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const {
  tokenize,
  parseCommandLine,
  dispatchCommand,
  runRepl,
  renderBanner,
  renderPrompt,
} = require('../src/repl-shell');
const { getCatalog } = require('../src/i18n');

// Captures writes so we can assert on the shell chrome.
function capture() {
  const out = { buf: '', write(s) { this.buf += s; } };
  return out;
}

// Fake shared reader: a scripted line queue + isEnded() (true once exhausted),
// mirroring src/repl-stdin.js's contract without a real readline.
function fakeStdin(lines) {
  let i = 0;
  const ask = () => Promise.resolve(i < lines.length ? lines[i++] : '');
  ask.isEnded = () => i >= lines.length;
  return ask;
}

test('tokenize honours quotes so a path with spaces survives', () => {
  assert.deepStrictEqual(tokenize('footprint --root "/my project"'), ['footprint', '--root', '/my project']);
  assert.deepStrictEqual(tokenize("certify --skills '1,3'"), ['certify', '--skills', '1,3']);
  assert.deepStrictEqual(tokenize('   '), []);
});

test('parseCommandLine lower-cases the command, preserves arg case', () => {
  assert.deepStrictEqual(parseCommandLine('FootPrint --root /X'), { command: 'footprint', args: ['--root', '/X'] });
  assert.deepStrictEqual(parseCommandLine(''), { command: '', args: [] });
});

test('dispatch: footprint/certify route to deps with args + shared ask', async () => {
  const catalog = getCatalog('en');
  const calls = [];
  const ask = fakeStdin([]);
  const deps = {
    runFootprint: (args, ctx) => { calls.push(['fp', args, ctx.ask === ask]); },
    runCertify: (args, ctx) => { calls.push(['cert', args, ctx.ask === ask]); },
  };
  const out = capture();

  await dispatchCommand({ command: 'footprint', args: ['--json'] }, { ask, catalog, deps, out });
  await dispatchCommand({ command: 'certify', args: ['--all'] }, { ask, catalog, deps, out });

  assert.deepStrictEqual(calls, [
    ['fp', ['--json'], true],
    ['cert', ['--all'], true],
  ]);
});

test('dispatch: exit/quit end the loop, help/clear/unknown continue', async () => {
  const catalog = getCatalog('en');
  const deps = { runFootprint() {}, runCertify() {} };
  const out = capture();

  assert.deepStrictEqual(await dispatchCommand({ command: 'exit', args: [] }, { ask: fakeStdin([]), catalog, deps, out }), { exit: true });
  assert.deepStrictEqual(await dispatchCommand({ command: 'quit', args: [] }, { ask: fakeStdin([]), catalog, deps, out }), { exit: true });
  assert.deepStrictEqual(await dispatchCommand({ command: 'help', args: [] }, { ask: fakeStdin([]), catalog, deps, out }), { exit: false });
  assert.deepStrictEqual(await dispatchCommand({ command: 'clear', args: [] }, { ask: fakeStdin([]), catalog, deps, out }), { exit: false });

  const r = await dispatchCommand({ command: 'bogus', args: [] }, { ask: fakeStdin([]), catalog, deps, out });
  assert.deepStrictEqual(r, { exit: false });
  assert.match(out.buf, /bogus/);
});

test('runRepl: banner, dispatch, clean exit on "exit"', async () => {
  const out = capture();
  const fpArgs = [];
  await runRepl({
    stdin: fakeStdin(['footprint --json', 'exit']),
    deps: { runFootprint: (a) => fpArgs.push(a), runCertify() {} },
    lang: 'en',
    version: '9.9.9',
    out,
    color: false,
  });
  assert.deepStrictEqual(fpArgs, [['--json']]);
  assert.match(out.buf, /SHAKERS|S H A K E R S|____/); // wordmark present
  assert.match(out.buf, /See you soon\./); // goodbye
});

test('runRepl: EOF (no explicit exit) ends cleanly', async () => {
  const out = capture();
  await runRepl({
    stdin: fakeStdin(['help']), // no exit -> exhausts -> EOF
    deps: { runFootprint() {}, runCertify() {} },
    lang: 'en',
    out,
    color: false,
  });
  assert.match(out.buf, /available commands/);
  assert.match(out.buf, /See you soon\./);
});

test('renderBanner/renderPrompt: colour off yields plain, accent-free chrome', () => {
  const banner = renderBanner({ lang: 'en', version: '1.0.0', color: false });
  assert.ok(!banner.includes('\x1b['), 'no ANSI when colour is off');
  assert.match(banner, /Local AI tooling/);
  assert.match(banner, /v1\.0\.0/);

  const prompt = renderPrompt({ lang: 'en', color: false });
  assert.match(prompt, /shakers ›/);
  assert.ok(!prompt.includes('\x1b['));

  // Colour on emits truecolour escapes.
  assert.ok(renderPrompt({ lang: 'en', color: true }).includes('\x1b[38;2;'));
});
