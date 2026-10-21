'use strict';

const path = require('path');
const { derivePayload } = require('./share-payload');
const { classify } = require('./maturity');
const { reviewCopy } = require('./signup-copy');
const { sanitizeRenderText } = require('./sanitize-network-text');

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

function withoutExcluded(report, { agents = [], excerpts = true } = {}) {
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
  if (!excerpts) {
    if (next.steering) next.steering.redactedSteeringExcerpts = [];
    if (next.decisions) next.decisions.redactedDecisionExcerpts = [];
    if (next.sessions) next.sessions.redactedCommandSample = [];
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

function resultText(lang, preview) {
  const c = reviewCopy(lang);
  if (!preview) return [c.resultPending, c.afterwards].join('\n\n');
  const m = preview.matrix || {};
  const lines = [
    c.resultTitle,
    m.setupLevel ? c.setupLevel(c.levels[m.setupLevel] || m.setupLevel) : null,
    preview.setup && preview.setup.explanation,
    m.usageLevel ? c.usageLevel(c.levels[m.usageLevel] || m.usageLevel) : null,
    preview.usage && preview.usage.explanation,
    m.cell ? c.cell(m.cell) : null,
  ].filter(Boolean).map(sanitizeRenderText);
  return [lines.join('\n'), c.explanation[0], c.afterwards].join('\n\n');
}

module.exports = { uploadFacts, withoutExcluded, repoName, summaryText, explanationText, resultText };
