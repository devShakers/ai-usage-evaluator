'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { extensionsForTechnology, TECH_EXTENSION_MAP, DETECTION_ONLY } = require('../src/tech-extensions');
const { canonicalFrameworkName, EXACT_FRAMEWORK_MAP, GO_FRAMEWORK_PREFIXES } = require('../src/tech-detector');

// The COMPLETE set of canonical technologies the detector can ever emit, read
// from the detector's OWN tables (source of truth) — so a tech added there is
// automatically pulled into the coverage guard below.
function allDetectorTechnologies() {
  const names = new Set(Object.values(EXACT_FRAMEWORK_MAP));
  for (const g of GO_FRAMEWORK_PREFIXES) names.add(g.name);
  return names;
}

/*
 * skill-code-certification, issue 005: technology -> extensions map. Keyed by
 * the canonical names tech-detector.js emits; a technology with no entry is
 * NOT sampleable (null), never guessed.
 */

test('extensionsForTechnology: returns a copy for known technologies', () => {
  const a = extensionsForTechnology('React');
  assert.ok(a.includes('.tsx'));
  a.push('.zzz');
  const b = extensionsForTechnology('React');
  assert.equal(b.includes('.zzz'), false, 'must return a fresh copy, not the shared table');
});

test('extensionsForTechnology: Python/Go map to their single extension', () => {
  assert.deepEqual(extensionsForTechnology('Django'), ['.py']);
  assert.deepEqual(extensionsForTechnology('Gin'), ['.go']);
});

test('extensionsForTechnology: unknown/invalid technology -> null (not sampleable)', () => {
  assert.equal(extensionsForTechnology('COBOL'), null);
  assert.equal(extensionsForTechnology(null), null);
  assert.equal(extensionsForTechnology(undefined), null);
});

// --- issue 009: expanded catalog, sampleable vs detection-only --------------

test('009: new code-sampleable technologies have an extension mapping', () => {
  for (const t of [
    'TanStack Query', 'TanStack Router', 'TanStack Table', 'TanStack Form',
    'Zustand', 'Redux', 'Redux Toolkit', 'Apollo', 'tRPC', 'Zod', 'Remix', 'GORM',
    'SQLAlchemy', 'Pydantic',
  ]) {
    const exts = extensionsForTechnology(t);
    assert.ok(Array.isArray(exts) && exts.length > 0, `"${t}" should be sampleable`);
  }
  assert.ok(extensionsForTechnology('Astro').includes('.astro'));
  assert.ok(extensionsForTechnology('Prisma').includes('.prisma'));
  assert.ok(extensionsForTechnology('GraphQL').includes('.graphql'));
});

test('DETECTION_ONLY is empty — every detectable tech is now code-sampleable', () => {
  assert.equal(DETECTION_ONLY.size, 0);
});

test('Jest/Vitest are code-sampleable via their test-file suffixes', () => {
  for (const t of ['Jest', 'Vitest']) {
    const exts = extensionsForTechnology(t);
    assert.ok(Array.isArray(exts) && exts.length > 0, `${t} should be sampleable`);
    // Targets test files specifically, not the whole JS/TS tree.
    assert.ok(exts.includes('.test.ts'));
    assert.ok(exts.includes('.spec.tsx'));
    assert.equal(exts.includes('.ts'), false, 'must match ONLY *.test.*/*.spec.*, not every .ts file');
  }
});

test('build/config tools are code-sampleable via their config file only', () => {
  assert.ok(extensionsForTechnology('Vite').includes('vite.config.ts'));
  assert.ok(extensionsForTechnology('Webpack').includes('webpack.config.js'));
  assert.ok(extensionsForTechnology('Tailwind CSS').includes('tailwind.config.mjs'));
  // Config-file suffixes must not slurp arbitrary source.
  assert.equal(extensionsForTechnology('Vite').includes('.ts'), false);
  assert.equal(extensionsForTechnology('Tailwind CSS').includes('.css'), false);
});

// --- coverage guard: no silent certification gap ---------------------------
// The whole point (skill-code-certification, "don't let another Jest happen"):
// a technology the detector recognizes must NEVER reach a user as neither
// code-sampleable nor an explicit detection-only opt-out. These read the
// detector's real tables + tech-extensions.js's real maps, so a future tech
// added to the detector without a decision breaks CI, not a user's run.

test('GUARD: every detectable technology is code-sampleable OR explicitly detection-only', () => {
  const offenders = [];
  for (const tech of allDetectorTechnologies()) {
    const sampleable = extensionsForTechnology(tech) !== null;
    const optedOut = DETECTION_ONLY.has(tech);
    if (!sampleable && !optedOut) offenders.push(tech);
  }
  assert.deepEqual(
    offenders,
    [],
    'these detectable techs have NO sampling and are NOT on the DETECTION_ONLY '
    + 'allowlist. Add a sampling to TECH_EXTENSION_MAP (tech-extensions.js), or, '
    + 'if intentionally not code-certifiable, add them to DETECTION_ONLY '
    + `(a deliberate one-line opt-out): ${offenders.join(', ')}`,
  );
});

test('GUARD: sampled and detection-only are disjoint (a tech is one or the other, never both)', () => {
  const both = [...DETECTION_ONLY].filter((t) => extensionsForTechnology(t) !== null);
  assert.deepEqual(both, [], `techs both sampled AND marked detection-only (remove from DETECTION_ONLY): ${both.join(', ')}`);
});

test('GUARD: DETECTION_ONLY has no dead entries — every opt-out is a tech the detector emits', () => {
  const known = allDetectorTechnologies();
  const dead = [...DETECTION_ONLY].filter((t) => !known.has(t));
  assert.deepEqual(dead, [], `DETECTION_ONLY lists techs the detector never emits (stale opt-out): ${dead.join(', ')}`);
});

// Sanity: the derived universe is broad and canonicalFrameworkName round-trips.
test('allDetectorTechnologies: derives a broad, canonical universe', () => {
  const all = allDetectorTechnologies();
  assert.ok(all.size > 30, 'sanity: derived a broad set of canonical names');
  assert.equal(all.has(canonicalFrameworkName('react')), true);
  assert.equal(all.has(canonicalFrameworkName('github.com/gin-gonic/gin')), true);
});
