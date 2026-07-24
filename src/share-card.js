'use strict';

const fs = require('fs');
const path = require('path');

const { getCatalog } = require('./i18n');
const { setupLevelForTier } = require('./tier-engine');
const { renderDocument } = require('./report-theme');
const { loadState, configDir, projectSlug, fileUrl } = require('./report-store');
const { WORDMARK_VIEWBOX, WORDMARK_PATHS } = require('./shakers-wordmark');

/*
 * `share` command (skill-code-certification): a branded, self-contained card
 * the Talent can post on LinkedIn to show off their AI-usage FOOTPRINT result
 * (tier T0-T7 + score /100 + maturity band). Enfoque elegido por el usuario:
 * tarjeta HTML + "Download PNG" generado EN EL NAVEGADOR (zero-dep) — el CLI
 * nunca rasteriza, solo escribe un HTML self-contained y imprime su enlace.
 *
 * Invariants (same discipline as the HTML reports, src/report-theme.js):
 *   - ZERO network: every asset is inline. The logo is the REAL hand-drawn
 *     "shakers" wordmark (…/images/shakers-text-logo.svg), inlined as SVG
 *     <path>s (src/shakers-wordmark.js) — never a remote <image>, <use>, url()
 *     or data-URI fetch. (The lightning bolt was removed; the wordmark is the
 *     logo.) The remaining texts (headline/tier/score/stats) use the system
 *     sans stack (no @font-face, no CDN). This is what keeps the browser-side
 *     SVG->canvas->PNG export from TAINTING the canvas (an external ref would
 *     make toDataURL throw a SecurityError).
 *   - Deterministic: the card content is a pure function of the stored
 *     footprint (tier/score/band + derived signal counts) — same footprint
 *     always yields the same card.
 *   - The CARD ITSELF is ENGLISH-FIXED (a brand surface, like the sh-eval
 *     banner and the installer). The CLI copy around it (bin/share.js) is
 *     localized (es/en). Tier/band labels come from the `en` i18n catalog
 *     (tierNames/levelNames) so they read in English regardless of OS locale.
 *
 * Data source: the per-project footprint persisted by src/report-store.js
 * (`report-state.json`). No footprint for this project -> the command tells the
 * Talent to run `footprint` first (bin/share.js), it never fabricates a result.
 */

// LinkedIn shares render best at 1.91:1 (1200×627). Fixed so the browser-side
// canvas export writes exactly these pixels.
const CARD_W = 1200;
const CARD_H = 627;

// Brand palette (from shakers-design-system/design-spec/tokens.css). The card
// is a DARK surface that reads GREEN + LIME: brand teal for the secondary
// surfaces (accent stripe, stats panel) and LIME reserved for the HERO data
// (tier, score ring, stat numbers). The lightning bolt was dropped — the logo
// is now the hand-drawn wordmark alone (user request).
const BRAND = {
  lime: '#d8e637',      // hero accent (tier, score arc, stat numbers)
  dark: '#181B1A',      // card background
  white: '#ffffff',
  zinc300: '#d4d4d8',   // stat labels / technology names (light, secondary)
  zinc400: '#a1a1aa',   // "/ 100", muted labels
  zinc500: '#71717a',   // shakersworks.com, separators
  teal500: '#0e7d69',   // teal-500 — accent stripe + eyebrow
  teal700: '#08473c',   // teal-700 — band pill + score-ring track
};

// Font stack shared with the reports (Inter -> system fallback). Pure font
// NAMES only: no @font-face / no url(), so nothing is fetched and the SVG stays
// canvas-exportable without tainting.
const FONT_STACK =
  "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

/*
 * Loads THIS project's stored footprint from the report store: the maturity
 * (tier/score/band) PLUS a compact set of derived signals for the card's stats
 * strip (AI tools detected, MCP servers, agents/skills/commands/hooks, top
 * technologies). Everything is read from what's ALREADY persisted in
 * report-state.json (`project.footprint.{maturity,report}`) — never a fresh
 * scan, never fabricated. Returns null when the project has no footprint yet
 * (the caller turns that into an actionable "run footprint first" message).
 * `load` is injectable purely for tests; production reads via report-store.
 */
