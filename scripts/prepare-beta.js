#!/usr/bin/env node
'use strict';

// Stamps package.json for the PUBLIC beta package (shakers-cli-beta -> npmjs,
// staging backend). Not shipped (outside bin/src/README/LICENSE). Zero-dep.
//
//   npm run publish:beta               # bump BETA.version below first, then this one command
//
// which runs: node scripts/prepare-beta.js && npm publish --tag latest && git checkout -- package.json
// `--tag latest` is explicit because npm refuses to publish a prerelease (0.8.0-beta.N) to latest
// without a tag; `latest` still moves, so testers installing `shakers-cli-beta` bare get the newest.
// Needs npm login / NODE_AUTH_TOKEN. The baked backend flavor follows the name:
// `shakers-cli-beta` -> staging (src/config.js#PACKAGE_NAME_ENV), no extra runtime flag.

const fs = require('fs');
const path = require('path');

// CI passes the release version via BETA_VERSION (e.g. `${CI_COMMIT_TAG#v}`); locals
// fall back to the pinned beta. Keeps one stamping path for both flows.
if (process.env.CI && !process.env.BETA_VERSION) {
  console.error('BETA_VERSION is required in CI');
  process.exit(1);
}

const BETA = {
  name: 'shakers-cli-beta',
  version: process.env.BETA_VERSION || '0.8.0-beta.10',
  publishConfig: { access: 'public', registry: 'https://registry.npmjs.org/' },
};

const file = path.join(__dirname, '..', 'package.json');
const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));

pkg.name = BETA.name;
pkg.version = BETA.version;
pkg.publishConfig = BETA.publishConfig;

fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');

process.stdout.write(
  `package.json stamped for beta: ${BETA.name}@${BETA.version} -> ${BETA.publishConfig.registry}\n` +
  'Next: npm publish --tag latest   (npm needs an explicit tag for prereleases; then: git checkout -- package.json)\n',
);
