#!/usr/bin/env node
'use strict';

/*
 * Spawned by test/certify-skills-consent-order.test.js to drive
 * `bin/certify.js#runCertifySkills` in a FRESH process.
 *
 * WHY A SEPARATE PROCESS, not an in-process call with a monkey-patched
 * `process.stdout.write` (the pattern test/bin-certify-target-picker.test.js
 * and others use successfully elsewhere in this repo): `runCertifySkills`
 * does REAL network I/O against a real localhost HTTP server, and
 * reproducibly, running several such tests back to back in ONE process each
 * globally monkey-patching `process.stdout.write` for the duration of a REAL
 * async delay (a timer, a socket) races with `node:test`'s OWN deferred
 * per-test report write: test N's TAP result gets silently swallowed into
 * test N+1's active patch instead of reaching the real terminal, and only
 * the LAST test in the file ends up reported. Verified directly with a
 * three-line reproduction outside this repo before writing this harness —
 * removing the real timer/socket from the repro made the bug disappear,
 * confirming the race is specifically about the combination of "real I/O
 * delay" + "global stream monkey-patch shared across sibling tests", not
 * `node:test` concurrency (the three tests DO run sequentially; the report
 * WRITE is what races). A separate process has its own real stdout/stderr —
 * nothing to race with.
 *
 * `bin/certify.js`'s top-level functions do not accept injectable
 * `stdout`/`stderr` streams (unlike `certify-agents.js`/
 * `certify-skill-interview.js`, which do) — adding that is a larger refactor
 * than this unit of work; this harness is the contained workaround.
 *
 * Not shipped: `test-fixtures/` is not `src/`, not `bin/`, not in
 * `install.sh`'s `FILES`/`ASSETS` lists, and `node --test` does not pick it
 * up either (the directory is not named `test`) — see AGENTS.md's "Test
 * layout" invariant for why fixtures live here and nowhere else.
 *
 * Contract, entirely via env vars (argv would need shell-safe JSON quoting
 * for values containing spaces/quotes; env avoids that):
 *   HARNESS_ARGV          JSON array — the argv `runCertifySkills` receives.
 *   HARNESS_ANSWERS       JSON array of strings — a FIFO queue for the
 *                         injected `ask()`; exhausted calls resolve to ''
 *                         (mirrors the real reader's post-EOF behaviour).
 *   HARNESS_TTY           '1' -> stdinIsTTY: true, else false.
 *   HARNESS_FAIL_ON_ASK   '1' -> `ask()` throws if called at all (asserts a
 *                         scenario that must never prompt for anything).
 * Every other env var (config dir, endpoints, ...) passes through normally
 * — this process inherits the spawning test's `env` override as-is.
 */

const { runCertifySkills } = require('../bin/certify');

async function main() {
  const argv = JSON.parse(process.env.HARNESS_ARGV || '[]');
  const answers = JSON.parse(process.env.HARNESS_ANSWERS || '[]');
  const stdinIsTTY = process.env.HARNESS_TTY === '1';
  const failOnAsk = process.env.HARNESS_FAIL_ON_ASK === '1';

  const queue = [...answers];
  const ask = async () => {
    if (failOnAsk) throw new Error('HARNESS: ask() must not be called in this scenario');
    return queue.length ? queue.shift() : '';
  };

  await runCertifySkills(argv, { ask, stdinIsTTY });
}

main()
  .then(() => process.exit(process.exitCode || 0))
  .catch((e) => {
    process.stderr.write(`HARNESS CRASHED: ${(e && e.stack) || e}\n`);
    process.exit(1);
  });
