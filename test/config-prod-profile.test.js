'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');

const PROD = {
  hubBase: 'https://api.hub.shakersworks.com/api/v1',
  certsBase: 'https://api.certifications.shakersworks.com/api/v1',
  profileUrl: 'https://app.shakersworks.com/login',
  almaBase: 'https://app.shakersworks.com',
};

function configPublishedAs(packageName) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shk-pkg-'));
  fs.cpSync(path.join(ROOT, 'src'), path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: packageName }));
  return require(path.join(dir, 'src', 'config.js'));
}

function emptyEnv(extra = {}) {
  return { SHAKERS_CLI_CONFIG_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'shk-cfg-')), ...extra };
}

test('the package published as shakers-cli bakes the prod flavor', () => {
  const config = configPublishedAs('shakers-cli');
  const env = emptyEnv();
  assert.strictEqual(config.getEnvProfileName(env), 'prod');
  assert.strictEqual(config.getHubBase(env), PROD.hubBase);
  assert.strictEqual(config.getCertsBase(env), PROD.certsBase);
  assert.strictEqual(config.getTalentProfileUrl(env), PROD.profileUrl);
  assert.strictEqual(config.getAlmaChatEndpoint(env), `${PROD.almaBase}/alma/chat`);
});

test('the beta and private packages keep their flavors', () => {
  assert.strictEqual(configPublishedAs('shakers-cli-beta').getEnvProfileName(emptyEnv()), 'staging');
  assert.strictEqual(configPublishedAs('@shakers/shakers-cli').getEnvProfileName(emptyEnv()), 'dev');
});

test('SHAKERS_CLI_ENV=prod selects the prod endpoints from any package', () => {
  const config = require('../src/config');
  const env = emptyEnv({ SHAKERS_CLI_ENV: 'prod' });
  assert.strictEqual(config.getEnvProfileName(env), 'prod');
  assert.strictEqual(config.getHubBase(env), PROD.hubBase);
  assert.strictEqual(config.getCertsBase(env), PROD.certsBase);
  assert.strictEqual(config.getAlmaBase(env), PROD.almaBase);
});

test('every web link the prod CLI builds lands on app.shakersworks.com', () => {
  const config = require('../src/config');
  const { buildWebLink } = require('../src/certify-dimension-flow');
  const env = emptyEnv({ SHAKERS_CLI_ENV: 'prod' });
  assert.strictEqual(config.getOneTimeLoginUrl('t0k', env), 'https://app.shakersworks.com/auth/one-time?token=t0k');
  assert.strictEqual(
    buildWebLink(config.getTalentProfileUrl(env), { clusterId: 'c1', slug: 'react' }),
    'https://app.shakersworks.com/certifications?dimension=c1/react',
  );
});

test('an explicit SHAKERS_CLI_ALMA_BASE still wins over the baked prod Alma', () => {
  const config = require('../src/config');
  const env = emptyEnv({ SHAKERS_CLI_ENV: 'prod', SHAKERS_CLI_ALMA_BASE: 'http://127.0.0.1:5030/' });
  assert.strictEqual(config.getAlmaBase(env), 'http://127.0.0.1:5030');
});

test('dev keeps the local Alma default', () => {
  const config = require('../src/config');
  assert.strictEqual(config.getAlmaBase(emptyEnv({ SHAKERS_CLI_ENV: 'dev' })), 'http://127.0.0.1:5030');
});
