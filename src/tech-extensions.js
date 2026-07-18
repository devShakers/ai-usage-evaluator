'use strict';

/*
 * Deterministic technology -> source-file EXTENSIONS map (skill-code-
 * certification, issue 005). Used by src/skill-sampler.js to pick which
 * files are candidates for sampling when certifying a Skill tied to a
 * detected technology.
 *
 * Extensible exactly like tech-detector.js's EXACT_FRAMEWORK_MAP: keyed by
 * the CANONICAL technology name that tech-detector.js#detectTechnologies
 * emits (e.g. 'React', 'NestJS', 'Django'), NOT the raw dependency name. A
 * technology with NO entry here is treated as NOT SAMPLEABLE — documented and
 * surfaced in the report, NEVER guessed at with a made-up extension set (same
 * "honest limitation" discipline as tech-detector.js: recognizing more
 * ecosystems is future work, not something to fake).
 *
 * SAMPLING SURFACES BY TECH TYPE. The sampler matches by filename suffix
 * (name.endsWith(ext)), so an "extension" here can be a real extension
 * (`.tsx`), a compound suffix (`.test.ts`), or a full config filename
 * (`vite.config.ts`) — whatever isolates the tech's real skill signal with
 * minimum egress:
 *
 *   - Frameworks/libraries → their source extensions (React → .tsx, Django →
 *     .py, …).
 *   - Testing frameworks (Jest, Vitest) → the TEST files themselves via
 *     compound suffixes (`.test.*` / `.spec.*`), NOT the whole JS/TS tree.
 *     Known limit: tests placed in a `__tests__/` dir WITHOUT a
 *     `.test.`/`.spec.` suffix aren't matched (the suffix matcher has no
 *     directory awareness); such a project yields zero candidate files and
 *     degrades to the normal "couldn't certify this run" path, never the
 *     "no sampling defined" one.
 *   - Build/config tooling (Vite, Webpack, Tailwind CSS) → the CONFIG file is
 *     the meaningful, reviewable surface (there's no dedicated source surface).
 *     Full-filename suffixes (`vite.config.ts`, `webpack.config.js`,
 *     `tailwind.config.mjs`, …) match ONLY the tool's own config, never
 *     arbitrary source/CSS/markup.
 *
 * A technology with NO entry here is treated as NOT SAMPLEABLE — documented
 * and surfaced, never guessed with a made-up extension set. As of the
 * skill-code-certification coverage work, EVERY technology the detector emits
 * has a sampling (DETECTION_ONLY below is empty); the coverage guard
 * (test/tech-extensions.test.js) fails if a future detectable tech has
 * neither a sampling nor an explicit detection-only opt-out.
 */

// Common JS/TS source extensions — most JS/TS libraries share this surface.
const JS_TS = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'];

