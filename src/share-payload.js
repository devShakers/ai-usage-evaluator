'use strict';

// The derived-payload whitelist for the `usage/reports` ingest, extracted from src/share.js (structure refactor, issue 020).

const { scrubSecrets } = require('./agent-synthesis');
const { MAX_DEFINITION_CHARS } = require('./agent-evaluation');

// Only these fields leave the machine.
function whitelistSchedulerProbe(probe) {
  return {
    inspected: !!(probe && probe.inspected),
    matches: probe && typeof probe.matches === 'number' ? probe.matches : 0,
  };
}

// WHY ONE MORE FIELD IS ADMISSIBLE ON THE AGENT WHITELIST (issue 115).
function agentCatalogIdsByName(report) {
  const evaluations =
    report.agentEvaluation && Array.isArray(report.agentEvaluation.evaluations)
      ? report.agentEvaluation.evaluations
      : [];

  const byName = new Map();
  for (const e of evaluations) {
    if (!e || typeof e.name !== 'string' || !e.name) continue;
    if (byName.has(e.name)) continue; // first occurrence wins — see docblock
    const id =
      e.classification && typeof e.classification.catalogId === 'string' && e.classification.catalogId
        ? e.classification.catalogId
        : null;
    byName.set(e.name, id);
  }
  return byName;
}

// WHY THE AGENT `definition` NOW RIDES THE INGEST PAYLOAD (agent-classifier fix).
function agentDefinitionsByName(report) {
  const definitions = Array.isArray(report.agentDefinitions)
    ? report.agentDefinitions
    : [];
  const byName = new Map();
  for (const entry of definitions) {
    if (!entry || typeof entry.name !== 'string' || !entry.name) continue;
    if (byName.has(entry.name)) continue; // first occurrence wins — mirrors agentCatalogIdsByName
    const text = typeof entry.definition === 'string' ? entry.definition : '';
    byName.set(entry.name, scrubSecrets(text).slice(0, MAX_DEFINITION_CHARS));
  }
  return byName;
}

function derivePayload(report, maturity) {
  const agents = Array.isArray(report.agents) ? report.agents : [];
  const catalogIdsByName = agentCatalogIdsByName(report);
  const definitionsByName = agentDefinitionsByName(report);
  const technologies = Array.isArray(report.technologies) ? report.technologies : [];
  const synthesisAgents =
    report.agentSynthesis && Array.isArray(report.agentSynthesis.agents)
      ? report.agentSynthesis.agents
      : [];

  const mcp = report.mcp || {};
  const memory = report.memory || {};
  const automations = report.automations || {};
  const automationsScripts = automations.scripts || {};
  const automationsSchedulers = automations.schedulers || {};
  const browserTools = report.browserTools || {};
  const browserToolsVia = browserTools.via || {};

  return {
    schemaVersion: report.schemaVersion,
    generatedAt: report.generatedAt,
    anonId: report.anonId,
    platform: report.platform,
    level: maturity.level,
    levelName: maturity.name,
    score: maturity.score,
    totalDetected: report.summary.totalDetected,
    categories: report.summary.categories,
    tools: report.tools.map((t) => ({
      id: t.id,
      detected: t.detected,
      depth: t.depth || {},
    })),
    agents: agents.map((a) => ({
      name: a.name,
      tools: Array.isArray(a.tools) ? a.tools : [],
      model: a.model || null,
      parent: a.parent || null,
      // issue 115 — the ONLY classification field that travels.
      catalogId: catalogIdsByName.get(a.name) || null,
      // agent-classifier fix — the agent's own definition (frontmatter description + body), scrubbed + capped.
      ...(definitionsByName.get(a.name)
        ? { definition: definitionsByName.get(a.name) }
        : {}),
    })),
    agentCounts: report.agentCounts || { agents: 0, skills: 0, commands: 0, mcpServers: 0, hooks: 0 },
    technologies,
    agentSynthesis: synthesisAgents.map((a) => ({
      name: a.name,
      symbolicName: scrubSecrets(a.symbolicName || '') || null,
      whatItDoes: scrubSecrets(a.whatItDoes || '') || null,
    })),
    tier: typeof maturity.tier === 'number' ? maturity.tier : null,
    tierKey: maturity.tierKey || null,
    mcp: {
      countsByCategory: { ...(mcp.countsByCategory || { data: 0, comms: 0, dev: 0, browser: 0, other: 0 }) },
      total: typeof mcp.total === 'number' ? mcp.total : 0,
    },
    memory: {
      totalImports: typeof memory.totalImports === 'number' ? memory.totalImports : 0,
      maxDepth: typeof memory.maxDepth === 'number' ? memory.maxDepth : 0,
      layered: !!memory.layered,
    },
    automations: {
      scripts: {
        npm: typeof automationsScripts.npm === 'number' ? automationsScripts.npm : 0,
        shell: typeof automationsScripts.shell === 'number' ? automationsScripts.shell : 0,
      },
      jsonPiping: typeof automations.jsonPiping === 'number' ? automations.jsonPiping : 0,
      schedulers: {
        cron: whitelistSchedulerProbe(automationsSchedulers.cron),
        launchd: whitelistSchedulerProbe(automationsSchedulers.launchd),
        pm2: whitelistSchedulerProbe(automationsSchedulers.pm2),
        systemd: whitelistSchedulerProbe(automationsSchedulers.systemd),
      },
    },
    browserTools: {
      detected: !!browserTools.detected,
      count: typeof browserTools.count === 'number' ? browserTools.count : 0,
      via: {
        dependency: Array.isArray(browserToolsVia.dependencies) && browserToolsVia.dependencies.length > 0,
        mcp: Array.isArray(browserToolsVia.mcp) && browserToolsVia.mcp.length > 0,
      },
    },
    // Hybrid evaluation, Slice 1: two DETERMINISTIC behavioural blocks (no LLM).
    gitActivity: whitelistGitActivity(report.gitActivity),
    sessions: whitelistSessions(report.sessions),
    // Hybrid evaluation, Slice 2: one DETERMINISTIC block (workStreams) and two REDACTED-excerpt blocks (steering, decisions).
    workStreams: whitelistWorkStreams(report.workStreams),
    steering: whitelistSteering(report.steering),
    decisions: whitelistDecisions(report.decisions),
    // Hybrid evaluation, Slice 3c: PER-CANDIDATE authorship + depth (per detected skill, per detected agent).
    detectionEvidence: whitelistDetectionEvidence(report.detectionEvidence),
  };
}

