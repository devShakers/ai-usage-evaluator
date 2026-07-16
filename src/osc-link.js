'use strict';

/*
 * OSC 8 terminal hyperlink helper (talents-ai-score, user request: links were
 * printed as plain text and could NOT be clicked in iTerm2).
 *
 * OSC 8 wraps a visible LABEL in an escape sequence carrying the target URI, so
 * a supporting terminal (iTerm2, kitty, WezTerm, VTE-based, Windows Terminal…)
 * renders it as a real clickable link. The sequence is:
 *
 *     ESC ] 8 ; ; <URI> ST  <label>  ESC ] 8 ; ; ST
 *
 * with ST (String Terminator) = ESC \ . Concretely:
 *     \x1b]8;;<URL>\x1b\<label>\x1b]8;;\x1b\
 *
 * GRACEFUL DEGRADATION: a terminal that doesn't understand OSC 8 ignores the
 * escapes and shows only <label> — so we always pass a human-readable label
 * (the URL / path itself when no explicit label is given). Nothing is lost.
 *
 * ENCODING: `file://` URLs must reach here ALREADY percent-encoded — they come
 * from `url.pathToFileURL(p).href` (which correctly encodes spaces, unicode and
 * Windows drive letters). `oscLink` does NOT re-encode: doing so would
 * double-encode an already-valid URL and break the link. `https://` URLs are
 * literals we control. The label may contain ANSI SGR colour codes (the link
 * text can be coloured) — those live in the label, never in the URI segment.
 *
 * Zero-dependency (repo invariant): pure string assembly, no deps.
 */

const OSC = '\x1b]8;;';
const ST = '\x1b\\';

/**
 * Wrap `label` as an OSC 8 hyperlink to `url`.
 * @param {string} url   the target URI (already percent-encoded for file://)
 * @param {string} [label]  visible text; defaults to the URL itself
 * @returns {string}
 */
function oscLink(url, label) {
  const target = url == null ? '' : String(url);
  const text = label == null || label === '' ? target : String(label);
  if (!target) return text;
  return `${OSC}${target}${ST}${text}${OSC}${ST}`;
}

module.exports = { oscLink };
