'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { parseAgentOrgChart, parseAgentDescriptions, parseAgentDefinitions } = require('../src/agent-org-chart');

/*
 * talents-ai-score, issue 009 (ADR-009): deterministic (no-LLM) parser of the
 * talent's AI agent org chart, scoped to KNOWN AI config files only
 * (`.claude/agents/*.md` frontmatter). Structure + names ONLY:
 *   - name/role, wired tools, model, hierarchy (parent, if declared)
 *   - NEVER descriptions/prompts/system-prompts, file content beyond
 *     frontmatter, paths, env vars or credentials.
 *
 * Every test builds its own throwaway root (fixture `.claude/agents/`), never
 * touching the real repo or the developer's machine.
 */

let tmpDir;
let tmpHome;
let originalHomeOverride;

test.beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-footprint-agents-test-'));
  // talents-ai-score, ADR-014: parseAgentOrgChart/parseAgentDescriptions now
  // also read `.claude/agents/` from the home directory (project ∪ home).
  // Isolated to a throwaway dir so these tests never depend on — or leak
  // into — the real developer machine's personal agents.
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-footprint-agents-home-'));
  originalHomeOverride = process.env.AI_FOOTPRINT_HOME_DIR;
  process.env.AI_FOOTPRINT_HOME_DIR = tmpHome;
});

