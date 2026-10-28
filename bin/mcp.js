#!/usr/bin/env node
'use strict';

const { createMcpServer } = require('../src/mcp-server');
const { makeAiUsageTools } = require('../src/mcp-ai-usage-tool');
const { makeAiUsageResultTool } = require('../src/mcp-ai-usage-result-tool');
const { makeCertifyDimensionTools } = require('../src/mcp-certify-dimension-tools');
const { makeFindProjectsTools } = require('../src/mcp-find-projects-tools');
const { makeShowProjectTools } = require('../src/mcp-show-project-tools');
const { makeSavedPositionsTools } = require('../src/mcp-saved-positions-tools');
const { makeApplyTools } = require('../src/mcp-apply-tools');
const { makeInvitationsTools } = require('../src/mcp-invitations-tools');
const { makeApplicationsTools } = require('../src/mcp-applications-tools');
const { makeAvailabilityTools } = require('../src/mcp-availability-tools');
const { makeCertificationsTools } = require('../src/mcp-certifications-tools');
const { makeProfileTools } = require('../src/mcp-profile-tools');
const { makeRateTools } = require('../src/mcp-rate-tools');
const { makeAlmaTools } = require('../src/mcp-alma-tools');
const { makeLangTools } = require('../src/mcp-lang-tools');
const { makeSocialsTools } = require('../src/mcp-socials-tools');
const { makePortfolioTools } = require('../src/mcp-portfolios-tools');
const { makeOnboardingTools } = require('../src/mcp-onboarding-tools');
const { makeRoleTools } = require('../src/mcp-role-tools');
const { makeDeviceLoginTools } = require('../src/mcp-device-login-tools');
const { makeRegisterTools } = require('../src/mcp-register-tools');
const { makeSignupTools } = require('../src/mcp-signup-tools');
const { makeSignupTool, outsideSignup, narratedTool, narrationLanguage, ABSORBED_TOOLS } = require('../src/mcp-signup-flow');
const { detectFlowLang } = require('../src/i18n');
const { makeReportTools } = require('../src/mcp-report-tools');
const { makePrompts } = require('../src/mcp-prompts');
const { buildServerInstructions } = require('../src/mcp-instructions');
const { mcpNarration } = require('../src/trust-narration');
const { ensureFreshSession } = require('../src/session-refresh');
const { emitCommandAudit } = require('../src/command-audit');
const { createFunnel } = require('../src/onboarding-funnel');

function narrateTool(lang) {
  return (name, { failed = false, args, result } = {}) => {
    const tool = narratedTool(name, args);
    const uploaded = tool === 'ai_usage' && !!result && result.uploaded === true;
    return mcpNarration(uploaded ? 'ai_usage_upload' : tool, narrationLanguage(name, args, lang), { failed });
  };
}

let VERSION = '';
try {
  VERSION = require('../package.json').version || '';
} catch {
  VERSION = '';
}

const HELP = `\n  shakers mcp — local MCP server (stdio)\n\n`
  + `  Exposes the AI-usage evaluation as an MCP tool over stdin/stdout so a\n`
  + `  desktop AI app (Claude / ChatGPT Desktop) can run it on your machine.\n\n`
  + `  Usage: shakers mcp\n\n`
  + `  This command speaks JSON-RPC on stdio; it is meant to be launched by an\n`
  + `  MCP client, not run by hand.\n`
  + `  Tools: signup (the whole sign-up, step by step), ai_usage, ai_usage_upload,\n`
  + `         ai_usage_result, logout, social_signin_start, social_signin_poll,\n`
  + `         list_addable, add_skill, add_agent, add_detected_agents,\n`
  + `         add_project, open_web,\n`
  + `         onboarding_interview_start, onboarding_interview_turn,\n`
  + `         onboarding_interview_complete, repeat_onboarding_interview,\n`
  + `         onboarding_finish, list_available_roles, add_role, list_my_roles,\n`
  + `         set_main_role, report, share, list_certifiable_dimensions,\n`
  + `         find_projects, show_project, save_project, unsave_project,\n`
  + `         prepare_application, apply_to_project,\n`
  + `         list_invitations, list_applications, get_availability,\n`
  + `         list_certifications, get_profile, get_rate, get_languages,\n`
  + `         list_socials, list_experiences, list_portfolios, alma_chat, alma_decision.\n\n`;

