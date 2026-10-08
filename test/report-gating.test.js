'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { resolveReportGate, reportGateForIdentity, DEFAULT_REPORT_GATE } = require('../src/report-gating');
const { saveAuthSession } = require('../src/auth-session-store');
const config = require('../src/config');
const { renderTerminal } = require('../src/render-terminal');
const { renderCertificationTerminal } = require('../src/render-certification');
const { renderSheet } = require('../src/render-sheet');
const { getCatalog } = require('../src/i18n');
const { needle } = require('../test-fixtures/copy-needle');

// talents-ai-score, issue 123 / ADR-044.

const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

/* ---------- the pure policy ---------- */

test('resolveReportGate: the general user (not logged in) sees everything', () => {
  const g = resolveReportGate({ loggedIn: false });
  assert.equal(g.loggedIn, false);
  assert.equal(g.showRoadmap, true);
  assert.equal(g.showAgentSuggestions, true);
  assert.equal(g.showCertifyRemediation, true);
});

test('resolveReportGate: a logged-in Talent loses exactly the three ADR-044 surfaces', () => {
  const g = resolveReportGate({ loggedIn: true });
  assert.equal(g.loggedIn, true);
  assert.equal(g.showRoadmap, false);
  assert.equal(g.showAgentSuggestions, false);
  assert.equal(g.showCertifyRemediation, false);
});

test('resolveReportGate: the result is frozen (no surface can mutate the shared policy)', () => {
  const g = resolveReportGate({ loggedIn: true });
  assert.throws(() => { g.showRoadmap = true; }, TypeError);
});

test('DEFAULT_REPORT_GATE is the general-user policy — so a renderer with no gate shows everything', () => {
  assert.equal(DEFAULT_REPORT_GATE.loggedIn, false);
  assert.equal(DEFAULT_REPORT_GATE.showRoadmap, true);
  assert.equal(DEFAULT_REPORT_GATE.showAgentSuggestions, true);
  assert.equal(DEFAULT_REPORT_GATE.showCertifyRemediation, true);
  // talents-ai-score, framework-copy gate: OPPOSITE polarity from the three
  // above — the general-user path must never suddenly grow NEW copy.
  assert.equal(DEFAULT_REPORT_GATE.showFrameworkIntro, false);
});

test('resolveReportGate: showFrameworkIntro requires loggedIn AND a platform-Talent userType', () => {
  assert.equal(resolveReportGate({ loggedIn: false }).showFrameworkIntro, false);
  assert.equal(resolveReportGate({ loggedIn: true, userType: null }).showFrameworkIntro, false, 'logged in but no reliable signal -> off');
  assert.equal(resolveReportGate({ loggedIn: true, userType: 'WORKS_TALENT' }).showFrameworkIntro, true);
  assert.equal(resolveReportGate({ loggedIn: true, userType: 'WORKS_PARTNER' }).showFrameworkIntro, true);
  assert.equal(resolveReportGate({ loggedIn: true, userType: 'HUB' }).showFrameworkIntro, false, 'staff is not a Talent');
  assert.equal(resolveReportGate({ loggedIn: true, userType: 'WORKS_CLIENT' }).showFrameworkIntro, false, 'a client is not a Talent');
  assert.equal(resolveReportGate({ loggedIn: false, userType: 'WORKS_TALENT' }).showFrameworkIntro, false);
});

/* ---------- identity is read once, correctly ---------- */

function freshEnv() {
  return { AI_FOOTPRINT_CONFIG_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'aifp-gate-')) };
}

test('reportGateForIdentity: no session -> general user, status none', () => {
  const g = reportGateForIdentity(freshEnv());
  assert.equal(g.loggedIn, false);
  assert.equal(g.showRoadmap, true);
  assert.equal(g.sessionStatus, 'none');
});

test('reportGateForIdentity: an ACTIVE session -> logged in, everything gated', () => {
  const env = freshEnv();
  saveAuthSession({ accessToken: 'x', expiresAt: new Date(Date.now() + 60_000).toISOString() }, env);
  const g = reportGateForIdentity(env);
  assert.equal(g.loggedIn, true);
  assert.equal(g.showRoadmap, false);
  assert.equal(g.sessionStatus, 'active');
});

function fakeHubToken(userType) {
  const seg = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  return `${seg({ alg: 'none' })}.${seg({ userType })}.sig`;
}

test('reportGateForIdentity: an ACTIVE session whose hub identity is WORKS_TALENT gets the framework intro', () => {
  const env = freshEnv();
  saveAuthSession(
    { accessToken: 'x', expiresAt: new Date(Date.now() + 60_000).toISOString(), hubAccessToken: fakeHubToken('WORKS_TALENT') },
    env,
  );
  assert.equal(reportGateForIdentity(env).showFrameworkIntro, true);
});

