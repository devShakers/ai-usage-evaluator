'use strict';

const fs = require('fs');
const path = require('path');

const { getCatalog } = require('./i18n');
const { renderDocument } = require('./report-theme');
const { loadState, configDir, projectSlug, fileUrl } = require('./report-store');

/*
 * `share` command (skill-code-certification): a branded, self-contained card
 * the Talent can post on LinkedIn to show off their AI-usage FOOTPRINT result
 * (tier T0-T7 + score /100 + maturity band). Enfoque elegido por el usuario:
 * tarjeta HTML + "Download PNG" generado EN EL NAVEGADOR (zero-dep) — el CLI
 * nunca rasteriza, solo escribe un HTML self-contained y imprime su enlace.
 *
 * Invariants (same discipline as the HTML reports, src/report-theme.js):
 *   - ZERO network: every asset is inline. The Shakers bolt is the REAL logo
 *     path (shakers-hub-frontend .../images/shakers-logo.svg) inlined as an
 *     SVG <path> — never a remote <image> or data-URI fetch. Fonts are the
 *     system sans stack (no @font-face, no CDN). This is also what keeps the
 *     browser-side SVG->canvas->PNG export from TAINTING the canvas (an
 *     external ref would make toDataURL throw a SecurityError).
 *   - Deterministic: the card content is a pure function of the stored
 *     footprint (tier/score/band) — same footprint always yields the same card.
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

// The REAL Shakers lightning bolt — copied VERBATIM from the design asset
// (shakers-hub-frontend/apps/hub/public/images/shakers-logo.svg, viewBox
// 0 0 12 19). Inlined as an SVG <path> (no remote image, no data-URI) so the
// card stays self-contained and the canvas export never taints.
const BOLT_PATH =
  'M4.21721 7.63625C5.37214 7.86417 6.19709 8.03512 7.07704 8.14908C8.06698 8.32002 9.05692 '
  + '8.37701 10.1019 8.49097C10.9268 8.60493 11.6418 8.94682 11.9168 9.85852C12.1917 10.8272 '
  + '11.7518 11.511 11.0918 12.0808C10.7618 12.3657 10.3768 12.6506 10.0469 12.9355C7.57201 '
  + '14.7589 5.09716 16.5823 2.62231 18.4057C2.45732 18.5197 2.29233 18.6906 2.07234 18.8046C1.46737 '
  + '19.1465 0.807414 19.0325 0.36744 18.5197C-0.0725338 18.0068 -0.12753 17.3231 0.257447 '
  + '16.6963C0.53243 16.2404 0.917407 15.8985 1.30238 15.6136C3.11728 14.2461 4.93217 12.9355 '
  + '6.96705 11.397C6.36208 11.2261 5.97711 11.1691 5.59213 11.0551C4.54719 10.8272 3.50225 '
  + '10.6563 2.51231 10.3144C0.69742 9.63059 0.257446 7.97814 1.52237 6.38266C2.34732 5.357 '
  + '3.33726 4.4453 4.3272 3.59058C5.70212 2.50794 7.18703 1.53926 8.67194 0.570575C9.82688 '
  + '-0.227162 10.6518 -0.170181 11.1468 0.627556C11.6418 1.42529 11.3118 2.22303 10.2119 '
  + '3.07775C8.83694 4.10341 7.40702 5.07209 6.0321 6.09776C5.48213 6.49662 4.98716 6.95248 '
  + '4.21721 7.63625Z';
const BOLT_H = 19; // asset viewBox height (width 12)

// Brand palette (from shakers-design-system/design-spec/tokens.css). The card
// is a DARK surface with a lime hero accent — the same visual language as the
// sh-eval banner (a lime bolt on a dark tile), which reads well on a social feed.
const BRAND = {
  lime: '#d8e637',
  dark: '#181B1A',
  white: '#ffffff',
  zinc400: '#a1a1aa',
  zinc500: '#71717a',
  track: '#27272a',
  teal: '#0e7d69',
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
 * Loads THIS project's stored footprint (tier/score/band) from the report
 * store. Returns null when the project has no footprint yet (the caller turns
 * that into an actionable "run footprint first" message). `load` is injectable
 * purely for tests; production reads report-state.json via report-store.
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
  return {
    root: absRoot,
    tier: m.tier,
    tierKey: m.tierKey,
    score: m.score,
    level: m.level,
    levelKey: m.key,
    generatedAt: fp.generatedAt || null,
  };
}

/*
 * Maps the raw footprint into the card's display model. English-fixed: tier and
 * band names are resolved through the `en` catalog (never tier-engine.js's
 * Spanish `tierName`), so the branded surface reads in English regardless of
 * the machine locale.
 */
