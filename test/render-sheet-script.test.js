'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { renderSheet } = require('../src/render-sheet');
const {
  runTemplateScripts, fireWindowEvent, makeNode,
} = require('../test-fixtures/template-script-harness');

// Inventory of every DOM node `report-sheet.html`'s script looks up, and in which data combination it is absent (issue 067, criterion 1).

function harnessCombos() {
  return [
    { name: 'fully empty project (no footprint, no skills, no agents)', project: {}, hasFoot: false },
    {
      name: 'footprint only',
      project: { footprint: { report: { agentEvaluation: null }, maturity: { tierName: 'Explorando' }, generatedAt: '2026-01-01' } },
      hasFoot: true,
    },
    {
      name: 'skills only (no footprint, no agents)',
      project: { certifications: { 'id:1': { generatedAt: 'x', item: { skillId: 1, skillName: 'React', result: { score: 80, rationale: 'r', improvements: [] } } } } },
      hasFoot: false,
    },
    {
      name: 'agents only (no footprint, no skills) — issue 066 shape',
      project: {
        agentCertifications: {
          'code-reviewer': {
            level: 'P4', category: 'dev', role: 'Code Reviewer',
            areas: [{ area: 'purpose_fit', tag: 'verified', evidence: 'x' }],
            verifiedEvidence: [], unverifiedEvidence: [], rationale: 'r',
          },
        },
      },
      hasFoot: false,
    },
  ];
}

const QS_MAP_FACTORY = () => ({
  '.tab.active': makeNode(),
  '.tabpanel.show': makeNode(),
});

test('report-sheet script: every persisted-data combination runs the WHOLE script and its `load` handler without throwing', () => {
  for (const combo of harnessCombos()) {
    const html = renderSheet(combo.project, 'en');

    // Preconditions — this is what makes the "missing node" claim checkable
    // instead of assumed: #ringFill/#scoreNum exist iff footprint does.
    assert.equal(html.includes('id="ringFill"'), combo.hasFoot, `${combo.name}: #ringFill presence must match hasFoot`);
    assert.equal(html.includes('id="scoreNum"'), combo.hasFoot, `${combo.name}: #scoreNum presence must match hasFoot`);
    // The tabs/expand-all chrome is unconditional — the actual "always there" half of the inventory above.
    assert.equal(html.includes('id="tabInd"'), true, `${combo.name}: #tabInd is static chrome`);
    assert.equal(html.includes('id="expandAll"'), true, `${combo.name}: #expandAll is static chrome`);

    let thrown = null;
    let sandbox, windowListeners;
    try {
      ({ sandbox, windowListeners } = runTemplateScripts(html, { querySelectorMap: QS_MAP_FACTORY() }));
      fireWindowEvent(windowListeners, 'load');
    } catch (e) {
      thrown = e;
    }
    assert.equal(thrown, null, `${combo.name}: script + load handler must not throw (${thrown && thrown.stack})`);

    // Each of the FOUR independent `load` steps actually ran — not merely
    // "didn't throw", which a silently-skipped step would also satisfy.
    const tabInd = sandbox.document._registry.get('tabInd');
    assert.equal(tabInd.style.left, '0px', `${combo.name}: moveInd() positioned the tab indicator`);
    const expandBtn = sandbox.document._registry.get('expandAll');
    assert.ok(expandBtn.textContent.length > 0, `${combo.name}: syncExpandLabel() set the expand-all label`);

    if (combo.hasFoot) {
      const ringFill = sandbox.document._registry.get('ringFill');
      assert.ok(ringFill.style.strokeDasharray, `${combo.name}: paintRing() styled the ring when footprint IS present`);
      const scoreNum = sandbox.document._registry.get('scoreNum');
      assert.notEqual(scoreNum.textContent, '', `${combo.name}: countUp() wrote a score when footprint IS present`);
    } else {
      assert.equal(sandbox.document._registry.get('ringFill'), undefined, `${combo.name}: #ringFill genuinely absent from the DOM double, mirroring the rendered output`);
    }
  }
});

test('report-sheet script: the theme-toggle click repaints the ring without throwing, footprint present or not', () => {
  for (const combo of harnessCombos()) {
    const html = renderSheet(combo.project, 'en');
    const { sandbox } = runTemplateScripts(html, { querySelectorMap: QS_MAP_FACTORY() });
    const themeBtn = sandbox.document._registry.get('themeBtn');
    assert.doesNotThrow(() => themeBtn._fire('click'), `${combo.name}: theme toggle must not throw on click`);
    assert.doesNotThrow(() => themeBtn._fire('click'), `${combo.name}: theme toggle must not throw on a SECOND click (back to light)`);
  }
});

test('report-sheet script: load-sequence isolation survives even if the #ringFill/#scoreNum guards regress', () => {
  const project = {
    agentCertifications: {
      'code-reviewer': {
        level: 'P4', category: 'dev', role: 'Code Reviewer',
        areas: [{ area: 'purpose_fit', tag: 'verified', evidence: 'x' }],
        verifiedEvidence: [], unverifiedEvidence: [], rationale: 'r',
      },
    },
  }; // no footprint: #ringFill/#scoreNum are absent, so an unguarded paintRing/countUp WILL throw.
  const html = renderSheet(project, 'en');
  assert.equal(html.includes('id="ringFill"'), false, 'precondition: no footprint, no #ringFill');

  const regressedHtml = html
    .replace('if(!fill) return;', '')
    .replace(/if\(!el\) return;[^\n]*/, '');
  assert.notEqual(regressedHtml, html, 'precondition: the guard-strip actually changed the script (still matches the shipped source)');

  const { sandbox, windowListeners } = runTemplateScripts(regressedHtml, { querySelectorMap: QS_MAP_FACTORY() });
  assert.doesNotThrow(() => fireWindowEvent(windowListeners, 'load'), 'the load handler itself must not propagate the two now-unguarded throws');

  const tabInd = sandbox.document._registry.get('tabInd');
  assert.equal(tabInd.style.left, '0px', 'moveInd() still ran despite paintRing() throwing on its now-unguarded #ringFill lookup');
  const expandBtn = sandbox.document._registry.get('expandAll');
  assert.ok(expandBtn.textContent.length > 0, 'syncExpandLabel() still ran despite countUp() throwing on its now-unguarded #scoreNum lookup');
});

test('harness sanity: an UNISOLATED sequence genuinely cascades (proves the isolation test above is not tautological)', () => {
  const html = `<html><body>
    <div id="a"></div><div id="b"></div>
    <script>
      window.addEventListener('load', function(){
        (function step1(){ throw new Error('step1 boom'); })();
        document.getElementById('a').textContent = 'ran';
        document.getElementById('b').textContent = 'ran';
      });
    </script>
  </body></html>`;
  const { sandbox, windowListeners } = runTemplateScripts(html);
  assert.throws(() => fireWindowEvent(windowListeners, 'load'), /step1 boom/);
  assert.equal(sandbox.document._registry.get('a').textContent, '', 'without isolation, the step AFTER the throw never ran');
});
