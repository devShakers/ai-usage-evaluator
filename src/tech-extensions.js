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
 * DETECTION-ONLY technologies (skill-code-certification, issue 009):
 * tech-detector.js recognizes some technologies deliberately absent here
 * because they have no meaningful CODE surface to review by sampling
 * (config/tooling/utility-class based): Tailwind CSS, Vite, Webpack, Jest,
 * Vitest. They still appear in the footprint and can be sent for RESOLVE, but
 * extensionsForTechnology returns null so the sampler marks them NOT
 * sampleable (not code-certified). Adding a real file surface later is all it
 * takes to make them sampleable.
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
};

// Returns the extension list for a canonical technology name, or null when
// the technology has no mapping (= NOT sampleable). Returns a fresh copy so
// callers can't mutate the shared table.
function extensionsForTechnology(technology) {
  if (typeof technology !== 'string') return null;
  const exts = TECH_EXTENSION_MAP[technology];
  return exts ? exts.slice() : null;
}

module.exports = { TECH_EXTENSION_MAP, extensionsForTechnology };
