'use strict';

// THE AGENT-CATEGORY VOCABULARY, AND WHICH OF IT IS A SPECIALITY (issue 120).

/** The floor category key, as the service's catalog defines it (`other-1`'s category). */
const FLOOR_CATEGORY = 'other';

// True for the floor category only.
function isFloorCategory(category) {
  return category === FLOOR_CATEGORY;
}

module.exports = { FLOOR_CATEGORY, isFloorCategory };
