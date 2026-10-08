'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const PLATFORMS = ['darwin-arm64', 'darwin-x64', 'linux-x64-gnu', 'linux-arm64-gnu', 'win32-x64-msvc'];

function write(file, content, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, mode ? { mode } : undefined);
}

// Dry run: the real script against a copy of the repo layout, with npm, npx and tar shimmed to record their calls.
function dryRun() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'build-mcpb-'));
  const shims = path.join(root, 'shims');
  const log = path.join(root, 'calls.log');
  write(path.join(root, 'scripts/build-mcpb.sh'), fs.readFileSync(path.join(REPO, 'scripts/build-mcpb.sh')));
  for (const f of ['manifest.json', 'README.md', 'PRIVACY.md']) write(path.join(root, 'packaging/mcpb', f), '{}');
  write(path.join(root, 'LICENSE'), 'license');
  write(path.join(root, 'package.json'), fs.readFileSync(path.join(REPO, 'package.json')));
  write(path.join(root, 'bin/mcp.js'), '');
  write(path.join(root, 'src/index.js'), '');
  write(path.join(shims, 'npm'), `#!/bin/sh
echo "npm $* @ $PWD" >> "${log}"
case "$1" in
  install) mkdir -p node_modules/@livekit/rtc-ffi-bindings && echo '{"version":"9.9.9"}' > node_modules/@livekit/rtc-ffi-bindings/package.json ;;
  pack) f="$(echo "$2" | sed 's|@livekit/||; s|@.*||').tgz"; touch "$f"; echo "$f" ;;
esac
`, 0o755);
  write(path.join(shims, 'npx'), `#!/bin/sh\necho "npx $*" >> "${log}"\n`, 0o755);
  write(path.join(shims, 'tar'), `#!/bin/sh
echo "tar $*" >> "${log}"
while [ "$1" != "-C" ]; do shift; done
touch "$2/rtc-node.node"
`, 0o755);
  const out = execFileSync('sh', [path.join(root, 'scripts/build-mcpb.sh')], {
    env: { ...process.env, PATH: `${shims}:${process.env.PATH}` },
    encoding: 'utf8',
  });
  return { root, out, calls: fs.readFileSync(log, 'utf8').trim().split('\n') };
}

test('build-mcpb stages package.json, installs only runtime deps and adds the LiveKit binary of all five platforms at the pinned FFI version', { skip: process.platform === 'win32' }, () => {
  const { root, out, calls } = dryRun();
  const stage = path.join(root, 'dist/mcpb');
  try {
    assert.ok(fs.existsSync(path.join(stage, 'package.json')), 'package.json is staged so the bundle reports its version');
    const install = calls.find((c) => c.startsWith('npm install --omit=dev'));
    assert.equal(fs.realpathSync(install.split(' @ ')[1]), fs.realpathSync(stage), 'runtime deps install inside the stage');
    const packs = calls.filter((c) => c.startsWith('npm pack')).map((c) => c.split(' ')[2]);
    assert.deepEqual(packs, PLATFORMS.map((p) => `@livekit/rtc-ffi-bindings-${p}@9.9.9`));
    for (const p of PLATFORMS) {
      assert.ok(fs.existsSync(path.join(stage, `node_modules/@livekit/rtc-ffi-bindings-${p}/rtc-node.node`)), `${p} binary extracted`);
    }
    assert.ok(calls.some((c) => c === `npx -y @anthropic-ai/mcpb@2.1.2 pack ${stage} ${path.join(root, 'dist/shakers-ai-usage.mcpb')}`));
    assert.ok(!fs.existsSync(path.join(root, 'dist/livekit-tgz')), 'the downloaded tarballs are cleaned up');
    assert.match(out, /LiveKit FFI 9\.9\.9: darwin-arm64 darwin-x64 linux-x64-gnu linux-arm64-gnu win32-x64-msvc/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