function buildCardModel(fp) {
  const en = getCatalog('en');
  const tierKey = fp.tierKey;
  const tierName = (en.tierNames && en.tierNames[tierKey]) || tierKey;
  const bandName = (en.levelNames && en.levelNames[fp.levelKey]) || '';
  return {
    tierKey,
    tierName,
    bandName,
    score: Math.max(0, Math.min(100, Math.round(fp.score))),
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
 * inline: the bolt is an SVG <path>, text uses the system font stack, the score
 * is a stroked donut ring. No <image>, no url(), no xlink:href, no @font-face —
 * so the browser can serialize it, draw it to a <canvas> and toDataURL() a PNG
 * without tainting.
 */
function renderCardSvg(model, { id = 'share-card-svg' } = {}) {
  const { tierKey, tierName, bandName, score } = model;

  // Bolt: scale the 12×19 asset up to ~46px tall, top-left, in lime.
  const boltScale = 46 / BOLT_H; // ≈ 2.42

  // Score donut ring (right side). Deterministic geometry from the score.
  const cx = 958;
  const cy = 292;
  const r = 128;
  const circ = 2 * Math.PI * r; // ≈ 804.25
  const dashOffset = (circ * (1 - score / 100)).toFixed(2);

  return `<svg id="${id}" width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}"`
    + ` xmlns="http://www.w3.org/2000/svg" font-family="${esc(FONT_STACK)}">
  <rect width="${CARD_W}" height="${CARD_H}" fill="${BRAND.dark}"/>
  <rect x="0" y="0" width="10" height="${CARD_H}" fill="${BRAND.lime}"/>

  <!-- brand lockup: real Shakers bolt + wordmark -->
  <g transform="translate(80,64)">
    <g transform="scale(${boltScale.toFixed(4)})"><path d="${BOLT_PATH}" fill="${BRAND.lime}"/></g>
    <text x="72" y="36" font-size="34" font-weight="700" letter-spacing="0.5" fill="${BRAND.white}">shakers</text>
  </g>

  <!-- headline -->
  <text x="82" y="212" font-size="27" letter-spacing="4" font-weight="600" fill="${BRAND.zinc400}">MY AI TOOLING MATURITY</text>

  <!-- tier -->
  <text x="76" y="378" font-size="176" font-weight="800" fill="${BRAND.lime}">${esc(tierKey)}</text>
  <text x="82" y="446" font-size="46" font-weight="700" fill="${BRAND.white}">${esc(tierName)}</text>

  <!-- maturity band pill -->
  <g transform="translate(82,480)">
    <rect x="0" y="0" rx="16" ry="16" width="${Math.max(160, 44 + bandName.length * 15)}" height="42" fill="${BRAND.lime}"/>
    <text x="22" y="28" font-size="20" font-weight="700" fill="${BRAND.dark}">${esc(bandName)}</text>
  </g>

  <!-- score donut -->
  <g transform="translate(${cx},${cy})">
    <circle r="${r}" fill="none" stroke="${BRAND.track}" stroke-width="24"/>
    <circle r="${r}" fill="none" stroke="${BRAND.lime}" stroke-width="24" stroke-linecap="round"
      stroke-dasharray="${circ.toFixed(2)}" stroke-dashoffset="${dashOffset}" transform="rotate(-90)"/>
    <text text-anchor="middle" y="18" font-size="96" font-weight="800" fill="${BRAND.white}">${score}</text>
    <text text-anchor="middle" y="64" font-size="26" letter-spacing="2" fill="${BRAND.zinc400}">/ 100</text>
  </g>

  <!-- footer -->
  <text x="82" y="582" font-size="21" fill="${BRAND.zinc500}">measured with Shakers AI Usage Evaluator &#183; shakersworks.com</text>
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
