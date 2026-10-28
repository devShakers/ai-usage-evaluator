'use strict';

const path = require('path');
const { derivePayload, wireExcerpt } = require('./share-payload');
const { looksLikeCredential } = require('./agent-synthesis');
const { classify } = require('./maturity');
const { reviewCopy } = require('./signup-copy');
const { sanitizeRenderText } = require('./sanitize-network-text');
const { toSignupLanguage } = require('./signup-copy');

const numbered = (nums) => nums.map((n) => `#${n}`).join(', ');

const EXCERPT_COPY = {
  es: {
    title: 'Este es el texto exacto que se subiría, ya filtrado:',
    flagged: (nums) => `Estos parecen una contraseña o una clave, así que se quedan fuera salvo que pidas mantenerlos: ${numbered(nums)}.`,
    mark: '[parece una credencial]',
    conversation: 'mensaje',
    command: 'comando',
    chatHint: 'Si quieres dejar fuera alguno de estos textos, dime su número al responder.',
    formField: 'Números de los textos que quieres dejar fuera (los que parecen credenciales ya están puestos)',
    previousTitle: 'Tu evaluación anterior en «Mi trabajo con IA» (la nueva tarda unos minutos):',
  },
  en: {
    title: 'This is the exact text that would be uploaded, already filtered:',
    flagged: (nums) => `These look like a password or a key, so they are left out unless you ask to keep them: ${numbered(nums)}.`,
    mark: '[looks like a credential]',
    conversation: 'message',
    command: 'command',
    chatHint: 'If you want to leave out any of these texts, tell me its number when you answer.',
    formField: 'Numbers of the texts to leave out (the ones that look like credentials are already filled in)',
    previousTitle: 'Your previous evaluation in "My work with AI" (the new one takes a few minutes):',
  },
  it: {
    title: 'Questo è il testo esatto che verrebbe caricato, già filtrato:',
    flagged: (nums) => `Questi sembrano una password o una chiave, quindi restano fuori a meno che tu chieda di tenerli: ${numbered(nums)}.`,
    mark: '[sembra una credenziale]',
    conversation: 'messaggio',
    command: 'comando',
    chatHint: 'Se vuoi escludere qualcuno di questi testi, dimmi il suo numero quando rispondi.',
    formField: 'Numeri dei testi da escludere (quelli che sembrano credenziali sono già inseriti)',
    previousTitle: "La tua valutazione precedente in «Il mio lavoro con l'IA» (la nuova richiede qualche minuto):",
  },
  pt: {
    title: 'Este é o texto exato que seria carregado, já filtrado:',
    flagged: (nums) => `Estes parecem uma palavra-passe ou uma chave, por isso ficam de fora, a menos que peça para os manter: ${numbered(nums)}.`,
    mark: '[parece uma credencial]',
    conversation: 'mensagem',
    command: 'comando',
    chatHint: 'Se quiser deixar de fora algum destes textos, diga-me o número ao responder.',
    formField: 'Números dos textos a deixar de fora (os que parecem credenciais já estão preenchidos)',
    previousTitle: 'A sua avaliação anterior em «Meu trabalho com IA» (a nova demora alguns minutos):',
  },
};

function excerptCopy(lang) {
  return EXCERPT_COPY[toSignupLanguage(lang) || 'en'];
}

function excerptItems({ report, maturity }) {
  const payload = derivePayload(report, maturity);
  const conversation = [
    ...(payload.steering ? payload.steering.redactedSteeringExcerpts : []),
    ...(payload.decisions ? payload.decisions.redactedDecisionExcerpts : []),
  ].map((text) => ({ kind: 'conversation', text }));
  const commands = (payload.sessions ? payload.sessions.redactedCommandSample : []).map((text) => ({ kind: 'command', text }));
  return [...conversation, ...commands].map((item, i) => ({ ...item, n: i + 1, flagged: looksLikeCredential(item.text) }));
}

function excerptItemsText(lang, items) {
  const x = excerptCopy(lang);
  const flagged = items.filter((i) => i.flagged).map((i) => i.n);
  return [
    x.title,
    flagged.length ? x.flagged(flagged) : null,
    ...items.map((i) => `#${i.n} ${i.flagged ? `${x.mark} ` : ''}(${x[i.kind]}) ${sanitizeRenderText(i.text.replace(/\s+/g, ' '))}`),
  ].filter(Boolean).join('\n');
}

function repoName(repo) {
  return path.basename(String(repo)) || String(repo);
}

