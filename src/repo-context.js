'use strict';

/*
 * repo-context.js — collect a COMPACT, content-free structural context of a
 * codebase for the LLM analysis that builds the LOCAL report's graph (`map`).
 *
 * foglamp-style "what does this repo DO". To reach the COMPLETENESS of a real
 * foglamp scan (~50 nodes, not ~27), recall is driven DETERMINISTICALLY here:
 * we enumerate explicit CANDIDATE lists (one agent per AI call-site file, one
 * cron per cron file, integration dirs → externals, modules → services,
 * datastore types → stores, grouped entrypoints) so the LLM's job is to emit a
 * node per candidate and WIRE THE FLOWS (edges) — not to rediscover everything
 * from sparse signals (which under-enumerated). Still content-free: file PATHS
 * + matched lines + names, never file contents/secrets; bounded + scrubbed.
 */

const fs = require('fs');
const path = require('path');
const { scrubString } = require('./graph-generator');
const { modelNode } = require('./graph-scan'); // exact-model resolver (aliases → exact ids)

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.turbo', 'vendor', '__snapshots__', '__tests__', '__mocks__', 'test', 'tests', 'e2e']);
const CODE_EXT = new Set(['.ts', '.js', '.tsx', '.jsx', '.mjs', '.cts', '.mts']);
const SKIP_FILE_RE = /\.(spec|test|e2e-spec|d)\.[tj]sx?$/;
const MAX_FILES = 6000;
const MAX_READ = 700;
const MAX_BYTES_PER = 200 * 1024;
const LINE_MAX = 160;
const CAP = { entrypoints: 12, crons: 18, agents: 30, integrations: 20, stores: 12, services: 40, tech: 60 };

const AI_RE = /generateText|streamText|generateObject|streamObject|embedMany|tool\s*\(|@ai-sdk\/|from\s+['"]ai['"]|new\s+OpenAI|new\s+Anthropic|@anthropic-ai\/sdk|GoogleGenerativeAI|@google\/(?:genai|generative-ai)|Gemini\w*Service|Anthropic\w*Service|ShakersAi\w*|\.sendMessage\(|\.messages\.create\(|\.chat\.completions\.create\(|\.generateContent\(|\.responses\.create\(|ChatOpenAI|langchain|llamaindex|createAgent|AgentExecutor/;
const CRON_RE = /@Cron\b|CronExpression|new\s+CronJob|EVERY_(MINUTE|HOUR|DAY)/;
const CRON_PATH_RE = /(\.cron\.[tj]s$|(^|\/)cron-jobs?\/|(^|\/)crons?\/)/i;
const ENTRY_PATH_RE = /(controller|\.route|router|webhook|gateway|resolver|main\.[tj]s|(^|\/)cli\/|(^|\/)commands?\/)/i;
const IMPORT_RE = /^\s*(import\b|const\b.*=\s*require\()/;

// npm import substring -> integration/provider label
const INTEG = [
  [/stripe/i, 'Stripe'], [/hubspot/i, 'HubSpot'], [/(datadog|dd-trace)/i, 'Datadog'],
  [/twilio/i, 'Twilio'], [/(sendgrid|@sendgrid)/i, 'SendGrid'], [/(@slack|slack-)/i, 'Slack'],
  [/(bigquery|@google-cloud\/bigquery)/i, 'BigQuery'], [/holded/i, 'Holded'], [/adobe/i, 'Adobe PDF'],
  [/n8n/i, 'n8n'], [/cloudfront/i, 'CloudFront'], [/(mongoose|mongodb)/i, 'MongoDB'],
  [/(ioredis|['"]redis['"])/i, 'Redis'], [/@aws-sdk|aws-sdk/i, 'AWS'],
];
// integrations/<dir> -> label (a dir under any `integrations/` path = a wired service)
const INTEG_DIR = {
  hubspot: 'HubSpot', holded: 'Holded', slack: 'Slack', datadog: 'Datadog', bigquery: 'BigQuery',
  adobe: 'Adobe PDF', 'adobe-pdf': 'Adobe PDF', n8n: 'n8n', cloudfront: 'CloudFront', s3: 'AWS S3',
  stripe: 'Stripe', match: 'calc-match', 'shakers-ai': 'shakers-ai-api', 'sh-ai': 'shakers-ai-api',
  twilio: 'Twilio', sendgrid: 'SendGrid',
};
const MODEL_DIRS = new Set(['gemini', 'anthropic', 'openai']); // integration dirs that are MODELS, not externals

function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'x'; }
function clip(s) { s = String(s || '').trim(); return s.length > LINE_MAX ? s.slice(0, LINE_MAX) + '…' : s; }
function titleize(s) { return String(s || '').replace(/[-_]+/g, ' ').replace(/\.(service|controller|cron|module)$/i, '').trim().replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 40); }
function readSafe(p) { try { const st = fs.statSync(p); if (st.size > MAX_BYTES_PER) return null; return fs.readFileSync(p, 'utf8'); } catch { return null; } }

function providerFromLine(line) {
  const l = String(line || '').toLowerCase();
  if (/gemini|generatecontent|google.*genai|generativeai/.test(l)) return { label: 'Gemini', domain: 'gemini.google.com' };
  if (/anthropic|claude|messages\.create/.test(l)) return { label: 'Claude', domain: 'claude.ai' };
  if (/openai|chat\.completions|responses\.create|\bgpt\b/.test(l)) return { label: 'OpenAI', domain: 'openai.com' };
  if (/shakersai|sh_ai|shakers-ai|chatgpt/.test(l)) return { label: 'shakers-ai-api', domain: null };
  return null;
}

function walk(root) {
  const files = [];
  const stack = [root];
  while (stack.length && files.length < MAX_FILES) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (files.length >= MAX_FILES) break;
      if (e.name.startsWith('.') && e.name !== '.claude') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) stack.push(full); }
      else if (CODE_EXT.has(path.extname(e.name)) && !SKIP_FILE_RE.test(e.name)) files.push(full);
    }
  }
  return files;
}