test('reportGateForIdentity: an ACTIVE session whose hub identity is a CLIENT does NOT get the framework intro', () => {
  const env = freshEnv();
  saveAuthSession(
    { accessToken: 'x', expiresAt: new Date(Date.now() + 60_000).toISOString(), hubAccessToken: fakeHubToken('WORKS_CLIENT') },
    env,
  );
  assert.equal(reportGateForIdentity(env).showFrameworkIntro, false);
});

test('reportGateForIdentity: an ACTIVE session with NO hubAccessToken (no reliable signal) does NOT get the framework intro', () => {
  const env = freshEnv();
  saveAuthSession({ accessToken: 'x', expiresAt: new Date(Date.now() + 60_000).toISOString() }, env);
  const g = reportGateForIdentity(env);
  assert.equal(g.loggedIn, true);
  assert.equal(g.showFrameworkIntro, false);
});

test('reportGateForIdentity: no session at all -> no framework intro', () => {
  assert.equal(reportGateForIdentity(freshEnv()).showFrameworkIntro, false);
});

/* ---------- ADR-058 fase 1: the `external` distribution profile also hides
   the framework intro, even for a stale WORKS_TALENT session ---------- */

test('resolveReportGate: profile defaults to \'talent\' -- every EXISTING call site keeps its behaviour', () => {
  assert.equal(resolveReportGate({ loggedIn: true, userType: 'WORKS_TALENT' }).showFrameworkIntro, true);
});

test('resolveReportGate: an `external` profile never gets the framework intro, even logged in as a platform Talent', () => {
  assert.equal(
    resolveReportGate({ loggedIn: true, userType: 'WORKS_TALENT', profile: 'external' }).showFrameworkIntro,
    false,
  );
});

test('reportGateForIdentity: config.json profile:"external" + a STALE WORKS_TALENT session -> still no framework intro', () => {
  const env = freshEnv();
  saveAuthSession(
    { accessToken: 'x', expiresAt: new Date(Date.now() + 60_000).toISOString(), hubAccessToken: fakeHubToken('WORKS_TALENT') },
    env,
  );
  config.saveConfigFile({ profile: 'external' }, env);
  const g = reportGateForIdentity(env);
  assert.equal(g.loggedIn, true, 'the session itself is still active');
  assert.equal(g.showFrameworkIntro, false, 'the external profile overrides it regardless');
});

test('reportGateForIdentity: config.json profile:"talent" (or absent) + WORKS_TALENT session -> framework intro shows', () => {
  const env = freshEnv();
  saveAuthSession(
    { accessToken: 'x', expiresAt: new Date(Date.now() + 60_000).toISOString(), hubAccessToken: fakeHubToken('WORKS_TALENT') },
    env,
  );
  assert.equal(reportGateForIdentity(env).showFrameworkIntro, true, 'no profile key at all defaults to talent');
  config.saveConfigFile({ profile: 'talent' }, env);
  assert.equal(reportGateForIdentity(env).showFrameworkIntro, true);
});

test('resolveReportGate/reportGateForIdentity: `profile` is exposed on the gate, normalized to exactly "external"|"talent"', () => {
  assert.equal(resolveReportGate({}).profile, 'talent', 'default');
  assert.equal(resolveReportGate({ profile: 'talent' }).profile, 'talent');
  assert.equal(resolveReportGate({ profile: 'external' }).profile, 'external');
  assert.equal(resolveReportGate({ profile: 'bogus' }).profile, 'talent', 'never an arbitrary string');

  const env = freshEnv();
  assert.equal(reportGateForIdentity(env).profile, 'talent', 'no profile key at all defaults to talent');
  config.saveConfigFile({ profile: 'external' }, env);
  assert.equal(reportGateForIdentity(env).profile, 'external');
});

/* ---------- issue 130: the gate also carries the session's email as DATA ---------- */

test('resolveReportGate: carries the session email through when logged in', () => {
  const g = resolveReportGate({ loggedIn: true, email: 'talent@example.com' });
  assert.equal(g.email, 'talent@example.com');
});

test('resolveReportGate: email is null when not logged in, even if one is passed (never leak an anonymous "email")', () => {
  const g = resolveReportGate({ loggedIn: false, email: 'talent@example.com' });
  assert.equal(g.email, null);
});

test('resolveReportGate: a logged-in session with NO cached email (Google login) reports email: null, not undefined/missing', () => {
  const g = resolveReportGate({ loggedIn: true, email: null });
  assert.equal(g.email, null);
  assert.equal('email' in g, true);
});

test('reportGateForIdentity: an ACTIVE session with a cached email surfaces it on the gate', () => {
  const env = freshEnv();
  saveAuthSession({ accessToken: 'x', expiresAt: new Date(Date.now() + 60_000).toISOString(), email: 'talent@example.com' }, env);
  const g = reportGateForIdentity(env);
  assert.equal(g.email, 'talent@example.com');
});

