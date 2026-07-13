'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseCertifyArgs } = require('../src/certify-args');

/*
 * skill-code-certification, issue 004: arg parsing for the `ai-certify`
 * binary. Kept separate from cli-args.js (ai-footprint) — different surface.
 */

test('parseCertifyArgs: defaults', () => {
  const opts = parseCertifyArgs([]);
  assert.equal(opts.root, null);
  assert.equal(opts.email, null);
  assert.equal(opts.lang, null);
  assert.equal(opts.acceptDisclaimer, false);
  assert.equal(opts.help, false);
});

test('parseCertifyArgs: --root (space and = forms)', () => {
  assert.equal(parseCertifyArgs(['--root', '../other']).root, '../other');
  assert.equal(parseCertifyArgs(['--root=../other']).root, '../other');
});

test('parseCertifyArgs: --email (space and = forms)', () => {
  assert.equal(parseCertifyArgs(['--email', 'a@b.com']).email, 'a@b.com');
  assert.equal(parseCertifyArgs(['--email=a@b.com']).email, 'a@b.com');
});

test('parseCertifyArgs: --lang es|en, unrecognized -> null', () => {
  assert.equal(parseCertifyArgs(['--lang', 'es']).lang, 'es');
  assert.equal(parseCertifyArgs(['--lang=en']).lang, 'en');
  assert.equal(parseCertifyArgs(['--lang', 'fr']).lang, null);
  assert.equal(parseCertifyArgs(['--lang=de']).lang, null);
});

test('parseCertifyArgs: --accept-disclaimer is an explicit, standalone flag (never implied)', () => {
  assert.equal(parseCertifyArgs(['--accept-disclaimer']).acceptDisclaimer, true);
  assert.equal(parseCertifyArgs([]).acceptDisclaimer, false);
  // Not implied by any other flag.
  assert.equal(parseCertifyArgs(['--email', 'a@b.com']).acceptDisclaimer, false);
});

test('parseCertifyArgs: --help/-h', () => {
  assert.equal(parseCertifyArgs(['--help']).help, true);
  assert.equal(parseCertifyArgs(['-h']).help, true);
});

test('parseCertifyArgs: --all / --skills / --html (certify-phase flags)', () => {
  assert.equal(parseCertifyArgs(['--all']).all, true);
  assert.equal(parseCertifyArgs(['--skills', '1,3']).skills, '1,3');
  assert.equal(parseCertifyArgs(['--skills=2']).skills, '2');
  assert.equal(parseCertifyArgs(['--html']).html, true);
  assert.equal(parseCertifyArgs(['-w']).html, true);
  assert.equal(parseCertifyArgs([]).all, false);
});

test('parseCertifyArgs: ai-footprint-only flags are NOT recognized here (no cross-contamination)', () => {
  const opts = parseCertifyArgs(['--json', '--no-save', '--build-next-level']);
  assert.equal('json' in opts, false);
  assert.equal('buildNextLevel' in opts, false);
  assert.equal('save' in opts, false);
});
