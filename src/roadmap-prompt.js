'use strict';

const { tierName: getTierName } = require('./i18n');

// Deterministic, ready-to-paste "implementation prompt" (talents-ai-score: "next steps -> prompt").

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
    introMax: (frameworksText) =>
      `Ayúdame a consolidar y afinar el setup de IA de mi proyecto${frameworksText ? ` (uso ${frameworksText})` : ''}.`,
    contextMax: (tierKey, tierName) =>
      `Contexto: mi proyecto ya está en el tier máximo ${tierKey} (${tierName}) según AI Footprint. No busco añadir más herramientas, sino sacarle más partido a lo que ya tengo.`,
    remainsLabel: 'Dónde está el margen ahora:',
    stepsLabelMax: 'Refinamientos a aplicar:',
    closingMax:
      'Revisa mi proyecto y aplícalo directamente: recorta lo que estorbe, afina lo existente y '
      + 'sigue las convenciones que ya uso; al final explícame brevemente qué has cambiado y por qué.',
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
    introMax: (frameworksText) =>
      `Help me consolidate and sharpen my project's AI setup${frameworksText ? ` (I use ${frameworksText})` : ''}.`,
    contextMax: (tierKey, tierName) =>
      `Context: my project is already at the top tier ${tierKey} (${tierName}) according to AI Footprint. I'm not looking to add more tools, but to get more out of what I already have.`,
    remainsLabel: 'Where the margin is now:',
    stepsLabelMax: 'Refinements to apply:',
    closingMax:
      'Review my project and apply it directly: trim what gets in the way, sharpen what exists and '
      + 'follow the conventions I already use; briefly explain at the end what you changed and why.',
  },
};

function resolveTemplate(lang) {
  return TEMPLATES[lang] || TEMPLATES.es;
}

// `entry` is the roadmap entry ALREADY resolved by the caller (curated, or curated-with-personalization-merged — src/roadmap-personalization.js's mergeRoadmapPersonalization).
function buildImplementationPrompt(entry, report, maturity, lang) {
  if (!entry) return null;
  if (entry.maxTier) return buildConsolidationPrompt(entry, report, maturity, lang);

  const T = resolveTemplate(lang);
  const r = report || {};
  const frameworks = Array.isArray(r.technologies) ? r.technologies : [];
  const toolNames = Array.isArray(r.tools) ? r.tools.filter((x) => x && x.detected).map((x) => x.name) : [];
  const tierKey = (maturity && maturity.tierKey) || entry.tierKey || '';
  // talents-ai-score, i18n audit: NEVER maturity.tierName directly — that field comes straight from tier-engine.js and is Spanish-only by design (domain logic, not i18n).
  const tierName = getTierName(tierKey, lang);

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

function buildConsolidationPrompt(entry, report, maturity, lang) {
  const steps = Array.isArray(entry.consolidationSteps) ? entry.consolidationSteps : [];
  if (steps.length === 0 && !entry.whatRemains) return null;

  const T = resolveTemplate(lang);
  const r = report || {};
  const frameworks = Array.isArray(r.technologies) ? r.technologies : [];
  const toolNames = Array.isArray(r.tools) ? r.tools.filter((x) => x && x.detected).map((x) => x.name) : [];
  const tierKey = (maturity && maturity.tierKey) || entry.tierKey || 'T7';
  const tierName = getTierName(tierKey, lang);

  const lines = [];
  lines.push(T.introMax(frameworks.join(', ')));
  lines.push('');
  lines.push(T.contextMax(tierKey, tierName));

  if (entry.whatRemains) {
    lines.push('');
    lines.push(T.remainsLabel);
    lines.push(entry.whatRemains);
  }

  if (toolNames.length) {
    lines.push('');
    lines.push(T.toolsLabel);
    lines.push(toolNames.join(', '));
  }

  if (steps.length) {
    lines.push('');
    lines.push(T.stepsLabelMax);
    steps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
  }

  lines.push('');
  lines.push(T.closingMax);

  return lines.join('\n');
}

module.exports = { buildImplementationPrompt };