function loadProjectFootprint(root, { load = loadState } = {}) {
  const absRoot = path.resolve(root || process.cwd());
  let state;
  try {
    state = load();
  } catch {
    return null;
  }
  const project = state && state.projects && state.projects[absRoot];
  const fp = project && project.footprint;
  const m = fp && fp.maturity;
  if (!m || m.tierKey == null || typeof m.score !== 'number') return null;

  // Derived signals from the persisted report (defensive: any missing piece
  // reads as 0 / empty — an older stored report never crashes the card).
  const report = (fp && fp.report) || {};
  const counts = report.agentCounts || {};
  const toolsDetected = Array.isArray(report.tools)
    ? report.tools.filter((tl) => tl && tl.detected).length
    : 0;
  const mcpTotal = report.mcp && typeof report.mcp.total === 'number'
    ? report.mcp.total
    : (typeof counts.mcpServers === 'number' ? counts.mcpServers : 0);
  const technologies = Array.isArray(report.technologies)
    ? report.technologies.filter((s) => typeof s === 'string' && s.trim())
    : [];

  return {
    root: absRoot,
    tier: m.tier,
    tierKey: m.tierKey,
    score: m.score,
    level: m.level,
    levelKey: m.key,
    // ADR-016: Setup Level for the card pill (replaces the 0-4 band). Prefer the
    // persisted `setupLevel`; derive from the tier for older stored reports.
    setupLevelKey: (m.setupLevel && m.setupLevel.key)
      || (typeof m.tier === 'number' ? setupLevelForTier(m.tier).key : 'none'),
    generatedAt: fp.generatedAt || null,
    signals: {
      toolsDetected,
      mcpServers: mcpTotal,
      agents: typeof counts.agents === 'number' ? counts.agents : 0,
      skills: typeof counts.skills === 'number' ? counts.skills : 0,
      commands: typeof counts.commands === 'number' ? counts.commands : 0,
      hooks: typeof counts.hooks === 'number' ? counts.hooks : 0,
      technologies,
    },
  };
}

// How many top technologies to name on the card (kept small — social card).
const MAX_TECHNOLOGIES = 4;

/*
 * Maps the raw footprint into the card's display model. English-fixed: tier and
 * band names are resolved through the `en` catalog (never tier-engine.js's
 * Spanish `tierName`), so the branded surface reads in English regardless of
 * the machine locale.
 *
 * The model also carries a light `stats` line (only signals with a value > 0 —
 * zeros are NOT shown) and the `technologies` shortlist, both derived from
 * `fp.signals` (from loadProjectFootprint). Every field is defensive: a bare
 * `{tierKey,levelKey,score}` (no signals) still yields a valid model with an
 * empty stats list, so callers/tests that don't provide signals never break.
 */
function buildCardModel(fp) {
  const en = getCatalog('en');
  const tierKey = fp.tierKey;
  const tierName = (en.tierNames && en.tierNames[tierKey]) || tierKey;
  // ADR-016: Setup Level label for the pill (English-fixed like the tier name).
  const setupKey = fp.setupLevelKey || 'none';
  const bandName = (en.setupLevels && en.setupLevels[setupKey] && en.setupLevels[setupKey].label) || '';

  const s = fp.signals || {};
  const n = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
  // Only stats with a value > 0 make the card — never a "0 skills" filler.
  // Order is the reading order the label list implies (tools -> hooks).
  const stats = [
    { value: n(s.toolsDetected), label: 'AI tools' },
    { value: n(s.mcpServers), label: 'MCP' },
    { value: n(s.agents), label: 'agents' },
    { value: n(s.skills), label: 'skills' },
    { value: n(s.commands), label: 'commands' },
    { value: n(s.hooks), label: 'hooks' },
  ].filter((st) => st.value > 0);
  const technologies = Array.isArray(s.technologies) ? s.technologies.slice(0, MAX_TECHNOLOGIES) : [];

  return {
    tierKey,
    tierName,
    bandName,
    score: Math.max(0, Math.min(100, Math.round(fp.score))),
    stats,
    technologies,
  };
}

// Suggested LinkedIn caption, built deterministically from the model. English.
function buildSuggestedText(model) {
  return (
    `I just measured my AI tooling maturity with the Shakers AI Usage Evaluator: `
    + `tier ${model.tierKey} (${model.tierName}), scoring ${model.score}/100. `
    + `How do you work with AI? Measure yours at shakersworks.com `
    + `#AI #DeveloperExperience #AITooling #Shakers`
  );
}

