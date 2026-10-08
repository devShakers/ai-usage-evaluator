'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { stripTemplateComments, findInternalReferences } = require('../src/strip-internal-comments');
const { renderSheet } = require('../src/render-sheet');
const { scan } = require('../src/scanner');
const { classify } = require('../src/maturity');
const { parseAgentDescriptions } = require('../src/agent-org-chart');

// Issue 098: nothing we write for ourselves may end up in the document the talent shares.

/* ---------- a real project, scanned for real ---------- */

let tmpRoot;
let realProject;

test('setup: scan a real project and build the report-store shape from it', () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-footprint-098-'));
  fs.mkdirSync(path.join(tmpRoot, '.claude', 'agents'), { recursive: true });
  // Talent-authored content that deliberately CONTAINS comment delimiters: if the sweep ever moves from the template to the rendered document, this is the text it would silently mangle.
  fs.writeFileSync(
    path.join(tmpRoot, '.claude', 'agents', 'legacy-fixer.md'),
    [
      '---',
      'name: legacy-fixer',
      'description: Fixes the /* legacy */ parser and the // fallback path',
      'tools: Read, Write',
      'model: sonnet',
      '---',
      'Body: keeps the old parser alive.',
    ].join('\n'),
  );
  fs.writeFileSync(path.join(tmpRoot, '.mcp.json'), JSON.stringify({ mcpServers: { postgres: {} } }));

  const report = scan({ root: tmpRoot });
  report.agentDescriptions = parseAgentDescriptions(tmpRoot);
  const maturity = classify(report);
  realProject = {
    root: tmpRoot,
    updatedAt: new Date().toISOString(),
    footprint: { generatedAt: report.generatedAt, report, maturity },
    certifications: {},
    agentCertifications: {},
    backendAcceptance: {},
  };
  assert.ok(realProject.footprint.report.agents.length >= 1, 'the scan found the agent we wrote');
});

/* ---------- the control: the templates DID carry the leak ---------- */

test('control: the raw templates DO contain internal references (so the test proves the sweep works)', () => {
  const raw = [
    fs.readFileSync(path.join(__dirname, '..', 'src', 'templates', 'report-sheet.html'), 'utf8'),
  ];
  for (const src of raw) {
    const found = findInternalReferences(src);
    assert.ok(found.length > 0, 'a template with no internal reference at all would make this suite vacuous');
  }
});

/* ---------- the sweep itself ---------- */

test('stripTemplateComments removes html, block and whole-line comments', () => {
  const input = [
    '<!-- internal: issue 098 -->',
    '<style>',
    '  /* internal note about src/render-sheet.js */',
    '  .card { color: red; }',
    '</style>',
    '<script>',
    '  // internal: see ADR-014',
    '  const u = "https://example.com/x";',
    '</script>',
  ].join('\n');
  const out = stripTemplateComments(input);
  assert.equal(out.includes('issue 098'), false);
  assert.equal(out.includes('src/render-sheet.js'), false);
  assert.equal(out.includes('ADR-014'), false);
  // Content survives, including a URL whose `//` is not a comment.
  assert.match(out, /\.card \{ color: red; \}/);
  assert.match(out, /https:\/\/example\.com\/x/);
});

test('stripTemplateComments does NOT strip a mid-line `//` (that is a URL, not a comment)', () => {
  const input = 'const a = "x"; const u = "http://h/p";';
  assert.equal(stripTemplateComments(input), input);
});

/* ---------- the generated documents ---------- */

function blocks(html, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(html)) !== null) out.push(m[1]);
  return out;
}

for (const lang of ['es', 'en']) {
  test(`the shareable report [${lang}] carries no comment and no internal reference`, () => {
    const html = renderSheet(realProject, lang);
    assert.equal(/<!--/.test(html), false, 'no html comment');
    for (const block of [...blocks(html, 'style'), ...blocks(html, 'script')]) {
      assert.equal(block.includes('/*'), false, 'a block comment survived in the shared report');
    }
    const found = findInternalReferences(html);
    assert.deepEqual(found, [], `internal references reached the shared report: ${JSON.stringify(found)}`);
  });
}

/* ---------- the talent's own text is NOT collateral ---------- */

test("the talent's own `/* */` text survives into the shared report — the sweep never touches their data", () => {
  const html = renderSheet(realProject, 'es');
  // The description was authored with comment delimiters in it. It must arrive
  // intact: this is why the sweep runs on the template and not on the output.
  assert.match(html, /legacy/, 'the description reached the report');
  assert.match(html, /Fixes the \/\* legacy \*\/ parser/, 'and did so verbatim, delimiters included');
});

/* ---------- the sweep did not break the CSS or the script ---------- */

test('after the sweep the <style> braces are still balanced in the shared report', () => {
  const docs = [
    renderSheet(realProject, 'es'),
  ];
  for (const html of docs) {
    for (const css of blocks(html, 'style')) {
      const open = (css.match(/\{/g) || []).length;
      const close = (css.match(/\}/g) || []).length;
      assert.equal(open, close, 'a stripped comment must never eat a brace');
    }
  }
});

test('after the sweep every inline <script> still parses', () => {
  const docs = [
    renderSheet(realProject, 'es'),
  ];
  for (const html of docs) {
    for (const js of blocks(html, 'script')) {
      if (!js.trim()) continue;
      // A real syntax check with no dependency: `new Function` compiles without
      // executing. A comment removal that swallowed a line would throw here.
      assert.doesNotThrow(() => new Function(js), 'the stripped script must still be valid JS');
    }
  }
});

test('teardown', () => {
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
});