test('reportGateForIdentity: an ACTIVE session with NO cached email (Google login) surfaces email: null', () => {
  const env = freshEnv();
  saveAuthSession({ accessToken: 'x', expiresAt: new Date(Date.now() + 60_000).toISOString(), email: null }, env);
  const g = reportGateForIdentity(env);
  assert.equal(g.loggedIn, true);
  assert.equal(g.email, null);
});

test('reportGateForIdentity: an EXPIRED session never surfaces its stale cached email (painted as anonymous)', () => {
  const env = freshEnv();
  saveAuthSession({ accessToken: 'x', expiresAt: new Date(Date.now() - 1000).toISOString(), email: 'talent@example.com' }, env);
  const g = reportGateForIdentity(env);
  assert.equal(g.loggedIn, false);
  assert.equal(g.email, null);
});

test('reportGateForIdentity: an EXPIRED session paints like anonymous BUT carries status "expired"', () => {
  const env = freshEnv();
  saveAuthSession({ accessToken: 'x', expiresAt: new Date(Date.now() - 1000).toISOString() }, env);
  const g = reportGateForIdentity(env);
  // Painted as the general user (the gate is right to)...
  assert.equal(g.loggedIn, false);
  assert.equal(g.showRoadmap, true);
  // ...but the status is preserved so bin/report.js can TELL them (ADR-044).
  assert.equal(g.sessionStatus, 'expired');
});

/* ---------- THE ANTI-DRIFT GUARD: every key changes a real render ---------- */

function footprintReport() {
  return {
    schemaVersion: 1, generatedAt: '2026-08-05T00:00:00Z', anonId: 'a', platform: 'darwin',
    summary: { totalDetected: 1, categories: [] },
    tools: [{ id: 'claude-code', detected: true, depth: {} }], technologies: [],
    agents: [{ name: 'test-writer', tools: [], model: 'sonnet', parent: null }],
    agentCounts: { agents: 1, skills: 0, commands: 0, mcpServers: 0, hooks: 0 },
    agentEvaluation: {
      evaluations: [{
        name: 'test-writer', description: 'd', improvements: ['UNIQUE-IMPROVEMENT-TIP-XYZ'],
        classification: { catalogId: 'dev-2', category: 'developer', role: 'QA', level: 'L2', method: 'llm' },
      }],
    },
  };
}
const MATURITY = { level: 2, name: 'x', score: 50, tierKey: 'T2', setupLevel: { key: 'S1', rank: 1, code: 'S1' } };

function certification() {
  return {
    items: [{
      skillName: 'TypeScript', technology: 'ts', scoreBand: 'mid', score: 55,
      dimensionScores: { correctness: 3 }, evidence: [],
      // buildRemediationPrompt reads item.result.improvements (real shape); a
      // non-empty list is what makes the prompt render at all.
      result: { improvements: ['UNIQUE-REMEDIATION-TIP-QRS'] },
    }],
    authorship: null,
  };
}

for (const lang of ['es', 'en']) {
  test(`GUARD [${lang}] showAgentSuggestions: ON prints per-agent tips, OFF removes them`, () => {
    const on = strip(renderTerminal(footprintReport(), MATURITY, lang, { gate: resolveReportGate({ loggedIn: false }) }));
    const off = strip(renderTerminal(footprintReport(), MATURITY, lang, { gate: resolveReportGate({ loggedIn: true }) }));
    assert.ok(on.includes('UNIQUE-IMPROVEMENT-TIP-XYZ'), 'the general user must see the tip');
    assert.equal(off.includes('UNIQUE-IMPROVEMENT-TIP-XYZ'), false, 'the logged-in Talent must not');
  });

  test(`GUARD [${lang}] showRoadmap: --roadmap ON prints the section, OFF prints NOTHING (the explanatory note was removed, dueño 2026-08-12)`, () => {
    const on = strip(renderTerminal(footprintReport(), MATURITY, lang, { showRoadmap: true, gate: resolveReportGate({ loggedIn: false }) }));
    const off = strip(renderTerminal(footprintReport(), MATURITY, lang, { showRoadmap: true, gate: resolveReportGate({ loggedIn: true }) }));
    // ON: real, substantial roadmap content.
    assert.ok(on.length > 400, 'the roadmap section should be substantial');
    assert.ok(off.length < on.length / 4, 'a gated --roadmap request must render close to nothing now, no explanatory text');
    assert.equal(off.includes('certify'), false, 'no mention of certify either -- that was part of the removed note');
  });

  test(`GUARD [${lang}] showRoadmap: the DEFAULT view hint disappears (not replaced by a note) when gated`, () => {
    const on = strip(renderTerminal(footprintReport(), MATURITY, lang, { gate: resolveReportGate({ loggedIn: false }) }));
    const off = strip(renderTerminal(footprintReport(), MATURITY, lang, { gate: resolveReportGate({ loggedIn: true }) }));
    assert.ok(on.includes('usage --roadmap'), 'general user gets the discoverability hint');
    assert.equal(off.includes('usage --roadmap'), false, 'logged-in Talent is not pointed at a closed door');
    // dueño (2026-08-12): the "your level comes from certifying" note that used to fill this gap is REMOVED — the section is shorter now, not replaced by different text.
    assert.ok(off.length < on.length, 'the gated view ends without the note that used to explain the gap');
  });

  test(`GUARD [${lang}] showCertifyRemediation: ON prints the remediation prompt, OFF removes it`, () => {
    const r = getCatalog(lang).certify.report;
    const on = strip(renderCertificationTerminal(certification(), lang, { gate: resolveReportGate({ loggedIn: false }) }));
    const off = strip(renderCertificationTerminal(certification(), lang, { gate: resolveReportGate({ loggedIn: true }) }));
    const heading = needle(r.remediationHeading, `${lang} remediationHeading`);
    assert.ok(on.includes(heading), 'the general user must see the remediation prompt');
    assert.equal(off.includes(heading), false, 'the logged-in Talent must not');
  });
}