test.afterEach(() => {
  if (originalHomeOverride === undefined) delete process.env.AI_FOOTPRINT_HOME_DIR;
  else process.env.AI_FOOTPRINT_HOME_DIR = originalHomeOverride;
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

function writeHomeAgentFile(relPath, content) {
  const full = path.join(tmpHome, '.claude', 'agents', relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function writeAgentFile(root, relPath, content) {
  const full = path.join(root, '.claude', 'agents', relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
}

// ADR-016 agent evaluation: parseAgentDefinitions must return the FULL authored
// definition (frontmatter description + body). This is the bug fix for "no agent
// scores": body-defined agents (thin/absent frontmatter description) previously
// sent an empty definition to the evaluation backend, which then omitted them.
test('parseAgentDefinitions: a BODY-defined agent (no frontmatter description) still yields a non-empty definition (the body)', () => {
  writeAgentFile(
    tmpDir,
    'body-only.md',
    [
      '---',
      'name: body-only',
      'model: opus',
      'tools: Read, Edit',
      '---',
      'You are a refactoring agent. Boundaries: never change public APIs;',
      'always keep tests green. Structure output as findings, diff, risks.',
    ].join('\n'),
  );
  // The frontmatter-only view is empty for this agent...
  const desc = parseAgentDescriptions(tmpDir).find((d) => d.name === 'body-only');
  assert.equal(desc.description, '');
  // ...but the definition view carries the body.
  const def = parseAgentDefinitions(tmpDir).find((d) => d.name === 'body-only');
  assert.ok(def.definition.length > 0, 'definition is not empty');
  assert.match(def.definition, /refactoring agent/);
  assert.match(def.definition, /never change public APIs/);
});

test('parseAgentDefinitions: concatenates the frontmatter description AND the body', () => {
  writeAgentFile(
    tmpDir,
    'both.md',
    ['---', 'name: both', 'description: One-line summary.', 'model: sonnet', '---', 'Detailed body instructions here.'].join('\n'),
  );
  const def = parseAgentDefinitions(tmpDir).find((d) => d.name === 'both');
  assert.match(def.definition, /One-line summary\./);
  assert.match(def.definition, /Detailed body instructions here\./);
});

test('parseAgentOrgChart: no .claude/agents directory -> empty array, never throws', () => {
  const agents = parseAgentOrgChart(tmpDir);
  assert.deepEqual(agents, []);
});

test('parseAgentOrgChart: parses name/tools(inline comma list)/model from frontmatter', () => {
  writeAgentFile(
    tmpDir,
    'backend-developer.md',
    [
      '---',
      'name: backend-developer',
      'description: |',
      '  Long free-text prompt describing exactly how this agent behaves,',
      '  including sensitive project/business framing that must never leave',
      '  the machine — client names, internal code names, strategy notes.',
      'tools: Read, Write, Bash, Edit',
      'model: sonnet',
      '---',
      '',
      '# System prompt body (outside frontmatter, also never read for this)',
      'Do detailed backend work.',
    ].join('\n'),
  );

  const agents = parseAgentOrgChart(tmpDir);
  assert.equal(agents.length, 1);
  assert.deepEqual(agents[0], {
    name: 'backend-developer',
    tools: ['Read', 'Write', 'Bash', 'Edit'],
    model: 'sonnet',
    parent: null,
  });
});

test('parseAgentOrgChart: parses tools as an inline YAML array', () => {
  writeAgentFile(
    tmpDir,
    'reviewer.md',
    ['---', 'name: reviewer', 'tools: [Read, Grep, Glob]', 'model: opus', '---', ''].join('\n'),
  );

  const agents = parseAgentOrgChart(tmpDir);
  assert.equal(agents.length, 1);
  assert.deepEqual(agents[0].tools, ['Read', 'Grep', 'Glob']);
  assert.equal(agents[0].model, 'opus');
});

test('parseAgentOrgChart: parses tools as a YAML block list ("- item" lines)', () => {
  writeAgentFile(
    tmpDir,
    'qa-tester.md',
    ['---', 'name: qa-tester', 'tools:', '  - Read', '  - Bash', 'model: haiku', '---', ''].join('\n'),
  );

  const agents = parseAgentOrgChart(tmpDir);
  assert.equal(agents.length, 1);
  assert.deepEqual(agents[0].tools, ['Read', 'Bash']);
});

test('parseAgentOrgChart: model missing -> null; tools missing -> empty array', () => {
  writeAgentFile(tmpDir, 'minimal.md', ['---', 'name: minimal', '---', ''].join('\n'));

  const agents = parseAgentOrgChart(tmpDir);
  assert.equal(agents.length, 1);
  assert.deepEqual(agents[0], { name: 'minimal', tools: [], model: null, parent: null });
});

test('parseAgentOrgChart: EXCLUDES description content entirely — never present anywhere in the returned structure', () => {
  const secretMarker = 'PROJECT-CODENAME-DO-NOT-LEAK';
  writeAgentFile(
    tmpDir,
    'leaky.md',
    [
      '---',
      'name: leaky-agent',
      `description: |`,
      `  Works on ${secretMarker} for the client, references internal paths`,
      '  and strategy details that must never travel anywhere.',
      'tools: Read',
      'model: sonnet',
      '---',
      '',
    ].join('\n'),
  );

  const agents = parseAgentOrgChart(tmpDir);
  assert.equal(agents.length, 1);
  assert.equal('description' in agents[0], false);
  const serialized = JSON.stringify(agents);
  assert.equal(serialized.includes(secretMarker), false);
  assert.equal(serialized.toLowerCase().includes('description'), false);
});

// talents-ai-score bugfix: agents used to be silently DROPPED from the
// whole org chart when frontmatter had no `name` — worse than showing one,
// since the agent simply vanished. Every agent must show a name: falls
// back to the file's own basename (extension stripped) rather than being
// excluded.
test('parseAgentOrgChart: file with frontmatter but no `name` field falls back to the filename, never dropped', () => {
  writeAgentFile(tmpDir, 'no-name.md', ['---', 'tools: Read', 'model: sonnet', '---', ''].join('\n'));
  writeAgentFile(tmpDir, 'valid.md', ['---', 'name: valid-agent', '---', ''].join('\n'));

  const agents = parseAgentOrgChart(tmpDir);
  assert.equal(agents.length, 2);
  const byName = Object.fromEntries(agents.map((a) => [a.name, a]));
  assert.ok(byName['no-name']);
  assert.equal(byName['no-name'].model, 'sonnet');
  assert.ok(byName['valid-agent']);
});

// Real-world frontmatter edge case found while investigating the "agents
// show up without a name" report: `name:` present as a KEY but with an
// EMPTY value (as opposed to the key being fully absent) hits a different
// code path in parseFrontmatter (the YAML block-list-continuation branch,
// since the value is '') and never populates `fm.name` at all — same
// fallback applies.
test('parseAgentOrgChart: an empty `name:` value in frontmatter (present key, no value) also falls back to the filename', () => {
  writeAgentFile(tmpDir, 'empty-name.md', ['---', 'name:', 'model: opus', '---', ''].join('\n'));
  const agents = parseAgentOrgChart(tmpDir);
  assert.equal(agents.length, 1);
  assert.equal(agents[0].name, 'empty-name');
  assert.equal(agents[0].model, 'opus'); // confirms the line after the empty `name:` still parses correctly
});

// Only a file with NO frontmatter block at all remains excluded — that one
// genuinely isn't a valid agent definition Claude Code itself would
// recognize either.
test('parseAgentOrgChart: a file with no frontmatter block at all is still excluded (not a valid agent definition)', () => {
  writeAgentFile(tmpDir, 'plain-doc.md', '# Just a markdown file, no frontmatter\n');
  const agents = parseAgentOrgChart(tmpDir);
  assert.deepEqual(agents, []);
});

test('parseAgentOrgChart: file with no frontmatter at all is skipped, never throws', () => {
  writeAgentFile(tmpDir, 'plain.md', '# Just a markdown file, no frontmatter\n');
  const agents = parseAgentOrgChart(tmpDir);
  assert.deepEqual(agents, []);
});

test('parseAgentOrgChart: reads nested subdirectories recursively (e.g. engineering/, design/)', () => {
  writeAgentFile(tmpDir, 'engineering/backend-developer.md', ['---', 'name: backend-developer', '---', ''].join('\n'));
  writeAgentFile(tmpDir, 'design/product-designer.md', ['---', 'name: product-designer', '---', ''].join('\n'));

  const agents = parseAgentOrgChart(tmpDir);
  assert.equal(agents.length, 2);
  assert.deepEqual(agents.map((a) => a.name).sort(), ['backend-developer', 'product-designer']);
});

test('parseAgentOrgChart: hierarchy — explicit `parent` field wires orchestrator -> subagent edges', () => {
  writeAgentFile(
    tmpDir,
    'orchestrator.md',
    ['---', 'name: orchestrator', 'model: opus', '---', ''].join('\n'),
  );
  writeAgentFile(
    tmpDir,
    'subagent.md',
    ['---', 'name: subagent', 'model: sonnet', 'parent: orchestrator', '---', ''].join('\n'),
  );

  const agents = parseAgentOrgChart(tmpDir);
  const byName = Object.fromEntries(agents.map((a) => [a.name, a]));
  assert.equal(byName.orchestrator.parent, null);
  assert.equal(byName.subagent.parent, 'orchestrator');
});

test('parseAgentOrgChart: no declared hierarchy -> every agent is a child of the implicit root orchestrator (parent: null)', () => {
  writeAgentFile(tmpDir, 'a.md', ['---', 'name: agent-a', '---', ''].join('\n'));
  writeAgentFile(tmpDir, 'b.md', ['---', 'name: agent-b', '---', ''].join('\n'));

  const agents = parseAgentOrgChart(tmpDir);
  assert.ok(agents.every((a) => a.parent === null));
});

// --- talents-ai-score bugfix: derive orchestrator->subagent edges from prose ---
// Claude Code's subagent schema has no `parent` field, so real multi-agent
// setups declare the hierarchy in each agent's own prose. Without derivation
// every card rendered flat (no edges). The rule: an edge is derived only when
// a sentence names EXACTLY ONE other known agent AND carries BOTH a direction
// cue (that agent defines/sets/coordinates the work) and an execution cue
// (THIS agent executes it), and is not a negation line.

test('parseAgentOrgChart: derives parent from prose when a child names its coordinator (direction + execution cue)', () => {
  writeAgentFile(tmpDir, 'growth-manager.md', ['---', 'name: growth-manager', 'model: opus', '---', 'You own growth strategy.'].join('\n'));
  writeAgentFile(
    tmpDir,
    'content-creator.md',
    ['---', 'name: content-creator', 'model: sonnet', '---', 'You own social content. The growth-manager defines the strategy; you execute it.'].join('\n'),
  );

  const byName = Object.fromEntries(parseAgentOrgChart(tmpDir).map((a) => [a.name, a]));
  assert.equal(byName['content-creator'].parent, 'growth-manager');
  assert.equal(byName['growth-manager'].parent, null); // top-level, child of the implicit root
});

test('parseAgentOrgChart: a "do NOT touch" line naming another agent does NOT create a parent edge', () => {
  writeAgentFile(tmpDir, 'growth-manager.md', ['---', 'name: growth-manager', '---', 'Strategy owner.'].join('\n'));
  writeAgentFile(
    tmpDir,
    'product-manager.md',
    ['---', 'name: product-manager', '---', 'You own product. You do NOT touch growth strategy (growth-manager); they execute their own plan.'].join('\n'),
  );

  const byName = Object.fromEntries(parseAgentOrgChart(tmpDir).map((a) => [a.name, a]));
  assert.equal(byName['product-manager'].parent, null); // negation line -> no edge
});

test('parseAgentOrgChart: a peer hand-off (direction cue but no execution cue) does NOT create a parent edge', () => {
  writeAgentFile(tmpDir, 'project-manager.md', ['---', 'name: project-manager', '---', 'Roadmap owner.'].join('\n'));
  writeAgentFile(
    tmpDir,
    'cfo.md',
    ['---', 'name: cfo', '---', 'You set the financial targets. Handoff to project-manager with an inline summary.'].join('\n'),
  );

  const byName = Object.fromEntries(parseAgentOrgChart(tmpDir).map((a) => [a.name, a]));
  assert.equal(byName['cfo'].parent, null); // no "you execute" cue tying cfo under project-manager
  assert.equal(byName['project-manager'].parent, null);
});

test('parseAgentOrgChart: explicit `parent` frontmatter wins over a prose-derived one', () => {
  writeAgentFile(tmpDir, 'growth-manager.md', ['---', 'name: growth-manager', '---', ''].join('\n'));
  writeAgentFile(tmpDir, 'ceo.md', ['---', 'name: ceo', '---', ''].join('\n'));
  writeAgentFile(
    tmpDir,
    'seo-writer.md',
    ['---', 'name: seo-writer', 'parent: ceo', '---', 'The growth-manager defines the SEO strategy; you execute it.'].join('\n'),
  );

  const byName = Object.fromEntries(parseAgentOrgChart(tmpDir).map((a) => [a.name, a]));
  assert.equal(byName['seo-writer'].parent, 'ceo'); // explicit frontmatter, not the prose-derived growth-manager
});

test('parseAgentOrgChart: two agents named in one directive sentence is ambiguous -> no derived edge', () => {
  writeAgentFile(tmpDir, 'growth-manager.md', ['---', 'name: growth-manager', '---', ''].join('\n'));
  writeAgentFile(tmpDir, 'product-manager.md', ['---', 'name: product-manager', '---', ''].join('\n'));
  writeAgentFile(
    tmpDir,
    'content-creator.md',
    ['---', 'name: content-creator', '---', 'The growth-manager and product-manager define the strategy; you execute it.'].join('\n'),
  );

  const byName = Object.fromEntries(parseAgentOrgChart(tmpDir).map((a) => [a.name, a]));
  assert.equal(byName['content-creator'].parent, null); // ambiguous -> skipped, not guessed
});

test('parseAgentOrgChart: derivation never leaks prose — returned agents carry only name/tools/model/parent', () => {
  writeAgentFile(tmpDir, 'growth-manager.md', ['---', 'name: growth-manager', '---', 'Secret business framing here.'].join('\n'));
  writeAgentFile(
    tmpDir,
    'crm-manager.md',
    ['---', 'name: crm-manager', 'model: sonnet', '---', 'Confidential pipeline notes. The growth-manager defines the sales strategy; you execute it.'].join('\n'),
  );

  for (const a of parseAgentOrgChart(tmpDir)) {
    assert.deepEqual(Object.keys(a).sort(), ['model', 'name', 'parent', 'tools']);
    assert.equal(JSON.stringify(a).includes('Confidential'), false);
    assert.equal(JSON.stringify(a).includes('Secret'), false);
  }
});

test('parseAgentOrgChart: quoted scalar values are unquoted', () => {
  writeAgentFile(
    tmpDir,
    'quoted.md',
    ['---', 'name: "quoted-agent"', "model: 'opus'", '---', ''].join('\n'),
  );
  const agents = parseAgentOrgChart(tmpDir);
  assert.equal(agents[0].name, 'quoted-agent');
  assert.equal(agents[0].model, 'opus');
});

// --- parseAgentDescriptions (talents-ai-score, ADR-010: gated exception) ---
//
// This is a DIFFERENT function from parseAgentOrgChart, used only to feed
// the ephemeral agent-synthesis request (src/agent-synthesis.js). It's the
// only place in this module that ever returns description content.

test('parseAgentDescriptions: returns {name, description} pairs from block-scalar descriptions', () => {
  writeAgentFile(
    tmpDir,
    'backend-developer.md',
    [
      '---',
      'name: backend-developer',
      'description: |',
      '  Handles backend work for the project, including database access',
      '  and API design.',
      'tools: Read, Write',
      'model: sonnet',
      '---',
      '',
    ].join('\n'),
  );

  const descriptions = parseAgentDescriptions(tmpDir);
  assert.equal(descriptions.length, 1);
  assert.equal(descriptions[0].name, 'backend-developer');
  assert.match(descriptions[0].description, /Handles backend work/);
  assert.match(descriptions[0].description, /database access/);
});

test('parseAgentDescriptions: agent with no description -> empty string, not omitted', () => {
  writeAgentFile(tmpDir, 'minimal.md', ['---', 'name: minimal', '---', ''].join('\n'));
  const descriptions = parseAgentDescriptions(tmpDir);
  assert.deepEqual(descriptions, [{ name: 'minimal', description: '' }]);
});

test('parseAgentDescriptions: does not affect parseAgentOrgChart — the structural chart still never carries description', () => {
  writeAgentFile(
    tmpDir,
    'a.md',
    ['---', 'name: agent-a', 'description: |', '  some prompt text here', 'tools: Read', '---', ''].join('\n'),
  );
  const structural = parseAgentOrgChart(tmpDir);
  const withDescriptions = parseAgentDescriptions(tmpDir);
  assert.equal('description' in structural[0], false);
  assert.match(withDescriptions[0].description, /some prompt text here/);
});

test('parseAgentDescriptions: no .claude/agents directory -> empty array, never throws', () => {
  assert.deepEqual(parseAgentDescriptions(tmpDir), []);
});

// --- project ∪ home scope (talents-ai-score, ADR-014, closed decision #5) ---

test('parseAgentOrgChart: includes agents from the HOME .claude/agents/ directory too', () => {
  writeHomeAgentFile('personal-helper.md', ['---', 'name: personal-helper', 'model: sonnet', '---', ''].join('\n'));
  const agents = parseAgentOrgChart(tmpDir);
  assert.equal(agents.length, 1);
  assert.equal(agents[0].name, 'personal-helper');
});

test('parseAgentOrgChart: merges project AND home agents together', () => {
  writeAgentFile(tmpDir, 'project-agent.md', ['---', 'name: project-agent', '---', ''].join('\n'));
  writeHomeAgentFile('personal-agent.md', ['---', 'name: personal-agent', '---', ''].join('\n'));
  const agents = parseAgentOrgChart(tmpDir);
  assert.deepEqual(agents.map((a) => a.name).sort(), ['personal-agent', 'project-agent']);
});

test('parseAgentOrgChart: on a name collision, the PROJECT-level agent wins over the personal one', () => {
  writeAgentFile(tmpDir, 'reviewer.md', ['---', 'name: reviewer', 'model: opus', '---', ''].join('\n'));
  writeHomeAgentFile('reviewer.md', ['---', 'name: reviewer', 'model: sonnet', '---', ''].join('\n'));
  const agents = parseAgentOrgChart(tmpDir);
  assert.equal(agents.length, 1);
  assert.equal(agents[0].model, 'opus'); // the project definition, not the personal one
});

test('parseAgentDescriptions: also merges project ∪ home, project wins on collision', () => {
  writeAgentFile(tmpDir, 'reviewer.md', ['---', 'name: reviewer', 'description: project version'].join('\n') + '\n---\n');
  writeHomeAgentFile('reviewer.md', ['---', 'name: reviewer', 'description: personal version'].join('\n') + '\n---\n');
  const descriptions = parseAgentDescriptions(tmpDir);
  assert.equal(descriptions.length, 1);
});
