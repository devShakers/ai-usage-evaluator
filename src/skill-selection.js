'use strict';

/*
 * Parses the Talent's Skill selection for the certify phase (skill-code-
 * certification, issue 005). Pure/testable — the interactive prompting lives
 * in bin/certify.js (via stdin-ask). Accepts:
 *   - "all" / "todas" / "todos" / "*"  -> every certifiable Skill
 *   - a list of 1-based indices, comma- or space-separated ("1,3" / "2 4")
 * Returns { ok:true, selected:[...] } (deduped, in the certifiable list's
 * order) or { ok:false } on empty/out-of-range/garbage input — the caller
 * re-prompts rather than guessing a selection.
 */

const ALL_RE = /^(all|todas|todos|\*)$/i;

function parseSkillSelection(input, certifiable) {
  const list = Array.isArray(certifiable) ? certifiable : [];
  const raw = String(input == null ? '' : input).trim();
  if (!raw) return { ok: false };

  if (ALL_RE.test(raw)) {
    return list.length > 0 ? { ok: true, selected: list.slice() } : { ok: false };
  }

  const tokens = raw.split(/[\s,]+/).filter(Boolean);
  if (tokens.length === 0) return { ok: false };

  const chosen = new Set();
  for (const tok of tokens) {
    if (!/^\d+$/.test(tok)) return { ok: false };
    const idx = Number(tok);
    if (idx < 1 || idx > list.length) return { ok: false };
    chosen.add(idx - 1);
  }
  if (chosen.size === 0) return { ok: false };

  // Preserve the certifiable list's order (not the order typed).
  const selected = [...chosen].sort((a, b) => a - b).map((i) => list[i]);
  return { ok: true, selected };
}

module.exports = { parseSkillSelection, ALL_RE };
