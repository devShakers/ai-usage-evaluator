'use strict';

// BRAND_ANSI — the Shakers brand palette, reincarnated as ANSI 256-colour SGR codes (talents-ai-score, terminal design-consistency pass).

const BRAND_ANSI = {
  primary: '\x1b[38;5;73m',
  accent: '\x1b[38;5;185m',
  success: '\x1b[38;5;29m',
  warning: '\x1b[38;5;214m',
  danger: '\x1b[38;5;161m',
  muted: '\x1b[38;5;243m',
};

module.exports = { BRAND_ANSI };