// Re-derives the `detectionEvidence` block field-by-field (never spreads the source).
function whitelistDetectionEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object') return null;
  const skills = Array.isArray(evidence.skills)
    ? evidence.skills.map((s) => ({
        tech: typeof s.tech === 'string' ? s.tech : '',
        authoredFileCount: numOr0(s.authoredFileCount),
        totalFileCount: numOr0(s.totalFileCount),
        authorshipKnown: !!s.authorshipKnown,
        depth: numOrNull(s.depth),
        vendored: !!s.vendored,
        recencyDays: numOrNull(s.recencyDays),
      }))
    : [];
  const agents = Array.isArray(evidence.agents)
    ? evidence.agents.map((a) => ({
        name: typeof a.name === 'string' ? a.name : '',
        tools: Array.isArray(a.tools)
          ? a.tools.filter((t) => typeof t === 'string')
          : [],
        model: typeof a.model === 'string' && a.model ? a.model : null,
        authoredFileCount: numOr0(a.authoredFileCount),
        totalFileCount: numOr0(a.totalFileCount),
        authorshipKnown: !!a.authorshipKnown,
        depth: numOrNull(a.depth),
        vendored: !!a.vendored,
        recencyDays: numOrNull(a.recencyDays),
      }))
    : [];
  return { skills, agents, provenance: whitelistProvenance(evidence.provenance) };
}

// Re-derives the repo-level anti-noise `provenance` (Slice 3): the (weak) fork signal and the (conservative) boilerplate/tutorial signal.
function whitelistProvenance(provenance) {
  if (!provenance || typeof provenance !== 'object') return null;
  const marker =
    typeof provenance.boilerplateMarker === 'string' && provenance.boilerplateMarker
      ? provenance.boilerplateMarker.slice(0, 60)
      : null;
  const forkSignal =
    typeof provenance.forkSignal === 'string' && provenance.forkSignal
      ? provenance.forkSignal.slice(0, 60)
      : null;
  return {
    fork: !!provenance.fork,
    forkSignal,
    boilerplate: !!provenance.boilerplate,
    boilerplateMarker: marker,
  };
}

