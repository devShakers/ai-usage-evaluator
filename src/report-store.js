'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const { getCatalog } = require('./i18n');
const { renderDocument } = require('./report-theme');
const { footprintSectionsHtml, FOOTPRINT_CSS, FOOTPRINT_SCRIPT } = require('./render-html');
const { certificationSectionsHtml, CERTIFICATION_CSS } = require('./render-certification');

/*
 * Cumulative report store (skill-code-certification, reporting redesign).
 *
 * ONE persistent local report that fills in over time: every `ai-footprint`
 * run and every `ai-certify` run UPSERTS its own section into a shared state
 * file, and the HTML is REGENERATED WHOLE from that state each run (never
 * spliced, never partially overwritten). This is deliberately state-driven:
 * re-rendering the full document from a structured source of truth is far more
 * robust than string-editing an existing HTML file in place.
 *
 * Identity (upsert keys), per the confirmed design decision:
 *   - Footprint  -> the ABSOLUTE path of the scanned project. Re-scanning the
 *     same repo UPDATES its card; scanning a different repo ADDS a new one.
 *   - Certification -> the Skill id (fallback: `name::technology`). Re-certifying
 *     the same Skill UPDATES its entry in place.
 *
 * Location: the user's config dir `~/.config/ai-footprint/` (same base as
 * consent.json — one place, shared by both binaries, and cross-project, which
 * is exactly what a cumulative report needs). Overridable via
 * AI_FOOTPRINT_CONFIG_DIR (test isolation), the same override share.js uses.
 * Nothing is written into the scanned project (that would leak the setup into
 * a commit and clutter the repo — the original store.js rationale, preserved).
 *
 * Files written:
 *   - report-state.json  (structured source of truth; lang-independent data)
 *   - report.html        (regenerated from the state, in the CURRENT run's lang)
 */

const SCHEMA_VERSION = 1;

function configDir() {
  return process.env.AI_FOOTPRINT_CONFIG_DIR || path.join(os.homedir(), '.config', 'ai-footprint');
}
function statePath() {
  return path.join(configDir(), 'report-state.json');
}
function htmlPath() {
  return path.join(configDir(), 'report.html');
}

// A real file:// URL (handles spaces, Windows drive letters, etc.) so the CLI
// can print a link the talent can click/paste to open the report.
function fileUrl(p) {
  return pathToFileURL(p).href;
}

function freshState() {
  return { schemaVersion: SCHEMA_VERSION, updatedAt: null, footprints: {}, certifications: {} };
}

function loadState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
    return {
      schemaVersion: SCHEMA_VERSION,
      updatedAt: parsed.updatedAt || null,
      footprints: parsed.footprints && typeof parsed.footprints === 'object' ? parsed.footprints : {},
      certifications: parsed.certifications && typeof parsed.certifications === 'object' ? parsed.certifications : {},
    };
  } catch {
    return freshState();
  }
}

function saveState(state) {
  fs.mkdirSync(configDir(), { recursive: true });
  fs.writeFileSync(statePath(), JSON.stringify(state, null, 2));
}

/* ---------- rendering the cumulative document ---------- */

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

// Sorted newest-first so the most recent evaluation is at the top of its
// section — stable and deterministic given the stored `generatedAt`.
function sortedByGeneratedAtDesc(entries) {
  return entries.slice().sort((a, b) => String(b.generatedAt || '').localeCompare(String(a.generatedAt || '')));
}

const CUMULATIVE_CSS = `
  .project-block{margin:0 0 28px}
  .project-block:last-child{margin-bottom:0}
  .block-meta{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 12px;margin:0 0 12px 2px}
  .block-meta .path{font-family:var(--font-mono);font-size:13px;font-weight:600;color:var(--fg);
    word-break:break-all}
  .block-meta .when{font-size:12px;color:var(--faint);font-variant-numeric:tabular-nums}
  .section-empty{padding:16px 18px;color:var(--faint);font-size:13px}
  .section-title{font-size:20px;font-weight:700;letter-spacing:-.01em;color:var(--fg);
    margin:0 0 14px;padding-bottom:8px;border-bottom:2px solid var(--secondary)}
`;

