'use strict';

// Catalog of AI tools for developers.

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

  // ---- Expansion (talents-ai-score, more signals) — confidence per entry below ----
  {
    id: 'amazon-q-developer',
    name: 'Amazon Q Developer',
    vendor: 'AWS',
    category: CATEGORIES.AGENTIC_CLI,
    signals: [
      // High confidence: binary and extension id are stable for the official CLI/extension.
      { type: 'bin', name: 'q' },
      { type: 'vscodeExt', prefix: 'amazonwebservices.amazon-q-vscode' },
      // Medium confidence: CLI credentials/cache directory under .aws.
      { type: 'homePath', path: '.aws/amazonq' },
    ],
  },
  {
    id: 'codeium',
    name: 'Codeium',
    vendor: 'Codeium (Exafunction)',
    category: CATEGORIES.IDE_ASSISTANT,
    signals: [
      // Codeium's base extension (autocomplete in any editor), distinct from Windsurf (its own editor, already cataloged above).
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
      // High confidence in the extension id; medium in the local state directory.
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
      // Medium confidence: extension id recalled from memory, could not be verified against the marketplace in this environment.
      { type: 'vscodeExt', prefix: 'meshintelligenttechnologiesinc.pieces-vscode' },
    ],
  },
  {
    id: 'warp-ai',
    name: 'Warp (AI terminal)',
    vendor: 'Warp',
    category: CATEGORIES.AI_TERMINAL,
    signals: [
      // Medium confidence: config directory of the Warp terminal app.
      { type: 'homePath', path: '.warp' },
      // On Linux, Warp's config lives under ~/.config/warp-terminal.
      { type: 'homePath', path: '.config/warp-terminal' },
    ],
  },
  {
    id: 'trae',
    name: 'Trae',
    vendor: 'ByteDance',
    category: CATEGORIES.AI_EDITOR,
    signals: [
      { type: 'projectPath', path: '.trae' },
      { type: 'homePath', path: '.trae' },
      { type: 'bin', name: 'trae' },
    ],
  },
];

module.exports = { detectors, CATEGORIES };
