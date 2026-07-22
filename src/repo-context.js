'use strict';

/*
 * repo-context.js — collect a COMPACT, content-free-ish STRUCTURAL context of a
 * codebase for the LLM analysis that builds the LOCAL report's graph (`map`).
 *
 * This is the foglamp-style "what does this repo DO" input: NOT our AI-config
 * detectors (those feed the AI-usage drawer only). We grep/read a BOUNDED set
 * of signal files and extract structure — file PATHS, matched import/decorator
 * LINES (truncated + scrubbed), symbol names, deps, Prisma models — never whole
 * files, never secrets. The LLM turns this into the foglamp graph (nodes/edges).
 *
 * Bounded like scanner.js (skip node_modules/.git/dist, cap files/bytes/lines)
 * so it stays fast and the payload that leaves the machine stays small.
 */

const fs = require('fs');
const path = require('path');
const { scrubString } = require('./graph-generator');

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.turbo', 'vendor', '__snapshots__', '__tests__', '__mocks__', 'test', 'tests', 'e2e']);
const CODE_EXT = new Set(['.ts', '.js', '.tsx', '.jsx', '.mjs', '.cts', '.mts']);
const SKIP_FILE_RE = /\.(spec|test|e2e-spec|d)\.[tj]sx?$/;
const MAX_FILES = 4000;      // files to consider (name scan)
const MAX_READ = 500;        // files we actually read for line signals
const MAX_BYTES_PER = 200 * 1024;
const LINE_MAX = 160;
const CAP = { entrypoints: 70, aiCallSites: 50, crons: 30, integrations: 24, stores: 30, agents: 40, modules: 60, tech: 60 };

