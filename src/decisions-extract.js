'use strict';

const { eachHumanText } = require('./transcript-turns');
const { scrubSecrets } = require('./agent-synthesis');

const MAX_EXCERPTS = 20;
const MAX_EXCERPT_LEN = 200;

const DECISION_RE =
  /\b(decid\w*|decision|decisión|vamos a|vamos con|voy con|let'?s|we'?ll|we will|prefer|prefiero|option|opción|elij\w*|choose|chose|choice|pick|go with|descarta\w*|opta|trade-?off|instead of|en vez de|en lugar de|rather than|because|porque|reason|razón)\b/i;

function makeDecisionsAccumulator() {
  let decisionExchangeCount = 0;
  const excerpts = [];
  const seen = new Set();
  return {
    add(text) {
      if (!DECISION_RE.test(text)) return;
      decisionExchangeCount += 1;
      if (excerpts.length >= MAX_EXCERPTS) return;
      const scrubbed = scrubSecrets(text)
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_EXCERPT_LEN);
      if (scrubbed && !seen.has(scrubbed)) {
        seen.add(scrubbed);
        excerpts.push(scrubbed);
      }
    },
    result() {
      if (decisionExchangeCount === 0) return null;
      return { decisionExchangeCount, redactedDecisionExcerpts: excerpts };
    },
  };
}

function collectDecisions(env = process.env, selectedCwds = null) {
  const acc = makeDecisionsAccumulator();
  for (const text of eachHumanText(env, { selectedCwds })) acc.add(text);
  return acc.result();
}

module.exports = { collectDecisions, makeDecisionsAccumulator };