function entryGroup(rel) {
  const p = rel.toLowerCase();
  const app = (p.match(/(?:^|\/)apps\/([^/]+)\//) || [])[1];
  if (app) return { key: 'app:' + app, label: titleize(app) + ' API', sub: `apps/${app}` };
  const integ = (p.match(/(?:^|\/)integrations\/([^/]+)\/.*(webhook|controller)/) || [])[1];
  if (integ) return { key: 'wh:' + integ, label: titleize(integ) + ' webhook', sub: 'inbound webhook' };
  if (/gateway|websocket|\bws\b/.test(p)) return { key: 'ws', label: 'WebSocket gateway', sub: 'realtime' };
  if (/(^|\/)cli\/|(^|\/)commands?\//.test(p)) return { key: 'cli', label: 'CLI', sub: 'commands' };
  if (/main\.[tj]s$/.test(p)) return { key: 'http', label: 'HTTP server', sub: 'main' };
  if (/webhook/.test(p)) return { key: 'wh', label: 'Webhook', sub: 'inbound' };
  return { key: 'ctrl', label: 'HTTP API', sub: 'controllers' };
}

function collectRepoContext(root, { readFileImpl = readSafe } = {}) {
  const abs = path.resolve(root || process.cwd());
  const rel = (p) => path.relative(abs, p) || path.basename(p);

  const ctx = {
    project: { name: path.basename(abs) || 'project', slug: slug(path.basename(abs)), date: new Date().toISOString().slice(0, 10) },
    entrypoints: [], crons: [], agents: [], services: [], models: [], integrations: [], stores: [], technologies: [],
  };
  const integrationSet = new Set();
  const modelSet = new Map();
  const storeSet = new Set();
  const serviceSet = new Set();
  const entryGroups = new Map();
  const cronFiles = new Set();
  const aiFiles = new Map(); // path -> { provider, line }

  // package.json
  const pkgRaw = readFileImpl(path.join(abs, 'package.json'));
  if (pkgRaw) {
    try {
      const pkg = JSON.parse(pkgRaw);
      if (pkg.name) { const nm = pkg.name.replace(/^@[^/]+\//, ''); ctx.project.name = nm; ctx.project.slug = slug(nm); }
      if (pkg.description) ctx.project.tagline = clip(pkg.description);
      ctx.technologies = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }).slice(0, CAP.tech).map(scrubString);
    } catch { /* ignore */ }
  }

  // Prisma stores (datasource provider). schema.prisma OR prisma/schema/ dir.
  const eatPrisma = (raw) => {
    if (!raw) return;
    const provider = (raw.match(/datasource\s+\w+\s*\{[^}]*provider\s*=\s*"([^"]+)"/m) || [])[1];
    if (provider) storeSet.add(provider === 'postgresql' ? 'PostgreSQL' : titleize(provider));
  };
  for (const cand of ['prisma/schema.prisma', 'schema.prisma']) { const r = readFileImpl(path.join(abs, cand)); if (r) { eatPrisma(r); break; } }
  for (const dir of ['prisma/schema', 'prisma']) {
    const d = path.join(abs, dir);
    try { if (fs.statSync(d).isDirectory()) for (const f of fs.readdirSync(d)) if (f.endsWith('.prisma')) eatPrisma(readFileImpl(path.join(d, f))); } catch { /* none */ }
  }

  // .claude/agents → agent candidates, carrying the EXACT model from each agent's
  // `model:` field (aliases resolved to exact ids: opus→claude-opus-4-8, etc.) so
  // the graph shows the real model, not a vendor family. `inherit`/missing is kept
  // honest (never a fabricated id). The exact model is also fed as a model
  // candidate so the analysis emits a per-exact-model node. Sourced deterministically
  // from the scan — the LLM only renders what we resolved here.
  try {
    for (const f of fs.readdirSync(path.join(abs, '.claude', 'agents'))) {
      if (!f.endsWith('.md')) continue;
      const raw = readFileImpl(path.join(abs, '.claude', 'agents', f)) || '';
      const mm = raw.match(/^\s*model\s*:\s*["']?([^"'\n]+?)["']?\s*$/im);
      const mn = mm ? modelNode(mm[1].trim()) : null;
      const provider = mn ? mn.label : null;
      if (mn) modelSet.set(mn.label, { label: mn.label, ...(mn.domain ? { domain: mn.domain } : {}) });
      ctx.agents.push({ label: titleize(path.basename(f, '.md')), provider, path: scrubString(`.claude/agents/${f}`) });
    }
  } catch { /* none */ }

  // scan code files — AI/flow-likely first
  const score = (p) => {
    if (/(gemini|openai|anthropic|claude|ai-footprint|\bai\b|\/ai[-/]|llm|agent|orchestrat|generate-|chat|embed|personaliz|translat|synthes|certif|recomm|summar|extract|classif|briefing|showcase)/i.test(p)) return 0;
    if (/(\.service\.|controller|\.cron|worker|queue|webhook|gateway|resolver|handler|integrations\/)/i.test(p)) return 1;
    return 2;
  };
  const files = walk(abs).sort((a, b) => score(rel(a)) - score(rel(b)));
  let readCount = 0;
  for (const f of files) {
    const r = rel(f);
    // integration dirs → externals or models (KNOWN dirs only, to avoid noise
    // from generic subdirs like ai/chat/http/config)
    const idir = (r.match(/(?:^|\/)integrations\/([^/]+)\//) || [])[1];
    if (idir) {
      const key = idir.toLowerCase();
      if (MODEL_DIRS.has(key)) { const pv = providerFromLine(key); if (pv) modelSet.set(pv.label, pv); }
      else if (INTEG_DIR[key]) integrationSet.add(INTEG_DIR[key]);
    }
    // module/service dirs
    const mod = (r.match(/(?:^|\/)modules\/([^/]+)\//) || [])[1];
    if (mod && !/^(prisma|mongo|base-http|response|counter|shared|common|health)$/i.test(mod)) serviceSet.add(mod);
    // datastore hints from path/libs
    if (/aws-sdk\/client-s3|(^|\/)s3\b/i.test(r)) storeSet.add('AWS S3');
    if (/cloudfront/i.test(r)) storeSet.add('CloudFront KVS');
    // entrypoints (grouped)
    if (ENTRY_PATH_RE.test(r) && !CRON_PATH_RE.test(r)) { const g = entryGroup(r); if (!entryGroups.has(g.key)) entryGroups.set(g.key, g); }
    // crons (per file, by path)
    if (CRON_PATH_RE.test(r)) cronFiles.add(r);

    if (readCount >= MAX_READ) continue;
    const src = readFileImpl(f);
    if (src == null) continue;
    readCount++;
    const lines = src.split('\n');
    let firstAi = null;
    for (const ln of lines) {
      if (!firstAi && AI_RE.test(ln)) firstAi = ln;
      if (CRON_RE.test(ln)) cronFiles.add(r);
      if (IMPORT_RE.test(ln)) {
        for (const [re, label] of INTEG) if (re.test(ln)) {
          if (/mongo/i.test(label)) storeSet.add('MongoDB');
          else if (/redis/i.test(label)) storeSet.add('Redis');
          else if (label === 'AWS') storeSet.add('AWS S3');
          else integrationSet.add(label);
        }
        const pv = providerFromLine(ln);
        if (pv && pv.domain) modelSet.set(pv.label, pv);
      }
    }
    if (firstAi) aiFiles.set(r, { provider: providerFromLine(firstAi), line: clip(firstAi) });
  }

  // Assemble agent candidates from AI call-site files, EXCLUDING provider-client
  // files (integrations/<provider>) and infra files — those are the model client
  // or plumbing, not agents (they'd become junk nodes otherwise).
  const AGENT_SKIP_DIR = /^(gemini|anthropic|openai|http|base-http|event|config|util|shared|common|prisma|mongo|health|logger|integrations)$/i;
  for (const [p, info] of aiFiles) {
    if (ctx.agents.length >= CAP.agents) break;
    if (/(?:^|\/)integrations\//.test(p)) { // the provider client, not an agent
      if (info.provider && info.provider.domain) modelSet.set(info.provider.label, info.provider);
      continue;
    }
    const dir = p.split('/').slice(-2, -1)[0] || path.basename(p);
    if (AGENT_SKIP_DIR.test(dir)) continue;
    ctx.agents.push({ label: titleize(dir), provider: info.provider ? info.provider.label : null, path: scrubString(p) });
    if (info.provider && info.provider.domain) modelSet.set(info.provider.label, info.provider);
    else if (info.provider) integrationSet.add(info.provider.label); // shakers-ai-api = external tool
  }
  // Match the foglamp scan's REST grain: keep DISTINCT surfaces (one per app,
  // per named webhook, per WS gateway, per CLI) and DROP the generic catch-alls
  // ('ctrl'→"HTTP API", 'http'→"HTTP server", bare 'wh'→"Webhook") whenever a
  // specific surface already covers them — otherwise the graph shows a lumped
  // "HTTP API" node next to the real per-app entries (what the user flagged).
  const hasApp = [...entryGroups.keys()].some((k) => k.startsWith('app:'));
  const hasNamedWebhook = [...entryGroups.keys()].some((k) => k.startsWith('wh:'));
  if (hasApp) { entryGroups.delete('ctrl'); entryGroups.delete('http'); }
  if (hasNamedWebhook) entryGroups.delete('wh');
  ctx.entrypoints = Array.from(entryGroups.values()).slice(0, CAP.entrypoints).map((g) => ({ label: g.label, sub: g.sub }));
  ctx.crons = Array.from(cronFiles).slice(0, CAP.crons).map((p) => ({ label: titleize(path.basename(p).replace(/\.(cron\.)?[tj]s$/, '')), path: scrubString(p) }));
  ctx.services = Array.from(serviceSet).slice(0, CAP.services).map((m) => titleize(m));
  ctx.models = Array.from(modelSet.values());
  ctx.integrations = Array.from(integrationSet).slice(0, CAP.integrations);
  ctx.stores = Array.from(storeSet).slice(0, CAP.stores);
  return ctx;
}

module.exports = { collectRepoContext, slug };