/* ---------- THE SHAREABLE SHEET is a renderer of the layer too (issue 123 follow-up) ---------- */

function sheetSkillProject() {
  return {
    root: '/tmp/d',
    footprint: {
      generatedAt: '2026-08-05T00:00:00Z',
      report: { agents: [], agentCounts: { agents: 0, skills: 0, commands: 0, mcpServers: 0, hooks: 0 }, tools: [], technologies: [] },
      maturity: { tierKey: 'T2', tierName: 'x', score: 50, setupLevel: { key: 'S1', rank: 1, code: 'S1' } },
    },
    certifications: {
      ts: { item: { skillName: 'TypeScript', technology: 'ts', result: { score: 55, rationale: 'r', improvements: ['SHEET-SKILL-TIP-999'] } } },
    },
  };
}

// Agent certifications (and their per-agent suggestion block) were removed from the report (ADR-033); the sheet's only gated "how to improve" surface left is the per-SKILL one below.
for (const lang of ['es', 'en']) {
  test(`GUARD [${lang}] the SHAREABLE sheet: showCertifyRemediation ON prints the per-SKILL tips, OFF removes the whole block`, () => {
    const c = getCatalog(lang).sheet;
    const on = renderSheet(sheetSkillProject(), lang, resolveReportGate({ loggedIn: false }));
    const off = renderSheet(sheetSkillProject(), lang, resolveReportGate({ loggedIn: true }));
    assert.ok(on.includes('SHEET-SKILL-TIP-999'), 'the general user must see the skill tip');
    assert.ok(on.includes(needle(c.comoMejorar, `${lang} comoMejorar`)), 'and the block heading');
    assert.equal(off.includes('SHEET-SKILL-TIP-999'), false, 'the logged-in Talent must not see the skill tip');
    // This project has ONLY a skill (no agent block), so the heading's absence is
    // purely the skill block being gone — not a blank left behind.
    assert.equal(off.includes(needle(c.comoMejorar, `${lang} comoMejorar`)), false, 'nor an empty "how to improve" block');
    assert.equal(/certificarte|certifying/.test(off), false, 'no talent-facing note in the portfolio artifact');
  });
}

/* ---------- the general-user path is the DEFAULT, not a special case ---------- */

for (const lang of ['es', 'en']) {
  test(`DEFAULT [${lang}]: a renderer called with NO gate === the general-user render (regression guard)`, () => {
    const noGate = strip(renderTerminal(footprintReport(), MATURITY, lang, {}));
    const explicit = strip(renderTerminal(footprintReport(), MATURITY, lang, { gate: resolveReportGate({ loggedIn: false }) }));
    assert.equal(noGate, explicit, 'no gate must render byte-identically to the general-user gate');
    // And it really shows everything.
    assert.ok(noGate.includes('UNIQUE-IMPROVEMENT-TIP-XYZ'));
    assert.ok(noGate.includes('usage --roadmap'));
  });

  test(`DEFAULT [${lang}]: the SHEET with NO gate === the general-user sheet (skill, regression guard)`, () => {
    // Agent certifications were removed from the report (ADR-033); the surviving
    // gated sheet surface is the per-skill remediation.
    for (const [proj, tip] of [[sheetSkillProject(), 'SHEET-SKILL-TIP-999']]) {
      const noGate = renderSheet(proj, lang);
      const explicit = renderSheet(proj, lang, resolveReportGate({ loggedIn: false }));
      assert.equal(noGate, explicit, 'no gate must render byte-identically to the general-user gate');
      assert.ok(noGate.includes(tip));
    }
  });
}
