'use strict';

// Setup(tier) x Usage(interaction) -> 3x3 cell; mapping mirrors certs/hub (keep in
// sync). Usage level is judged server-side; this only maps already-judged bands.

const SETUP_LEVELS = ['ASSISTED', 'EXTENDED', 'ORCHESTRATED'];
const USAGE_LEVELS = ['REACTIVE', 'DELIBERATE', 'RIGOROUS'];

const SETUP_CODE = { ASSISTED: 'S1', EXTENDED: 'S2', ORCHESTRATED: 'S3' };

// hub CELL_NAMES, transposed to [setup][usage].
const CELL_NAMES = {
  ASSISTED: { REACTIVE: 'Explorer', DELIBERATE: 'Practitioner', RIGOROUS: 'Craftsman' },
  EXTENDED: { REACTIVE: 'Tooled-up', DELIBERATE: 'Builder', RIGOROUS: 'Architect' },
  ORCHESTRATED: { REACTIVE: 'Automated', DELIBERATE: 'Scaler', RIGOROUS: 'AI Native' },
};

function deriveSetupLevelFromTier(tier) {
  if (tier === null || tier === undefined || tier <= 0) return null;
  if (tier <= 2) return 'ASSISTED';
  if (tier <= 4) return 'EXTENDED';
  return 'ORCHESTRATED';
}

function deriveUsageLevelFromInteraction(interactionLevel) {
  switch (interactionLevel) {
    case 'reactive':
      return 'REACTIVE';
    case 'directive':
      return 'DELIBERATE';
    case 'orchestrative':
      return 'RIGOROUS';
    default:
      return null;
  }
}

function deriveAiFluencyCell(setupLevel, usageLevel) {
  if (!setupLevel || !usageLevel) return null;
  const row = CELL_NAMES[setupLevel];
  return (row && row[usageLevel]) || null;
}

function isAiNative(setupLevel, usageLevel) {
  return setupLevel === 'ORCHESTRATED' && usageLevel === 'RIGOROUS';
}

// tier (0-7) + interactionLevel ('reactive'|'directive'|'orchestrative') -> matrix.
// Null bands when an input is missing (setup-only / usage-pending).
function composeAiFluencyMatrix({ tier = null, interactionLevel = null } = {}) {
  const setupLevel = deriveSetupLevelFromTier(tier);
  const usageLevel = deriveUsageLevelFromInteraction(interactionLevel);
  return {
    setupLevel,
    setupCode: setupLevel ? SETUP_CODE[setupLevel] : null,
    usageLevel,
    cell: deriveAiFluencyCell(setupLevel, usageLevel),
    isAiNative: isAiNative(setupLevel, usageLevel),
  };
}

module.exports = {
  SETUP_LEVELS,
  USAGE_LEVELS,
  SETUP_CODE,
  CELL_NAMES,
  deriveSetupLevelFromTier,
  deriveUsageLevelFromInteraction,
  deriveAiFluencyCell,
  isAiNative,
  composeAiFluencyMatrix,
};
