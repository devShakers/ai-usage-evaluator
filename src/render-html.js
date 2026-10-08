'use strict';

const { sanitizeRenderText } = require('./sanitize-network-text');

// SHARED SHAPING FOR AGENT CARDS AND CERTIFICATION EVIDENCE — no HTML.

function normalizeAgentName(name) {
  return String(name || '').trim().toLowerCase().replace(/^[`'"*]+|[`'"*]+$/g, '');
}

// talents-ai-score, description-always-present (real-browser user feedback): TWO earlier approaches were tried and rejected before this one.

function humanizeAgentName(name) {
  const spaced = String(name || '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return spaced.replace(/^\S/, (c) => c.toUpperCase());
}

function cleanRawDescription(text) {
  return String(text || '')
    .replace(/\\[nrt]/g, ' ') // literal 2-char escape sequences, as typed in the source frontmatter
    .replace(/[\n\r\t]/g, ' ') // real control characters (e.g. from a `|` block scalar)
    .replace(/\|/g, ' ') // stray YAML block-scalar/table-like pipe artifacts
    .replace(/\s+/g, ' ')
    .trim();
}

const CARD_EXCERPT_MAX_LEN = 160;

function excerptForCard(text, maxLen = CARD_EXCERPT_MAX_LEN) {
  if (!text) return text;
  const sentenceMatch = text.match(/[.!?](?=\s|$)/);
  const sentenceEndIdx = sentenceMatch ? sentenceMatch.index + 1 : null;

  if (sentenceEndIdx !== null && sentenceEndIdx <= maxLen) {
    return text.slice(0, sentenceEndIdx).trim();
  }
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen).trim()}…`;
}

// Every card field that is TALENT-AUTHORED or came OFF THE WIRE, neutralised once, here — issue 055.

// Every card field that is TALENT-AUTHORED or came OFF THE WIRE, neutralised once, here — issue 055.
function sanitizeCardText(v) {
  return typeof v === 'string' ? sanitizeRenderText(v) : v;
}

function sanitizeCardList(v) {
  return Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? sanitizeRenderText(x) : x)) : v;
}

function buildAgentCardTree(report, t) {
  const agents = Array.isArray(report.agents) ? report.agents : [];
  const synthesisAgents =
    report.agentSynthesis && Array.isArray(report.agentSynthesis.agents) ? report.agentSynthesis.agents : [];
  const synthesisByName = new Map(synthesisAgents.map((a) => [normalizeAgentName(a.name), a]));
  const rawDescriptions = Array.isArray(report.agentDescriptions) ? report.agentDescriptions : [];
  const rawDescByName = new Map(rawDescriptions.map((d) => [normalizeAgentName(d.name), d.description]));
  const byName = new Set(agents.map((a) => a.name));

  // ADR-016 agent evaluation: the ephemeral LLM definition-quality score (+ rationale) keyed by normalized name, and the LOCAL usage count keyed by exact name.
  const evaluations =
    report.agentEvaluation && Array.isArray(report.agentEvaluation.evaluations)
      ? report.agentEvaluation.evaluations
      : [];
  // The agents the evaluation call answered about but did NOT cover — declared by
  // the service and cross-checked against what was sent (src/agent-evaluation.js).
  const omittedNames = new Set(
    report.agentEvaluation && Array.isArray(report.agentEvaluation.omittedAgentNames)
      ? report.agentEvaluation.omittedAgentNames.filter((n) => typeof n === 'string' && n)
      : [],
  );
  const evalByName = new Map(evaluations.map((e) => [normalizeAgentName(e.name), e]));

  const cards = agents.map((a) => {
    const key = normalizeAgentName(a.name);
    const synth = synthesisByName.get(key);
    const parentKey = a.parent && byName.has(a.parent) && a.parent !== a.name ? a.parent : null;
    const tools = Array.isArray(a.tools) ? a.tools : [];
    // AI product derived from the agent's SOURCE (agent-org-chart#deriveAiProduct) — shown on the card in place of the LLM model.
    const aiProduct = typeof a.aiProduct === 'string' && a.aiProduct ? a.aiProduct : null;

    const ev = evalByName.get(key);
    const evalPhrase =
      ev && typeof ev.description === 'string' && ev.description.trim() ? ev.description.trim() : null;
    const synthPhrase =
      synth && typeof synth.whatItDoes === 'string' && synth.whatItDoes.trim() ? synth.whatItDoes.trim() : null;
    const rawRaw = rawDescByName.get(key);
    const rawPhrase =
      typeof rawRaw === 'string' && rawRaw.trim() ? excerptForCard(cleanRawDescription(rawRaw)) : null;
    const fallbackPhrase = t && t.html.agentDescriptionFromName ? t.html.agentDescriptionFromName(humanizeAgentName(a.name)) : null;
    const whatItDoes = evalPhrase || synthPhrase || rawPhrase || fallbackPhrase;

    // The numeric score AND the local usage signal were removed from footprint cards (user decision) — not carried onto the card.
    const rationale = ev && typeof ev.rationale === 'string' && ev.rationale.trim() ? ev.rationale.trim() : null;
    // v4 (agent classification): closest catalog agent + how it was matched, and 2-3 improvement tips.
    const classification = ev
      ? ev.classification && ev.classification.catalogId
        ? ev.classification
        : { catalogId: null, category: null, role: null, level: null, method: 'unclassified' }
      : null;
    const improvements = ev && Array.isArray(ev.improvements) ? ev.improvements : [];
    // THE FOUR-VALUE EVALUATION STATE, RESOLVED HERE AND NOWHERE ELSE (2026-08-03).
    const evaluationState = ev
      ? (classification && classification.catalogId ? 'classified' : 'unclassified')
      : (omittedNames.has(a.name) ? 'omitted' : 'not-evaluated');

    // The single render-safety pass for both the HTML and the terminal card (see sanitizeCardText above).
    return {
      name: sanitizeCardText(a.name),
      symbolicName: sanitizeCardText(synth && synth.symbolicName ? synth.symbolicName : null),
      whatItDoes: sanitizeCardText(whatItDoes),
      tools: sanitizeCardList(tools),
      // The declared LLM model (issue 089).
      model: sanitizeCardText(a.model),
      aiProduct,
      parent: sanitizeCardText(parentKey),
      rationale: sanitizeCardText(rationale),
      classification: classification
        ? { ...classification, role: sanitizeCardText(classification.role) }
        : classification,
      improvements: sanitizeCardList(improvements),
      // Issue 106's provenance rule, applied to the fourth state: ONE field, on the card both surfaces read, so the terminal and the shared report cannot disagree about the same agent.
      evaluationState,
    };
  });

  const childrenByParent = new Map();
  for (const card of cards) {
    if (!childrenByParent.has(card.parent)) childrenByParent.set(card.parent, []);
    childrenByParent.get(card.parent).push(card);
  }

  return { childrenByParent, roots: childrenByParent.get(null) || [] };
}

// Maps an AI-product key (e.g. 'claude-code') to its display name via i18n,
// falling back to the raw key. Product names are proper nouns (same es/en).

module.exports = { buildAgentCardTree };
