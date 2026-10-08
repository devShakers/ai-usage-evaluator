'use strict';

const { eachHumanText } = require('./transcript-turns');
const { scrubSecrets } = require('./agent-synthesis');

const MAX_EXCERPTS = 20;
const MAX_EXCERPT_LEN = 200;

const STEERING_RE =
  /\b(no|nope|not that|don'?t|do not|instead|en vez de|en lugar de|mejor|better|change|cambia|revert|revierte|vuelve|deshaz|undo|stop|para|wrong|incorrect|incorrecto|fix|arregla|corrige|use|usa|make it|hazlo|add|añade|remove|quita|ensure|asegúrate|should|deberías|must|debes)\b/i;

function makeSteeringAccumulator() {
  let steeringTraceCount = 0;
  const excerpts = [];
  const seen = new Set();
  return {
    add(text) {
      if (!STEERING_RE.test(text)) return;
      steeringTraceCount += 1;
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
      if (steeringTraceCount === 0) return null;
      return { steeringTraceCount, redactedSteeringExcerpts: excerpts };
    },
  };
}

function collectSteering(env = process.env, selectedCwds = null) {
  const acc = makeSteeringAccumulator();
  for (const text of eachHumanText(env, { selectedCwds })) acc.add(text);
  return acc.result();
}

module.exports = { collectSteering, makeSteeringAccumulator };
