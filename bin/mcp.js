#!/usr/bin/env node
'use strict';

const { createMcpServer } = require('../src/mcp-server');
const { makeAiUsageTool } = require('../src/mcp-ai-usage-tool');
const { makeAiUsageResultTool } = require('../src/mcp-ai-usage-result-tool');
const { makeCertifyDimensionTools } = require('../src/mcp-certify-dimension-tools');
const { makeFindProjectsTools } = require('../src/mcp-find-projects-tools');
const { makeShowProjectTools } = require('../src/mcp-show-project-tools');
const { makeSavedPositionsTools } = require('../src/mcp-saved-positions-tools');
const { makeInvitationsTools } = require('../src/mcp-invitations-tools');
const { makeApplicationsTools } = require('../src/mcp-applications-tools');
const { makeAvailabilityTools } = require('../src/mcp-availability-tools');
const { makeCertificationsTools } = require('../src/mcp-certifications-tools');
const { makeProfileTools } = require('../src/mcp-profile-tools');
const { makeRateTools } = require('../src/mcp-rate-tools');
const { makeAskTools } = require('../src/mcp-ask-tools');
const { makeAlmaTools } = require('../src/mcp-alma-tools');
const { makeLangTools } = require('../src/mcp-lang-tools');
const { makeSocialsTools } = require('../src/mcp-socials-tools');
const { makePortfolioTools } = require('../src/mcp-portfolios-tools');
const { makeOnboardingTools } = require('../src/mcp-onboarding-tools');
const { makeRoleTools } = require('../src/mcp-role-tools');
const { makeDeviceLoginTools } = require('../src/mcp-device-login-tools');
const { makeRegisterTools } = require('../src/mcp-register-tools');
const { makeSignupTools } = require('../src/mcp-signup-tools');
const { detectFlowLang } = require('../src/i18n');
const { makeReportTools } = require('../src/mcp-report-tools');
const { makePrompts } = require('../src/mcp-prompts');
const { buildServerInstructions } = require('../src/mcp-instructions');
const { ensureFreshSession } = require('../src/session-refresh');

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
  + `  Tools: ai_usage, ai_usage_result, login, logout, social_signin_start, social_signin_poll,\n`
  + `         list_addable, add_skill, add_agent,\n`
  + `         add_project, signup_start, signup_email, signup_draft, signup_create_account,\n`
  + `         signup_status, update_existing_profile, import_profile, save_profile_details, open_web,\n`
  + `         open_linkedin_profile,\n`
  + `         suggest_register_context, read_cv, onboarding_interview_start,\n`
  + `         onboarding_interview_turn, onboarding_interview_complete,\n`
  + `         repeat_onboarding_interview, onboarding_finish,\n`
  + `         list_available_roles, add_role, list_my_roles, set_main_role,\n`
  + `         report, share,\n`
  + `         list_certifiable_dimensions, find_projects, show_project,\n`
  + `         save_project, unsave_project, list_invitations,\n`
  + `         list_applications, get_availability,\n`
  + `         list_certifications, get_profile, get_rate, get_languages,\n`
  + `         list_socials, list_experiences, list_portfolios, ask.\n\n`;

// The LOCAL (filesystem/machine) tools — the only ones the .mcpb bundle exposes; the
// server-backed tools belong to the remote connector.
const LOCAL_ONLY_TOOL_NAMES = new Set(['ai_usage', 'ai_usage_result', 'read_cv', 'suggest_register_context']);

// `localOnly` builds the scan-only server for the Claude .mcpb bundle, reusing the SAME
// tool registry (just filtered) — no duplicate registration.
function buildServer({ localOnly = false } = {}) {
  const lang = detectFlowLang();
  const allTools = [makeAiUsageTool(), makeAiUsageResultTool(), ...makeOnboardingTools(), ...makeRoleTools({ lang }), ...makeDeviceLoginTools(), ...makeSignupTools({ lang }), ...makeRegisterTools({ lang }), ...makeReportTools(), ...makeCertifyDimensionTools(), ...makeFindProjectsTools(), ...makeShowProjectTools(), ...makeSavedPositionsTools(), ...makeInvitationsTools(), ...makeApplicationsTools(), ...makeAvailabilityTools(), ...makeCertificationsTools(), ...makeProfileTools(), ...makeRateTools(), ...makeLangTools(), ...makeSocialsTools(), ...makePortfolioTools(), ...makeAskTools(), ...makeAlmaTools()];
  const tools = localOnly ? allTools.filter((t) => LOCAL_ONLY_TOOL_NAMES.has(t.name)) : allTools;
  // Slash-command prompts, kept to the tools actually registered in this mode.
  const prompts = makePrompts(new Set(tools.map((t) => t.name)), lang);
  return createMcpServer({
    tools,
    prompts,
    serverInfo: { name: localOnly ? 'Shakers (local scan)' : 'Shakers', version: VERSION || '0.0.0' },
    instructions: localOnly ? null : (client) => buildServerInstructions(client),
    // Long-lived server: refresh the email session's hub JWT from the stored
    // cookie before each tool call so a stale (~15-min) JWT never reaches a tool.
    beforeCall: () => ensureFreshSession(process.env),
  });
}

async function run(argv = process.argv.slice(2)) {
  // The installer's last step; not a command the Talent needs to know.
  if (argv[0] === 'install') {
    await require('../src/mcp-install').runMcpInstall();
    return;
  }
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(HELP);
    return;
  }

  require('../src/config').sanitizeStaleBakedEndpoints(process.env);

  // `--local` = the scan-only server shipped in the Claude .mcpb bundle.
  const server = buildServer({ localOnly: argv.includes('--local') });
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
}

module.exports = { run, buildServer, buildServerInstructions };

if (require.main === module) {
  run();
}
