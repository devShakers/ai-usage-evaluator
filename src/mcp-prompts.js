'use strict';

// MCP prompts = in-client slash-commands. Each is a thin wrapper that injects a user turn
// telling the assistant which Shakers tool(s) to use — the logic stays in the tools, so
// there is no duplication. `buildMessages(args)` returns the prompts/get message list.

function userText(text) {
  return [{ role: 'user', content: { type: 'text', text } }];
}

// Only reference tools that exist in the FULL server; `available(toolNames)` hides a prompt
// when its tool isn't registered (e.g. the --local scan-only server).
const PROMPTS = [
  {
    name: 'ai_usage',
    description: 'Evaluate and showcase how you work with AI (scans this machine, builds your "My work with AI").',
    tools: ['ai_usage'],
    buildMessages: () => userText(
      'Evaluate how I work with AI for my Shakers profile. First ask me for consent and the email to attribute it to, then call the `ai_usage` tool and show me the resulting report verbatim. Never show internal ids/codes.',
    ),
  },
  {
    name: 'onboarding',
    description: 'Sign up on Shakers from this chat: your CV and LinkedIn, a password or Google, and your profile filled in for you.',
    tools: ['signup_start'],
    buildMessages: (_args, lang) => userText(
      `Sign me up on Shakers following the sign-up flow in your Shakers instructions. Start with \`signup_start\` (language: the one I write in; "${lang}" if I have not written anything yet) and show me its texts word for word. Ask me only the questions the tools return, with their options, and nothing you can infer.`,
    ),
  },
  {
    name: 'find_projects',
    description: 'Find open Shakers projects/positions matched to you.',
    tools: ['find_projects'],
    buildMessages: () => userText(
      'Find open Shakers positions that match me: call `find_projects` and summarize them by title/company (never show internal ids). Offer `save_project` / `show_project` for ones I like.',
    ),
  },
  {
    name: 'certify',
    description: 'See which role dimensions you can certify and start a certification.',
    tools: ['list_certifiable_dimensions'],
    buildMessages: () => userText(
      'Help me certify on Shakers: call `list_certifiable_dimensions`, present the dimensions I can certify by name, and guide me through certifying the one I pick.',
    ),
  },
  {
    name: 'ask',
    description: 'Ask Alma, the Shakers AI assistant, a question.',
    tools: ['ask'],
    arguments: [{ name: 'message', description: 'What to ask Alma.', required: false }],
    buildMessages: (args = {}) => userText(
      `Ask Alma (the Shakers assistant) and relay her answer as-is. My question: ${typeof args.message === 'string' && args.message ? args.message : '(ask me what I want to know first)'}`,
    ),
  },
  {
    name: 'my_profile',
    description: 'Show your Shakers profile (role, rate, availability, "My work with AI").',
    tools: ['get_profile'],
    buildMessages: () => userText(
      'Show my Shakers profile: call `get_profile` (and `get_rate` / `get_availability` if useful) and present it in plain terms. Any ids/codes are internal — never show them.',
    ),
  },
];

function makePrompts(toolNames = null, lang = 'en') {
  const available = toolNames instanceof Set ? toolNames : null;
  // Keep a prompt only if at least one of its tools is present in this server.
  return PROMPTS
    .filter((p) => !available || p.tools.some((t) => available.has(t)))
    .map((p) => ({ ...p, buildMessages: (args) => p.buildMessages(args, lang) }));
}

module.exports = { makePrompts, PROMPTS };
