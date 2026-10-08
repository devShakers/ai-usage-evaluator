'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const REPO_ROOT = path.join(__dirname, '..');

function mkSandbox() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-footprint-install-test-'));
  return {
    home,
    installDir: path.join(home, '.ai-footprint'),
    binDir: path.join(home, '.local', 'bin'),
    configDir: path.join(home, '.config', 'ai-footprint'),
  };
}

function runInstall(scriptDir, sandbox, args = [], extraEnv = {}) {
  return spawnSync('bash', [path.join(scriptDir, 'install.sh'), ...args], {
    cwd: scriptDir,
    encoding: 'utf8',
    timeout: 60000,
    env: {
      PATH: process.env.PATH,
      HOME: sandbox.home,
      SHELL: '/bin/bash',
      AI_FOOTPRINT_HOME: sandbox.installDir,
      AI_FOOTPRINT_BIN: sandbox.binDir,
      AI_FOOTPRINT_CONFIG_DIR: sandbox.configDir,
      SHAKERS_SKIP_MCP_INSTALL: '1',
      SHAKERS_SKIP_NATIVE_INSTALL: '1',
      ...extraEnv,
    },
  });
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function listFilesRecursive(dir) {
  const out = [];
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    if (fs.statSync(abs).isDirectory()) out.push(...listFilesRecursive(abs));
    else out.push(abs);
  }
  return out;
}

// Copies the real repo into a scratch dir so a test can corrupt one file
// (make it unreadable) without ever touching the actual working tree.
function scratchCopyOfRepo() {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-footprint-repo-copy-'));
  for (const rel of ['install.sh', 'package.json', 'README.md']) {
    fs.copyFileSync(path.join(REPO_ROOT, rel), path.join(dest, rel));
  }
  for (const sub of ['bin', 'src']) {
    fs.cpSync(path.join(REPO_ROOT, sub), path.join(dest, sub), { recursive: true });
  }
  return dest;
}

test('install: generates a SHA-256 manifest that matches the installed files', () => {
  const sandbox = mkSandbox();
  try {
    const res = runInstall(REPO_ROOT, sandbox);
    assert.equal(res.status, 0, res.stderr || res.stdout);

    const manifestPath = path.join(sandbox.installDir, 'MANIFEST.sha256');
    assert.ok(fs.existsSync(manifestPath), 'MANIFEST.sha256 must exist after install');

    const lines = fs.readFileSync(manifestPath, 'utf8').trim().split('\n');
    assert.ok(lines.length > 10, 'manifest should list every shipped file');
    for (const line of lines) {
      const idx = line.indexOf('  ');
      const expected = line.slice(0, idx);
      const rel = line.slice(idx + 2);
      const actual = sha256(path.join(sandbox.installDir, rel));
      assert.equal(actual, expected, `manifest hash mismatch for ${rel}`);
    }
  } finally {
    fs.rmSync(sandbox.home, { recursive: true, force: true });
  }
});

test('install: a failed re-install (corrupted source) leaves the PREVIOUS install fully intact (atomic swap)', () => {
  const sandbox = mkSandbox();
  const scratchRepo = scratchCopyOfRepo();
  try {
    // 1) A normal, successful first install (from the real repo).
    const first = runInstall(REPO_ROOT, sandbox);
    assert.equal(first.status, 0, first.stderr || first.stdout);
    const beforeFiles = listFilesRecursive(sandbox.installDir).sort();
    const beforeHashes = new Map(beforeFiles.map((f) => [f, sha256(f)]));

    const marker = '\n// INSTALL-SH-TEST-MARKER-SHOULD-NEVER-REACH-LIVE-INSTALL\n';
    fs.appendFileSync(path.join(scratchRepo, 'bin', 'ai-usage.js'), marker);
    const victim = path.join(scratchRepo, 'src', 'typewriter.js');
    assert.ok(fs.existsSync(victim), 'fixture assumption: src/typewriter.js exists');
    fs.chmodSync(victim, 0o000);

    // 3) Re-install FROM the scratch (corrupted) copy, into the SAME sandbox
    // HOME as step 1 — this is the "upgrade" path that must fail closed.
    const second = runInstall(scratchRepo, sandbox);

    fs.chmodSync(victim, 0o644); // restore perms so cleanup can remove it

    assert.notEqual(second.status, 0, 'the corrupted re-install must fail, not silently succeed');

    const afterFiles = listFilesRecursive(sandbox.installDir).sort();
    assert.deepEqual(afterFiles, beforeFiles, 'file set must be unchanged after a failed re-install');
    for (const f of afterFiles) {
      assert.equal(sha256(f), beforeHashes.get(f), `file changed after a failed re-install: ${f}`);
    }
    const liveReportJs = fs.readFileSync(path.join(sandbox.installDir, 'bin', 'ai-usage.js'), 'utf8');
    assert.ok(!liveReportJs.includes('INSTALL-SH-TEST-MARKER'), 'a file copied EARLY in the failed run must never reach the live install (no partial/mixed-version mutation)');
    const siblings = fs.readdirSync(path.dirname(sandbox.installDir));
    assert.ok(!siblings.some((n) => n.includes('.staging.') || n.includes('.old.')), 'no leftover staging/old scratch dirs');
  } finally {
    fs.rmSync(sandbox.home, { recursive: true, force: true });
    fs.rmSync(scratchRepo, { recursive: true, force: true });
  }
});

