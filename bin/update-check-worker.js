#!/usr/bin/env node
'use strict';

// Detached worker: fetches the latest version from the PUBLIC, unauthenticated npm registry, writes the `{lastCheck, latest}` cache, fails silent.

const https = require('https');
const { writeCache } = require('../src/update-notifier');

const FETCH_TIMEOUT_MS = 10000;
const MAX_BODY_BYTES = 3 * 1024 * 1024;

// Scoped names (`@scope/pkg`) address the registry as `@scope%2fpkg`, `@` literal; install-v1 metadata still carries `dist-tags`.
function registryUrl(name) {
  const p = name.startsWith('@') ? `@${name.slice(1).replace('/', '%2f')}` : name;
  return `https://registry.npmjs.org/${p}`;
}

function fetchLatest(name, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    let req;
    try {
      req = https.get(
        registryUrl(name),
        { headers: { Accept: 'application/vnd.npm.install-v1+json' } },
        (res) => {
          if (res.statusCode !== 200) {
            res.resume();
            return done(null);
          }
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (c) => {
            body += c;
            if (body.length > MAX_BODY_BYTES) req.destroy();
          });
          res.on('end', () => {
            try {
              const json = JSON.parse(body);
              const latest = json && json['dist-tags'] && json['dist-tags'].latest;
              done(typeof latest === 'string' && latest ? latest : null);
            } catch {
              done(null);
            }
          });
        },
      );
    } catch {
      return done(null);
    }
    req.setTimeout(timeoutMs, () => req.destroy());
    req.on('error', () => done(null));
  });
}

async function main() {
  const name = process.argv[2];
  if (!name) return;
  const latest = await fetchLatest(name, FETCH_TIMEOUT_MS);
  if (!latest) return;
  writeCache({ lastCheck: Date.now(), latest });
}

main();
