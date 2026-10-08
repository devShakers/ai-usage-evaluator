'use strict';

// The agents + activity blocks of the terminal report, extracted from src/render-terminal.js (structure refactor, issue 020).

const { label } = require('./i18n');
const { buildAgentCardTree } = require('./render-html');
const { sanitizeRenderText } = require('./sanitize-network-text');
const { MODEL_CALL, REASON, callFailed, callPartial, callTimedOut, modelCall, omittedByCall } = require('./model-call-record');
const { isFloorCategory } = require('./agent-category');
const { DEFAULT_REPORT_GATE } = require('./report-gating');
const { c, wrap, summarize } = require('./terminal-format');
const { detectedToolNames } = require('./detected-tools');

// agents (ADR-016: one line per agent) As SIMPLE as possible: ONE line per agent.

// AI product (from the source, e.g. Claude Code) shown in place of the LLM model.
function agentProductLabel(card, t) {
  if (!card.aiProduct) return '';
  const map = (t.html && t.html.aiProducts) || {};
  return map[card.aiProduct] || card.aiProduct;
}

function agentLine(card, depth, t) {
  const indent = '  '.repeat(depth);
  // Root = a filled bullet; every deeper level = that many stacked down-arrows.
  const marker = depth === 0 ? `${c.success}●${c.reset}` : `${c.primary}${'↓'.repeat(depth)}${c.reset}`;
  // card.symbolicName is agent-synthesis (LLM, ADR-010) content; card.name is
  // the local, deterministic agent id — only the former needs stripping.
  const title = card.symbolicName
    ? `${sanitizeRenderText(card.symbolicName)} ${c.muted}(${card.name})${c.reset}`
    : card.name;
  // No model, no usage (user decision) — show the AI PRODUCT instead of the model.
  const product = agentProductLabel(card, t);
  const productBit = product ? ` ${c.dim}[${product}]${c.reset}` : '';
  return `  ${indent}${marker} ${c.bold}${c.white}${title}${c.reset}${productBit}`;
}

// The agent's wired tools/integrations = the per-card "technologies" (user wants
// MORE tech visible). One dim line under the agent; deduped; omitted when empty.
function agentToolsLine(card, depth) {
  const tools = Array.from(new Set((card.tools || []).filter((x) => typeof x === 'string' && x.trim())));
  if (tools.length === 0) return null;
  const indent = '  '.repeat(depth);
  return `  ${indent}   ${c.muted}${tools.join(' · ')}${c.reset}`;
}

// A compact, dim, summarized description under each agent (frontmatter `description` via buildAgentCardTree's whatItDoes), truncated to ~90 chars on a clean boundary.
function agentDescLine(card, depth) {
  if (!card.whatItDoes) return null;
  const indent = '  '.repeat(depth);
  return `  ${indent}   ${c.dim}${summarize(sanitizeRenderText(card.whatItDoes), 90)}${c.reset}`;
}

function agentClassLine(card, depth, t) {
  const indent = '  '.repeat(depth);
  const cc = t.classification;
  // FOURTH STATE (2026-08-03): the evaluation SUCCEEDED and left this agent out.
  if (card.evaluationState === 'omitted') {
    return `  ${indent}   ${c.warning}${cc.agentEvalOmitted}${c.reset}`;
  }
  // No evaluation ran for this agent → no classification line.
  if (!card.classification) return '';
  if (card.classification.method === 'unclassified' || !card.classification.catalogId) {
    return `  ${indent}   ${c.muted}${cc.noCategory}${c.reset}`;
  }
  const { category, role, level } = card.classification;
  const catLabel = (category && cc.categories[category]) || sanitizeRenderText(category);
  const levelLabel = (level && cc.levels[level]) || sanitizeRenderText(level);
  const bits = [];
  // The FLOOR category is dimmed, not accented (issue 120).
  const floor = isFloorCategory(category);
  if (catLabel) {
    bits.push(floor ? `${c.dim}${catLabel}${c.reset}` : `${c.primary}${catLabel}${c.reset}`);
  }
  // The floor's ROLE is dropped, and it is not a style preference.
  if (role && !floor) bits.push(`${c.white}${sanitizeRenderText(role)}${c.reset}`);
  if (levelLabel) bits.push(`${c.dim}${levelLabel}${c.reset}`);
  return `  ${indent}   ${bits.join(`${c.muted} · ${c.reset}`)}`;
}

// v4 (report req 3): the "how to improve" tips, one per line under the agent.
function agentImprovementLines(card, depth, t) {
  const tips = Array.isArray(card.improvements) ? card.improvements : [];
  if (tips.length === 0) return [];
  const indent = '  '.repeat(depth);
  const out = [`  ${indent}   ${c.dim}${t.classification.improvementsHeading}${c.reset}`];
  for (const tip of tips) out.push(`  ${indent}     ${c.muted}- ${sanitizeRenderText(tip)}${c.reset}`);
  return out;
}

