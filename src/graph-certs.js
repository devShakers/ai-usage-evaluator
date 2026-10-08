'use strict';

// graph-certs.js — report-store → `map` cert-drawer payload adapter.

const { getCatalog } = require('./i18n');
const { scoreBand, skillLevelForScore } = require('./render-certification');
const { sanitizeRenderText } = require('./sanitize-network-text');

function levelInfoFromCombinedLevel(combinedLevel) {
  const key = typeof combinedLevel === 'string' ? combinedLevel.trim().toLowerCase() : '';
  if (key === 'expert') return { key: 'expert', band: 'high' };
  if (key === 'senior') return { key: 'senior', band: 'mid' };
  if (key === 'middle') return { key: 'middle', band: 'low' };
  return null;
}

// buildCertsPayload(project, lang) -> cert drawer payload | null `project` is a report-store project entry (state.projects[absRoot]).
function buildCertsPayload(project, lang) {
  const t = getCatalog(lang);

  const certObj = (project && project.certifications) || {};
  const skills = Object.values(certObj)
    .map((e) => e && e.item)
    .filter(Boolean)
    .map((item) => {
      const res = item.result || {};
      // `skillName` and `technology` both come off the wire (the service's certifiable list / verdict), and `technology` was one of the two fields issue 055 was opened for.
      const base = sanitizeRenderText(item.skillName) || (item.skillId != null ? String(item.skillId) : 'Skill');
      const name = item.technology ? `${base} · ${sanitizeRenderText(item.technology)}` : base;
      // ADR-016: named level (Middle/Senior/Expert) instead of the numeric grade.
      const skillReport = (t.certify && t.certify.report) || {};
      const skillLevelNames = skillReport.skillLevels || {};
      const { key: levelKey, band } = levelInfoFromCombinedLevel(res.combinedLevel) || skillLevelForScore(res.score);
      return {
        name,
        band, // retained for the badge colour (unchanged palette)
        levelKey,
        levelName: levelKey ? (skillLevelNames[levelKey] || levelKey) : (skillLevelNames.na || '—'),
        // Model-written text off the wire; sanitised (issue 055 — left raw by 052).
        rationale: typeof res.rationale === 'string' ? sanitizeRenderText(res.rationale) : '',
        improvements: Array.isArray(res.improvements)
          ? res.improvements.map((i) => (typeof i === 'string' ? sanitizeRenderText(i) : i))
          : [],
      };
    });

  if (!skills.length) return null;

  const labels = {
    skillsTitle: lang === 'es' ? 'Skills evaluadas' : 'Skills evaluated',
    empty: lang === 'es' ? 'Aún no hay certificaciones para este proyecto.' : 'No certifications for this project yet.',
    improvements: lang === 'es' ? 'Mejoras sugeridas' : 'Suggested improvements',
  };

  return { labels, skills };
}

module.exports = { buildCertsPayload, levelInfoFromCombinedLevel };
