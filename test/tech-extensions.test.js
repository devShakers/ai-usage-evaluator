'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { extensionsForTechnology, TECH_EXTENSION_MAP } = require('../src/tech-extensions');
const { canonicalFrameworkName } = require('../src/tech-detector');

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

test('009: detection-only technologies are NOT sampleable (null), by design', () => {
  for (const t of ['Tailwind CSS', 'Vite', 'Webpack', 'Jest', 'Vitest']) {
    assert.equal(extensionsForTechnology(t), null, `"${t}" must be detection-only (no extension mapping)`);
  }
});

test('every canonical framework tech-detector emits has an extension mapping (no orphan techs)', () => {
  // Derive the canonical names from tech-detector's own public mapper rather
  // than a private table, so this stays honest if the detector's map changes.
  const rawDeps = [
    'react', 'react-dom', 'next', 'vue', 'nuxt', '@angular/core', 'svelte', '@sveltejs/kit', 'solid-js',
    'express', 'fastify', 'koa', '@nestjs/core', '@hapi/hapi',
    'django', 'flask', 'fastapi', 'pyramid', 'tornado',
    'github.com/gin-gonic/gin', 'github.com/labstack/echo/v4', 'github.com/gofiber/fiber',
    'github.com/gorilla/mux', 'github.com/beego/beego',
  ];
  const emitted = new Set(rawDeps.map(canonicalFrameworkName).filter(Boolean));
  assert.ok(emitted.size > 15, 'sanity: derived a broad set of canonical names');
  for (const name of emitted) {
    assert.ok(TECH_EXTENSION_MAP[name], `technology "${name}" is detectable but has no extension mapping`);
  }
});