const TECH_EXTENSION_MAP = {
  // JS/TS — frontend
  React: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'],
  'Next.js': ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'],
  Vue: ['.vue', '.js', '.ts', '.mjs', '.cjs'],
  Nuxt: ['.vue', '.js', '.ts', '.mjs', '.cjs'],
  Angular: ['.ts', '.html'],
  Svelte: ['.svelte', '.js', '.ts'],
  SvelteKit: ['.svelte', '.js', '.ts'],
  SolidJS: ['.jsx', '.tsx', '.js', '.ts'],
  // JS/TS — backend
  Express: ['.js', '.ts', '.mjs', '.cjs'],
  Fastify: ['.js', '.ts', '.mjs', '.cjs'],
  Koa: ['.js', '.ts', '.mjs', '.cjs'],
  NestJS: ['.ts', '.js'],
  Hapi: ['.js', '.ts', '.mjs', '.cjs'],
  // Python
  Django: ['.py'],
  Flask: ['.py'],
  FastAPI: ['.py'],
  Pyramid: ['.py'],
  Tornado: ['.py'],
  // Go
  Gin: ['.go'],
  Echo: ['.go'],
  Fiber: ['.go'],
  'Gorilla Mux': ['.go'],
  Beego: ['.go'],
  GORM: ['.go'],
  // JS/TS — state management (issue 009)
  Zustand: JS_TS,
  Redux: JS_TS,
  'Redux Toolkit': JS_TS,
  // JS/TS — TanStack family (issue 009)
  'TanStack Query': JS_TS,
  'TanStack Router': JS_TS,
  'TanStack Table': JS_TS,
  'TanStack Form': JS_TS,
  // JS/TS — meta-frameworks (issue 009)
  Astro: ['.astro', '.js', '.ts'],
  Remix: JS_TS,
  // JS/TS — data / API layer (issue 009)
  Prisma: ['.prisma', '.ts', '.js'],
  GraphQL: ['.graphql', '.gql', '.ts', '.js'],
  Apollo: JS_TS,
  tRPC: ['.ts', '.js'],
  Zod: ['.ts', '.js'],
  // Python (issue 009)
  SQLAlchemy: ['.py'],
  Pydantic: ['.py'],
  // Testing — Jest / Vitest. Their code surface is the test suite; compound
  // suffixes match ONLY *.test.* / *.spec.* files, not the whole JS/TS tree.
  Jest: [
    '.test.js', '.test.jsx', '.test.ts', '.test.tsx', '.test.mjs', '.test.cjs',
    '.spec.js', '.spec.jsx', '.spec.ts', '.spec.tsx', '.spec.mjs', '.spec.cjs',
  ],
  Vitest: [
    '.test.js', '.test.jsx', '.test.ts', '.test.tsx', '.test.mjs', '.test.cjs',
    '.spec.js', '.spec.jsx', '.spec.ts', '.spec.tsx', '.spec.mjs', '.spec.cjs',
  ],
  // Build/config tooling — the CONFIG file IS the meaningful skill surface (no
  // dedicated source surface). Full-filename suffixes match ONLY the tool's own
  // config, never arbitrary source/CSS/markup — minimal, honest egress.
  Vite: ['vite.config.js', 'vite.config.cjs', 'vite.config.mjs', 'vite.config.ts'],
  Webpack: ['webpack.config.js', 'webpack.config.cjs', 'webpack.config.mjs', 'webpack.config.ts'],
  'Tailwind CSS': [
    'tailwind.config.js', 'tailwind.config.cjs', 'tailwind.config.mjs', 'tailwind.config.ts',
  ],
};

// Technologies the detector RECOGNIZES but that are INTENTIONALLY not code-
// sampleable — config/tooling/utility-class surfaces with no dedicated code to
// review by sampling. This is the deliberate opt-out that keeps the coverage
// guard honest: a detector-known technology must be EITHER in
// TECH_EXTENSION_MAP (sampleable) OR listed here (explicitly detection-only).
// The guard test (test/tech-extensions.test.js) FAILS on any detectable tech
// that is neither — so a new detectable tech can never silently reach a user
// with no sampling and no decision. Marking a new tech detection-only is a
// one-line addition here (a conscious choice, not an accident). Anything with a
// real code surface (Jest's tests, a build tool's config, etc.) belongs in
// TECH_EXTENSION_MAP instead.
//
// EMPTY as of the skill-code-certification coverage work: every technology the
// detector currently emits is code-sampleable (Vitest/Vite/Webpack/Tailwind CSS
// gained samplings). Kept exported and in place so a future intentionally-not-
// certifiable tech is a one-line opt-in here rather than a silent gap.
const DETECTION_ONLY = new Set([]);

// Returns the extension list for a canonical technology name, or null when
// the technology has no mapping (= NOT sampleable). Returns a fresh copy so
// callers can't mutate the shared table.
function extensionsForTechnology(technology) {
  if (typeof technology !== 'string') return null;
  const exts = TECH_EXTENSION_MAP[technology];
  return exts ? exts.slice() : null;
}

module.exports = { TECH_EXTENSION_MAP, DETECTION_ONLY, extensionsForTechnology };