// The LOCAL (filesystem/machine) tools — the only ones the .mcpb bundle exposes; the
// server-backed tools belong to the remote connector.
const LOCAL_ONLY_TOOL_NAMES = new Set(['ai_usage', 'ai_usage_upload', 'ai_usage_result', 'read_cv', 'suggest_register_context']);

// `localOnly` builds the scan-only server for the Claude .mcpb bundle, reusing the SAME
// tool registry (just filtered) — no duplicate registration.
function buildServer({ localOnly = false, funnel = createFunnel({ surface: 'mcp' }), makeInterviewClient = null } = {}) {
  const lang = detectFlowLang();
  const aiUsage = makeAiUsageTools();
  const allTools = [aiUsage.usage, aiUsage.upload, makeAiUsageResultTool(), ...makeOnboardingTools(), ...makeRoleTools({ lang, funnel }), ...makeDeviceLoginTools({ lang, funnel }), ...makeSignupTools({ lang, funnel }), ...makeRegisterTools({ lang, funnel, flowDeps: { makeInterviewClient } }), ...makeReportTools(), ...makeCertifyDimensionTools(), ...makeFindProjectsTools(), ...makeShowProjectTools(), ...makeSavedPositionsTools(), ...makeApplyTools(), ...makeInvitationsTools(), ...makeApplicationsTools(), ...makeAvailabilityTools(), ...makeCertificationsTools(), ...makeProfileTools(), ...makeRateTools(), ...makeLangTools(), ...makeSocialsTools(), ...makePortfolioTools(), ...makeAlmaTools()];
  // The sign-up runs through one tool (`signup`), so Claude Desktop asks the talent once instead of once per step.
  const tools = localOnly
    ? allTools.filter((t) => LOCAL_ONLY_TOOL_NAMES.has(t.name))
    : [makeSignupTool(allTools), ...allTools.filter((t) => !ABSORBED_TOOLS.has(t.name)).map(outsideSignup)];
  // Slash-command prompts, kept to the tools actually registered in this mode.
  const prompts = makePrompts(new Set(tools.map((t) => t.name)), lang);
  return createMcpServer({
    tools,
    prompts,
    serverInfo: { name: localOnly ? 'Shakers (local scan)' : 'Shakers', version: VERSION || '0.0.0' },
    instructions: localOnly ? null : (client) => buildServerInstructions(client),
    beforeCall: () => ensureFreshSession(process.env),
    afterCall: (name) => {
      funnel.flush();
      ensureFreshSession(process.env)
        .catch(() => null)
        .then(() => emitCommandAudit({ command: `mcp:${name}`, env: process.env }));
    },
    narrate: narrateTool(lang),
    onInitialize: ({ clientInfo }) => funnel.setMcpClient(clientInfo.name),
  });
}

function prepareProcess(env = process.env) {
  require('../src/config').sanitizeStaleBakedEndpoints(env);
  require('../src/backend-request').setClientIdentity('mcp');
}

async function run(argv = process.argv.slice(2), { makeInterviewClient = null } = {}) {
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(HELP);
    return;
  }

  const problem = require('../src/config').envProfileProblem(process.env);
  if (problem) {
    process.stderr.write(`  [mcp] ${problem}\n`);
    process.exitCode = 1;
    return;
  }
  prepareProcess();

  // `--local` = the scan-only server shipped in the Claude .mcpb bundle.
  const funnel = createFunnel({ surface: 'mcp' });
  const server = buildServer({ localOnly: argv.includes('--local'), funnel, makeInterviewClient });
  const rl = server.start({
    input: process.stdin,
    output: process.stdout,
    onError: (e) => {
      process.stderr.write(`  [mcp] ${e && e.message ? e.message : String(e)}\n`);
    },
  });

  await new Promise((resolve) => {
    rl.on('close', resolve);
    process.stdin.on('end', () => rl.close());
  });
  await funnel.settle();
}

module.exports = { run, buildServer, buildServerInstructions, prepareProcess, narrateTool };

if (require.main === module) {
  run();
}
