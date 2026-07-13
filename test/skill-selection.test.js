'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseSkillSelection } = require('../src/skill-selection');

const LIST = [
  { skillId: 10, skillName: 'React', technology: 'React' },
  { skillId: 20, skillName: 'NestJS', technology: 'NestJS' },
  { skillId: 30, skillName: 'Django', technology: 'Django' },
];

test('parseSkillSelection: "all"/"todas"/"*" -> everything', () => {
  for (const kw of ['all', 'todas', 'TODOS', '*']) {
    const r = parseSkillSelection(kw, LIST);
    assert.equal(r.ok, true);
    assert.equal(r.selected.length, 3);
  }
});

test('parseSkillSelection: comma/space indices, deduped, in list order (not typed order)', () => {
  const r = parseSkillSelection('3, 1, 1', LIST);
  assert.equal(r.ok, true);
  assert.deepEqual(r.selected.map((s) => s.skillId), [10, 30]);
  const r2 = parseSkillSelection('2 3', LIST);
  assert.deepEqual(r2.selected.map((s) => s.skillId), [20, 30]);
});

test('parseSkillSelection: empty / out-of-range / garbage -> ok:false', () => {
  assert.equal(parseSkillSelection('', LIST).ok, false);
  assert.equal(parseSkillSelection('  ', LIST).ok, false);
  assert.equal(parseSkillSelection('0', LIST).ok, false);
  assert.equal(parseSkillSelection('4', LIST).ok, false);
  assert.equal(parseSkillSelection('1,x', LIST).ok, false);
  assert.equal(parseSkillSelection('abc', LIST).ok, false);
});

test('parseSkillSelection: "all" on an empty list -> ok:false (nothing to select)', () => {
  assert.equal(parseSkillSelection('all', []).ok, false);
});