// NOTE: no outer \b…\b — several alternatives END in ( or / (e.g. `.sendMessage(`,
// `tool(`, `@ai-sdk/`), and a trailing \b would never match a following `{` or `/`.
const AI_RE = /generateText|streamText|generateObject|streamObject|embedMany|tool\s*\(|@ai-sdk\/|from\s+['"]ai['"]|new\s+OpenAI|new\s+Anthropic|@anthropic-ai\/sdk|GoogleGenerativeAI|@google\/(?:genai|generative-ai)|Gemini\w*Service|Anthropic\w*Service|\.sendMessage\(|\.messages\.create\(|\.chat\.completions\.create\(|\.generateContent\(|\.responses\.create\(|ChatOpenAI|langchain|llamaindex|createAgent|AgentExecutor/;
const CRON_RE = /@Cron\b|CronExpression|new\s+CronJob|bullmq|new\s+Queue\(|@Processor\b|EVERY_(MINUTE|HOUR|DAY)/;
const ENTRY_PATH_RE = /(controller|\.route|router|webhook|gateway|resolver|\.cron|main\.[tj]s|\bcli\b|commands?\/|handler)/i;
const IMPORT_RE = /^\s*(import\b|const\b.*=\s*require\()/;

// import substring -> integration/provider label
const INTEG = [
  [/stripe/i, 'Stripe'], [/hubspot/i, 'HubSpot'], [/(datadog|dd-trace)/i, 'Datadog'],
  [/(twilio)/i, 'Twilio'], [/(sendgrid|@sendgrid)/i, 'SendGrid'], [/(@slack|slack-)/i, 'Slack'],
  [/(bigquery|@google-cloud\/bigquery)/i, 'BigQuery'], [/holded/i, 'Holded'], [/adobe/i, 'Adobe PDF'],
  [/n8n/i, 'n8n'], [/cloudfront/i, 'CloudFront'], [/(mongoose|mongodb)/i, 'MongoDB'],
  [/(ioredis|['"]redis['"])/i, 'Redis'], [/@aws-sdk|aws-sdk/i, 'AWS'], [/\bs3\b/i, 'AWS S3'],
  [/(@prisma|prisma\/client)/i, 'Prisma'], [/(pg|postgres)/i, 'PostgreSQL'],
  [/openai/i, 'OpenAI'], [/anthropic|claude/i, 'Anthropic'], [/(gemini|google.*genai)/i, 'Gemini'],
];

function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'x';
}
function clip(s) { s = String(s || '').trim(); return s.length > LINE_MAX ? s.slice(0, LINE_MAX) + '…' : s; }
function readSafe(p) { try { const st = fs.statSync(p); if (st.size > MAX_BYTES_PER) return null; return fs.readFileSync(p, 'utf8'); } catch { return null; } }

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

function collectRepoContext(root, { readFileImpl = readSafe } = {}) {
  const abs = path.resolve(root || process.cwd());
  const rel = (p) => path.relative(abs, p) || path.basename(p);

  const ctx = {
    project: { name: path.basename(abs) || 'project', slug: slug(path.basename(abs)), date: new Date().toISOString().slice(0, 10) },
    entrypoints: [], aiCallSites: [], crons: [], integrations: new Set(),
    stores: [], agents: [], modules: new Set(), technologies: [],
  };

  // package.json deps -> technologies
  const pkgRaw = readFileImpl(path.join(abs, 'package.json'));
  if (pkgRaw) {
    try {
      const pkg = JSON.parse(pkgRaw);
      if (pkg.name && typeof pkg.name === 'string') {
        // strip an npm scope (@scope/name -> name) for a clean display slug
        const nm = pkg.name.replace(/^@[^/]+\//, '');
        ctx.project.name = nm;
        ctx.project.slug = slug(nm);
      }
      if (pkg.description) ctx.project.tagline = clip(pkg.description);
      const deps = Object.keys({ ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) });
      ctx.technologies = deps.slice(0, CAP.tech).map((d) => scrubString(d));
    } catch { /* ignore */ }
  }

  // Prisma schema -> datasource + models (stores). Handles BOTH a single
  // schema.prisma AND a prisma/schema/ DIRECTORY of *.prisma files (Prisma 5+).
  const eatPrisma = (raw) => {
    if (!raw) return;
    const provider = (raw.match(/datasource\s+\w+\s*\{[^}]*provider\s*=\s*"([^"]+)"/m) || [])[1];
    if (provider) ctx.stores.push(scrubString(provider));
    for (const m of [...raw.matchAll(/^\s*model\s+(\w+)\s*\{/gm)]) ctx.stores.push(scrubString(m[1]));
  };
  for (const cand of ['prisma/schema.prisma', 'schema.prisma']) { const raw = readFileImpl(path.join(abs, cand)); if (raw) { eatPrisma(raw); break; } }
  for (const dir of ['prisma/schema', 'prisma']) {
    const d = path.join(abs, dir);
    try {
      if (fs.statSync(d).isDirectory()) {
        for (const f of fs.readdirSync(d)) if (f.endsWith('.prisma')) eatPrisma(readFileImpl(path.join(d, f)));
      }
    } catch { /* none */ }
  }

  // .claude/agents names
  for (const base of [path.join(abs, '.claude', 'agents')]) {
    try {
      for (const f of fs.readdirSync(base)) {
        if (f.endsWith('.md')) ctx.agents.push(scrubString(path.basename(f, '.md')));
      }
    } catch { /* none */ }
  }

  // scan code files — read AI-/flow-likely files FIRST so the MAX_READ budget
  // covers the call-sites that matter (a big repo has >MAX_READ files). Tier 0:
  // AI-specific paths; tier 1: services/controllers/crons/flows; tier 2: rest.
  const score = (p) => {
    if (/(gemini|openai|anthropic|claude|ai-footprint|\bai\b|\/ai[-/]|llm|agent|orchestrat|generate-|chat|embed|personaliz|translat|synthes|certif|recomm|summar|extract|classif|briefing|showcase)/i.test(p)) return 0;
    if (/(\.service\.|controller|\.cron|worker|queue|webhook|gateway|resolver|handler)/i.test(p)) return 1;
    return 2;
  };
  const files = walk(abs).sort((a, b) => score(rel(a)) - score(rel(b)));
  let readCount = 0;
  for (const f of files) {
    const r = rel(f);
    // module/service dirs (business logic) from src/modules/<x> or src/**/<x>.service
    const modMatch = r.match(/(?:^|\/)modules\/([^/]+)\//) || r.match(/(?:^|\/)([a-z0-9-]+)\.service\.[tj]s$/i);
    if (modMatch) ctx.modules.add(scrubString(modMatch[1]));
    const isEntry = ENTRY_PATH_RE.test(r);
    if (isEntry && ctx.entrypoints.length < CAP.entrypoints) ctx.entrypoints.push({ path: scrubString(r) });

    if (readCount >= MAX_READ) continue;
    const src = readFileImpl(f);
    if (src == null) continue;
    readCount++;
    const lines = src.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      if (AI_RE.test(ln) && ctx.aiCallSites.length < CAP.aiCallSites) {
        ctx.aiCallSites.push({ path: scrubString(r), line: scrubString(clip(ln)) });
      }
      if (CRON_RE.test(ln) && ctx.crons.length < CAP.crons) {
        ctx.crons.push({ path: scrubString(r), line: scrubString(clip(ln)) });
      }
      if (IMPORT_RE.test(ln)) {
        for (const [re, label] of INTEG) if (re.test(ln)) ctx.integrations.add(label);
      }
    }
  }

  ctx.integrations = Array.from(ctx.integrations).slice(0, CAP.integrations);
  ctx.modules = Array.from(ctx.modules).slice(0, CAP.modules);
  ctx.stores = Array.from(new Set(ctx.stores)).slice(0, CAP.stores);
  ctx.agents = ctx.agents.slice(0, CAP.agents);
  return ctx;
}

module.exports = { collectRepoContext, slug };