function printActivity(report, t, p) {
  const s = report && report.sessions ? report.sessions : null;
  const g = report && report.gitActivity ? report.gitActivity : null;
  const w = report && report.workStreams ? report.workStreams : null;
  if (!s && !g && !w) return false;

  const a = t.terminal.activity;
  p(`  ${c.bold}${a.heading}${c.reset}`);
  if (Array.isArray(report.analyzedRepos) && report.analyzedRepos.length) {
    p(`  ${c.dim}${a.repos(report.analyzedRepos.map(sanitizeRenderText).join(', '))}${c.reset}`);
  }
  if (s) {
    const sub =
      s.subagentRunCount > 0
        ? ` ${c.muted}·${c.reset} ${a.subagents(s.subagentRunCount)}`
        : '';
    p(`  ${c.success}●${c.reset} ${a.sessions(s.sessionCount)}${sub}`);
    if (typeof s.activeHours === 'number' && s.activeHours > 0) {
      p(`  ${c.success}●${c.reset} ${a.hours(s.activeHours)}`);
    }
  }
  if (g) {
    p(
      `  ${c.success}●${c.reset} ${a.commits(g.authoredCommitCount, g.commitCount)} ${c.muted}·${c.reset} ${a.lines(g.linesAdded, g.linesDeleted)} ${c.muted}·${c.reset} ${a.velocity(g.velocity)}`,
    );
  }
  if (w) {
    p(
      `  ${c.success}●${c.reset} ${a.workStreams(w.streamCount, w.multiDayStreams, w.maxStreamSpanDays)}`,
    );
  }
  // Traction (ADR-039): recency-windowed signals from the local scan; agentsOnProfile
  // is hub-only, shown only when the ai-profile preview has already been fetched.
  const tr = tractionParts(report, s, a);
  if (tr.length) p(`  ${c.success}●${c.reset} ${a.tractionLabel}: ${tr.join(' · ')}`);
  return true;
}

function tractionParts(report, s, a) {
  const parts = [];
  if (s && typeof s.sessions90d === 'number') parts.push(a.tSessions(s.sessions90d));
  if (s && typeof s.activeDaysPerWeek === 'number') parts.push(a.tDays(s.activeDaysPerWeek));
  const detected = report && report.agentCounts ? report.agentCounts.agents : null;
  const onProfile = report && report.aiWorkPreview && report.aiWorkPreview.traction
    ? report.aiWorkPreview.traction.agentsOnProfile : null;
  if (typeof detected === 'number') parts.push(a.tAgents(detected, typeof onProfile === 'number' ? onProfile : null));
  const tools = detectedToolNames(report && report.tools);
  if (tools.length) parts.push(a.tTools(tools.join(', ')));
  return parts;
}

function printAgents(report, t, p, gate = DEFAULT_REPORT_GATE) {
  const { childrenByParent, roots } = buildAgentCardTree(report, t);
  // The names the evaluation left out.
  const omittedNames = new Set(omittedByCall(report, MODEL_CALL.EVALUATION));
  p(`  ${c.bold}${label(t.html.diagramHeading, 'Agents')}${c.reset}`);
  if (!roots.length) {
    p(`  ${c.muted}  ${label(t.html.agentsEmpty, 'No configured AI agents detected.')}${c.reset}`);
    p();
    return;
  }
  // THE ROOT THE AGENTS HANG FROM (issue 086 — restored, not invented).
  p(`  ${c.muted}${label(t.html.orchestratorLabel, 'Orchestrator')}${c.reset}`);
  const visited = new Set();
  const walk = (card, depth) => {
    if (visited.has(card.name)) return;
    visited.add(card.name);
    p(agentLine(card, depth, t));
    const desc = agentDescLine(card, depth);
    if (desc) p(desc);
    const toolsLine = agentToolsLine(card, depth);
    if (toolsLine) p(toolsLine);
    const classLine = agentClassLine(card, depth, t);
    if (classLine) p(classLine);
    if (gate.showAgentSuggestions) {
      for (const line of agentImprovementLines(card, depth, t)) p(line);
    }
    const children = childrenByParent.get(card.name) || [];
    for (const child of children) walk(child, depth + 1);
  };
  for (const root of roots) walk(root, 0);
  // A single note when the local usage history is unavailable, so a blank usage
  // column reads as "no local history" rather than "never used".
  if (report.agentUsage && report.agentUsage.available === false) {
    p(`  ${c.dim}${t.terminal.agentUsageUnavailable}${c.reset}`);
  }
  // A PARTIAL RUN SAYS SO, AND BY NAME (2026-08-03).
  if (callPartial(report, MODEL_CALL.EVALUATION)) {
    const names = [...omittedNames].map(sanitizeRenderText).join(', ');
    for (const line of wrap(t.classification.agentsEvalPartial(names, omittedNames.size))) p(`  ${c.dim}${line}${c.reset}`);
  }
  // THE CASE THAT SAID NOTHING AT ALL (issue 116).
  if (callFailed(report, MODEL_CALL.EVALUATION)) {
    const detected = Array.isArray(report.agents) ? report.agents.length : 0;
    const cls = t.classification;
    // FOUR outcomes, because they ask the talent to do different things — and ADR-042 is what made three of them distinguishable at all.
    const record = modelCall(report, MODEL_CALL.EVALUATION);
    const reason = record && record.reason;
    let notice;
    if (callTimedOut(report, MODEL_CALL.EVALUATION)) notice = cls.agentsEvalTimedOut(detected);
    else if (reason === REASON.NETWORK) notice = cls.agentsEvalUnreachable;
    else if (reason === REASON.HTTP) notice = cls.agentsEvalErrored;
    else notice = cls.agentsEvalMissing;
    for (const line of wrap(notice)) p(`  ${c.dim}${line}${c.reset}`);
  }
  p();
}

module.exports = { printAgents, printActivity };
