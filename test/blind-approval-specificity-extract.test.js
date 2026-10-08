'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { makeBlindApprovalAccumulator } = require('../src/blind-approval-extract');
const { makeSpecificityAccumulator } = require('../src/specificity-extract');

test('blind-approval counts ONLY clear bare affirmations (es+en+emoji), not steered turns', () => {
  const acc = makeBlindApprovalAccumulator();
  ['ok', 'sí', 'Perfecto!', 'dale', 'adelante', 'go ahead', 'sounds good', '👍'].forEach((t) => acc.add(t));
  ['no, cambia el archivo config.ts', 'ok, pero primero revisa el endpoint', 'usa gpt-4o en vez de haiku'].forEach((t) => acc.add(t));
  const r = acc.result();
  assert.equal(r.blindApprovalCount, 8);
  assert.equal(r.humanTurnCount, 11);
});

test('blind-approval: "ok, cambia X" is NOT a bare affirmation (has instruction content)', () => {
  const acc = makeBlindApprovalAccumulator();
  acc.add('ok cambia el color del boton');
  const r = acc.result();
  assert.equal(r.blindApprovalCount, 0);
  assert.equal(r.humanTurnCount, 1);
});

test('blind-approval: null when there are no human turns', () => {
  assert.equal(makeBlindApprovalAccumulator().result(), null);
});

test('specificity counts concrete instruction turns and skips short/affirmation turns', () => {
  const acc = makeSpecificityAccumulator();
  acc.add('usa `config.ts` y limita a 3 reintentos');
  acc.add('el endpoint debe validar el email exactamente');
  acc.add('haz el refactor por favor');
  acc.add('ok');
  const r = acc.result();
  assert.equal(r.instructionTurnCount, 3);
  assert.equal(r.specificInstructionCount, 2);
  assert.ok(r.avgInstructionLength > 0);
});

test('specificity: null when no instruction-length turns exist', () => {
  const acc = makeSpecificityAccumulator();
  acc.add('ok');
  acc.add('sí');
  assert.equal(acc.result(), null);
});