/*
 * Builds the branded card as a SELF-CONTAINED SVG (1200×627). Everything is
 * inline: the logo is the hand-drawn "shakers" wordmark (SVG <path>s), text
 * uses the system font stack, the score is a stroked donut ring, the stats are
 * a light inline text line. NO <image>, url(), xlink:href, @font-face or
 * foreignObject — so the browser can serialize it, draw it to a <canvas> and
 * toDataURL() a PNG without tainting.
 *
 * Palette reads GREEN + LIME on dark: teal (stripe, eyebrow, band pill, score-
 * ring track) for the secondary chrome, with LIME reserved for the hero data
 * (tier, score arc, stat numbers). No bottom footer/panel — the brand lives up
 * top (wordmark + shakersworks.com) and the bottom edge is left with air.
 */
function renderCardSvg(model, { id = 'share-card-svg' } = {}) {
  const { tierKey, tierName, bandName, score, stats, technologies } = model;

  // Logo: the REAL hand-drawn "shakers" wordmark (87×18 asset), ~44px tall,
  // top-left, in white. Inlined <path>s (self-contained — see
  // shakers-wordmark.js), so the card's canvas export never taints.
  const wordmarkScale = 44 / WORDMARK_VIEWBOX.h; // ≈ 2.44
  const wordmark = WORDMARK_PATHS
    .map((d) => `<path d="${d}" fill="${BRAND.white}"/>`)
    .join('');

  // Score donut ring (right). Deterministic geometry from the score.
  const cx = 980;
  const cy = 262;
  const r = 118;
  const circ = 2 * Math.PI * r;
  const dashOffset = (circ * (1 - score / 100)).toFixed(2);

  // Stats: a single LIGHT line — only signals with a value > 0 (buildCardModel
  // already filtered zeros out). Number in lime, label muted, " · " separators.
  const SEP = `<tspan fill="${BRAND.zinc500}">   ·   </tspan>`;
  const statsInline = (Array.isArray(stats) ? stats : [])
    .map((st) => `<tspan font-weight="800" fill="${BRAND.lime}">${esc(st.value)}</tspan><tspan fill="${BRAND.zinc300}"> ${esc(st.label)}</tspan>`)
    .join(SEP);
  const statsLine = stats && stats.length
    ? `<text x="82" y="500" font-size="27" fill="${BRAND.zinc300}">${statsInline}</text>`
    : '';

  // Technologies: one muted line ("Top: A · B · C"), only when present.
  const techLine = Array.isArray(technologies) && technologies.length
    ? `<text x="82" y="546" font-size="22" fill="${BRAND.zinc400}">Top: <tspan fill="${BRAND.white}">${esc(technologies.join(' · '))}</tspan></text>`
    : '';

  // Band pill (teal, secondary) with a lime status dot before the band name.
  const pillWidth = Math.max(150, 58 + bandName.length * 12);

  return `<svg id="${id}" width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}"`
    + ` xmlns="http://www.w3.org/2000/svg" font-family="${esc(FONT_STACK)}">
  <rect width="${CARD_W}" height="${CARD_H}" fill="${BRAND.dark}"/>
  <rect x="0" y="0" width="12" height="${CARD_H}" fill="${BRAND.teal500}"/>

  <!-- logo: real hand-drawn shakers wordmark (inline vector paths, self-contained) -->
  <g transform="translate(80,56) scale(${wordmarkScale.toFixed(4)})">${wordmark}</g>
  <text x="1160" y="92" text-anchor="end" font-size="19" fill="${BRAND.zinc500}">shakersworks.com</text>

  <!-- eyebrow (teal, letterspaced) -->
  <text x="82" y="176" font-size="25" letter-spacing="4" font-weight="700" fill="${BRAND.teal500}">AI TOOLING MATURITY</text>

  <!-- tier (hero, lime) + tier name -->
  <text x="76" y="330" font-size="150" font-weight="800" fill="${BRAND.lime}">${esc(tierKey)}</text>
  <text x="82" y="392" font-size="40" font-weight="700" fill="${BRAND.white}">${esc(tierName)}</text>

  <!-- maturity band pill (teal, secondary) with a lime status dot -->
  <g transform="translate(82,414)">
    <rect x="0" y="0" rx="15" ry="15" width="${pillWidth}" height="40" fill="${BRAND.teal700}"/>
    <circle cx="24" cy="20" r="6" fill="${BRAND.lime}"/>
    <text x="42" y="27" font-size="19" font-weight="700" fill="${BRAND.white}">${esc(bandName)}</text>
  </g>

  <!-- score donut (hero, lime arc on a teal track) -->
  <g transform="translate(${cx},${cy})">
    <circle r="${r}" fill="none" stroke="${BRAND.teal700}" stroke-width="22"/>
    <circle r="${r}" fill="none" stroke="${BRAND.lime}" stroke-width="22" stroke-linecap="round"
      stroke-dasharray="${circ.toFixed(2)}" stroke-dashoffset="${dashOffset}" transform="rotate(-90)"/>
    <text text-anchor="middle" y="14" font-size="86" font-weight="800" fill="${BRAND.white}">${score}</text>
    <text text-anchor="middle" y="56" font-size="24" letter-spacing="2" fill="${BRAND.zinc400}">/ 100</text>
  </g>

  <!-- light stats line + technologies (no panel, no footer; bottom edge breathes) -->
  ${statsLine}
  ${techLine}
</svg>`;
}

