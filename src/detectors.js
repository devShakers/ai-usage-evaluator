'use strict';

/*
 * Catálogo de herramientas de IA para desarrolladores.
 *
 * Cada detector declara SEÑALES (signals): comprobaciones de existencia de
 * ficheros/directorios o de binarios en el PATH. Nunca se lee el CONTENIDO de
 * los ficheros para decidir si una herramienta está presente: solo su
 * existencia. Las "sondas" (probe) opcionales extraen métricas de PROFUNDIDAD
 * (conteos), y están diseñadas para devolver únicamente números, jamás texto,
 * rutas absolutas ni valores de configuración.
 *
 * Tipos de señal:
 *   projectPath  -> ruta relativa al directorio escaneado (cwd)
 *   homePath     -> ruta relativa al home del usuario
 *   bin          -> binario disponible en el PATH
 *   vscodeExt    -> extensión instalada en ~/.vscode/extensions (prefijo)
 *
 * NOTA sobre las entradas añadidas tras el catálogo original de 12 (herramienta
 * talents-ai-score, ampliación de señales): igual que advierte
 * active-work/talents-ai-score/decisions.md ADR-001, este catálogo envejece
 * rápido y sigue sin dueño asignado. Cada entrada nueva lleva un comentario de
 * CONFIANZA sobre sus rutas/ids exactos (no se ha podido verificar contra la
 * documentación viva del vendor en este entorno, sin acceso a red). Confianza
 * "media/baja" => falso negativo probable si el vendor cambió el nombre; el
 * riesgo de falso positivo es bajo porque la comprobación es solo existencia.
 * Revisar y corregir antes de tratar estas señales como definitivas.
 */

const CATEGORIES = {
  AGENTIC_CLI: 'CLI agéntica',
  AI_EDITOR: 'Editor con IA',
  IDE_ASSISTANT: 'Asistente en IDE',
  COMPLETION: 'Autocompletado',
  AI_TERMINAL: 'Terminal con IA',
};

