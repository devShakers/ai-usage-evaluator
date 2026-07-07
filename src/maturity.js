'use strict';

/*
 * Clasificación de madurez de uso de IA.
 *
 * Combina AMPLITUD (cuántas herramientas distintas) con PROFUNDIDAD (cuánto se
 * han configurado: instrucciones de proyecto, reglas, servidores MCP, skills,
 * comandos, hooks). La profundidad pesa más que la amplitud: tener 5
 * herramientas recién instaladas sin configurar es menos maduro que dominar
 * una sola a fondo.
 */

const LEVELS = [
  { level: 0, key: 'none', name: 'Sin rastro de IA', emoji: '○' },
  { level: 1, key: 'exploring', name: 'Explorando', emoji: '◔' },
  { level: 2, key: 'integrated', name: 'Integrado', emoji: '◑' },
  { level: 3, key: 'power', name: 'Power user', emoji: '◕' },
  { level: 4, key: 'orchestrator', name: 'Orquestador', emoji: '●' },
];

const AGENTIC_IDS = ['claude-code', 'aider', 'gemini-cli', 'codex-cli'];

function depthTotals(tools) {
  let instructions = 0; // ficheros de instrucciones/reglas de proyecto
  let mcp = 0; // servidores MCP configurados
  let custom = 0; // skills + comandos + reglas propias
  let hooks = 0;

  for (const t of tools) {
    if (!t.detected) continue;
    const d = t.depth || {};
    instructions += (d.instructions || 0) + (d.config || 0);
    mcp += d.mcpServers || 0;
    custom += (d.skills || 0) + (d.commands || 0) + (d.rules || 0);
    hooks += d.hooks || 0;
  }
  return { instructions, mcp, custom, hooks };
}

function classify(report) {
  const detected = report.tools.filter((t) => t.detected);
  const breadth = detected.length;
  const d = depthTotals(detected);
  const hasAgentic = detected.some((t) => AGENTIC_IDS.includes(t.id));

  // Score 0-100 para el medidor visual.
  const score = Math.min(
    100,
    breadth * 8 + // amplitud
      d.instructions * 6 + // reglas/instrucciones de proyecto
      Math.min(d.mcp, 8) * 5 + // MCP (tope para no premiar en exceso)
      Math.min(d.custom, 12) * 3 + // skills/comandos/reglas propias
      d.hooks * 4 + // automatización con hooks
      (hasAgentic ? 6 : 0),
  );

  // Reglas de nivel: se cumple el nivel más alto cuyos criterios se satisfacen.
  let level = 0;
  if (breadth >= 1) level = 1; // hay al menos una herramienta
  if (d.instructions >= 1) level = 2; // hay config de proyecto
  if (d.mcp >= 1 || d.custom >= 1 || breadth >= 3) level = 3; // uso avanzado
  if (hasAgentic && d.mcp >= 1 && d.custom >= 1) level = 4; // automatización profunda

  const meta = LEVELS[level];

  return {
    level: meta.level,
    key: meta.key,
    name: meta.name,
    emoji: meta.emoji,
    score,
    breadth,
    depth: d,
    hasAgentic,
    next: nextStep(level, { breadth, ...d, hasAgentic }),
  };
}

function nextStep(level) {
  const steps = {
    0: 'Instala una herramienta de IA (Claude Code, Cursor o Copilot) y pruébala en un proyecto real.',
    1: 'Añade un fichero de instrucciones al proyecto (CLAUDE.md, .cursorrules o copilot-instructions.md) para dar contexto persistente.',
    2: 'Conecta un servidor MCP o crea reglas/comandos propios para que la IA acceda a tus datos y flujos.',
    3: 'Combina una CLI agéntica con MCP y skills/comandos propios; automatiza una tarea recurrente de principio a fin.',
    4: 'Ya operas a nivel de orquestación: documenta tu setup y encadena agentes o ejecución en background.',
  };
  return steps[level];
}

module.exports = { classify, LEVELS };
