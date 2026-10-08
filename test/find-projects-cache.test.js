'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { writePositionCache, readPositionCache, resolvePositionRef, cachePath } = require('../src/find-projects-cache');

function tmpEnv() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-cache-'));
  // config-dir resolves under this home; SHAKERS_CLI_HOME_DIR overrides HOME.
  return { SHAKERS_CLI_HOME_DIR: home, HOME: home, _home: home };
}

test('writePositionCache -> readPositionCache round-trips ids in order, 0600', () => {
  const env = tmpEnv();
  writePositionCache(['a', 'b', 'c'], env);
  assert.deepEqual(readPositionCache(env).ids, ['a', 'b', 'c']);
  const mode = fs.statSync(cachePath(env)).mode & 0o777;
  assert.equal(mode, 0o600);
});

test('writePositionCache: overwrites the previous listing + drops non-strings', () => {
  const env = tmpEnv();
  writePositionCache(['a', 'b'], env);
  writePositionCache(['x', null, 'y', 3], env);
  assert.deepEqual(readPositionCache(env).ids, ['x', 'y']);
});

test('readPositionCache: null when absent / malformed / wrong version', () => {
  const env = tmpEnv();
  assert.equal(readPositionCache(env), null); // never written
  fs.mkdirSync(path.dirname(cachePath(env)), { recursive: true });
  fs.writeFileSync(cachePath(env), '{ not json');
  assert.equal(readPositionCache(env), null);
  fs.writeFileSync(cachePath(env), JSON.stringify({ version: 999, ids: ['a'] }));
  assert.equal(readPositionCache(env), null);
});

test('resolvePositionRef: integer -> id from cache (1-based)', () => {
  const env = tmpEnv();
  writePositionCache(['id-1', 'id-2', 'id-3'], env);
  assert.deepEqual(resolvePositionRef('1', env), { ok: true, id: 'id-1' });
  assert.deepEqual(resolvePositionRef('3', env), { ok: true, id: 'id-3' });
});

test('resolvePositionRef: UUID / Mongo id passes through unchanged (no cache read)', () => {
  const env = tmpEnv();
  const uuid = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
  assert.deepEqual(resolvePositionRef(uuid, env), { ok: true, id: uuid });
  assert.deepEqual(resolvePositionRef('507f1f77bcf86cd799439011', env), { ok: true, id: '507f1f77bcf86cd799439011' });
});

test('resolvePositionRef: no cache -> no-cache; out of range -> out-of-range with count; empty -> no-id', () => {
  const env = tmpEnv();
  assert.deepEqual(resolvePositionRef('2', env), { ok: false, reason: 'no-cache' });
  writePositionCache(['id-1', 'id-2'], env);
  assert.deepEqual(resolvePositionRef('0', env), { ok: false, reason: 'out-of-range', count: 2 });
  assert.deepEqual(resolvePositionRef('5', env), { ok: false, reason: 'out-of-range', count: 2 });
  assert.deepEqual(resolvePositionRef('  ', env), { ok: false, reason: 'no-id' });
});

test('resolvePositionRef: injected readPositionCache is honored', () => {
  const res = resolvePositionRef('2', {}, { readPositionCache: () => ({ ids: ['x', 'y', 'z'] }) });
  assert.deepEqual(res, { ok: true, id: 'y' });
});