const detectors = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    vendor: 'Anthropic',
    category: CATEGORIES.AGENTIC_CLI,
    signals: [
      { type: 'projectPath', path: '.claude' },
      { type: 'projectPath', path: 'CLAUDE.md' },
      { type: 'projectPath', path: '.mcp.json' },
      { type: 'homePath', path: '.claude' },
      { type: 'bin', name: 'claude' },
    ],
  },
  {
    id: 'cursor',
    name: 'Cursor',
    vendor: 'Anysphere',
    category: CATEGORIES.AI_EDITOR,
    signals: [
      { type: 'projectPath', path: '.cursor' },
      { type: 'projectPath', path: '.cursorrules' },
      { type: 'homePath', path: '.cursor' },
      { type: 'bin', name: 'cursor' },
    ],
  },
  {
    id: 'github-copilot',
    name: 'GitHub Copilot',
    vendor: 'GitHub',
    category: CATEGORIES.IDE_ASSISTANT,
    signals: [
      { type: 'projectPath', path: '.github/copilot-instructions.md' },
      { type: 'vscodeExt', prefix: 'github.copilot' },
      { type: 'bin', name: 'copilot' },
    ],
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    vendor: 'Codeium',
    category: CATEGORIES.AI_EDITOR,
    signals: [
      { type: 'projectPath', path: '.windsurf' },
      { type: 'projectPath', path: '.windsurfrules' },
      { type: 'homePath', path: '.codeium/windsurf' },
      { type: 'bin', name: 'windsurf' },
    ],
  },
  {
    id: 'aider',
    name: 'Aider',
    vendor: 'Aider AI',
    category: CATEGORIES.AGENTIC_CLI,
    signals: [
      { type: 'projectPath', path: '.aider.conf.yml' },
      { type: 'projectPath', path: '.aider.chat.history.md' },
      { type: 'homePath', path: '.aider.conf.yml' },
      { type: 'bin', name: 'aider' },
    ],
  },
  {
    id: 'continue',
    name: 'Continue',
    vendor: 'Continue',
    category: CATEGORIES.IDE_ASSISTANT,
    signals: [
      { type: 'projectPath', path: '.continue' },
      { type: 'homePath', path: '.continue' },
      { type: 'vscodeExt', prefix: 'continue.continue' },
    ],
  },
  {
    id: 'cline',
    name: 'Cline',
    vendor: 'Cline',
    category: CATEGORIES.IDE_ASSISTANT,
    signals: [
      { type: 'projectPath', path: '.clinerules' },
      { type: 'vscodeExt', prefix: 'saoudrizwan.claude-dev' },
    ],
  },
  {
    id: 'gemini-cli',
    name: 'Gemini CLI',
    vendor: 'Google',
    category: CATEGORIES.AGENTIC_CLI,
    signals: [
      { type: 'projectPath', path: '.gemini' },
      { type: 'projectPath', path: 'GEMINI.md' },
      { type: 'homePath', path: '.gemini' },
      { type: 'bin', name: 'gemini' },
    ],
  },
  {
    id: 'codex-cli',
    name: 'Codex CLI',
    vendor: 'OpenAI',
    category: CATEGORIES.AGENTIC_CLI,
    signals: [
      { type: 'projectPath', path: 'AGENTS.md' },
      { type: 'homePath', path: '.codex' },
      { type: 'bin', name: 'codex' },
    ],
  },
  {
    id: 'cody',
    name: 'Cody',
    vendor: 'Sourcegraph',
    category: CATEGORIES.IDE_ASSISTANT,
    signals: [
      { type: 'projectPath', path: '.sourcegraph' },
      { type: 'vscodeExt', prefix: 'sourcegraph.cody-ai' },
      { type: 'bin', name: 'cody' },
    ],
  },
  {
    id: 'zed',
    name: 'Zed',
    vendor: 'Zed Industries',
    category: CATEGORIES.AI_EDITOR,
    signals: [
      { type: 'homePath', path: '.config/zed' },
      { type: 'bin', name: 'zed' },
    ],
  },
  {
    id: 'tabnine',
    name: 'Tabnine',
    vendor: 'Tabnine',
    category: CATEGORIES.COMPLETION,
    signals: [
      { type: 'homePath', path: '.config/TabNine' },
      { type: 'vscodeExt', prefix: 'tabnine.tabnine-vscode' },
    ],
  },

  // ---- Ampliación (talents-ai-score, más señales) — confianza por entrada abajo ----
  {
    id: 'amazon-q-developer',
    name: 'Amazon Q Developer',
    vendor: 'AWS',
    category: CATEGORIES.AGENTIC_CLI,
    signals: [
      // Confianza alta: binario e id de extensión estables de la CLI/extension oficiales.
      { type: 'bin', name: 'q' },
      { type: 'vscodeExt', prefix: 'amazonwebservices.amazon-q-vscode' },
      // Confianza media: directorio de credenciales/caché de la CLI bajo .aws.
      { type: 'homePath', path: '.aws/amazonq' },
    ],
  },
  {
    id: 'codeium',
    name: 'Codeium',
    vendor: 'Codeium (Exafunction)',
    category: CATEGORIES.IDE_ASSISTANT,
    signals: [
      // Extensión base de Codeium (autocompletado en cualquier editor), distinta
      // de Windsurf (editor propio, ya catalogado arriba). Confianza alta en el
      // id de extensión; media en la ruta de config local.
      { type: 'vscodeExt', prefix: 'codeium.codeium' },
      { type: 'homePath', path: '.codeium/config.json' },
    ],
  },
  {
    id: 'supermaven',
    name: 'Supermaven',
    vendor: 'Supermaven',
    category: CATEGORIES.COMPLETION,
    signals: [
      // Confianza alta en el id de extensión; media en el directorio de estado local.
      { type: 'vscodeExt', prefix: 'supermaven.supermaven' },
      { type: 'homePath', path: '.supermaven' },
    ],
  },
  {
    id: 'pieces',
    name: 'Pieces for Developers',
    vendor: 'Mesh Intelligent Technologies',
    category: CATEGORIES.IDE_ASSISTANT,
    signals: [
      // Confianza media: id de extensión recordado de memoria, sin poder
      // verificar contra el marketplace en este entorno. Sin homePath: la ruta
      // de datos de Pieces OS difiere demasiado entre SO (Application
      // Support/AppData/.local/share) para una señal fiable sin verificarla.
      { type: 'vscodeExt', prefix: 'meshintelligenttechnologiesinc.pieces-vscode' },
    ],
  },
  {
    id: 'warp-ai',
    name: 'Warp (AI terminal)',
    vendor: 'Warp',
    category: CATEGORIES.AI_TERMINAL,
    signals: [
      // Confianza media: directorio de configuración de la app de terminal Warp.
      { type: 'homePath', path: '.warp' },
    ],
  },
  {
    id: 'trae',
    name: 'Trae',
    vendor: 'ByteDance',
    category: CATEGORIES.AI_EDITOR,
    signals: [
      // Confianza baja/media: Trae es un fork de VS Code con reglas de proyecto
      // al estilo Cursor/Windsurf; nombre de carpeta `.trae` no verificado contra
      // documentación oficial en este entorno (sin acceso a red).
      { type: 'projectPath', path: '.trae' },
      { type: 'homePath', path: '.trae' },
      { type: 'bin', name: 'trae' },
    ],
  },
];

module.exports = { detectors, CATEGORIES };
