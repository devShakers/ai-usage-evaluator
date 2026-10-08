'use strict';

const { walkSessionSignals } = require('./session-scan');
const { humanTextsFromObject } = require('./transcript-turns');
const { makeSteeringAccumulator } = require('./steering-extract');
const { makeDecisionsAccumulator } = require('./decisions-extract');
const { makeBlindApprovalAccumulator } = require('./blind-approval-extract');
const { makeSpecificityAccumulator } = require('./specificity-extract');

function collectSessionSignals(env = process.env, selectedCwds = null) {
  const steering = makeSteeringAccumulator();
  const decisions = makeDecisionsAccumulator();
  const blindApproval = makeBlindApprovalAccumulator();
  const specificity = makeSpecificityAccumulator();
  const sessions = walkSessionSignals(env, selectedCwds, (obj) => {
    for (const text of humanTextsFromObject(obj)) {
      steering.add(text);
      decisions.add(text);
      blindApproval.add(text);
      specificity.add(text);
    }
  });
  if (sessions) {
    const approval = blindApproval.result();
    const specific = specificity.result();
    if (approval) Object.assign(sessions, approval);
    if (specific) Object.assign(sessions, specific);
  }
  return {
    sessions,
    steering: steering.result(),
    decisions: decisions.result(),
  };
}

module.exports = { collectSessionSignals };
