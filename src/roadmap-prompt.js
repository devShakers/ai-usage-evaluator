'use strict';

/*
 * Deterministic, ready-to-paste "implementation prompt" (talents-ai-score:
 * "next steps -> prompt"). The talent copies this into THEIR OWN AI tool
 * of choice, which then implements the current tier jump's recommendation
 * directly in their project — this is now the PRIMARY "how do I implement
 * this" path, replacing --build-next-level (generic starter-file writing,
 * kept as a secondary, opt-in alternative — src/build-next-level.js).
 *
 * Assembled purely from data this report already computes: the roadmap
 * entry being rendered (curated verbatim, or ADR-015-personalized — this
 * module is handed whatever the caller already resolved and doesn't know
 * or care which) plus a couple of already-derived project signals
 * (frameworks, detected AI tool names, tier). Never a second LLM call,
 * never invented content — a text template filled with data, same
 * "mechanical, not authored" spirit as src/tier-analysis.js.
 *
 * `lang` is fully translated (es/en) because, like tier-analysis.js, this
 * is formula-driven copy, not curated product prose — no
 * pendingTranslation flag needed. Unrecognized/missing `lang` defaults to
 * Spanish (this repo's base language, same fallback rule
 * src/roadmap-content.js's getRoadmapEntry already uses).
 */

const TEMPLATES = {
  es: {
    intro: (frameworksText) =>
      `Ayúdame a implementar el siguiente paso en mi proyecto${frameworksText ? ` (uso ${frameworksText})` : ''}.`,
    context: (tierKey, tierName) =>
      `Contexto: mi proyecto está en el tier ${tierKey} (${tierName}) según AI Footprint, una herramienta de auto-diagnóstico de uso de IA.`,
    unlocksLabel: 'Lo que quiero conseguir:',
    toolsLabel: 'Herramientas de IA que ya uso:',
    stepsLabel: 'Pasos a seguir:',
    snippetLabel: 'Punto de partida (referencia — adáptalo a mi proyecto real):',
    closing:
      'Hazlo directamente en mi proyecto: crea o edita lo que haga falta, sigue las convenciones que ya uso, '
      + 'y al final explícame brevemente qué has cambiado y por qué.',
  },
  en: {
    intro: (frameworksText) =>
      `Help me implement the next step in my project${frameworksText ? ` (I use ${frameworksText})` : ''}.`,
    context: (tierKey, tierName) =>
      `Context: my project is at tier ${tierKey} (${tierName}) according to AI Footprint, a self-diagnostic tool for AI usage.`,
    unlocksLabel: 'What I want to achieve:',
    toolsLabel: 'AI tools I already use:',
    stepsLabel: 'Steps to follow:',
    snippetLabel: 'Starting point (reference — adapt it to my actual project):',
    closing:
      "Do it directly in my project: create or edit whatever's needed, follow the conventions I already use, "
      + 'and briefly explain at the end what you changed and why.',
  },
};

function resolveTemplate(lang) {
  return TEMPLATES[lang] || TEMPLATES.es;
}

// `entry` is the roadmap jump entry ALREADY resolved by the caller
// (curated, or curated-with-personalization-merged — src/roadmap-
// personalization.js's mergeRoadmapPersonalization). `null`/a maxTier
// (T7 terminal) entry both mean "no next-tier jump to implement", so this
// returns `null` rather than fabricating a prompt for something that
// doesn't exist.
function buildImplementationPrompt(entry, report, maturity, lang) {
  if (!entry || entry.maxTier) return null;

  const T = resolveTemplate(lang);
  const r = report || {};
  const frameworks = Array.isArray(r.technologies) ? r.technologies : [];
  const toolNames = Array.isArray(r.tools) ? r.tools.filter((x) => x && x.detected).map((x) => x.name) : [];
  const tierKey = (maturity && maturity.tierKey) || entry.tierKey || '';
  const tierName = (maturity && maturity.tierName) || '';

  const lines = [];
  lines.push(T.intro(frameworks.join(', ')));
  lines.push('');
  lines.push(T.context(tierKey, tierName));
  lines.push('');
  lines.push(T.unlocksLabel);
  lines.push(entry.unlocks);

  if (toolNames.length) {
    lines.push('');
    lines.push(T.toolsLabel);
    lines.push(toolNames.join(', '));
  }

  lines.push('');
  lines.push(T.stepsLabel);
  const steps = Array.isArray(entry.steps) ? entry.steps : [];
  steps.forEach((s, i) => {
    lines.push(`${i + 1}. ${s.text}${s.estimate ? ` (${s.estimate})` : ''}`);
  });

  if (entry.snippet && entry.snippet.code) {
    lines.push('');
    lines.push(T.snippetLabel);
    if (entry.snippet.filename) lines.push(`${entry.snippet.filename}:`);
    lines.push('```' + (entry.snippet.language || ''));
    lines.push(entry.snippet.code);
    lines.push('```');
    if (entry.snippet.secondFile) {
      lines.push('');
      lines.push(`${entry.snippet.secondFile.filename}:`);
      lines.push('```' + (entry.snippet.language || ''));
      lines.push(entry.snippet.secondFile.code);
      lines.push('```');
    }
  }

  lines.push('');
  lines.push(T.closing);

  return lines.join('\n');
}

module.exports = { buildImplementationPrompt };