test('uninstall: keeps the config dir (session/local reports) by default', () => {
  const sandbox = mkSandbox();
  try {
    assert.equal(runInstall(REPO_ROOT, sandbox).status, 0);
    assert.ok(fs.existsSync(sandbox.configDir));

    const res = runInstall(REPO_ROOT, sandbox, ['--uninstall']);
    assert.equal(res.status, 0, res.stderr);
    assert.ok(!fs.existsSync(sandbox.installDir), 'install dir must be removed');
    assert.ok(fs.existsSync(sandbox.configDir), 'config dir must be KEPT by a plain --uninstall');
    assert.match(res.stdout, /KEPT/);
  } finally {
    fs.rmSync(sandbox.home, { recursive: true, force: true });
  }
});

test('uninstall --purge: also removes the config dir (session/local reports)', () => {
  const sandbox = mkSandbox();
  try {
    assert.equal(runInstall(REPO_ROOT, sandbox).status, 0);
    assert.ok(fs.existsSync(sandbox.configDir));

    const res = runInstall(REPO_ROOT, sandbox, ['--uninstall', '--purge']);
    assert.equal(res.status, 0, res.stderr);
    assert.ok(!fs.existsSync(sandbox.installDir));
    assert.ok(!fs.existsSync(sandbox.configDir), '--purge must remove the config dir too');
  } finally {
    fs.rmSync(sandbox.home, { recursive: true, force: true });
  }
});

test('install: PIN_REF/REF wiring exists for immutable-ref pinning (static check)', () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'install.sh'), 'utf8');
  assert.match(src, /PIN_REF=/, 'installer must expose a ref-pinning variable');
  assert.match(src, /RAW="https:\/\/raw\.githubusercontent\.com\/\$\{OWNER\}\/\$\{REPO\}\/\$\{REF\}"/, 'downloads must resolve against the pinnable $REF, not the mutable $BRANCH directly');
});

/* ---------------- ADR-058 fase 1: two distribution profiles ---------------- */

test('install: a fresh install with NO SHAKERS_PROFILE seeds profile:"external" (the public curl|bash default)', () => {
  const sandbox = mkSandbox();
  try {
    const res = runInstall(REPO_ROOT, sandbox);
    assert.equal(res.status, 0, res.stderr || res.stdout);
    const config = JSON.parse(fs.readFileSync(path.join(sandbox.configDir, 'config.json'), 'utf8'));
    assert.equal(config.profile, 'external');
    assert.match(res.stdout, /Profile: external/);
    // The external pre-flight/final-message copy must never pitch the
    // talent-only commands it will never expose.
    assert.ok(!res.stdout.includes('certify your skills'), 'external run must not pitch certify');
  } finally {
    fs.rmSync(sandbox.home, { recursive: true, force: true });
  }
});

test('install: SHAKERS_PROFILE=talent (env) seeds profile:"talent" -- the wrapper certs serves reuses THIS installer', () => {
  const sandbox = mkSandbox();
  try {
    const res = runInstall(REPO_ROOT, sandbox, [], { SHAKERS_PROFILE: 'talent' });
    assert.equal(res.status, 0, res.stderr || res.stdout);
    const config = JSON.parse(fs.readFileSync(path.join(sandbox.configDir, 'config.json'), 'utf8'));
    assert.equal(config.profile, 'talent');
    assert.match(res.stdout, /Profile: talent/);
    assert.match(res.stdout, /certify/); // the full pitch is back
  } finally {
    fs.rmSync(sandbox.home, { recursive: true, force: true });
  }
});

test('install: an unrecognized SHAKERS_PROFILE falls back to external (fail safe, never the fuller surface)', () => {
  const sandbox = mkSandbox();
  try {
    const res = runInstall(REPO_ROOT, sandbox, [], { SHAKERS_PROFILE: 'bogus' });
    assert.equal(res.status, 0, res.stderr || res.stdout);
    const config = JSON.parse(fs.readFileSync(path.join(sandbox.configDir, 'config.json'), 'utf8'));
    assert.equal(config.profile, 'external');
    assert.match(res.stdout, /unrecognized SHAKERS_PROFILE="bogus"/);
  } finally {
    fs.rmSync(sandbox.home, { recursive: true, force: true });
  }
});

