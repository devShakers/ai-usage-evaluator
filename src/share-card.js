'use strict';

const fs = require('fs');
const path = require('path');

const { getCatalog } = require('./i18n');
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
  lime: '#d8e637',      // hero accent (tier, score ring, stat numbers)
  dark: '#181B1A',      // card background
  white: '#ffffff',
  zinc400: '#a1a1aa',
  zinc500: '#71717a',
  track: '#0b3a31',     // score-ring track: a dark teal (ties the ring into the green)
  teal500: '#0e7d69',   // teal-500 — accent stripe
  teal700: '#08473c',   // teal-700 — the stats panel surface
  primary: '#05342c',   // darkest brand green (reserved / deep accents)
  mint: '#bfe0d7',      // pale teal-tint for labels on the teal panel
  mintSoft: '#dcefe9',  // slightly brighter mint for the secondary line
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

// Max tier in the ladder (T0..T7). "Next" is only shown below the ceiling.
const MAX_TIER = 7;
// How many top technologies to name on the card (kept small — social card).
const MAX_TECHNOLOGIES = 4;

/*
 * Maps the raw footprint into the card's display model. English-fixed: tier and
 * band names are resolved through the `en` catalog (never tier-engine.js's
 * Spanish `tierName`), so the branded surface reads in English regardless of
 * the machine locale.
 *
 * The model also carries a compact `stats` strip (labels English-fixed too),
 * the `technologies` shortlist and the `nextTierKey` — all derived from
 * `fp.signals` (from loadProjectFootprint). Every field is defensive: a bare
 * `{tierKey,levelKey,score}` (no signals) still yields a valid model with
 * zeroed stats, so callers/tests that don't provide signals never break.
 */
