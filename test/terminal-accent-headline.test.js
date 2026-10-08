'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { renderTerminal } = require('../src/render-terminal');
const { renderCertificationTerminal } = require('../src/render-certification');
const { BRAND_ANSI } = require('../src/brand-ansi');

function withTTY(fn) {
  const original = process.stdout.isTTY;
  try {
    process.stdout.isTTY = true;
    return fn();
  } finally {
    process.stdout.isTTY = original;
  }
}

function countAccent(s) {
  return (s.match(new RegExp(BRAND_ANSI.accent.replace(/[[\]\\^$.*+?()|{}]/g, '\\$&'), 'g')) || []).length;
}

/* ---------------------------- usage report (render-terminal.js) ---------------------------- */

const BASE_REPORT = {
  generatedAt: '2026-08-11T00:00:00.000Z',
  tools: [{
    id: 'claude-code', name: 'Claude Code', vendor: 'Anthropic', category: 'Agentic CLI',
    detected: true, signalTypes: ['bin'], signalCount: 1, depth: {},
    footprint: null, recency: { bucket: null }, version: null,
  }],
  environment: { platform: 'darwin', arch: 'arm64', nodeVersion: 'v22.0.0', editorsInstalled: [] },
  technologies: [], agents: [],
};

test('usage report: a REAL Setup Level (S2) is the ONE accent on screen', () => {
  const maturity = { level: 2, key: 'integrated', name: 'Integrated', score: 55, emoji: 'x', next: 'x', setupLevel: { key: 'S2' } };
  const out = withTTY(() => renderTerminal(BASE_REPORT, maturity, 'en'));
  assert.equal(countAccent(out), 1, 'exactly one accent on the default report screen');
  // And it sits on the Setup Level line specifically, not on the score bar
  // right below it (which stays `primary`, unchanged).
  const setupLine = out.split('\n').find((l) => l.includes('S2'));
  assert.ok(setupLine && setupLine.includes(BRAND_ANSI.accent), 'the Setup Level line must carry the accent');
});

test('usage report: "Not certified" (no AI tool detected) is NOT an achievement — no accent', () => {
  const maturity = { level: 0, key: 'none', name: 'No AI usage', score: 0, emoji: 'x', next: 'x', setupLevel: { key: 'none' } };
  const out = withTTY(() => renderTerminal(BASE_REPORT, maturity, 'en'));
  assert.equal(countAccent(out), 0, 'the floor state must never be painted as a result earned');
});

/* ---------------------------- certify skills — code-only fallback (render-certification.js) ---------------------------- */

function skillCertification(score) {
  return {
    items: [{
      skillId: 1, skillName: 'React', technology: 'React',
      sampling: { sampleable: true, includedCount: 3, candidateCount: 5, estTokens: 1000, truncated: false, capReason: null },
      result: { score, rationale: 'Solid usage.', improvements: [] },
    }],
  };
}

test('certify skills (code-only fallback): the level headline gets accent regardless of score band', () => {
  for (const score of [10, 55, 90]) { // middle, senior, expert bands
    const out = withTTY(() => renderCertificationTerminal(skillCertification(score), 'en'));
    assert.equal(countAccent(out), 1, `score ${score} must carry exactly one accent on its level line`);
  }
});

test('certify skills (code-only fallback): NO result at all -> no accent (nothing was earned)', () => {
  const cert = { items: [{ skillId: 1, skillName: 'React', technology: 'React', sampling: { sampleable: true }, result: null }] };
  const out = withTTY(() => renderCertificationTerminal(cert, 'en'));
  assert.equal(countAccent(out), 0);
});
