'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  CARD_W,
  CARD_H,
  loadProjectFootprint,
  buildCardModel,
  buildSuggestedText,
  renderCardSvg,
  renderShareCardHtml,
  cardPathFor,
  generateShareCard,
} = require('../src/share-card');

// A stored state with a footprint for one project, mirroring report-store's
// schema-v2 shape (projects keyed by absolute path).
function stateWithFootprint(absRoot, maturity) {
  return {
    schemaVersion: 2,
    updatedAt: '2026-07-16T10:00:00.000Z',
    projects: {
      [absRoot]: {
        root: absRoot,
        updatedAt: '2026-07-16T10:00:00.000Z',
        footprint: { generatedAt: '2026-07-16T10:00:00.000Z', report: { tools: [] }, maturity },
        certifications: {},
      },
    },
  };
}

const MATURITY = {
  level: 4, key: 'orchestrator', name: 'Orquestador', emoji: '●',
  score: 78, tier: 5, tierKey: 'T5', tierName: 'Operador agéntico',
};

test('loadProjectFootprint: returns the stored tier/score/band for the project', () => {
  const absRoot = path.resolve('/tmp/proj-a');
  const fp = loadProjectFootprint(absRoot, { load: () => stateWithFootprint(absRoot, MATURITY) });
  assert.ok(fp);
  assert.strictEqual(fp.tierKey, 'T5');
  assert.strictEqual(fp.tier, 5);
  assert.strictEqual(fp.score, 78);
  assert.strictEqual(fp.levelKey, 'orchestrator');
});

test('loadProjectFootprint: null when the project has no footprint', () => {
  const absRoot = path.resolve('/tmp/proj-none');
  assert.strictEqual(loadProjectFootprint(absRoot, { load: () => ({ schemaVersion: 2, projects: {} }) }), null);
  // Malformed maturity -> also null (never fabricates a result).
  const bad = loadProjectFootprint(absRoot, { load: () => stateWithFootprint(absRoot, { score: 'x' }) });
  assert.strictEqual(bad, null);
});

test('buildCardModel: tier and band labels resolve to ENGLISH regardless of locale', () => {
  const model = buildCardModel({ tierKey: 'T5', levelKey: 'orchestrator', score: 78 });
  assert.strictEqual(model.tierKey, 'T5');
  assert.strictEqual(model.tierName, 'Agentic operator'); // en catalog, not the Spanish tier-engine name
  assert.strictEqual(model.bandName, 'Orchestrator'); // en levelNames
  assert.strictEqual(model.score, 78);
  // Never the Spanish tier-engine name.
  assert.ok(!/Operador/.test(model.tierName));
});

test('buildCardModel: clamps/rounds the score into 0-100', () => {
  assert.strictEqual(buildCardModel({ tierKey: 'T7', levelKey: 'orchestrator', score: 140 }).score, 100);
  assert.strictEqual(buildCardModel({ tierKey: 'T0', levelKey: 'none', score: -3 }).score, 0);
  assert.strictEqual(buildCardModel({ tierKey: 'T3', levelKey: 'power', score: 63.6 }).score, 64);
});

test('renderCardSvg: correct dimensions and the tier/score/band content', () => {
  const svg = renderCardSvg(buildCardModel({ tierKey: 'T5', levelKey: 'orchestrator', score: 78 }));
  assert.match(svg, new RegExp(`width="${CARD_W}"`));
  assert.match(svg, new RegExp(`height="${CARD_H}"`));
  assert.match(svg, /viewBox="0 0 1200 627"/);
  assert.match(svg, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /id="share-card-svg"/);
  assert.match(svg, />T5</); // tier key
  assert.match(svg, />Agentic operator</); // tier name (english)
  assert.match(svg, />Orchestrator</); // band pill (english)
  assert.match(svg, />78</); // score
});

