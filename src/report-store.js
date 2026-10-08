'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const { getConfigDir } = require('./config-dir');
const { renderSheet } = require('./render-sheet');
const { reportGateForIdentity } = require('./report-gating');

const SCHEMA_VERSION = 2;

function configDir() {
  return getConfigDir(process.env);
}
function statePath() {
  return path.join(configDir(), 'report-state.json');
}

// Stable, filesystem-safe per-project file name derived from the absolute path.
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
      backendAcceptance: {},
    };
  }
  // Backward-compat: a project persisted before the two-backend chain
  // existed (talents-ai-score, ADR-020/021).
  if (!state.projects[absRoot].backendAcceptance) {
    state.projects[absRoot].backendAcceptance = {};
  }
  return state.projects[absRoot];
}

/* ---------- rendering a SINGLE project's document ---------- */

function renderProjectHtml(project, lang, gate) {
  return renderSheet(project, lang, gate);
}

/* ---------- persist (state only) + materialize (render HTML) ---------- */
// ADR-016 split: `footprint` and `certify` now PERSIST state only (no HTML file, no printed link).

function stampAndSaveState(state, absRoot) {
  state.schemaVersion = SCHEMA_VERSION;
  const now = new Date().toISOString();
  state.updatedAt = now;
  state.projects[absRoot].updatedAt = now;
  saveState(state);
  return { statePath: statePath(), stateDir: configDir() };
}

function writeProjectHtml(project, absRoot, lang, gate) {
  const html = renderProjectHtml(project, lang, gate);
  fs.mkdirSync(configDir(), { recursive: true });
  const p = htmlPathFor(absRoot);
  fs.writeFileSync(p, html);
  return { htmlPath: p, fileUrl: fileUrl(p) };
}

// Persist THIS project's footprint into report-state.json (keyed by absolute project path).
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

function loadAgentClassifications(root) {
  const absRoot = path.resolve(root || process.cwd());
  const state = loadState();
  const project = state.projects && state.projects[absRoot];
  const evaluation = project && project.footprint && project.footprint.report && project.footprint.report.agentEvaluation;
  const evaluations = evaluation && Array.isArray(evaluation.evaluations) ? evaluation.evaluations : [];
  const byName = {};
  for (const e of evaluations) {
    if (e && typeof e.name === 'string' && e.name && e.classification) {
      byName[e.name] = e.classification;
    }
  }
  return byName;
}

function recordBackendAcceptance({ root, kind, backend }) {
  if (!kind || !backend) return null;
  const absRoot = path.resolve(root || process.cwd());
  const state = loadState();
  const project = getOrCreateProject(state, absRoot);
  project.backendAcceptance[kind] = { backend, at: new Date().toISOString() };
  return stampAndSaveState(state, absRoot);
}

function loadFootprint({ root } = {}) {
  const absRoot = path.resolve(root || process.cwd());
  const state = loadState();
  const project = state.projects && state.projects[absRoot];
  const fp = project && project.footprint;
  return fp && fp.report ? { report: fp.report, maturity: fp.maturity } : null;
}

// The gate of `materializeProjectReport`, as a NAMED TABLE rather than an inlined chain of `&&`s — and the table IS the inventory.
const RENDERED_DATA = {
  footprint: (p) => !!(p.footprint && p.footprint.report),
  certifications: (p) => !!(p.certifications && Object.keys(p.certifications).length),
};

function hasRenderableData(project) {
  if (!project) return false;
  return Object.values(RENDERED_DATA).some((has) => has(project));
}

// Materialize (render + write) THIS project's cumulative HTML from persisted state, and return its path + file:// URL.
function materializeProjectReport({ root, lang }) {
  const absRoot = path.resolve(root || process.cwd());
  const state = loadState();
  const project = state.projects[absRoot];
  if (!hasRenderableData(project)) return { hasData: false };
  // issue 123 / ADR-044: the shareable HTML is gated by identity AT GENERATION TIME — this is the moment the `report` command produces the file, so this is where the gate is resolved.
  const gate = reportGateForIdentity();
  return { hasData: true, ...writeProjectHtml(project, absRoot, lang, gate) };
}

// `upsertFootprint` AND `upsertCertification` WERE HERE, and ADR-035 retired them.

function certKey(item) {
  if (item && item.skillId != null) return `id:${item.skillId}`;
  const name = (item && item.skillName) || '';
  const tech = (item && item.technology) || '';
  return `nt:${name}::${tech}`;
}

// Upsert each certified Skill from this run into THIS PROJECT's report (keyed by Skill id within the project).
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
  loadAgentClassifications,
  loadFootprint,
  recordBackendAcceptance,
  materializeProjectReport,
  certKey,
  SCHEMA_VERSION,
};
