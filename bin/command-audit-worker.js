#!/usr/bin/env node
'use strict';

const { ensureFreshSession } = require('../src/session-refresh');
const { emitCommandAudit, PAYLOAD_VAR } = require('../src/command-audit');

async function main() {
  let payload;
  try {
    payload = JSON.parse(process.env[PAYLOAD_VAR]);
  } catch {
    return;
  }
  if (!payload || typeof payload.command !== 'string') return;
  await ensureFreshSession(process.env).catch(() => null);
  await emitCommandAudit({ command: payload.command, argv: payload.args ? [payload.args] : [], env: process.env, id: typeof payload.id === 'string' ? payload.id : null });
}

main();
