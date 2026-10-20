#!/usr/bin/env node
'use strict';

var _nodeMajor = parseInt((process.versions && process.versions.node || '0').split('.')[0], 10);
if (_nodeMajor < 18) {
  process.stderr.write(
    '\n  shakers requires Node 18 or newer (you have ' + process.version + ').\n'
    + '  Update Node from https://nodejs.org and re-run.\n\n',
  );
  process.exit(1);
}

if (['--version', '-v', 'version'].includes(String(process.argv[2]).toLowerCase())) {
  require('./version');
  process.exit(0);
}

const config = require('../src/config');

const problem = config.envProfileProblem(process.env);
if (problem) {
  process.stderr.write(`\n  shakers: ${problem}\n\n`);
  process.exit(1);
}

const argv = process.argv.slice(2);
const token = argv.find((a) => !a.startsWith('-'));
const rest = argv.filter((_, i) => i !== argv.indexOf(token));

if (token && token.toLowerCase() === 'mcp' && rest[0] !== 'install') {
  require('../src/config-dir').migrateLegacyConfigDir(process.env);
  config.sanitizeStaleBakedEndpoints(process.env);
  require('../src/session-refresh').ensureFreshSession(process.env)
    .catch(() => null)
    .then(() => require('../src/command-audit').emitCommandAudit({ command: 'mcp', argv, env: process.env }));
  require('./mcp').run(rest, { makeInterviewClient: require('../src/interview-client').createInterviewClient });
} else {
  require('./shakers-cli').main();
}