// Component CSS for the HTML wrapper (the page around the card). Reuses the
// report theme tokens (var(--...)) from report-theme.js's renderDocument.
const SHARE_CSS = `
  .card-frame{margin:8px 0 22px}
  .card-svg-wrap{max-width:760px;border-radius:var(--r-xl);overflow:hidden;
    box-shadow:var(--shadow-lg);border:1px solid var(--border);background:#181B1A}
  .card-svg-wrap svg{display:block;width:100%;height:auto}
  .actions{display:flex;flex-wrap:wrap;gap:12px;margin:0 0 18px}
  .btn{display:inline-flex;align-items:center;gap:8px;font:inherit;font-size:15px;
    font-weight:600;padding:11px 20px;border-radius:var(--r-md);border:1px solid transparent;
    cursor:pointer;text-decoration:none;line-height:1}
  .btn-primary{background:var(--primary);color:var(--primary-fg)}
  .btn-primary:hover{background:var(--emphasis-strong)}
  .btn-secondary{background:var(--accent-lime);color:var(--accent-lime-fg)}
  .btn-secondary:hover{filter:brightness(.96)}
  .flow-note{display:flex;gap:12px;padding:16px 18px;border-radius:var(--r-lg);
    background:var(--secondary);color:var(--secondary-fg);margin:0 0 22px;font-size:14px;line-height:1.55}
  .flow-note ol{margin:6px 0 0;padding-left:20px}
  .flow-note li{margin:2px 0}
  .suggested{margin:0 0 8px}
  .sug-head{display:flex;align-items:center;justify-content:space-between;margin:0 0 8px}
  .sug-head span{font-size:13px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--faint)}
  .copy{font:inherit;font-size:12.5px;font-weight:600;padding:6px 12px;border-radius:var(--r-sm);
    border:1px solid var(--border);background:var(--surface);color:var(--muted);cursor:pointer}
  .copy.copied{background:var(--secondary);color:var(--secondary-fg);border-color:var(--secondary)}
  #li-text{margin:0;padding:16px 18px;border:1px solid var(--border);border-radius:var(--r-md);
    background:var(--track);color:var(--fg);font-size:14.5px;line-height:1.6}
`;

// Browser-side PNG export + LinkedIn share wiring. Zero-dep: native
// XMLSerializer + Image + <canvas>.toDataURL('image/png'). The SVG is fully
// self-contained (see renderCardSvg) so the canvas never taints. This runs in
// the browser only; it is a string appended after report-theme's COPY_SCRIPT.
const SHARE_SCRIPT = `
  (function(){
    var CARD_W=${CARD_W}, CARD_H=${CARD_H};
    var svg=document.getElementById('share-card-svg');
    var dl=document.getElementById('dl-png');
    var li=document.getElementById('li-share');
    var liText=document.getElementById('li-text');
    if(li){
      var text=liText?liText.textContent:'';
      li.setAttribute('href','https://www.linkedin.com/feed/?shareActive=true&text='+encodeURIComponent(text));
    }
    if(dl&&svg){
      dl.addEventListener('click',function(){
        // Serialize the inline SVG and load it as an image. encodeURIComponent
        // (not btoa) so any non-ASCII survives; charset is declared for safety.
        var xml=new XMLSerializer().serializeToString(svg);
        var src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(xml);
        var img=new Image();
        img.onload=function(){
          var canvas=document.createElement('canvas');
          canvas.width=CARD_W; canvas.height=CARD_H;
          var ctx=canvas.getContext('2d');
          ctx.fillStyle='#181B1A'; ctx.fillRect(0,0,CARD_W,CARD_H);
          ctx.drawImage(img,0,0,CARD_W,CARD_H);
          var png;
          try{ png=canvas.toDataURL('image/png'); }
          catch(e){ /* self-contained SVG shouldn't taint; bail quietly if it did */ return; }
          var a=document.createElement('a');
          a.href=png; a.download='shakers-ai-maturity.png';
          document.body.appendChild(a); a.click(); a.remove();
        };
        img.onerror=function(){};
        img.src=src;
      });
    }
  })();
`;