test('install: re-running over an EXISTING config.json never touches its `profile` -- the existing-config-kept path is untouched by ADR-058', () => {
  const sandbox = mkSandbox();
  try {
    // First install: external (the default).
    assert.equal(runInstall(REPO_ROOT, sandbox).status, 0);
    let config = JSON.parse(fs.readFileSync(path.join(sandbox.configDir, 'config.json'), 'utf8'));
    assert.equal(config.profile, 'external');

    // Hand-edit to talent, as `--set-endpoint`-style manual config editing
    // would (or as a future token-gated wrapper would do server-side).
    config.profile = 'talent';
    fs.writeFileSync(path.join(sandbox.configDir, 'config.json'), JSON.stringify(config, null, 2));

    const res = runInstall(REPO_ROOT, sandbox, [], { SHAKERS_PROFILE: 'external' });
    assert.equal(res.status, 0, res.stderr || res.stdout);
    assert.match(res.stdout, /Existing config kept/);
    config = JSON.parse(fs.readFileSync(path.join(sandbox.configDir, 'config.json'), 'utf8'));
    assert.equal(config.profile, 'talent', 'the existing file must survive untouched');
  } finally {
    fs.rmSync(sandbox.home, { recursive: true, force: true });
  }
});

test('install: FILES/manifest are IDENTICAL between profiles -- the code shipped is the same, only config.json differs (ADR-058)', () => {
  const external = mkSandbox();
  const talent = mkSandbox();
  try {
    assert.equal(runInstall(REPO_ROOT, external).status, 0);
    assert.equal(runInstall(REPO_ROOT, talent, [], { SHAKERS_PROFILE: 'talent' }).status, 0);
    const manifestOf = (sandbox) => fs.readFileSync(path.join(sandbox.installDir, 'MANIFEST.sha256'), 'utf8')
      .split('\n')
      .filter((l) => !l.endsWith('MANIFEST.sha256')); // the manifest doesn't hash itself
    assert.deepEqual(manifestOf(external), manifestOf(talent), 'the shipped file set + hashes must be identical across profiles');
  } finally {
    fs.rmSync(external.home, { recursive: true, force: true });
    fs.rmSync(talent.home, { recursive: true, force: true });
  }
});

// PATH with node but without the machine's `claude`, so the run cannot reach a real Claude Code.
function pathWithoutClaude(sandbox) {
  const binDir = path.join(sandbox.home, 'node-only-bin');
  fs.mkdirSync(binDir, { recursive: true });
  fs.symlinkSync(process.execPath, path.join(binDir, 'node'));
  return `${binDir}:/usr/bin:/bin`;
}

test('install: ends by connecting the MCP to the AI apps it finds (answered yes), pointing at the installed CLI', () => {
  const sandbox = mkSandbox();
  try {
    fs.mkdirSync(path.join(sandbox.home, '.cursor'), { recursive: true });
    const res = runInstall(REPO_ROOT, sandbox, [], { SHAKERS_SKIP_MCP_INSTALL: '', SHAKERS_MCP_INSTALL: '1', PATH: pathWithoutClaude(sandbox), SHAKERS_PROFILE: 'talent' });
    assert.equal(res.status, 0, res.stderr || res.stdout);
    const entry = JSON.parse(fs.readFileSync(path.join(sandbox.home, '.cursor', 'mcp.json'), 'utf8')).mcpServers.shakers;
    assert.deepEqual(entry.args, [fs.realpathSync(path.join(sandbox.installDir, 'bin', 'shakers.js')), 'mcp']);
    assert.equal(entry.env.SHAKERS_PROFILE, 'talent');
  } finally {
    fs.rmSync(sandbox.home, { recursive: true, force: true });
  }
});

test('install: SHAKERS_SKIP_MCP_INSTALL=1 leaves the AI apps untouched', () => {
  const sandbox = mkSandbox();
  try {
    fs.mkdirSync(path.join(sandbox.home, '.cursor'), { recursive: true });
    const res = runInstall(REPO_ROOT, sandbox, [], { PATH: pathWithoutClaude(sandbox) });
    assert.equal(res.status, 0, res.stderr || res.stdout);
    assert.equal(fs.existsSync(path.join(sandbox.home, '.cursor', 'mcp.json')), false);
  } finally {
    fs.rmSync(sandbox.home, { recursive: true, force: true });
  }
});
