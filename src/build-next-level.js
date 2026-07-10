'use strict';

const fs = require('fs');
const path = require('path');
const { getRoadmapEntry } = require('./roadmap-content');

/*
 * "Construir el siguiente nivel ahora" (talents-ai-score, issue 021 /
 * ADR-013-014) — an OPTIONAL phase (mirrors the reference repo's Phase 3):
 * on explicit request, writes the DETERMINISTIC starter artifact(s) for
 * the next tier, using the EXACT SAME snippets as the curated roadmap
 * (src/roadmap-content.js) — never LLM-generated, never invented content.
 *
 * Never runs as part of a normal scan; only invoked via an explicit CLI
 * flag (bin/report.js's `--build-next-level`). Never overwrites an
 * existing file unless `force: true` is passed explicitly — writing to the
 * talent's own project only happens on deliberate, explicit action.
 */

const TIER_ORDER = ['T0', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

function nextTierKey(tierKey) {
  const idx = TIER_ORDER.indexOf(tierKey);
  if (idx === -1 || idx === TIER_ORDER.length - 1) return null;
  return TIER_ORDER[idx + 1];
}

// Writes one snippet file, respecting the "never overwrite without force"
// invariant. Creates parent directories as needed.
function writeSnippetFile(root, filename, code, force) {
  const target = path.join(root, filename);
  const exists = fs.existsSync(target);
  if (exists && !force) {
    return { filename, status: 'skipped-exists' };
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, code);
  return { filename, status: exists ? 'overwritten' : 'created' };
}

// Builds the starter artifact(s) that unlock the NEXT tier, deterministic,
// straight from the curated roadmap content. `force` (default false) is
// the only thing that authorizes overwriting an existing file — an
// explicit, separate decision from just requesting the build.
function buildNextLevelStarter(root, currentTierKey, { force = false } = {}) {
  const entry = getRoadmapEntry(currentTierKey, 'es'); // snippets are literal, language-independent
  if (!entry) return { ok: false, reason: 'unrecognized-tier' };
  if (entry.maxTier) return { ok: false, reason: 'max-tier' };

  const { snippet } = entry;
  if (!snippet || !snippet.filename) {
    // Some jumps (e.g. T0 -> T1) are a shell command to run, not a file to
    // write — never invent a file target for those.
    return { ok: false, reason: 'no-file-target', label: snippet ? snippet.label : null };
  }

  const targets = [{ filename: snippet.filename, code: snippet.code }];
  if (snippet.secondFile) {
    targets.push({ filename: snippet.secondFile.filename, code: snippet.secondFile.code });
  }

  const files = targets.map((t) => writeSnippetFile(root, t.filename, t.code, force));

  return {
    ok: true,
    fromTierKey: currentTierKey,
    targetTierKey: nextTierKey(currentTierKey),
    files,
  };
}

module.exports = { buildNextLevelStarter, nextTierKey };