/*
 * Assembles the full, self-contained HTML page around the card, using the
 * shared Shakers report theme (report-theme.js#renderDocument). English-fixed
 * copy (brand surface). The suggested LinkedIn caption is copyable via the
 * theme's generic [data-copy-target] handler.
 */
function renderShareCardHtml(model) {
  const svg = renderCardSvg(model);
  const suggested = buildSuggestedText(model);

  const body = `<header>
    <span class="badge"><span class="spark"></span>SHAKERS</span>
    <h1>Share your AI maturity</h1>
    <p class="sub">A branded card to post on LinkedIn.</p>
  </header>

  <div class="card-frame">
    <div class="card-svg-wrap">${svg}</div>
  </div>

  <div class="actions">
    <button type="button" id="dl-png" class="btn btn-primary">Download PNG</button>
    <a id="li-share" class="btn btn-secondary" href="https://www.linkedin.com/feed/?shareActive=true" target="_blank" rel="noopener">Share on LinkedIn</a>
  </div>

  <div class="flow-note">
    <span aria-hidden="true">💡</span>
    <div>
      <strong>LinkedIn can't attach an image from a URL.</strong> To post the card:
      <ol>
        <li>Click <strong>Download PNG</strong> to save the image.</li>
        <li>Click <strong>Share on LinkedIn</strong> to open the composer (with the suggested text).</li>
        <li>Attach the downloaded PNG to your post.</li>
      </ol>
    </div>
  </div>

  <section class="suggested">
    <div class="sug-head">
      <span>Suggested text</span>
      <button type="button" class="copy" data-copy-target="li-text" data-copied-label="Copied ✓">Copy</button>
    </div>
    <p id="li-text">${esc(suggested)}</p>
  </section>

  <footer>
    <div class="priv">
      <span class="lock" aria-hidden="true">🔒</span>
      <span>Generated locally on your machine. The card and the PNG are built entirely in your browser — nothing is uploaded.</span>
    </div>
  </footer>`;

  return renderDocument({
    lang: 'en',
    title: 'Shakers — Share your AI maturity',
    componentCss: SHARE_CSS,
    body,
    script: SHARE_SCRIPT,
  });
}

// Per-project card file, alongside the reports in ~/.config/ai-footprint/
// (override via AI_FOOTPRINT_CONFIG_DIR). Reuses report-store's slug so the
// same project always overwrites its own card, never a second one.
function cardPathFor(absRoot) {
  return path.join(configDir(), `share-${projectSlug(path.resolve(absRoot))}.html`);
}

/*
 * Orchestrates the command: load the project's footprint, and either return a
 * "no footprint" signal or render + write the card and return its file:// link.
 * `load` is injectable for tests. Never throws on a missing footprint.
 */
function generateShareCard({ root, load } = {}) {
  const absRoot = path.resolve(root || process.cwd());
  const fp = loadProjectFootprint(absRoot, load ? { load } : {});
  if (!fp) return { ok: false, reason: 'no-footprint', root: absRoot };

  const model = buildCardModel(fp);
  const html = renderShareCardHtml(model);
  fs.mkdirSync(configDir(), { recursive: true });
  const htmlPath = cardPathFor(absRoot);
  fs.writeFileSync(htmlPath, html);
  return { ok: true, root: absRoot, model, html, htmlPath, fileUrl: fileUrl(htmlPath) };
}

module.exports = {
  CARD_W,
  CARD_H,
  loadProjectFootprint,
  buildCardModel,
  buildSuggestedText,
  renderCardSvg,
  renderShareCardHtml,
  cardPathFor,
  generateShareCard,
};
