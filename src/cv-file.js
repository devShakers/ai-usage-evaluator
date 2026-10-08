'use strict';

const fs = require('fs');
const path = require('path');
const { expandHome } = require('./env-paths');

// The talent names a file on their own machine. Read it only when the resolved file (symlinks
// followed) really is a CV: an allowed extension, a regular file, under the cap, and starting
// with that format's signature. Anything else is refused before it is loaded or sent.
const CV_MAX_BYTES = 10 * 1024 * 1024;

const CV_FORMATS = {
  '.pdf': { contentType: 'application/pdf', signature: Buffer.from('%PDF-') },
  '.doc': { contentType: 'application/msword', signature: Buffer.from([0xd0, 0xcf, 0x11, 0xe0]) },
  '.docx': {
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    signature: Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  },
};

function readLocalCv(input, { extensions, badFormat }) {
  if (typeof input !== 'string' || !input.trim()) return { ok: false, reason: 'cv-not-found' };
  const given = expandHome(input.trim());
  const ext = path.extname(given).toLowerCase();
  if (!extensions.includes(ext)) return { ok: false, reason: badFormat };
  const format = CV_FORMATS[ext];
  let real;
  try {
    real = fs.realpathSync(given);
  } catch {
    return { ok: false, reason: 'cv-not-found' };
  }
  if (path.extname(real).toLowerCase() !== ext) return { ok: false, reason: badFormat };

  let fd;
  try {
    fd = fs.openSync(real, 'r');
  } catch {
    return { ok: false, reason: 'cv-not-found' };
  }
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) return { ok: false, reason: 'cv-not-found' };
    if (stat.size > CV_MAX_BYTES) return { ok: false, reason: 'cv-too-large' };
    const data = Buffer.alloc(stat.size);
    let read = 0;
    while (read < stat.size) {
      const n = fs.readSync(fd, data, read, stat.size - read, read);
      if (n === 0) break;
      read += n;
    }
    const content = data.subarray(0, read);
    if (!content.subarray(0, format.signature.length).equals(format.signature)) return { ok: false, reason: badFormat };
    return { ok: true, file: { filename: path.basename(given), contentType: format.contentType, data: content } };
  } catch {
    return { ok: false, reason: 'cv-not-found' };
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = { readLocalCv, CV_MAX_BYTES };
