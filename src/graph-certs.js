'use strict';

/*
 * graph-certs.js — report-store → `map` cert-drawer payload adapter.
 *
 * The LOCAL report (`map`) shows the SAME real certifications the SHAREABLE
 * report (`report`, alias `sheet`) does — read from the SAME source of truth, the per-project
 * `report-store` state (`project.certifications` = Skill certs;
 * `project.agentCertifications` = agent certs). We do NOT re-derive or
 * re-render the cert LOGIC: this adapter reuses the shared helpers
 *   - deriveCertEvidence (src/render-html.js)  — the coherence fix: agent
 *     evidence is DERIVED from the areas, so a P5 can never show up without it;
 *   - scoreBand (src/render-certification.js)  — the Skill score→band mapping;
 *   - the i18n `certifyAgents` catalog        — P1–P5 levelNames (Familiar…
 *     Experto), areaNames, tagLabels, and the Why/Areas/Assessment headings;
 *   - `classification.categories`             — the agent category labels.
 * Only the PRESENTATION differs (`report` = white cards; `map` = the dark-capable
 * accordion drawer from the mockup), so the drawer markup lives in the template
 * — the data shaping is shared here.
 */

const { getCatalog } = require('./i18n');
const { deriveCertEvidence } = require('./render-html');
const { scoreBand } = require('./render-certification');

// P1–P5 → a tag colour band for the level pill (purely visual, mirrors
// render-certify-agents.levelColor: higher greener, floor red).
function levelBand(level) {
  if (level === 'P5' || level === 'P4') return 'high';
  if (level === 'P3') return 'mid';
  return 'low'; // P1 / P2 / none
}

/*
 * buildCertsPayload(project, lang) -> cert drawer payload | null
 * `project` is a report-store project entry (state.projects[absRoot]). Returns
 * null when the project has NO Skill certs AND NO agent certs (clean empty
 * state in the drawer — never a misleading placeholder).
 */
function buildCertsPayload(project, lang) {
  const t = getCatalog(lang);
  const ca = t.certifyAgents || {};
  const categories = (t.classification && t.classification.categories) || {};

  const agentCerts = (project && project.agentCertifications) || {};
  const agents = Object.keys(agentCerts).map((name) => {
    const cert = agentCerts[name] || {};
    const level = cert.level || 'none';
    const areas = Array.isArray(cert.areas) ? cert.areas : [];
    const { verified, unverified } = deriveCertEvidence(areas, ca);
    const catLabel = cert.category && categories[cert.category] ? categories[cert.category] : cert.category;
    const meta = [catLabel, cert.role].filter(Boolean).join(' · ');
    return {
      name,
      level,
      levelName: (ca.levelNames && ca.levelNames[level]) || level,
      band: levelBand(level),
      meta,
      verified,
      unverified,
      areas: areas.map((a) => ({
        name: (ca.areaNames && ca.areaNames[a.area]) || a.area,
        tag: (ca.tagLabels && ca.tagLabels[a.tag]) || a.tag,
        tagKey: a.tag,
        evidence: typeof a.evidence === 'string' ? a.evidence.trim() : '',
      })),
      rationale: typeof cert.rationale === 'string' && cert.rationale.trim() ? cert.rationale.trim() : '',
    };
  });

  const certObj = (project && project.certifications) || {};
  const skills = Object.values(certObj)
    .map((e) => e && e.item)
    .filter(Boolean)
    .map((item) => {
      const res = item.result || {};
      const base = item.skillName || (item.skillId != null ? String(item.skillId) : 'Skill');
      const name = item.technology ? `${base} · ${item.technology}` : base;
      return {
        name,
        score: typeof res.score === 'number' ? res.score : 0,
        band: scoreBand(res.score),
        rationale: typeof res.rationale === 'string' ? res.rationale : '',
        improvements: Array.isArray(res.improvements) ? res.improvements : [],
      };
    });

  if (!agents.length && !skills.length) return null;

  const ln = ca.levelNames || {};
  const pnScaleNote = ln.P1
    ? `${ln.P1} · ${ln.P2} · ${ln.P3} · ${ln.P4} · ${ln.P5}`
    : '';

  const labels = {
    agentsTitle: lang === 'es' ? 'Agentes certificados' : 'Certified agents',
    skillsTitle: lang === 'es' ? 'Skills evaluadas' : 'Skills evaluated',
    empty: lang === 'es' ? 'Aún no hay certificaciones para este proyecto.' : 'No certifications for this project yet.',
    improvements: lang === 'es' ? 'Mejoras sugeridas' : 'Suggested improvements',
    why: ca.whyHeading || (lang === 'es' ? 'Por qué' : 'Why'),
    verified: ca.verifiedHeading || (lang === 'es' ? 'Evidencias verificadas' : 'Verified evidence'),
    unverified: ca.unverifiedHeading || (lang === 'es' ? 'No verificadas' : 'Unverified'),
    areas: ca.areasHeading || (lang === 'es' ? 'Áreas evaluadas' : 'Assessed areas'),
    rationale: ca.rationaleHeading || (lang === 'es' ? 'Valoración' : 'Assessment'),
  };

  return { labels, pnScaleNote, agents, skills };
}

module.exports = { buildCertsPayload, levelBand };
