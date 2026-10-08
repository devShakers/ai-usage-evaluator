'use strict';

const VALID_LANGS = new Set(['es', 'en']);
const VALID_SCOPES = new Set(['machine', 'repo']);

function parseScope(value) {
  return VALID_SCOPES.has(value) ? value : null;
}

function parseRepoList(value) {
  if (typeof value !== 'string') return null;
  const items = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length > 0 ? items : null;
}

function parseArgs(argv) {
  const opts = {
    json: false,
    save: true,
    root: null,
    help: false,
    consentStatus: false,
    consentRevoke: false,
    consentReset: false,
    consentEmail: null,
    setEndpoint: null,
    showEndpoint: false,
    buildNextLevel: false,
    force: false,
    lang: null,
    roadmap: false,
    repos: null,
    allRepos: false,
    // Dynamic scope selector for the DEDICATED `ai-usage` command (a symptom fix: machine-wide runs were silently collapsing to the current repo's agents).
    machine: false,
    repo: false,
    scope: null,
    noAi: false,
    // Issue 103: turns the section reveal off. Same name in both parsers, and the
    // env var `NO_ANIMATION` does the same thing (the `NO_COLOR` pattern of 079).
    noAnimation: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-animation') opts.noAnimation = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--no-save') opts.save = false;
    else if (a === '--root') opts.root = argv[++i];
    else if (a === '--consent-status') opts.consentStatus = true;
    else if (a === '--consent-revoke') opts.consentRevoke = true;
    else if (a === '--consent-reset') opts.consentReset = true;
    else if (a === '--consent-email') opts.consentEmail = argv[++i];
    else if (a.startsWith('--consent-email=')) opts.consentEmail = a.slice('--consent-email='.length);
    else if (a === '--set-endpoint') opts.setEndpoint = argv[++i];
    else if (a.startsWith('--set-endpoint=')) opts.setEndpoint = a.slice('--set-endpoint='.length);
    else if (a === '--show-endpoint') opts.showEndpoint = true;
    else if (a === '--build-next-level') opts.buildNextLevel = true;
    else if (a === '--force') opts.force = true;
    // ADR-016: the tier roadmap / "next steps" block is removed from the
    // default footprint output; `--roadmap` (alias `--next`) shows it again.
    else if (a === '--roadmap' || a === '--next') opts.roadmap = true;
    else if (a === '--lang') opts.lang = VALID_LANGS.has(argv[++i]) ? argv[i] : null;
    else if (a.startsWith('--lang=')) {
      const value = a.slice('--lang='.length);
      opts.lang = VALID_LANGS.has(value) ? value : null;
    }
    else if (a === '--no-ai') opts.noAi = true;
    else if (a === '--all-repos') opts.allRepos = true;
    else if (a === '--machine') opts.machine = true;
    else if (a === '--repo') opts.repo = true;
    else if (a === '--scope') opts.scope = parseScope(argv[++i]);
    else if (a.startsWith('--scope=')) opts.scope = parseScope(a.slice('--scope='.length));
    else if (a === '--repos') opts.repos = parseRepoList(argv[++i]);
    else if (a.startsWith('--repos=')) opts.repos = parseRepoList(a.slice('--repos='.length));
    else if (a === '--help' || a === '-h') opts.help = true;
  }
  return opts;
}

module.exports = { parseArgs };