test('renderCardSvg: is SELF-CONTAINED — no external refs (would taint the canvas)', () => {
  const svg = renderCardSvg(buildCardModel({ tierKey: 'T5', levelKey: 'orchestrator', score: 78 }));
  assert.ok(!/<image/i.test(svg), 'no <image> element');
  assert.ok(!/xlink:href/i.test(svg), 'no xlink:href');
  assert.ok(!/url\(/i.test(svg), 'no url() reference');
  assert.ok(!/@font-face/i.test(svg), 'no @font-face');
  assert.ok(!/@import/i.test(svg), 'no @import');
  // The ONLY http(s) occurrence allowed is the SVG namespace declaration
  // (a namespace URI, never fetched) — any other would be an external asset.
  const httpHits = svg.match(/https?:\/\//g) || [];
  assert.strictEqual(httpHits.length, 1, 'only the xmlns namespace URI');
  // The real Shakers bolt is inlined as a <path>, not referenced.
  assert.match(svg, /<path d="M4\.21721 7\.63625/);
});

test('renderCardSvg: score ring dashoffset is deterministic from the score', () => {
  const svg0 = renderCardSvg(buildCardModel({ tierKey: 'T0', levelKey: 'none', score: 0 }));
  const svg100 = renderCardSvg(buildCardModel({ tierKey: 'T7', levelKey: 'orchestrator', score: 100 }));
  const circ = 2 * Math.PI * 128;
  // score 0 -> the lime arc is fully offset (empty ring); 100 -> offset 0 (full).
  assert.match(svg0, new RegExp(`stroke-dashoffset="${circ.toFixed(2)}"`));
  assert.match(svg100, /stroke-dashoffset="0.00"/);
});

test('buildSuggestedText: english caption mentions tier + score', () => {
  const text = buildSuggestedText(buildCardModel({ tierKey: 'T5', levelKey: 'orchestrator', score: 78 }));
  assert.match(text, /T5/);
  assert.match(text, /78\/100/);
  assert.match(text, /Shakers/);
  assert.match(text, /#AI/);
});

test('renderShareCardHtml: self-contained page with the card, PNG export and LinkedIn wiring', () => {
  const html = renderShareCardHtml(buildCardModel({ tierKey: 'T5', levelKey: 'orchestrator', score: 78 }));
  // The card SVG is inlined.
  assert.match(html, /id="share-card-svg"/);
  // Download PNG button + the browser-side SVG->canvas->PNG export.
  assert.match(html, /id="dl-png"/);
  assert.match(html, /Download PNG/);
  assert.match(html, /XMLSerializer/);
  assert.match(html, /getContext\('2d'\)/);
  assert.match(html, /toDataURL\('image\/png'\)/);
  // LinkedIn shortcut + the explicit "can't attach by URL -> download then attach" flow.
  assert.match(html, /id="li-share"/);
  assert.match(html, /linkedin\.com/);
  assert.match(html, /can't attach an image from a URL/i);
  // Suggested, copyable caption.
  assert.match(html, /id="li-text"/);
  assert.match(html, /data-copy-target="li-text"/);
  // No external stylesheet/script/font/image on the page either.
  assert.ok(!/<link /i.test(html), 'no <link>');
  assert.ok(!/src="http/i.test(html), 'no remote script/image src');
  // Match the real CSS RULE (`@font-face {`), not the bare substring: the page
  // embeds report-theme's TOKENS_CSS, which carries a descriptive CSS comment
  // ("Inter with a system fallback (no @font-face, no network)…"). A substring
  // check false-positives on that comment; the rule form still guarantees no
  // actual @font-face declaration (i.e. no network/webfont on the page).
  assert.ok(!/@font-face\s*\{/i.test(html), 'no @font-face rule');
});

test('generateShareCard: no footprint -> {ok:false, reason:no-footprint}, writes nothing', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'share-cfg-'));
  const prev = process.env.AI_FOOTPRINT_CONFIG_DIR;
  process.env.AI_FOOTPRINT_CONFIG_DIR = dir;
  try {
    const r = generateShareCard({ root: '/tmp/no-fp', load: () => ({ schemaVersion: 2, projects: {} }) });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.reason, 'no-footprint');
  } finally {
    if (prev === undefined) delete process.env.AI_FOOTPRINT_CONFIG_DIR; else process.env.AI_FOOTPRINT_CONFIG_DIR = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('generateShareCard: writes the per-project card and returns a file:// link', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'share-cfg-'));
  const prev = process.env.AI_FOOTPRINT_CONFIG_DIR;
  process.env.AI_FOOTPRINT_CONFIG_DIR = dir;
  const absRoot = path.resolve('/tmp/proj-a');
  try {
    const r = generateShareCard({ root: absRoot, load: () => stateWithFootprint(absRoot, MATURITY) });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.htmlPath, cardPathFor(absRoot));
    assert.ok(fs.existsSync(r.htmlPath), 'card html written');
    assert.match(r.fileUrl, /^file:\/\//);
    const html = fs.readFileSync(r.htmlPath, 'utf8');
    assert.match(html, />T5</);
    assert.match(html, /toDataURL\('image\/png'\)/);
  } finally {
    if (prev === undefined) delete process.env.AI_FOOTPRINT_CONFIG_DIR; else process.env.AI_FOOTPRINT_CONFIG_DIR = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
