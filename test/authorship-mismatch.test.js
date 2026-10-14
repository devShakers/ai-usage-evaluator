'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { detectAuthorshipMismatch } = require('../src/authorship-mismatch');
const { renderTerminal } = require('../src/render-terminal');

const ACCOUNT = 'ada@shakers.com';
const COMMITS_ZERO_AUTHORED = { commitCount: 40, authoredCommitCount: 0, linesAdded: 100, linesDeleted: 10, velocity: 2, spanDays: 20, filesByType: {} };

function readerFor(map) {
  return (root) => (root in map ? map[root] : null);
}

test('detectAuthorshipMismatch: warns when commits exist, none attributed, and the repo email differs from the account email', () => {
  const out = detectAuthorshipMismatch(['/r'], ACCOUNT, COMMITS_ZERO_AUTHORED, {
    readEmail: readerFor({ '/r': 'ada@gmail.com' }),
  });
  assert.deepEqual(out, { accountEmail: ACCOUNT, emails: ['ada@gmail.com'] });
});

test('detectAuthorshipMismatch: silent when some commit IS attributed to the account (no false alarm)', () => {
  const out = detectAuthorshipMismatch(['/r'], ACCOUNT, { ...COMMITS_ZERO_AUTHORED, authoredCommitCount: 3 }, {
    readEmail: readerFor({ '/r': 'ada@gmail.com' }),
  });
  assert.equal(out, null);
});

test('detectAuthorshipMismatch: silent when there are no commits at all', () => {
  const out = detectAuthorshipMismatch(['/r'], ACCOUNT, { ...COMMITS_ZERO_AUTHORED, commitCount: 0 }, {
    readEmail: readerFor({ '/r': 'ada@gmail.com' }),
  });
  assert.equal(out, null);
});

test('detectAuthorshipMismatch: silent when the account email is unknown (never guesses who "you" are)', () => {
  const out = detectAuthorshipMismatch(['/r'], null, COMMITS_ZERO_AUTHORED, {
    readEmail: readerFor({ '/r': 'ada@gmail.com' }),
  });
  assert.equal(out, null);
});

test('detectAuthorshipMismatch: silent when the repo is configured under the account email (case-insensitive)', () => {
  const out = detectAuthorshipMismatch(['/r'], ACCOUNT, COMMITS_ZERO_AUTHORED, {
    readEmail: readerFor({ '/r': 'ADA@Shakers.com' }),
  });
  assert.equal(out, null);
});

test('detectAuthorshipMismatch: dedupes differing emails across repos and ignores the matching ones', () => {
  const out = detectAuthorshipMismatch(['/a', '/b', '/c'], ACCOUNT, COMMITS_ZERO_AUTHORED, {
    readEmail: readerFor({ '/a': 'ada@gmail.com', '/b': 'ada@gmail.com', '/c': ACCOUNT }),
  });
  assert.deepEqual(out, { accountEmail: ACCOUNT, emails: ['ada@gmail.com'] });
});

test('detectAuthorshipMismatch: silent without gitActivity', () => {
  assert.equal(detectAuthorshipMismatch(['/r'], ACCOUNT, null, { readEmail: readerFor({ '/r': 'x@y.com' }) }), null);
});

test('renderTerminal: the activity block surfaces the authorship warning when report.authorshipMismatch is set', () => {
  const report = {
    generatedAt: '2026-07-10T00:00:00.000Z',
    tools: [],
    environment: { platform: 'darwin', arch: 'arm64', nodeVersion: 'v22.0.0', editorsInstalled: [] },
    technologies: [],
    agents: [],
    gitActivity: COMMITS_ZERO_AUTHORED,
    authorshipMismatch: { accountEmail: ACCOUNT, emails: ['ada@gmail.com'] },
  };
  const maturity = { level: 1, key: 'exploring', name: 'Exploring', score: 20, emoji: 'x', next: 'n' };
  const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
  const en = strip(renderTerminal(report, maturity, 'en'));
  assert.match(en, /ada@gmail\.com/);
  assert.match(en, /not your Shakers/);
  assert.match(en, /lines \(repo-wide\)/);
  const es = strip(renderTerminal(report, maturity, 'es'));
  assert.match(es, /no es tu email/);
  assert.match(es, /líneas \(del repo\)/);
});
