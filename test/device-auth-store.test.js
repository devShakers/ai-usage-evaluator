'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { savePendingDevice, loadPendingDevice, clearPendingDevice, devicePath, DEVICE_FILE_VERSION } = require('../src/device-auth-store');

function tmpEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shakers-dev-store-'));
  return { env: { SHAKERS_CLI_CONFIG_DIR: dir }, dir };
}

test('save/load roundtrip preserves the grant and register context; file is 0600', () => {
  const { env, dir } = tmpEnv();
  try {
    savePendingDevice({
      deviceCode: 'DEV-SECRET', verificationUrl: 'https://h/d?user_code=ABCD-1234&provider=google', userCode: 'ABCD-1234',
      tokenEndpoint: 'https://h/token', interval: 7,
      expiresAt: '2999-01-01T00:00:00.000Z', mode: 'register',
      registerContext: { freelanceType: 'FREELANCE', preferredLanguage: 'es' },
    }, env);
    const loaded = loadPendingDevice(env);
    assert.equal(loaded.deviceCode, 'DEV-SECRET');
    assert.equal(loaded.verificationUrl, 'https://h/d?user_code=ABCD-1234&provider=google');
    assert.equal(loaded.userCode, 'ABCD-1234');
    assert.equal(loaded.tokenEndpoint, 'https://h/token');
    assert.equal(loaded.interval, 7);
    assert.equal(loaded.mode, 'register');
    assert.deepEqual(loaded.registerContext, { freelanceType: 'FREELANCE', preferredLanguage: 'es' });
    assert.equal(fs.statSync(devicePath(env)).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('login mode defaults, missing/absent grant loads null, clear is idempotent', () => {
  const { env, dir } = tmpEnv();
  try {
    assert.equal(loadPendingDevice(env), null, 'no file -> null');
    savePendingDevice({ deviceCode: 'D', tokenEndpoint: 'https://h', mode: 'nonsense' }, env);
    const loaded = loadPendingDevice(env);
    assert.equal(loaded.mode, 'login', 'unknown mode clamps to login');
    assert.equal(loaded.interval, 5, 'default interval');
    assert.equal(clearPendingDevice(env), true);
    assert.equal(loadPendingDevice(env), null, 'cleared -> null');
    assert.equal(clearPendingDevice(env), false, 'clearing again is a no-op, never throws');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a version mismatch or a device-code-less file reads as null', () => {
  const { env, dir } = tmpEnv();
  try {
    fs.mkdirSync(path.dirname(devicePath(env)), { recursive: true });
    fs.writeFileSync(devicePath(env), JSON.stringify({ deviceCode: 'D', version: DEVICE_FILE_VERSION + 1 }));
    assert.equal(loadPendingDevice(env), null, 'unknown version -> null');
    fs.writeFileSync(devicePath(env), JSON.stringify({ version: DEVICE_FILE_VERSION }));
    assert.equal(loadPendingDevice(env), null, 'no deviceCode -> null');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
