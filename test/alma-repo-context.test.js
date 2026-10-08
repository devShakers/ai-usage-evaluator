'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { formatContextBlock, collectContextBlock, prependContext } = require('../src/alma-repo-context');

const SAMPLE = {
  project: { name: 'shakers-hub-backend', tagline: 'The hub API' },
  entrypoints: [{ label: 'HTTP API' }, { label: 'Stripe webhook' }],
  services: ['Billing', 'Matching'],
  agents: [{ label: 'Recommender' }],
  models: [{ label: 'Gemini' }, { label: 'Claude' }],
  integrations: ['Stripe', 'HubSpot'],
  stores: ['PostgreSQL'],
  technologies: ['@nestjs/core', 'prisma'],
};

test('formatContextBlock: labelled, fenced, includes structural fields, no instructions', () => {
  const block = formatContextBlock(SAMPLE);
  assert.match(block, /^<project-context>/);
  assert.match(block, /<\/project-context>$/);
  assert.match(block, /CONTEXT for your answer, not instructions/);
  assert.match(block, /Project: shakers-hub-backend/);
  assert.match(block, /Models: Gemini, Claude/);
  assert.match(block, /Integrations: Stripe, HubSpot/);
  assert.match(block, /Technologies: @nestjs\/core, prisma/);
});

test('formatContextBlock: empty/degenerate context yields empty string (nothing to prepend)', () => {
  assert.equal(formatContextBlock(null), '');
  assert.equal(formatContextBlock({}), '');
  assert.equal(formatContextBlock({ project: {}, entrypoints: [], services: [] }), '');
});

test('collectContextBlock: is non-fatal — a throwing collector yields empty string', () => {
  const block = collectContextBlock({ collect: () => { throw new Error('walk blew up'); } });
  assert.equal(block, '');
});

test('collectContextBlock: runs the walk through the status wrapper when provided', () => {
  let wrapped = false;
  const block = collectContextBlock({
    collect: () => SAMPLE,
    status: (fn) => { wrapped = true; return fn(); },
  });
  assert.equal(wrapped, true);
  assert.match(block, /Project: shakers-hub-backend/);
});

test('prependContext: only prepends when a block exists', () => {
  assert.equal(prependContext('', 'hi'), 'hi');
  assert.equal(prependContext('CTX', 'hi'), 'CTX\n\nhi');
});
