'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  readPackageInfo,
  detectInstall,
  fetchLatestVersion,
  compareVersions,
  buildUpdatePlan,
  runInstall,
  manualCommand,
  DEFAULT_INSTALL_URL,
} = require('../src/update-flow');
const { parseUpdateArgs } = require('../bin/update');

const INFO = { name: '@shakers/cli', version: '1.0.0', registry: 'https://reg.example' };

/* ---------- compareVersions ---------- */

test('compareVersions: orders by semver core and treats equal cores as 0', () => {
  assert.equal(compareVersions('1.0.0', '1.0.1'), -1);
  assert.equal(compareVersions('2.0.0', '1.9.9'), 1);
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
});

test('compareVersions: ignores prerelease suffix and a leading v', () => {
  assert.equal(compareVersions('v1.2.0', '1.2.0'), 0);
  assert.equal(compareVersions('1.2.0-beta.1', '1.2.0'), 0);
});

/* ---------- readPackageInfo / detectInstall ---------- */

test('readPackageInfo: reads this package name and version', () => {
  const info = readPackageInfo();
  assert.equal(typeof info.name, 'string');
  assert.ok(info.version);
});

test('detectInstall: a git checkout (no node_modules in path) is classified as source', () => {
  assert.equal(detectInstall({}).kind, 'source');
});

/* ---------- fetchLatestVersion ---------- */

test('fetchLatestVersion: no package name short-circuits without touching the network', () => {
  assert.deepEqual(fetchLatestVersion({}), { ok: false, reason: 'no-package-name' });
});

/* ---------- buildUpdatePlan ---------- */

test('buildUpdatePlan: npm-global builds an `npm install -g name@latest` plan with the registry', () => {
  const plan = buildUpdatePlan({ kind: 'npm-global' }, INFO, {});
  assert.equal(plan.type, 'npm');
  assert.deepEqual(plan.args, ['install', '-g', '@shakers/cli@latest', '--registry', 'https://reg.example']);
  assert.equal(plan.cwd, undefined);
});

test('buildUpdatePlan: npm-local targets the owning project dir', () => {
  const plan = buildUpdatePlan({ kind: 'npm-local', projectDir: '/home/t/proj' }, INFO, {});
  assert.deepEqual(plan.args, ['install', '@shakers/cli@latest', '--registry', 'https://reg.example']);
  assert.equal(plan.cwd, '/home/t/proj');
});

test('buildUpdatePlan: prefix builds the installer one-liner from the default URL', () => {
  const plan = buildUpdatePlan({ kind: 'prefix' }, INFO, {});
  assert.equal(plan.type, 'installer');
  assert.equal(plan.command, `curl -fsSL "${DEFAULT_INSTALL_URL}" | bash`);
});

test('buildUpdatePlan: prefix honours SHAKERS_CLI_INSTALL_URL override', () => {
  const plan = buildUpdatePlan({ kind: 'prefix' }, INFO, { SHAKERS_CLI_INSTALL_URL: 'https://x/install.sh' });
  assert.equal(plan.command, 'curl -fsSL "https://x/install.sh" | bash');
});

test('buildUpdatePlan: unknown install or missing name yields no plan', () => {
  assert.equal(buildUpdatePlan({ kind: 'unknown' }, INFO, {}), null);
  assert.equal(buildUpdatePlan({ kind: 'npm-global' }, { name: null }, {}), null);
});

/* ---------- manualCommand / runInstall ---------- */

test('manualCommand: with and without name/registry', () => {
  assert.equal(manualCommand(INFO), 'npm install -g @shakers/cli@latest --registry https://reg.example');
  assert.equal(manualCommand({ name: '@shakers/cli' }), 'npm install -g @shakers/cli@latest');
  assert.equal(manualCommand({}), 'npm install -g <package>@latest');
});

test('runInstall: a null plan returns {ok:false}', () => {
  assert.deepEqual(runInstall(null, {}), { ok: false, reason: 'no-plan' });
});

/* ---------- parseUpdateArgs (bin/update.js) ---------- */

test('parseUpdateArgs: parses --check/--dry-run, --json, --help and --lang', () => {
  assert.deepEqual(parseUpdateArgs(['--check']), { help: false, check: true, json: false, lang: null });
  assert.equal(parseUpdateArgs(['--dry-run']).check, true);
  assert.equal(parseUpdateArgs(['--json']).json, true);
  assert.equal(parseUpdateArgs(['-h']).help, true);
  assert.equal(parseUpdateArgs(['--lang', 'es']).lang, 'es');
  assert.equal(parseUpdateArgs(['--lang=en']).lang, 'en');
  assert.equal(parseUpdateArgs(['--lang', 'fr']).lang, null);
});
