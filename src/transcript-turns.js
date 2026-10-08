'use strict';

const { iterateSessionObjects } = require('./session-scan');

// Human-turn reader for the steering/decisions extractors (hybrid evaluation, Slice 2).

function isHumanTurn(obj) {
  if (!obj || typeof obj !== 'object') return false;
  const role = obj.message && obj.message.role;
  return obj.type === 'user' || role === 'user';
}

function messageOf(obj) {
  return obj.message && typeof obj.message === 'object' ? obj.message : obj;
}

function* textsFromContent(content) {
  if (typeof content === 'string') {
    yield content;
    return;
  }
  if (!Array.isArray(content)) return;
  for (const part of content) {
    if (part && part.type === 'text' && typeof part.text === 'string') {
      yield part.text;
    }
  }
}

// Yields each human-authored text turn from a SINGLE already-parsed session object.
function* humanTextsFromObject(obj, { minLength = 4 } = {}) {
  if (!isHumanTurn(obj)) return;
  for (const text of textsFromContent(messageOf(obj).content)) {
    const trimmed = text.trim();
    if (trimmed.length < minLength) continue;
    if (trimmed.startsWith('<')) continue;
    yield trimmed;
  }
}

// Yields each human-authored text turn across every AI-tool session on this machine, walking the shared bounded jsonl inventory.
function* eachHumanText(env = process.env, { minLength = 4, selectedCwds = null } = {}) {
  for (const { obj, cwd } of iterateSessionObjects(env)) {
    if (selectedCwds !== null && (cwd === null || !selectedCwds.has(cwd))) continue;
    yield* humanTextsFromObject(obj, { minLength });
  }
}

module.exports = { eachHumanText, humanTextsFromObject };
