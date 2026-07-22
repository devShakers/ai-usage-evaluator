'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { collectRepoContext } = require('../src/repo-context');

function mkTemp() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'repoctx-'));
  fs.mkdirSync(path.join(d, 'src'), { recursive: true });
  fs.mkdirSync(path.join(d, 'prisma'), { recursive: true });
  fs.mkdirSync(path.join(d, '.claude', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: 'demo-repo', description: 'A demo', dependencies: { stripe: '^1', '@nestjs/core': '^10' } }));
  fs.writeFileSync(path.join(d, 'src', 'app.controller.ts'),
    "import Stripe from 'stripe';\nimport { GeminiHttpService } from './gemini';\nexport class AppController {\n  run() { return this.gemini.sendMessage({ model: 'x' }); }\n  // apikey=sk_live_ABCDEFGHIJKLMNOPQRSTUVWX secret here\n}\n");
  fs.writeFileSync(path.join(d, 'src', 'billing.cron.ts'), "import { Cron } from '@nestjs/schedule';\n@Cron('0 6 * * *')\nexport class BillingCron {}\n");
  fs.writeFileSync(path.join(d, 'prisma', 'schema.prisma'),
    'datasource db { provider = "postgresql" }\nmodel User { id String @id }\nmodel Invoice { id String @id }\n');
  fs.writeFileSync(path.join(d, '.claude', 'agents', 'reviewer.md'), '---\nname: reviewer\n---\nx\n');
  return d;
}

test('collectRepoContext captures entrypoints, AI call-sites, integrations, stores, crons, agents', () => {
  const d = mkTemp();
  try {
    const c = collectRepoContext(d);
    assert.equal(c.project.slug, 'demo-repo');
    assert.equal(c.project.tagline, 'A demo');
    assert.ok(c.entrypoints.some((e) => e.path.includes('app.controller')));
    assert.ok(c.aiCallSites.some((a) => /sendMessage/.test(a.line)), 'AI call-site detected');
    assert.ok(c.integrations.includes('Stripe'));
    assert.ok(c.crons.some((cr) => /Cron/.test(cr.line)));
    assert.ok(c.stores.includes('postgresql'));
    assert.ok(c.stores.includes('User') && c.stores.includes('Invoice'));
    assert.ok(c.agents.includes('reviewer'));
    assert.ok(c.technologies.includes('stripe'));
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('secrets are scrubbed; file paths are NOT mangled by the base64 rule', () => {
  const d = mkTemp();
  try {
    const c = collectRepoContext(d);
    const blob = JSON.stringify(c);
    assert.ok(!/sk_live_[A-Za-z0-9]/.test(blob), 'secret redacted from matched lines');
    // the controller path survives intact (slash-paths must not be seen as base64)
    assert.ok(c.entrypoints.some((e) => e.path === 'src/app.controller.ts'), 'path not mangled');
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
