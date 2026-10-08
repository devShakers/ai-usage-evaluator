'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readSignupCv } = require('../src/mcp-signup-tools');

const PDF = Buffer.from('%PDF-1.7\n%stub\n');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cv-hardening-'));
}

test('readSignupCv reads the talent\'s own PDF', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'cv.pdf');
  fs.writeFileSync(file, PDF);
  const r = readSignupCv(file);
  assert.equal(r.ok, true);
  assert.equal(r.file.filename, 'cv.pdf');
  assert.deepEqual(r.file.data, PDF);
});

test('readSignupCv never follows a .pdf symlink to a file that is not a PDF', () => {
  const dir = tmpDir();
  const secret = path.join(dir, 'id_rsa');
  fs.writeFileSync(secret, '-----BEGIN OPENSSH PRIVATE KEY-----');
  const link = path.join(dir, 'cv.pdf');
  fs.symlinkSync(secret, link);
  assert.equal(readSignupCv(link).ok, false);
});

test('readSignupCv refuses a .pdf whose content is not a PDF', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'cv.pdf');
  fs.writeFileSync(file, 'aws_secret_access_key = abc');
  assert.equal(readSignupCv(file).ok, false);
});

test('readSignupCv refuses a directory named like a PDF', () => {
  const dir = tmpDir();
  const folder = path.join(dir, 'cv.pdf');
  fs.mkdirSync(folder);
  assert.equal(readSignupCv(folder).reason, 'cv-not-found');
});

test('readSignupCv checks the 10 MB cap before loading the file', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'cv.pdf');
  const fd = fs.openSync(file, 'w');
  fs.writeSync(fd, PDF);
  fs.ftruncateSync(fd, 11 * 1024 * 1024);
  fs.closeSync(fd);
  const original = fs.readFileSync;
  let loaded = false;
  fs.readFileSync = (...args) => { loaded = true; return original(...args); };
  try {
    assert.equal(readSignupCv(file).reason, 'cv-too-large');
  } finally {
    fs.readFileSync = original;
  }
  assert.equal(loaded, false);
});
