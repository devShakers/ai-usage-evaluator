'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const { getCatalog } = require('./i18n');
const { renderDocument } = require('./report-theme');
const { footprintSectionsHtml, FOOTPRINT_CSS, FOOTPRINT_SCRIPT, agentCertificationSectionsHtml } = require('./render-html');
const { certificationSectionsHtml, CERTIFICATION_CSS } = require('./render-certification');

/*
 * Per-project local report store (skill-code-certification, reporting redesign
 * v2 — REVISES the earlier "single global document that stacks footprint + all
 * certifications" model, which was wrong).
 *
 * The report is SCOPED TO A PROJECT, keyed by the ABSOLUTE path of the scanned
 * project. Each project gets its OWN report file (`report-<hash>.html`) and its
 * own slice of state — different projects never mix into one document.
 *
 * Within a project:
 *   - The FOOTPRINT section is rendered ONLY if that project has footprint data.
 *   - The CERTIFICATION section is rendered ONLY if that project has at least
 *     one certified Skill.
 *   - Both sections appear together ONLY when both `ai-footprint` and
 *     `ai-certify` have run for the SAME project.
 *
 * Upsert semantics (never stack, never duplicate):
 *   - Footprint      -> one per project; re-scanning REPLACES it in place.
 *   - Certification  -> keyed by Skill id WITHIN the project; re-certifying the
 *     same Skill REPLACES its entry, a different Skill adds one. Certifications
 *     belong to the project they were produced in — not a global skillId bucket.
 *
 * The HTML is REGENERATED WHOLE from `report-state.json` each run (never
 * spliced): re-rendering the full document from a structured source of truth is
 * far more robust than string-editing an existing file.
 *
 * Location: `~/.config/ai-footprint/` (same base as consent.json — one place,
 * shared by both binaries), overridable via AI_FOOTPRINT_CONFIG_DIR (the same
 * override share.js uses) for test isolation. Nothing is ever written into the
 * scanned project itself.
 *
 * Files written:
 *   - report-state.json         (structured source of truth; lang-independent)
 *   - report-<projectHash>.html (one per project, in the CURRENT run's lang)
 */

const SCHEMA_VERSION = 2;

function configDir() {
  return process.env.AI_FOOTPRINT_CONFIG_DIR || path.join(os.homedir(), '.config', 'ai-footprint');
}
function statePath() {
  return path.join(configDir(), 'report-state.json');
}

// Stable, filesystem-safe per-project file name derived from the absolute path.
// A hash (not the raw path) keeps the name short, collision-resistant and free
// of path separators / spaces, while staying deterministic so re-running in the
// same project overwrites THAT project's file (never a second one).
function projectSlug(absRoot) {
  return crypto.createHash('sha1').update(String(absRoot)).digest('hex').slice(0, 12);
}
function htmlPathFor(absRoot) {
  return path.join(configDir(), `report-${projectSlug(path.resolve(absRoot))}.html`);
}

// A real file:// URL (handles spaces, Windows drive letters, etc.) so the CLI
// can print a link the talent can click/paste to open the report.
function fileUrl(p) {
  return pathToFileURL(p).href;
}

function freshState() {
  return { schemaVersion: SCHEMA_VERSION, updatedAt: null, projects: {} };
}

// v1 -> v2 migration: the old global model kept `footprints{path->…}` (already
// path-keyed, so they map cleanly onto projects) and a GLOBAL `certifications`
// bucket with no project attribution. Footprints are carried over; the orphaned
// global certifications are dropped (they cannot be re-attributed to a project,
// and the model that produced them was the one being corrected).
function migrateFromV1(parsed) {
  const projects = {};
  const legacyFootprints = parsed && parsed.footprints && typeof parsed.footprints === 'object'
    ? parsed.footprints
    : {};
  for (const [absRoot, fp] of Object.entries(legacyFootprints)) {
    projects[absRoot] = {
      root: (fp && fp.root) || absRoot,
      updatedAt: (fp && fp.generatedAt) || null,
      footprint: fp
        ? { generatedAt: fp.generatedAt || null, report: fp.report, maturity: fp.maturity }
        : null,
      certifications: {},
    };
  }
  return { schemaVersion: SCHEMA_VERSION, updatedAt: (parsed && parsed.updatedAt) || null, projects };
}

function loadState() {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(statePath(), 'utf8'));
  } catch {
    return freshState();
  }
  if (parsed && parsed.schemaVersion === SCHEMA_VERSION && parsed.projects && typeof parsed.projects === 'object') {
    return { schemaVersion: SCHEMA_VERSION, updatedAt: parsed.updatedAt || null, projects: parsed.projects };
  }
  // Any older / unknown shape (v1 global model, or garbage) -> migrate what we can.
  return migrateFromV1(parsed);
}

function saveState(state) {
  fs.mkdirSync(configDir(), { recursive: true });
  fs.writeFileSync(statePath(), JSON.stringify(state, null, 2));
}

