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
 */

const CATEGORIES = {
  AGENTIC_CLI: 'CLI agéntica',
  AI_EDITOR: 'Editor con IA',
  IDE_ASSISTANT: 'Asistente en IDE',
  COMPLETION: 'Autocompletado',
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
];

module.exports = { detectors, CATEGORIES };
