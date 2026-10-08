'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { getUiLang, saveConfigFile, loadConfigFile } = require('../src/config');
const { detectReportLang, detectFlowLang } = require('../src/i18n');
const configCmd = require('../bin/config');

// UI-language preference (fix/cli-ui-language-detection-and-preference):
// precedence --lang flag > SHAKERS_CLI_LANG env > config.json `lang` > OS detection.

function freshConfigDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aifp-uilang-'));
}

function envWithConfigLang(lang, extra = {}) {
  const dir = freshConfigDir();
  const env = { SHAKERS_CLI_CONFIG_DIR: dir, ...extra };
  if (lang != null) saveConfigFile({ lang }, env);
  return env;
}

test('getUiLang: null when neither env nor config.json set it', () => {
  assert.equal(getUiLang(envWithConfigLang(null)), null);
});

test('getUiLang: config.json `lang` is used when no env override', () => {
  assert.equal(getUiLang(envWithConfigLang('es')), 'es');
  assert.equal(getUiLang(envWithConfigLang('en')), 'en');
});

test('getUiLang: SHAKERS_CLI_LANG env overrides config.json `lang`', () => {
  const env = envWithConfigLang('en', { SHAKERS_CLI_LANG: 'es' });
  assert.equal(getUiLang(env), 'es');
});

test('getUiLang: invalid env override is ignored, falls back to config.json', () => {
  const env = envWithConfigLang('es', { SHAKERS_CLI_LANG: 'fr' });
  assert.equal(getUiLang(env), 'es');
});

test('getUiLang: invalid config.json `lang` is ignored', () => {
  assert.equal(getUiLang(envWithConfigLang('de')), null);
});

test('detectReportLang: config.json preference beats OS locale (env LANG)', () => {
  const env = envWithConfigLang('es', { LANG: 'en_US.UTF-8' });
  assert.equal(detectReportLang(env), 'es');
});

test('detectFlowLang: env override beats OS locale', () => {
  const env = envWithConfigLang(null, { SHAKERS_CLI_LANG: 'es', LANG: 'en_US.UTF-8' });
  assert.equal(detectFlowLang(env), 'es');
});

test('--lang flag wins over env override (bin pattern `opts.lang || detectReportLang`)', () => {
  const env = envWithConfigLang('es', { SHAKERS_CLI_LANG: 'es' });
  const optsLang = 'en';
  assert.equal(optsLang || detectReportLang(env), 'en');
});

test('config.json `lang` round-trips via saveConfigFile/loadConfigFile', () => {
  const env = envWithConfigLang('en');
  assert.equal(loadConfigFile(env).lang, 'en');
});

test('`config` command exposes `lang` as a settable key', () => {
  assert.equal(configCmd.SETTABLE.has('lang'), true);
});

test('`config set lang en` persists and getUiLang reads it back', async () => {
  const env = { SHAKERS_CLI_CONFIG_DIR: freshConfigDir() };
  await configCmd.run(['set', 'lang', 'en'], { env, out: () => {} });
  assert.equal(loadConfigFile(env).lang, 'en');
  assert.equal(getUiLang(env), 'en');
});

test('`config set lang fr` is rejected and nothing is persisted', async () => {
  const prevExit = process.exitCode;
  const env = { SHAKERS_CLI_CONFIG_DIR: freshConfigDir() };
  let out = '';
  await configCmd.run(['set', 'lang', 'fr'], { env, out: (s) => { out += s; } });
  assert.match(out, /lang/i);
  assert.equal(loadConfigFile(env).lang, undefined);
  process.exitCode = prevExit; // don't leak the rejected-run exit code into the test runner
});
