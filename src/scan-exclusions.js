'use strict';

/*
 * Directory names never descended into when walking a project tree
 * (skill-code-certification, issue 008). Shared by the code sampler
 * (src/skill-sampler.js) and the recursive technology detector
 * (src/tech-detector.js) so both agree on what to skip — excluding
 * `node_modules` in particular is the critical performance guard on large /
 * monorepo trees.
 *
 * Factored out of skill-sampler.js (where it originally lived) so the tech
 * detector can reuse the exact same set without depending on the certify-only
 * sampler module.
 */
const EXCLUDED_DIRS = new Set([
  'node_modules', 'dist', 'build', '.git', 'vendor', 'coverage', '.next', 'out',
]);

module.exports = { EXCLUDED_DIRS };
