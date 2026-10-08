'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// FOUR TIMES IS A PATTERN, so it gets a test (issues 090, 093 and this sweep).

const REPO = path.join(__dirname, '..');

// Comment-stripped, because a docblock that NAMES a module fakes a dependency —
// the same trap issue 090 documented for symbols.
const readCode = (f) => fs
  .readFileSync(f, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/[^\n]*$/gm, '');

// The entry `package.json`'s `bin` maps and `install.sh` links, plus the one the .mcpb manifest runs.
const ENTRIES = [path.join('bin', 'shakers.js'), JSON.parse(fs.readFileSync(path.join(REPO, 'packaging/mcpb/manifest.json'), 'utf8')).server.entry_point];

function reachableFrom(entries) {
  const seen = new Set();
  const queue = [...entries];
  while (queue.length) {
    const rel = queue.shift();
    if (seen.has(rel)) continue;
    seen.add(rel);
    let code;
    try {
      code = readCode(path.join(REPO, rel));
    } catch {
      continue;
    }
    for (const m of code.matchAll(/require\((['"])(\.[^'"]+)\1\)/g)) {
      let target = path.normalize(path.join(path.dirname(rel), m[2]));
      if (!target.endsWith('.js')) target += '.js';
      if (fs.existsSync(path.join(REPO, target))) queue.push(target);
    }
  }
  return seen;
}

const PRESERVED_ORPHANS = new Set([]);

test('every src/ and bin/ module is reachable from the installed entry point', () => {
  const reached = reachableFrom(ENTRIES);
  const shipped = [
    ...fs.readdirSync(path.join(REPO, 'src')).filter((f) => f.endsWith('.js')).map((f) => path.join('src', f)),
    ...fs.readdirSync(path.join(REPO, 'bin')).filter((f) => f.endsWith('.js')).map((f) => path.join('bin', f)),
  ];
  const orphans = shipped.filter((f) => !reached.has(f) && !PRESERVED_ORPHANS.has(f));
  assert.deepEqual(
    orphans,
    [],
    'these modules are shipped to every Talent and reachable from nothing — delete them, or wire them:\n  '
      + orphans.join('\n  '),
  );
});

test('the walker is not vacuous: it does find a module nothing requires', () => {
  // Without this, the test above could be passing because the walk is broken rather than because the tree is clean.
  const reached = reachableFrom(ENTRIES);
  assert.equal(reached.has(path.join('src', 'this-module-does-not-exist.js')), false);
  // And it really did traverse: a deep module only required transitively.
  assert.ok(reached.has(path.join('src', 'backend-request.js')), 'the walk reaches transitive requires');
  for (const entry of ENTRIES) assert.ok(reached.has(entry));
});