function uploadFacts({ report, maturity, repos = [] }) {
  const payload = derivePayload(report, maturity);
  const sessions = payload.sessions || {};
  const conversationExcerpts =
    (payload.steering ? payload.steering.redactedSteeringExcerpts.length : 0)
    + (payload.decisions ? payload.decisions.redactedDecisionExcerpts.length : 0);
  const commandExcerpts = Array.isArray(sessions.redactedCommandSample) ? sessions.redactedCommandSample.length : 0;
  return {
    tools: (report.tools || []).filter((t) => t && t.detected).map((t) => t.name || t.id),
    technologies: payload.technologies.filter((t) => typeof t === 'string'),
    sessionCount: sessions.sessionCount || 0,
    activeDaysPerWeek: typeof sessions.activeDaysPerWeek === 'number' ? sessions.activeDaysPerWeek : null,
    commitCount: payload.gitActivity ? payload.gitActivity.commitCount : 0,
    repos: repos.map(repoName),
    agents: payload.agents.map((a) => a.name),
    agentDefinitions: payload.agents.filter((a) => a.definition).length,
    agentSummaries: payload.agentSynthesis.filter((a) => a.whatItDoes || a.symbolicName).length,
    conversationExcerpts,
    commandExcerpts,
  };
}

function keepNamed(list, excluded) {
  return Array.isArray(list) ? list.filter((x) => !(x && excluded.has(x.name))) : list;
}

function keepOnly(list, kept) {
  return Array.isArray(list) ? list.filter((x) => typeof x === 'string' && kept.has(wireExcerpt(x))) : list;
}

function withoutExcluded(report, { agents = [], excerpts = true, keptExcerpts = null } = {}) {
  const excluded = new Set(agents);
  const next = structuredClone(report);
  if (excluded.size > 0) {
    next.agents = keepNamed(next.agents, excluded)
      .map((a) => (a && excluded.has(a.parent) ? { ...a, parent: null } : a));
    next.agentDefinitions = keepNamed(next.agentDefinitions, excluded);
    next.agentDescriptions = keepNamed(next.agentDescriptions, excluded);
    if (next.agentEvaluation) next.agentEvaluation.evaluations = keepNamed(next.agentEvaluation.evaluations, excluded);
    if (next.agentSynthesis) next.agentSynthesis.agents = keepNamed(next.agentSynthesis.agents, excluded);
    if (next.detectionEvidence) next.detectionEvidence.agents = keepNamed(next.detectionEvidence.agents, excluded);
    if (next.agentUsage && next.agentUsage.byAgent) {
      for (const name of excluded) delete next.agentUsage.byAgent[name];
    }
    if (next.agentCounts) next.agentCounts.agents = Array.isArray(next.agents) ? next.agents.length : 0;
  }
  const kept = new Set(excerpts && keptExcerpts ? keptExcerpts : []);
  if (!excerpts || keptExcerpts) {
    if (next.steering) next.steering.redactedSteeringExcerpts = keepOnly(next.steering.redactedSteeringExcerpts, kept);
    if (next.decisions) next.decisions.redactedDecisionExcerpts = keepOnly(next.decisions.redactedDecisionExcerpts, kept);
    if (next.sessions) next.sessions.redactedCommandSample = keepOnly(next.sessions.redactedCommandSample, kept);
  }
  return { report: next, maturity: classify(next) };
}

function joined(list) {
  return list.join(', ');
}

function summaryText(lang, facts, { sent = false } = {}) {
  const c = reviewCopy(lang);
  return [
    sent ? c.sentTitle : c.title,
    facts.tools.length ? c.tools(joined(facts.tools)) : null,
    facts.technologies.length ? c.technologies(joined(facts.technologies)) : null,
    c.activity(facts.sessionCount, facts.activeDaysPerWeek),
    facts.repos.length ? c.repos(joined(facts.repos), facts.commitCount) : null,
    facts.agents.length ? c.agents(joined(facts.agents), facts.agentDefinitions, facts.agentSummaries) : null,
    facts.conversationExcerpts + facts.commandExcerpts > 0 ? c.excerpts(facts.conversationExcerpts, facts.commandExcerpts) : c.noExcerpts,
    c.notSent,
  ].filter(Boolean).map((line, i) => (i === 0 ? line : `- ${line}`)).join('\n');
}

function explanationText(lang) {
  const c = reviewCopy(lang);
  return [c.explanationTitle, ...c.explanation, c.afterwards].join('\n\n');
}

// `explained`: the talent already read what the two axes mean and how to disagree (the review in the sign-up), so they are not repeated.
function resultText(lang, preview, { explained = false, previous = false } = {}) {
  const c = reviewCopy(lang);
  const after = explained ? [] : [c.afterwards];
  if (!preview) return [c.resultPending, ...after].join('\n\n');
  const m = preview.matrix || {};
  const lines = [
    previous ? excerptCopy(lang).previousTitle : c.resultTitle,
    m.setupLevel ? c.setupLevel(c.levels[m.setupLevel] || m.setupLevel) : null,
    preview.setup && preview.setup.explanation,
    m.usageLevel ? c.usageLevel(c.levels[m.usageLevel] || m.usageLevel) : null,
    preview.usage && preview.usage.explanation,
    m.cell ? c.cell(m.cell) : null,
  ].filter(Boolean).map(sanitizeRenderText);
  return [lines.join('\n'), ...(explained ? [] : [c.explanation[0]]), ...after].join('\n\n');
}

module.exports = { uploadFacts, withoutExcluded, repoName, summaryText, explanationText, resultText, excerptCopy, excerptItems, excerptItemsText };