function numOrNull(n) {
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

// Re-derives the `workStreams` block field-by-field (never spreads the source).
// `null` when absent — the server treats it as "not reported".
function whitelistWorkStreams(ws) {
  if (!ws || typeof ws !== 'object') return null;
  return {
    streamCount: numOr0(ws.streamCount),
    multiDayStreams: numOr0(ws.multiDayStreams),
    avgCommitsPerSession: numOr0(ws.avgCommitsPerSession),
    maxStreamSpanDays: numOr0(ws.maxStreamSpanDays),
  };
}

// Re-derives the `steering` block.
function whitelistSteering(s) {
  if (!s || typeof s !== 'object') return null;
  return {
    steeringTraceCount: numOr0(s.steeringTraceCount),
    redactedSteeringExcerpts: whitelistExcerpts(s.redactedSteeringExcerpts),
  };
}

// Re-derives the `decisions` block, same discipline as `steering`. `null` when absent.
function whitelistDecisions(d) {
  if (!d || typeof d !== 'object') return null;
  return {
    decisionExchangeCount: numOr0(d.decisionExchangeCount),
    redactedDecisionExcerpts: whitelistExcerpts(d.redactedDecisionExcerpts),
  };
}

const MAX_WHITELISTED_EXCERPTS = 20;
const MAX_WHITELISTED_EXCERPT_LEN = 200;
function whitelistExcerpts(arr) {
  return Array.isArray(arr)
    ? arr
        .filter((x) => typeof x === 'string' && x)
        .slice(0, MAX_WHITELISTED_EXCERPTS)
        .map((x) => scrubSecrets(x).slice(0, MAX_WHITELISTED_EXCERPT_LEN))
        .filter((x) => x)
    : [];
}

// Re-derives the `gitActivity` block field-by-field (never spreads the source).
// `null` when absent — the server treats it as "not reported".
function whitelistGitActivity(git) {
  if (!git || typeof git !== 'object') return null;
  const filesByType = {};
  if (git.filesByType && typeof git.filesByType === 'object') {
    for (const [ext, count] of Object.entries(git.filesByType)) {
      if (typeof count === 'number') filesByType[ext] = count;
    }
  }
  return {
    commitCount: numOr0(git.commitCount),
    authoredCommitCount: numOr0(git.authoredCommitCount),
    linesAdded: numOr0(git.linesAdded),
    linesDeleted: numOr0(git.linesDeleted),
    filesByType,
    velocity: numOr0(git.velocity),
    spanDays: numOr0(git.spanDays),
  };
}

// Re-derives the `sessions` block field-by-field (never spreads the source).
function whitelistSessions(sessions) {
  if (!sessions || typeof sessions !== 'object') return null;
  return {
    toolsSeen: Array.isArray(sessions.toolsSeen)
      ? sessions.toolsSeen.filter((t) => typeof t === 'string')
      : [],
    sessionCount: numOr0(sessions.sessionCount),
    subagentRunCount: numOr0(sessions.subagentRunCount),
    activeHours: numOrNull(sessions.activeHours),
    crossToolLinks: numOr0(sessions.crossToolLinks),
    filesTouchedCount: numOr0(sessions.filesTouchedCount),
    bashCommandsCount: numOr0(sessions.bashCommandsCount),
    planningSignalCount: numOr0(sessions.planningSignalCount),
    // Recency-windowed traction signals for the hub profile.
    sessions90d: numOrNull(sessions.sessions90d),
    activeDaysPerWeek: numOrNull(sessions.activeDaysPerWeek),
    blindApprovalCount: numOrNull(sessions.blindApprovalCount),
    humanTurnCount: numOrNull(sessions.humanTurnCount),
    specificInstructionCount: numOrNull(sessions.specificInstructionCount),
    instructionTurnCount: numOrNull(sessions.instructionTurnCount),
    avgInstructionLength: numOrNull(sessions.avgInstructionLength),
    redactedCommandSample: Array.isArray(sessions.redactedCommandSample)
      ? sessions.redactedCommandSample
          .filter((c) => typeof c === 'string')
          .map((c) => scrubSecrets(c).slice(0, MAX_WHITELISTED_EXCERPT_LEN))
          .filter((c) => c)
      : [],
  };
}

function numOr0(n) {
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
}

module.exports = { derivePayload };
