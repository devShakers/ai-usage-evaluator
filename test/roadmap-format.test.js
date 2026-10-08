'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { renderTerminal } = require('../src/render-terminal');
const { getCatalog } = require('../src/i18n');
const { needle } = require('../test-fixtures/copy-needle');

// Issue 087 — the roadmap read as a crash: "Ahora parece que ha ocurrido un error.

const MATURITY = {
  level: 1, key: 'exploring', name: 'x', emoji: 'x', score: 30, next: 'x',
  tier: 2, tierKey: 'T2', tierName: 'Banco con notas',
  setupLevel: { key: 'S1', code: 'S1', rank: 1 },
};

const REPORT = {
  schemaVersion: 1, generatedAt: '2026-08-03T00:00:00.000Z', anonId: 'a1b2c3d4e5f6',
  platform: 'darwin', scope: 'project', environment: { editorsInstalled: [] },
  summary: { totalDetected: 2 },
  tools: [{ id: 'claude-code', name: 'Claude Code', detected: true, signalCount: 2, depth: {} }],
  agents: [], agentCounts: { agents: 0 }, technologies: ['React'],
  mcp: { servers: [] }, memory: {}, automations: {}, browserTools: {},
};

const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
const MAX_COLS = 80;

// The roadmap block: from its heading to the copyable prompt's own heading.
function roadmapBlock(out, lang) {
  const t = getCatalog(lang);
  const i = out.indexOf(needle(t.html.roadmapHeading, 't.html.roadmapHeading'));
  const j = out.indexOf(needle(t.html.implementationPromptHeading, 't.html.implementationPromptHeading'));
  assert.ok(i >= 0, 'the roadmap heading must be present');
  assert.ok(j > i, 'the prompt block must come after the roadmap');
  return out.slice(i, j);
}

for (const lang of ['es', 'en']) {
  test(`087 [${lang}]: no line runs past the terminal, in either language`, () => {
    // The classic hand-tabulated failure is that one language fits and the other does not, so both are measured.
    const out = strip(renderTerminal(REPORT, MATURITY, lang, { showRoadmap: true }));
    const over = roadmapBlock(out, lang).split('\n').filter((l) => l.length > MAX_COLS);
    assert.deepEqual(over, [], `${over.length} line(s) past ${MAX_COLS} columns`);
  });

  test(`087 [${lang}]: no value is cut mid-sentence with an ellipsis`, () => {
    // A sentence that stops in the middle is the thing that reads as broken output.
    const block = roadmapBlock(strip(renderTerminal(REPORT, MATURITY, lang, { showRoadmap: true })), lang);
    assert.equal(/…\s*$/m.test(block), false, 'a trailing ellipsis means a truncated value');
  });

  test(`087 [${lang}]: the block has hierarchy and separators, not one flat column`, () => {
    const out = strip(renderTerminal(REPORT, MATURITY, lang, { showRoadmap: true }));
    const block = roadmapBlock(out, lang);
    const lines = block.split('\n').filter((l) => l.trim());
    // At least three indentation levels: heading (2), label (2) + value (4), step
    // continuation (7+). A dump has one.
    const indents = new Set(lines.map((l) => l.match(/^ */)[0].length));
    assert.ok(indents.size >= 3, `expected several indent levels, got ${[...indents].join(',')}`);
    // Blank lines between blocks: a wall of text has none.
    assert.ok(block.split('\n').filter((l) => !l.trim()).length >= 3, 'the block needs air between its parts');
    // And the repo's own separator rule before the copyable prompt.
    assert.match(out, /─{20,}/, 'the existing separator pattern must delimit the prompt');
  });

  test(`087 [${lang}]: the structure survives a pipe — same shape with no colour`, () => {
    // The load-bearing test for the 079 gate: in a redirected log the colour is gone, so if hierarchy depended on it the file would be flat again.
    const coloured = renderTerminal(REPORT, MATURITY, lang, { showRoadmap: true });
    // Rendering happens through the ansi.js gate; under `node --test` stdout is a pipe, so `coloured` already has no escapes.
    assert.equal(/\x1b\[/.test(coloured), false, 'no ANSI reaches a piped run');
    const block = roadmapBlock(strip(coloured), lang);
    assert.match(block, /^ {4}\d+\. /m, 'the numbered steps survive without colour');
    // Strengthened after reading the CONTROL run: "there are indented lines" passed against the OLD render too, because its steps were already indented.
    const t = getCatalog(lang);
    const label = t.html.roadmapUnlocksLabel;
    const lines = block.split('\n');
    const at = lines.findIndex((l) => l.trim() === `${label}:`);
    assert.ok(at >= 0, `the label must be alone on its line, got: ${JSON.stringify(lines.filter((l) => l.includes(label)))}`);
    assert.match(lines[at + 1], /^ {4}\S/, 'and its value must hang indented under it');
  });

  test(`087 [${lang}]: the copyable prompt is NOT reflowed`, () => {
    // The prompt is pasted into another tool, so its own line breaks are content.
    const out = strip(renderTerminal(REPORT, MATURITY, lang, { showRoadmap: true }));
    const t = getCatalog(lang);
    const prompt = out.slice(out.indexOf(needle(t.html.implementationPromptHeading, 't.html.implementationPromptHeading')));
    const fences = prompt.split('\n').filter((l) => l.trim().startsWith('```'));
    assert.ok(fences.length >= 2, 'the prompt keeps its fenced block');
    for (const f of fences) {
      assert.match(f, /^ {2}```/, `a fence was re-indented or wrapped: ${JSON.stringify(f)}`);
    }
  });

  test(`087 [${lang}]: the CONTENT is unchanged — same items, same order`, () => {
    // The issue is explicit that formatting must not add, remove or reorder anything.
    const { getRoadmapEntry } = require('../src/roadmap-content');
    const entry = getRoadmapEntry('T2', lang);
    const out = strip(renderTerminal(REPORT, MATURITY, lang, { showRoadmap: true }));
    const block = roadmapBlock(out, lang);
    let cursor = -1;
    for (const step of entry.steps) {
      // Wrapping breaks the text across lines, so compare on a whitespace-collapsed
      // copy — the words and their order are the content, the line breaks are not.
      const flat = block.replace(/\s+/g, ' ');
      const needle = String(step.text).replace(/\s+/g, ' ');
      const at = flat.indexOf(needle);
      assert.ok(at > cursor, `step out of order or missing: ${needle.slice(0, 48)}`);
      cursor = at;
      assert.ok(flat.includes(`(${step.estimate})`), `estimate missing for: ${needle.slice(0, 40)}`);
    }
  });
}

test('087: wrap() never breaks a word, and keeps code identifiers whole', () => {
  // These values carry identifiers and paths (`mcpServers >= 1`,
  // `~/.codeium/windsurf/mcp_config.json`); hyphenating them would make them wrong.
  const { wrap } = require('../src/render-terminal');
  const long = '`~/.codeium/windsurf/mcp_config.json` es una ruta larguísima que no se puede partir';
  for (const line of wrap(long, 20)) {
    if (line.includes(' ')) assert.ok(line.length <= 20, `line over width: ${line}`);
    // A word longer than the width gets its own line, intact.
    else assert.ok(long.includes(line), 'a word was mangled');
  }
  assert.deepEqual(wrap('', 20), []);
  assert.deepEqual(wrap(null, 20), []);
  assert.deepEqual(wrap('a  b', 20), ['a b'], 'whitespace is collapsed as before');
});
