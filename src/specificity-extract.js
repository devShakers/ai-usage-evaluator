'use strict';

const { eachHumanText } = require('./transcript-turns');

const MIN_INSTRUCTION_LEN = 12;

const CONCRETE_RE =
  /(`[^`]+`|\b[\w-]+\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|rb|php|css|scss|html|json|ya?ml|md|sql|sh|toml)\b|\/[\w./-]{2,}|"[^"]{2,}"|\d|\b(must|should|shouldn'?t|don'?t|do not|ensure|avoid|instead|because|so that|only|never|always|exactly|specifically|at least|at most|no more than|make sure|asegúrate|debe|deber[íi]as?|no (uses?|hagas|pongas)|en vez de|en lugar de|porque|exactamente|específicamente|solo|nunca|siempre)\b)/i;

function makeSpecificityAccumulator() {
  let instructionTurnCount = 0;
  let specificInstructionCount = 0;
  let totalInstructionLength = 0;
  return {
    add(text) {
      const trimmed = typeof text === 'string' ? text.trim() : '';
      if (trimmed.length < MIN_INSTRUCTION_LEN) return;
      instructionTurnCount += 1;
      totalInstructionLength += trimmed.length;
      if (CONCRETE_RE.test(trimmed)) specificInstructionCount += 1;
    },
    result() {
      if (instructionTurnCount === 0) return null;
      return {
        specificInstructionCount,
        instructionTurnCount,
        avgInstructionLength: Math.round(
          totalInstructionLength / instructionTurnCount,
        ),
      };
    },
  };
}

function collectSpecificity(env = process.env, selectedCwds = null) {
  const acc = makeSpecificityAccumulator();
  for (const text of eachHumanText(env, { selectedCwds })) acc.add(text);
  return acc.result();
}

module.exports = { collectSpecificity, makeSpecificityAccumulator };
