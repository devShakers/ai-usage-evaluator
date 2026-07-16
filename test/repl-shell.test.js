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
  assert.match(out.buf, /Welcome to shakers/); // boxed header present
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

test('renderBanner (wide): colour off yields a plain, accent-free boxed header', () => {
  const banner = renderBanner({ version: '1.0.0', color: false, width: 90 });
  assert.ok(!banner.includes('\x1b['), 'no ANSI when colour is off');
  // Rounded box with the title embedded in the top border.
  assert.match(banner, /╭─ sh-eval · v1\.0\.0 ─+╮/);
  assert.match(banner, /╰─+╯/);
  // Two-column content: welcome + product line on the left, a "what it is"
  // summary + Commands/Getting started on the right.
  assert.match(banner, /Welcome to shakers/);
  assert.match(banner, /AI Usage Evaluator/);
  assert.match(banner, /A local-first CLI to understand and/);
  assert.match(banner, /level up how you work with AI\./);
  assert.match(banner, /Commands/);
  assert.match(banner, /footprint/);
  assert.match(banner, /certify/);
  assert.match(banner, /Getting started/);
  assert.match(banner, /Type footprint or certify · help · exit/);
});

test('renderBanner (narrow): degrades to a single stacked column without crashing', () => {
  const banner = renderBanner({ version: '1.0.0', color: false, width: 60 });
  assert.ok(!banner.includes('\x1b['));
  assert.match(banner, /╭─ sh-eval · v1\.0\.0 ─+╮/);
  assert.match(banner, /Welcome to shakers/);
  assert.match(banner, /Commands/);
  assert.match(banner, /footprint/);
  assert.match(banner, /certify/);
  // Every visible line stays within the terminal width (no overflow).
  for (const l of banner.split('\n')) assert.ok(l.length <= 60, `line too wide: ${JSON.stringify(l)}`);
});

test('renderPrompt: the Shakers bolt precedes the command prompt, teal when coloured', () => {
  const prompt = renderPrompt({ lang: 'en', color: false });
  // Shakers lightning bolt (ϟ) precedes the command prompt.
  assert.match(prompt, /ϟ sh-eval ›/);
  assert.ok(!prompt.includes('\x1b['));

  // Colour on emits truecolour escapes.
  assert.ok(renderPrompt({ lang: 'en', color: true }).includes('\x1b[38;2;'));
});
