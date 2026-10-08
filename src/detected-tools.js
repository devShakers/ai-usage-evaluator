'use strict';

// Single source of truth for turning a tools array ({id, name, detected}) into what the report shows.

function detectedTools(tools) {
  return Array.isArray(tools) ? tools.filter((t) => t && t.detected === true) : [];
}

function detectedToolNames(tools) {
  return detectedTools(tools)
    .map((t) => (t && (t.name || t.id)) || null)
    .filter(Boolean);
}

module.exports = { detectedTools, detectedToolNames };
