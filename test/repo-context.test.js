'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { collectRepoContext } = require('../src/repo-context');

function mkTemp() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'repoctx-'));
  fs.mkdirSync(path.join(d, 'src', 'modules', 'billing'), { recursive: true });
  fs.mkdirSync(path.join(d, 'src', 'integrations', 'hubspot'), { recursive: true });
  fs.mkdirSync(path.join(d, 'prisma'), { recursive: true });
  fs.mkdirSync(path.join(d, '.claude', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ name: 'demo-repo', description: 'A demo', dependencies: { stripe: '^1', '@nestjs/core': '^10' } }));
  fs.writeFileSync(path.join(d, 'src', 'app.controller.ts'),
    "import Stripe from 'stripe';\nimport { GeminiHttpService } from './gemini';\nexport class AppController {\n  run() { return this.gemini.sendMessage({ model: 'x' }); }\n  // apikey=sk_live_ABCDEFGHIJKLMNOPQRSTUVWX secret here\n}\n");
  fs.writeFileSync(path.join(d, 'src', 'integrations', 'hubspot', 'hubspot.client.ts'), "import axios from 'axios';\nexport class HubspotClient {}\n");
  fs.writeFileSync(path.join(d, 'src', 'billing.cron.ts'), "import { Cron } from '@nestjs/schedule';\n@Cron('0 6 * * *')\nexport class BillingCron {}\n");
  fs.writeFileSync(path.join(d, 'prisma', 'schema.prisma'), 'datasource db { provider = "postgresql" }\nmodel User { id String @id }\n');
  fs.writeFileSync(path.join(d, '.claude', 'agents', 'reviewer.md'), '---\nname: reviewer\n---\nx\n');
  return d;
}

test('collectRepoContext emits candidate lists: entrypoints, crons, agents, models, integrations, stores', () => {
  const d = mkTemp();
  try {
    const c = collectRepoContext(d);
    assert.equal(c.project.slug, 'demo-repo');
    assert.equal(c.project.tagline, 'A demo');
    assert.ok(c.entrypoints.length >= 1 && c.entrypoints.every((e) => e.label));
    assert.ok(c.crons.some((cr) => /Billing/i.test(cr.label)));
    // agent candidates: the AI call-site file + the .claude/agents entry
    assert.ok(c.agents.some((a) => a.label === 'Reviewer'));
    assert.ok(c.agents.length >= 1);
    // model provider inferred from the gemini call-site
    assert.ok(c.models.some((m) => m.label === 'Gemini' && m.domain === 'gemini.google.com'));
    // integrations: Stripe (import) + HubSpot (integrations/ dir)
    assert.ok(c.integrations.includes('Stripe'));
    assert.ok(c.integrations.includes('HubSpot'));
    // stores: datastore TYPE, not model names
    assert.ok(c.stores.includes('PostgreSQL'));
    assert.ok(!c.stores.includes('User'));
    assert.ok(c.technologies.includes('stripe'));
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('secrets are scrubbed; file paths are NOT mangled by the base64 rule', () => {
  const d = mkTemp();
  try {
    const c = collectRepoContext(d);
    const blob = JSON.stringify(c);
    assert.ok(!/sk_live_[A-Za-z0-9]/.test(blob), 'secret redacted');
    // a candidate path survives intact (slash-paths must not look like base64)
    const paths = [...c.agents.map((a) => a.path), ...c.crons.map((cr) => cr.path)].filter(Boolean);
    assert.ok(paths.some((p) => p.includes('/') && !p.includes('redacted')), 'path not mangled');
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