function getOrCreateProject(state, absRoot) {
  if (!state.projects[absRoot]) {
    state.projects[absRoot] = {
      root: absRoot,
      updatedAt: null,
      footprint: null,
      certifications: {},
      agentCertifications: {},
    };
  }
  // Backward-compat: a project persisted before agent certifications existed.
  if (!state.projects[absRoot].agentCertifications) {
    state.projects[absRoot].agentCertifications = {};
  }
  return state.projects[absRoot];
}

/* ---------- rendering a SINGLE project's document ---------- */

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
  .block-meta{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 12px;margin:0 0 18px 2px}
  .block-meta .path{font-family:var(--font-mono);font-size:13px;font-weight:600;color:var(--fg);
    word-break:break-all}
  .block-meta .when{font-size:12px;color:var(--faint);font-variant-numeric:tabular-nums}
  section{margin:0 0 28px}
  section:last-of-type{margin-bottom:0}
  .section-title{font-size:20px;font-weight:700;letter-spacing:-.01em;color:var(--fg);
    margin:0 0 14px;padding-bottom:8px;border-bottom:2px solid var(--secondary)}
`;

// Renders ONE project's report. Footprint and certification sections are each
// included ONLY when the project actually has that kind of data — a cert-only
// run shows no footprint section, a footprint-only run shows no certification
// section, and both appear only when both ran for this same project.
function renderProjectHtml(project, lang) {
  const t = getCatalog(lang);
  const c = t.cumulative;

  const sections = [];

  if (project && project.footprint && project.footprint.report) {
    // Enrich the footprint report's agent cards with any agent-certification
    // LEVEL tags for this project (skill-code-certification, `certify agents`) —
    // read by render-html.js#buildAgentCardTree. The HTML level tag therefore
    // requires a footprint (which builds the agents section); the per-agent
    // detail always shows in the terminal at cert time.
    const report = {
      ...project.footprint.report,
      agentCertifications: (project && project.agentCertifications) || {},
    };
    sections.push(`<section>
    <h2 class="section-title">${esc(c.footprintHeading)}</h2>
    ${footprintSectionsHtml(report, project.footprint.maturity, lang)}
  </section>`);
  }

  // Agent certifications (skill-code-certification, `certify agents`): their OWN
  // section (skill-style cards) with the full verdict — the agent card in the
  // footprint tree above keeps only the level tag. Independent of footprint
  // (keyed by agent name), rendered whenever the project has any certified agent.
  const agentCerts = (project && project.agentCertifications) || {};
  const agentCertBody = agentCertificationSectionsHtml({ agentCertifications: agentCerts }, t);
  if (agentCertBody) {
    sections.push(`<section>
    <h2 class="section-title">${esc(c.agentCertificationHeading)}</h2>
    ${agentCertBody}
  </section>`);
  }

  const certItems = sortedByGeneratedAtDesc(Object.values((project && project.certifications) || {})).map((e) => e.item);
  if (certItems.length) {
    sections.push(`<section>
    <h2 class="section-title">${esc(c.certificationHeading)}</h2>
    ${certificationSectionsHtml({ items: certItems }, lang)}
  </section>`);
  }

  const updatedWhen = project && project.updatedAt ? new Date(project.updatedAt).toLocaleString() : '';

  const body = `<header>
    <span class="badge"><span class="spark"></span>SHAKERS</span>
    <h1>${esc(c.title)}</h1>
    <p class="sub">${esc(c.subtitle)}</p>
    <div class="block-meta">
      <span class="path">${esc((project && project.root) || c.unknownProject)}</span>
      ${updatedWhen ? `<span class="when">${esc(c.updatedLabel(updatedWhen))}</span>` : ''}
    </div>
  </header>

  ${sections.join('\n')}

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

/* ---------- persist (state only) + materialize (render HTML) ---------- */
//
// ADR-016 split: `footprint` and `certify` now PERSIST state only (no HTML file,
// no printed link). The HTML report is materialized + opened solely by the
// `report` command (bin/report-html.js), so `materializeProjectReport` is the
// ONE place the .html file is written. The legacy `upsertFootprint`/
// `upsertCertification` (persist + materialize in one call) are kept for
// backward compatibility (and existing callers/tests) as thin compositions.

function stampAndSaveState(state, absRoot) {
  state.schemaVersion = SCHEMA_VERSION;
  const now = new Date().toISOString();
  state.updatedAt = now;
  state.projects[absRoot].updatedAt = now;
  saveState(state);
  return { statePath: statePath(), stateDir: configDir() };
}

function writeProjectHtml(project, absRoot, lang) {
  const html = renderProjectHtml(project, lang);
  fs.mkdirSync(configDir(), { recursive: true });
  const p = htmlPathFor(absRoot);
  fs.writeFileSync(p, html);
  return { htmlPath: p, fileUrl: fileUrl(p) };
}