function buildCardModel(fp) {
  const en = getCatalog('en');
  const tierKey = fp.tierKey;
  const tierName = (en.tierNames && en.tierNames[tierKey]) || tierKey;
  const bandName = (en.levelNames && en.levelNames[fp.levelKey]) || '';

  const s = fp.signals || {};
  const n = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
  const stats = [
    { value: n(s.toolsDetected), label: 'AI TOOLS' },
    { value: n(s.mcpServers), label: 'MCP' },
    { value: n(s.agents), label: 'AGENTS' },
    { value: n(s.skills), label: 'SKILLS' },
    { value: n(s.commands), label: 'COMMANDS' },
    { value: n(s.hooks), label: 'HOOKS' },
  ];
  const technologies = Array.isArray(s.technologies) ? s.technologies.slice(0, MAX_TECHNOLOGIES) : [];

  // "Next" tier: the immediate step above the current one, when below the
  // ceiling. Prefer the numeric tier; fall back to parsing "T<n>" from tierKey.
  let tierNum = typeof fp.tier === 'number' ? fp.tier : NaN;
  if (!isFinite(tierNum)) {
    const m = /^T(\d+)$/.exec(String(tierKey || ''));
    tierNum = m ? Number(m[1]) : NaN;
  }
  const nextTierKey = isFinite(tierNum) && tierNum < MAX_TIER ? `T${tierNum + 1}` : null;

  return {
    tierKey,
    tierName,
    bandName,
    score: Math.max(0, Math.min(100, Math.round(fp.score))),
    stats,
    technologies,
    nextTierKey,
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
 * uses the system font stack, the score is a stroked donut ring, the stats
 * strip is a teal panel. NO <image>, url(), xlink:href, @font-face or
 * foreignObject — so the browser can serialize it, draw it to a <canvas> and
 * toDataURL() a PNG without tainting.
 *
 * Palette reads GREEN + LIME on dark: teal-500 accent stripe + teal-700 stats
 * panel (the green), with LIME reserved for the hero data (tier, score ring,
 * stat numbers). The lightning bolt was removed — the wordmark is the logo.
 */
function renderCardSvg(model, { id = 'share-card-svg' } = {}) {
  const { tierKey, tierName, bandName, score, stats, technologies, nextTierKey } = model;

  // Logo: the REAL hand-drawn "shakers" wordmark (87×18 asset), ~44px tall,
  // top-left, in white. Inlined <path>s (self-contained — see
  // shakers-wordmark.js), so the card's canvas export never taints.
  const wordmarkScale = 44 / WORDMARK_VIEWBOX.h; // ≈ 2.44
  const wordmark = WORDMARK_PATHS
    .map((d) => `<path d="${d}" fill="${BRAND.white}"/>`)
    .join('');

  // Score donut ring (upper right). Deterministic geometry from the score.
  const cx = 980;
  const cy = 250;
  const r = 115;
  const circ = 2 * Math.PI * r;
  const dashOffset = (circ * (1 - score / 100)).toFixed(2);

  // Stats strip: 6 evenly spaced cells inside the teal panel (number in lime,
  // label in a pale teal-tint). Centres chosen to sit comfortably inside the
  // 1200-wide panel with side padding.
  const statCx = [140, 324, 508, 692, 876, 1060];
  const statCells = (Array.isArray(stats) ? stats : [])
    .slice(0, statCx.length)
    .map((st, i) => `<text x="${statCx[i]}" y="524" text-anchor="middle" font-size="42" font-weight="800" fill="${BRAND.lime}">${esc(st.value)}</text>
    <text x="${statCx[i]}" y="551" text-anchor="middle" font-size="15" font-weight="600" letter-spacing="1" fill="${BRAND.mint}">${esc(st.label)}</text>`)
    .join('\n    ');

  // Secondary line inside the panel: top technologies (left) + "Next: T<n>"
  // (right). Each shown only when there's something to say.
  const techLine = Array.isArray(technologies) && technologies.length
    ? `<text x="140" y="598" font-size="19" fill="${BRAND.mintSoft}">Top: ${esc(technologies.join(' · '))}</text>`
    : '';
  const nextLine = nextTierKey
    ? `<text x="1060" y="598" text-anchor="end" font-size="19" fill="${BRAND.mint}">Next: <tspan font-weight="800" fill="${BRAND.lime}">${esc(nextTierKey)}</tspan></text>`
    : '';

  const pillWidth = Math.max(150, 42 + bandName.length * 14);

  return `<svg id="${id}" width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}"`
    + ` xmlns="http://www.w3.org/2000/svg" font-family="${esc(FONT_STACK)}">
  <rect width="${CARD_W}" height="${CARD_H}" fill="${BRAND.dark}"/>
  <rect x="0" y="0" width="12" height="${CARD_H}" fill="${BRAND.teal500}"/>

  <!-- logo: real hand-drawn shakers wordmark (inline vector paths, self-contained) -->
  <g transform="translate(80,54) scale(${wordmarkScale.toFixed(4)})">${wordmark}</g>
  <text x="1160" y="90" text-anchor="end" font-size="19" fill="${BRAND.zinc500}">shakersworks.com</text>

  <!-- headline -->
  <text x="82" y="166" font-size="26" letter-spacing="4" font-weight="600" fill="${BRAND.zinc400}">MY AI TOOLING MATURITY</text>

  <!-- tier (hero, lime) -->
  <text x="76" y="322" font-size="150" font-weight="800" fill="${BRAND.lime}">${esc(tierKey)}</text>
  <text x="82" y="384" font-size="40" font-weight="700" fill="${BRAND.white}">${esc(tierName)}</text>

  <!-- maturity band pill -->
  <g transform="translate(82,406)">
    <rect x="0" y="0" rx="14" ry="14" width="${pillWidth}" height="40" fill="${BRAND.lime}"/>
    <text x="20" y="27" font-size="19" font-weight="700" fill="${BRAND.dark}">${esc(bandName)}</text>
  </g>

  <!-- score donut (hero, lime ring on a dark-teal track) -->
  <g transform="translate(${cx},${cy})">
    <circle r="${r}" fill="none" stroke="${BRAND.track}" stroke-width="22"/>
    <circle r="${r}" fill="none" stroke="${BRAND.lime}" stroke-width="22" stroke-linecap="round"
      stroke-dasharray="${circ.toFixed(2)}" stroke-dashoffset="${dashOffset}" transform="rotate(-90)"/>
    <text text-anchor="middle" y="14" font-size="86" font-weight="800" fill="${BRAND.white}">${score}</text>
    <text text-anchor="middle" y="56" font-size="24" letter-spacing="2" fill="${BRAND.zinc400}">/ 100</text>
  </g>

  <!-- stats strip: teal panel with derived footprint signals -->
  <rect x="0" y="462" width="${CARD_W}" height="${CARD_H - 462}" fill="${BRAND.teal700}"/>
  <g>
    ${statCells}
  </g>
  ${techLine}
  ${nextLine}
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
