'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { getCatalog, label } = require('../src/i18n');
const { printAgents } = require('../src/render-terminal');
const { agentsCard } = require('../src/render-sheet');

// Ported from d7c4d23 ("harden agent-card labels against a literal 'undefined'"), adapted to the CURRENT structure.

// eslint-disable-next-line no-control-regex
const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

function renderAgents(report, t) {
  const lines = [];
  printAgents(report, t, (s = '') => lines.push(s));
  return strip(lines.join('\n'));
}

// A real catalog with specific keys removed — simulates a stale/partial/renamed
// catalog (an older cached install) without inventing a whole fake one.
function catalogMissing(...htmlKeys) {
  const t = getCatalog('en');
  const html = { ...t.html };
  for (const k of htmlKeys) delete html[k];
  return { ...t, html };
}

function sheetMissing(...sheetKeys) {
  const t = getCatalog('en');
  const sheet = { ...t.sheet };
  for (const k of sheetKeys) delete sheet[k];
  return { t, c: sheet };
}

const REPORT = {
  generatedAt: '2026-07-10T00:00:00.000Z',
  tools: [],
  technologies: [],
  agents: [{ name: 'ddd-enforcer', tools: [], model: 'opus', parent: null }],
};

/* ---------------- label() (the single hardening) ---------------- */

test('label(): a present, non-empty string passes through byte-identically', () => {
  assert.equal(label('Orchestrator', 'fallback'), 'Orchestrator');
  assert.equal(label('Agents', 'fallback'), 'Agents');
});

test('label(): missing / undefined / null / empty / non-string -> the fallback, never "undefined"', () => {
  assert.equal(label(undefined, 'Orchestrator'), 'Orchestrator');
  assert.equal(label(null, 'Orchestrator'), 'Orchestrator');
  assert.equal(label('', 'Orchestrator'), 'Orchestrator');
  assert.equal(label(123, 'Orchestrator'), 'Orchestrator');
  assert.equal(label({}, 'Orchestrator'), 'Orchestrator');
});

/* ---------------- terminal report: structural labels ---------------- */

test('printAgents (terminal): a catalog MISSING diagramHeading/orchestratorLabel falls back to a real word, never "undefined"', () => {
  const out = renderAgents(REPORT, catalogMissing('diagramHeading', 'orchestratorLabel'));
  assert.equal(/undefined/i.test(out), false, 'a missing key must never surface as "undefined"');
  assert.match(out, /Agents/, 'diagramHeading falls back to a real heading');
  assert.match(out, /Orchestrator/, 'orchestratorLabel falls back to a real root label');
});

test('printAgents (terminal): with the real catalog the labels are the catalog values (helper is pure passthrough — general-user report unchanged)', () => {
  const t = getCatalog('en');
  const out = renderAgents(REPORT, t);
  assert.equal(/undefined/i.test(out), false);
  assert.match(out, new RegExp(t.html.orchestratorLabel));
  assert.match(out, new RegExp(t.html.diagramHeading));
});

/* ---------------- terminal report: no-tools vs with-tools ---------------- */

test('printAgents (terminal): an agent with NO tools declared renders no tools line, and never "undefined"', () => {
  const out = renderAgents({ ...REPORT, agents: [{ name: 'ddd-enforcer', tools: [], model: 'opus', parent: null }] }, getCatalog('en'));
  assert.equal(out.includes(' · '), false, 'no tools declared -> no dotted tools line');
  assert.equal(/undefined/i.test(out), false);
  assert.match(out, /ddd-enforcer/);
});

test('printAgents (terminal): an agent WITH tools renders every one, joined', () => {
  const out = renderAgents({ ...REPORT, agents: [{ name: 'test-writer', tools: ['Read', 'Write', 'Bash'], model: 'sonnet', parent: null }] }, getCatalog('en'));
  assert.match(out, /Read · Write · Bash/);
  assert.equal(/undefined/i.test(out), false);
});

/* ---------------- shareable sheet: same defensive fallback ---------------- */

test('agentsCard (sheet): a catalog MISSING agentsT/agentsEmpty falls back, never "undefined"', () => {
  const { t, c } = sheetMissing('agentsT', 'agentsEmpty');
  const empty = agentsCard([], c, t);
  assert.equal(/undefined/i.test(empty), false);
  assert.match(empty, /No configured AI agents detected\./, 'agentsEmpty falls back');

  const withAgent = agentsCard([{ name: 'ddd-enforcer', model: 'opus', evaluated: true }], c, t);
  assert.equal(/undefined/i.test(withAgent), false);
  assert.match(withAgent, /AI agents/, 'agentsT heading falls back');
});

test('agentsCard (sheet): with the real catalog the heading is the catalog value (passthrough)', () => {
  const t = getCatalog('en');
  const html = agentsCard([{ name: 'x', model: 'opus', evaluated: true }], t.sheet, t);
  assert.equal(/undefined/i.test(html), false);
  assert.match(html, new RegExp(t.sheet.agentsT));
});
