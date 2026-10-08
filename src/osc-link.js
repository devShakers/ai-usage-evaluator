'use strict';

// OSC 8 terminal hyperlink helper (talents-ai-score, user request: links were printed as plain text and could NOT be clicked in iTerm2).

const OSC = '\x1b]8;;';
const ST = '\x1b\\';

// Wrap `label` as an OSC 8 hyperlink to `url`.
function oscLink(url, label) {
  const target = url == null ? '' : String(url);
  const text = label == null || label === '' ? target : String(label);
  if (!target) return text;
  return `${OSC}${target}${ST}${text}${OSC}${ST}`;
}

module.exports = { oscLink };
