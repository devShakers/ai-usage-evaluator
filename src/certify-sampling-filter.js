'use strict';

const { extensionsForTechnology } = require('./tech-extensions');

/*
 * Invariant guard for the RESOLVE -> CERTIFY handoff (skill-code-certification).
 *
 * The RESOLVE server answers a CATALOG question ("does this Talent hold a Skill
 * that maps to this detected technology?") and is DECOUPLED from whether THIS
 * CLI can actually sample code for that technology. So a tech can come back
 * `certifiable` while `extensionsForTechnology(tech)` is null (Jest, Vitest,
 * Tailwind… are detection-only in tech-extensions.js). Left unfiltered, the
 * talent could pick such a Skill and then hit, at certify time:
 *   "No hay muestreo definido para la tecnología X: todavía no se puede
 *    certificar por código."
 * — a broken promise: advertised certifiable, then un-certifiable.
 *
 * This filter enforces the invariant  listed-as-certifiable  <=>  has-a-defined
 * -sampling  at a SINGLE point: entries whose technology has no code sampling
 * are demoted from `certifiable` to `nonCertifiable` (reason 'no-sampling'),
 * so both the printed resolve report AND the interactive selection see the same
 * already-filtered list. After this it is impossible to select something from
 * "Certificables" and then meet "no hay muestreo".
 *
 * Pure and side-effect-free (only consults the static extension map) so the
 * invariant is directly testable without the filesystem or the network.
 */

const NO_SAMPLING_REASON = 'no-sampling';

// A technology has a code sampling iff it has an extension mapping.
function hasSampling(technology) {
  return extensionsForTechnology(technology) !== null;
}

// Returns a NEW resolve result where every certifiable entry lacking a code
// sampling is moved to nonCertifiable with reason 'no-sampling'. Existing
// nonCertifiable entries (and their server-provided reasons) are preserved;
// demoted techs are de-duplicated and never clobber a reason already present.
function filterResolveBySampling(result) {
  const certifiable = (result && Array.isArray(result.certifiable)) ? result.certifiable : [];
  const nonCertifiable = (result && Array.isArray(result.nonCertifiable)) ? result.nonCertifiable.slice() : [];

  const kept = [];
  const demoted = [];
  for (const entry of certifiable) {
    if (entry && hasSampling(entry.technology)) kept.push(entry);
    else if (entry) demoted.push(entry);
  }

  const seen = new Set(
    nonCertifiable.map((n) => n && n.technology).filter((t) => typeof t === 'string' && t),
  );
  for (const entry of demoted) {
    const tech = entry.technology;
    if (typeof tech === 'string' && tech && !seen.has(tech)) {
      nonCertifiable.push({ technology: tech, reason: NO_SAMPLING_REASON });
      seen.add(tech);
    }
  }

  return { ...result, certifiable: kept, nonCertifiable };
}

module.exports = { filterResolveBySampling, hasSampling, NO_SAMPLING_REASON };
