'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { AUTH_METHODS, methodsForFlow, methodIdsForFlow, isMethodAvailable, methodLabel } = require('../src/auth-methods');
const { getCatalog } = require('../src/i18n');

// The single source of truth for auth methods (talents-ai-score).

test('login offers email, google, linkedin, in that order', () => {
  assert.deepEqual(methodIdsForFlow('login'), ['email', 'google', 'linkedin']);
});

test('register offers email, google, linkedin (Google + LinkedIn share the device flow)', () => {
  assert.deepEqual(methodIdsForFlow('register'), ['email', 'google', 'linkedin']);
  assert.equal(isMethodAvailable('google', 'register'), true);
  assert.equal(isMethodAvailable('linkedin', 'register'), true);
  assert.equal(isMethodAvailable('email', 'register'), true);
});

test('google and linkedin are social (share one device flow); email is not', () => {
  const { isSocialMethod } = require('../src/auth-methods');
  assert.equal(isSocialMethod('google'), true);
  assert.equal(isSocialMethod('linkedin'), true);
  assert.equal(isSocialMethod('email'), false);
});

test('every method declares availableFor for both flows (so adding one cannot forget a flow)', () => {
  for (const m of AUTH_METHODS) {
    assert.equal(typeof m.availableFor.login, 'boolean', `${m.id}.availableFor.login`);
    assert.equal(typeof m.availableFor.register, 'boolean', `${m.id}.availableFor.register`);
    assert.equal(typeof m.labelKey, 'string');
  }
});

test('methodLabel resolves from the catalog by labelKey, in both languages', () => {
  const es = getCatalog('es').login;
  const en = getCatalog('en').login;
  const [email, google, linkedin] = methodsForFlow('login');
  assert.equal(methodLabel(email, es), es.methodEmail);
  assert.equal(methodLabel(google, es), es.methodGoogle);
  assert.equal(methodLabel(linkedin, es), es.methodLinkedin);
  assert.equal(methodLabel('email', en), en.methodEmail);
  assert.equal(methodLabel('google', en), en.methodGoogle);
  assert.equal(methodLabel('linkedin', en), en.methodLinkedin);
});

test('methodLabel falls back to the id when the catalog lacks the key', () => {
  assert.equal(methodLabel('email', {}), 'email');
  assert.equal(methodLabel('google', null), 'google');
});
