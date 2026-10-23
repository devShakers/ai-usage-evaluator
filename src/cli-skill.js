'use strict';

const { SERVER_NAME } = require('./mcp-server-name');

const CLI_SKILL_NAME = 'shakers-cli';

const OWN_SKILL_NAMES = new Set([CLI_SKILL_NAME, SERVER_NAME]);

const CLI_SKILL_DESCRIPTION = 'Use Shakers, the freelance talent marketplace, from the terminal through the `shakers` CLI: find, view and save projects, read the talent profile, certifications, applications and invitations, and get the link to certify a role dimension. Use when the talent wants to work with Shakers from the terminal or mentions the `shakers` command.';

const BODY = `# Shakers CLI

Shakers is a freelance talent marketplace. The \`shakers\` CLI acts on the talent's own account. You run it for the talent, with their permission.

## Rules

- Before running any command, show the talent the exact command and ask them first.
- Run only the \`shakers\` commands listed in this skill. If \`shakers\` is not on PATH, run the same command as \`npx -y shakers-cli <command>\`.
- Install only the official npm package \`shakers-cli\`. Never install a package with a similar name.
- Never run \`shakers update\` without \`--check\` unless the talent explicitly asks to update.
- Put the command name first (\`shakers me --json\`, not \`shakers --json me\`).
- Prefer \`--json\` and read ids from the JSON. Never pass the \`N)\` numbers of a printed list: a number refers to the last human listing, not to your JSON.
- If the Shakers MCP server tools are available in this session and the talent did not ask for the terminal, use those tools instead of this skill.

## Not logged in

A command that needs a session exits 1 and prints on stderr that it requires an active session. Do not try to log in for the talent. Tell them to run \`shakers login\` in their own terminal, then retry the command.

Without \`--json\`, each command first prints on stderr one line saying what Shakers does on this computer and in the account (what it reads, changes or sends). Relay that line to the talent word for word.

## Commands you may run

Projects:
- \`shakers find-projects --json [--page N] [--limit N] [--tab all|saved] [--attendance remote|hybrid|in-person] [--country ES] [--recommended]\`: projects available to the talent. The id of each item is \`items[].positionId\`.
- \`shakers show-project <positionId> --json\`: detail of one project.
- \`shakers save-project <positionId> --json\` and \`shakers unsave-project <positionId> --json\`: add or remove a saved project.
- \`shakers applications --json\`: projects the talent applied to and their status (\`items[].positionId\`).
- \`shakers invitations --json\`: the talent's unread project invitations.

Profile (read only):
- \`shakers me --json\`: profile summary.
- \`shakers rate --json\`, \`shakers availability --json\`, \`shakers lang --json\`, \`shakers socials --json\`.
- \`shakers experiences --json\`, \`shakers portfolios --json\`.

Certifications:
- \`shakers certifications --json\`: certified, uncertified and expired dimensions.
- \`shakers certify --dimension <key>\`: only when the talent named the dimension. It prints a link; the interview happens on the web. Show the talent the link. It has no \`--json\`.

Account:
- \`shakers config list\` and \`shakers config get <key>\`: read the CLI configuration.
- \`shakers update --check --json\`: tells whether a newer version exists. Installs nothing.
- \`shakers logout\`: only when the talent asks to sign out.

## Hand these to the talent

Never run these yourself. They need the talent at their own keyboard: they ask for consent, reviews or choices, and \`login\` and \`register\` open a Shakers page on shakersworks.com with a code the talent checks and approves (the password is typed only there, never in a terminal). Tell the talent the exact command to run in their own terminal, or point them to the web (https://www.shakersworks.com) or the Shakers MCP server.

- \`shakers register\` and \`shakers onboarding\`: sign-up and the onboarding interview.
- \`shakers login\`.
- \`shakers ai-usage\`: the AI-usage analysis and upload. The talent gives consent and reviews what is sent.
- Profile changes: \`shakers rate --set\`, \`shakers availability --set\`, \`shakers lang --set\`, \`shakers socials --set\`.
- \`shakers add-agent\`, \`shakers add-skill\`, \`shakers add-project\`, \`shakers add-role\`, \`shakers change-role\`.
- \`shakers config set\`.
`;

function cliSkill() {
  return [
    '---',
    `name: ${CLI_SKILL_NAME}`,
    `description: ${JSON.stringify(CLI_SKILL_DESCRIPTION)}`,
    '---',
    '',
    BODY,
  ].join('\n');
}

module.exports = { cliSkill, CLI_SKILL_NAME, OWN_SKILL_NAMES };