function renderCumulativeHtml(state, lang) {
  const t = getCatalog(lang);
  const c = t.cumulative;

  const footprintEntries = sortedByGeneratedAtDesc(Object.values(state.footprints || {}));
  const footprintBlocks = footprintEntries.length
    ? footprintEntries.map((e) => {
      const when = e.generatedAt ? new Date(e.generatedAt).toLocaleString() : '';
      return `<div class="project-block">
    <div class="block-meta">
      <span class="path">${esc(e.root || c.unknownProject)}</span>
      ${when ? `<span class="when">${esc(c.updatedLabel(when))}</span>` : ''}
    </div>
    ${footprintSectionsHtml(e.report, e.maturity, lang)}
  </div>`;
    }).join('\n')
    : `<div class="card section-empty">${esc(c.footprintEmpty)}</div>`;

  const certEntries = sortedByGeneratedAtDesc(Object.values(state.certifications || {}));
  const certBody = certEntries.length
    ? certificationSectionsHtml({ items: certEntries.map((e) => e.item) }, lang)
    : `<div class="card section-empty">${esc(c.certificationEmpty)}</div>`;

  const updatedWhen = state.updatedAt ? new Date(state.updatedAt).toLocaleString() : '';

  const body = `<header>
    <span class="badge"><span class="spark"></span>SHAKERS</span>
    <h1>${esc(c.title)}</h1>
    <p class="sub">${esc(c.subtitle)}</p>
  </header>

  <section>
    <h2 class="section-title">${esc(c.footprintHeading)}</h2>
    ${footprintBlocks}
  </section>

  <section>
    <h2 class="section-title">${esc(c.certificationHeading)}</h2>
    ${certBody}
  </section>

  <footer>
    <div class="priv">
      <span class="lock" aria-hidden="true">🔒</span>
      <span>${esc(c.privacyNote)}</span>
    </div>
    ${updatedWhen ? `<div class="meta-line">${esc(c.updatedLabel(updatedWhen))}</div>` : ''}
  </footer>`;

  return renderDocument({
    lang: t.html.lang,
    title: c.title,
    componentCss: FOOTPRINT_CSS + CERTIFICATION_CSS + CUMULATIVE_CSS,
    body,
    script: FOOTPRINT_SCRIPT,
  });
}

/* ---------- upserts (each writes state + regenerates the HTML) ---------- */

function writeAll(state, lang) {
  state.schemaVersion = SCHEMA_VERSION;
  state.updatedAt = new Date().toISOString();
  saveState(state);
  const html = renderCumulativeHtml(state, lang);
  fs.mkdirSync(configDir(), { recursive: true });
  fs.writeFileSync(htmlPath(), html);
  const p = htmlPath();
  return { statePath: statePath(), htmlPath: p, fileUrl: fileUrl(p), stateDir: configDir() };
}

// Upsert THIS project's footprint (keyed by absolute project path).
function upsertFootprint({ root, report, maturity, lang }) {
  const absRoot = path.resolve(root || process.cwd());
  const state = loadState();
  state.footprints[absRoot] = {
    root: absRoot,
    generatedAt: (report && report.generatedAt) || new Date().toISOString(),
    report,
    maturity,
  };
  return writeAll(state, lang);
}

// Stable upsert key for a certified Skill: its id when present, else a
// name::technology composite (never index-based — indices aren't stable across
// runs, which would defeat the "update in place" requirement).
function certKey(item) {
  if (item && item.skillId != null) return `id:${item.skillId}`;
  const name = (item && item.skillName) || '';
  const tech = (item && item.technology) || '';
  return `nt:${name}::${tech}`;
}

// Upsert each certified Skill from this run (keyed by Skill id). `items` is the
// certify phase's assembled list ({skillId, skillName, technology, sampling,
// result}). Only items that carry a Skill identity are stored.
function upsertCertification({ items, lang }) {
  const list = Array.isArray(items) ? items.filter((i) => i && (i.skillId != null || i.skillName)) : [];
  const state = loadState();
  const now = new Date().toISOString();
  for (const item of list) {
    state.certifications[certKey(item)] = { generatedAt: now, item };
  }
  return writeAll(state, lang);
}

module.exports = {
  configDir,
  statePath,
  htmlPath,
  fileUrl,
  loadState,
  saveState,
  renderCumulativeHtml,
  upsertFootprint,
  upsertCertification,
  certKey,
  SCHEMA_VERSION,
};
