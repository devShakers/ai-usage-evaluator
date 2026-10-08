'use strict';

const { detectedTools } = require('./detected-tools');

const LABELS = {
  es: {
    title: 'Informe de uso de IA (almacenado)',
    platform: 'Plataforma',
    level: 'Nivel',
    score: 'Puntuación',
    tier: 'Tier',
    detected: 'Detectados',
    categories: 'Categorías',
    tools: 'Herramientas',
    technologies: 'Tecnologías',
    agents: 'Agentes',
    mcp: 'Servidores MCP',
    activity: 'Actividad',
    sessions: 'Sesiones',
    subagentRuns: 'Ejecuciones de subagentes',
    activeHours: 'Horas activas',
    crossToolLinks: 'Enlaces entre herramientas',
    filesTouched: 'Ficheros tocados',
    bashCommands: 'Comandos de shell',
    planningSignals: 'Señales de planificación',
    commits: 'Commits propios',
    steering: 'Correcciones/steering',
    decisions: 'Decisiones deliberadas',
    fluency: 'Nivel de fluidez con IA',
    interaction: 'Nivel de interacción (prompting)',
    veracity: 'veracidad',
    generatedAt: 'Generado',
    none: '(ninguno)',
    notEvaluated: '(sin evaluar todavía)',
  },
  en: {
    title: 'AI usage report (stored)',
    platform: 'Platform',
    level: 'Level',
    score: 'Score',
    tier: 'Tier',
    detected: 'Detected',
    categories: 'Categories',
    tools: 'Tools',
    technologies: 'Technologies',
    agents: 'Agents',
    mcp: 'MCP servers',
    activity: 'Activity',
    sessions: 'Sessions',
    subagentRuns: 'Subagent runs',
    activeHours: 'Active hours',
    crossToolLinks: 'Cross-tool links',
    filesTouched: 'Files touched',
    bashCommands: 'Shell commands',
    planningSignals: 'Planning signals',
    commits: 'Your commits',
    steering: 'Steering/corrections',
    decisions: 'Deliberate decisions',
    fluency: 'AI fluency level',
    interaction: 'Interaction (prompting) level',
    veracity: 'veracity',
    generatedAt: 'Generated',
    none: '(none)',
    notEvaluated: '(not evaluated yet)',
  },
};

function line(out, label, value) {
  out.push(`  ${label}: ${value}`);
}

function agentName(a) {
  if (!a || typeof a !== 'object') return null;
  const name = typeof a.name === 'string' ? a.name : null;
  if (!name) return null;
  const role = typeof a.role === 'string' && a.role ? ` — ${a.role}` : '';
  return `${name}${role}`;
}

function evaluationText(evaluation, L) {
  if (!evaluation || typeof evaluation !== 'object' || !evaluation.level) {
    return L.notEvaluated;
  }
  const veracity = evaluation.veracity ? ` (${L.veracity}: ${evaluation.veracity})` : '';
  return `${evaluation.level}${veracity}`;
}

function renderUsageReportText(view, { lang = 'en' } = {}) {
  const L = LABELS[lang] || LABELS.en;
  const report = view && view.report ? view.report : null;
  const out = [];
  out.push('');
  out.push(`  ${L.title}`);
  out.push('');

  if (report) {
    const levelName = typeof report.levelName === 'string' ? report.levelName : '';
    line(out, L.platform, report.platform || '');
    line(out, L.level, levelName ? `${levelName} (${report.level})` : `${report.level}`);
    line(out, L.score, `${report.score}`);
    line(out, L.tier, report.tierKey ? `${report.tierKey}` : `${report.tier ?? '-'}`);
    line(out, L.detected, `${report.totalDetected}`);
    line(out, L.categories, Array.isArray(report.categories) && report.categories.length ? report.categories.join(', ') : L.none);

    const toolCount = detectedTools(report.tools).length;
    line(out, L.tools, `${toolCount}`);

    const techs = Array.isArray(report.technologies) ? report.technologies : [];
    line(out, L.technologies, techs.length ? techs.join(', ') : L.none);

    const mcpCount = report.mcp && typeof report.mcp.count === 'number' ? report.mcp.count : 0;
    line(out, L.mcp, `${mcpCount}`);

    out.push('');
    out.push(`  ${L.agents}:`);
    const agents = Array.isArray(report.agents) ? report.agents.map(agentName).filter(Boolean) : [];
    if (agents.length) {
      for (const a of agents) out.push(`    - ${a}`);
    } else {
      out.push(`    ${L.none}`);
    }

    out.push('');
    out.push(`  ${L.activity}:`);
    const s = report.sessions;
    if (s && typeof s === 'object') {
      line(out, `  ${L.sessions}`, `${s.sessionCount}`);
      line(out, `  ${L.subagentRuns}`, `${s.subagentRunCount ?? 0}`);
      line(out, `  ${L.activeHours}`, `${s.activeHours ?? 0}`);
      line(out, `  ${L.crossToolLinks}`, `${s.crossToolLinks}`);
      line(out, `  ${L.filesTouched}`, `${s.filesTouchedCount}`);
      line(out, `  ${L.bashCommands}`, `${s.bashCommandsCount}`);
      line(out, `  ${L.planningSignals}`, `${s.planningSignalCount ?? 0}`);
    }
    const git = report.gitActivity;
    if (git && typeof git === 'object') {
      line(out, `  ${L.commits}`, `${git.authoredCommitCount ?? 0}`);
    }
    line(out, `  ${L.steering}`, `${report.steeringTraceCount ?? 0}`);
    line(out, `  ${L.decisions}`, `${report.decisionExchangeCount ?? 0}`);
  }

  out.push('');
  line(out, L.fluency, evaluationText(view && view.fluency, L));
  line(out, L.interaction, evaluationText(view && view.interactionQuality, L));

  if (report && report.generatedAt) {
    out.push('');
    line(out, L.generatedAt, report.generatedAt);
  }
  out.push('');
  return `${out.join('\n')}\n`;
}

module.exports = { renderUsageReportText };
