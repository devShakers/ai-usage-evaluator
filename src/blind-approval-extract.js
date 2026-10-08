'use strict';

const { eachHumanText } = require('./transcript-turns');

const MAX_AFFIRMATION_LEN = 24;

const AFFIRMATION_RE =
  /^(s[ií]|ok|okay|oka|vale|dale|perfecto|perfect|genial|correcto|exacto|eso|as[ií]|adelante|hazlo|listo|ya|yes|yep|yeah|yup|sure|lgtm|great|thanks|thx|gracias|go ahead|do it|sounds good|looks good|makes sense|ok perfecto|ok gracias)$/i;

const EMOJI_AFFIRMATION_RE = /^[\s👍👌✅🙌💯🚀]+$/u;

function normalizeTurn(text) {
  return text
    .replace(/^[\s(*_~"'`\-]+/u, '')
    .replace(/[\s.!¡¿?…,:;)*_~"'`\-]+$/u, '')
    .trim();
}

function makeBlindApprovalAccumulator() {
  let blindApprovalCount = 0;
  let humanTurnCount = 0;
  return {
    add(text) {
      const trimmed = typeof text === 'string' ? text.trim() : '';
      if (!trimmed) return;
      humanTurnCount += 1;
      if (trimmed.length > MAX_AFFIRMATION_LEN) return;
      if (EMOJI_AFFIRMATION_RE.test(trimmed)) {
        blindApprovalCount += 1;
        return;
      }
      const norm = normalizeTurn(trimmed).toLowerCase();
      if (norm && AFFIRMATION_RE.test(norm)) blindApprovalCount += 1;
    },
    result() {
      if (humanTurnCount === 0) return null;
      return { blindApprovalCount, humanTurnCount };
    },
  };
}

function collectBlindApproval(env = process.env, selectedCwds = null) {
  const acc = makeBlindApprovalAccumulator();
  for (const text of eachHumanText(env, { selectedCwds })) acc.add(text);
  return acc.result();
}

module.exports = { collectBlindApproval, makeBlindApprovalAccumulator };