// Persist THIS project's footprint into report-state.json (keyed by absolute
// project path). State only — no HTML is written here (ADR-016). Replaces the
// project's single footprint in place; never touches other projects.
function persistFootprint({ root, report, maturity }) {
  const absRoot = path.resolve(root || process.cwd());
  const state = loadState();
  const project = getOrCreateProject(state, absRoot);
  project.footprint = {
    generatedAt: (report && report.generatedAt) || new Date().toISOString(),
    report,
    maturity,
  };
  return stampAndSaveState(state, absRoot);
}

// Persist an agent certification for THIS project (skill-code-certification,
// `certify agents`), keyed by the local agent name. State only (no HTML). Stores
// the FULL verdict — level + category + role AND the "why" (verified/unverified
// evidence), the five areas with their tag, and the rationale — because the HTML
// report card is now the full breakdown surface (the terminal shows only a
// summary at cert time). Latest per agent name wins (the card shows the most
// recent verdict).
function persistAgentCertification({
  root,
  agentName,
  level,
  category,
  role,
  areas,
  verifiedEvidence,
  unverifiedEvidence,
  rationale,
}) {
  const absRoot = path.resolve(root || process.cwd());
  const state = loadState();
  const project = getOrCreateProject(state, absRoot);
  project.agentCertifications[agentName] = {
    level: level || 'none',
    category: category || null,
    role: role || null,
    areas: Array.isArray(areas) ? areas : [],
    verifiedEvidence: Array.isArray(verifiedEvidence) ? verifiedEvidence : [],
    unverifiedEvidence: Array.isArray(unverifiedEvidence) ? unverifiedEvidence : [],
    rationale: rationale || null,
    generatedAt: new Date().toISOString(),
  };
  return stampAndSaveState(state, absRoot);
}

// Materialize (render + write) THIS project's cumulative HTML from persisted
// state, and return its path + file:// URL. Returns `{ hasData:false }` when the
// project has neither a footprint nor a certified Skill yet (the `report`
// command turns that into an actionable "run footprint first" message). This is
// the ONLY place the HTML file is produced now (ADR-016).
function materializeProjectReport({ root, lang }) {
  const absRoot = path.resolve(root || process.cwd());
  const state = loadState();
  const project = state.projects[absRoot];
  const hasFootprint = !!(project && project.footprint && project.footprint.report);
  const hasCerts = !!(project && project.certifications && Object.keys(project.certifications).length);
  if (!hasFootprint && !hasCerts) return { hasData: false };
  return { hasData: true, ...writeProjectHtml(project, absRoot, lang) };
}

// Backward-compatible convenience: persist footprint AND materialize the HTML in
// one call (the pre-ADR-016 behaviour). New code should call persistFootprint
// (state only) + let `report` materialize.
function upsertFootprint({ root, report, maturity, lang }) {
  const s = persistFootprint({ root, report, maturity });
  const m = materializeProjectReport({ root, lang });
  return { ...s, htmlPath: m.htmlPath, fileUrl: m.fileUrl };
}

// Stable upsert key for a certified Skill WITHIN its project: its id when
// present, else a name::technology composite (never index-based — indices
// aren't stable across runs, which would defeat the "update in place" rule).
function certKey(item) {
  if (item && item.skillId != null) return `id:${item.skillId}`;
  const name = (item && item.skillName) || '';
  const tech = (item && item.technology) || '';
  return `nt:${name}::${tech}`;
}

// Upsert each certified Skill from this run into THIS PROJECT's report (keyed by
// Skill id within the project). Certifications are scoped to the project they
// were produced in — scanning/certifying another project keeps a separate
// report. Only items that carry a Skill identity are stored.
// Persist each certified Skill from this run into THIS PROJECT's state (keyed by
// Skill id within the project). State only — no HTML written (ADR-016).
function persistCertification({ root, items }) {
  const absRoot = path.resolve(root || process.cwd());
  const list = Array.isArray(items) ? items.filter((i) => i && (i.skillId != null || i.skillName)) : [];
  const state = loadState();
  const project = getOrCreateProject(state, absRoot);
  const now = new Date().toISOString();
  for (const item of list) {
    project.certifications[certKey(item)] = { generatedAt: now, item };
  }
  return stampAndSaveState(state, absRoot);
}

// Backward-compatible convenience: persist certification AND materialize.
function upsertCertification({ root, items, lang }) {
  const s = persistCertification({ root, items });
  const m = materializeProjectReport({ root, lang });
  return { ...s, htmlPath: m.htmlPath, fileUrl: m.fileUrl };
}

module.exports = {
  configDir,
  statePath,
  htmlPathFor,
  projectSlug,
  fileUrl,
  loadState,
  saveState,
  renderProjectHtml,
  persistFootprint,
  persistCertification,
  persistAgentCertification,
  materializeProjectReport,
  upsertFootprint,
  upsertCertification,
  certKey,
  SCHEMA_VERSION,
};
