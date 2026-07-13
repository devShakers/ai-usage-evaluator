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
 */

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
