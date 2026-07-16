'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { oscLink } = require('../src/osc-link');

const OSC = '\x1b]8;;';
const ST = '\x1b\\';

test('oscLink: wraps label in the OSC 8 hyperlink sequence', () => {
  const out = oscLink('https://example.com', 'click me');
  assert.equal(out, `${OSC}https://example.com${ST}click me${OSC}${ST}`);
});

test('oscLink: defaults the visible label to the URL itself (graceful degradation shows the URL)', () => {
  const url = 'file:///Users/x/report.html';
  const out = oscLink(url);
  assert.equal(out, `${OSC}${url}${ST}${url}${OSC}${ST}`);
  // The URL appears BOTH as the target and as the visible label, so a terminal
  // without OSC 8 support still renders a readable URL.
  assert.ok(out.includes(url));
});

test('oscLink: empty/nullish URL returns just the label (no escapes)', () => {
  assert.equal(oscLink('', 'x'), 'x');
  assert.equal(oscLink(null, 'x'), 'x');
  assert.equal(oscLink(undefined), '');
});

test('oscLink: does NOT re-encode an already-encoded file:// URL', () => {
  // pathToFileURL already percent-encodes; oscLink must pass it through verbatim.
  const url = 'file:///Users/x/My%20Reports/report%20(1).html';
  const out = oscLink(url);
  assert.ok(out.includes(`${OSC}${url}${ST}`));
  assert.equal(out.includes('%2520'), false, 'no double-encoding');
});

test('oscLink: label may carry ANSI colour codes (link text can be coloured)', () => {
  const colored = '\x1b[38;2;14;125;105mhttps://s.co\x1b[0m';
  const out = oscLink('https://s.co', colored);
  assert.equal(out, `${OSC}https://s.co${ST}${colored}${OSC}${ST}`);
});
