'use strict';

/*
 * Deterministic, pure formatter for the RESOLVE phase output
 * (skill-code-certification, issue 004). No ANSI/colors (kept plain for
 * unambiguous testing and clean piping); the CLI adds the surrounding
 * chrome. Renders two lists:
 *   - Certifiable: the Skills the Hub says are certifiable for this Talent
 *     (Skill in the catalog AND declared by the Talent), each tied to the
 *     detected technology that matched it.
 *   - Non-certifiable: every detected technology NOT covered by a certifiable
 *     entry, WITH a reason. The reason comes from the server's optional
 *     `nonCertifiable[{technology, reason}]` list (a stable key mapped to
 *     localized copy); when the server doesn't say why, a generic reason is
 *     shown — the detected-minus-certifiable derivation guarantees the talent
 *     always sees where each detected technology landed, never a silent drop.
 */

function reasonText(catalog, reasonKey) {
  const reasons = (catalog.certify && catalog.certify.reasons) || {};
  return (reasonKey && reasons[reasonKey]) || reasons.notCertifiable;
}

function formatResolveReport(technologies, result, catalog) {
  const c = catalog.certify;
  const detected = Array.isArray(technologies) ? technologies.filter((t) => typeof t === 'string' && t) : [];
  const certifiable = (result && Array.isArray(result.certifiable)) ? result.certifiable : [];
  const serverNonCertifiable = (result && Array.isArray(result.nonCertifiable)) ? result.nonCertifiable : [];

  const certifiableTechs = new Set(
    certifiable.map((e) => e && e.technology).filter((t) => typeof t === 'string' && t),
  );
  const reasonByTech = new Map(
    serverNonCertifiable
      .filter((n) => n && typeof n.technology === 'string')
      .map((n) => [n.technology, n.reason]),
  );

  const lines = [];
  lines.push(c.resolveHeading);
  lines.push('');

  // Certifiable
  lines.push(c.certifiableHeading);
  if (certifiable.length === 0) {
    lines.push(`  ${c.certifiableEmpty}`);
  } else {
    for (const entry of certifiable) {
      lines.push(`  ${c.certifiableLine(entry.skillName || String(entry.skillId), entry.technology, entry.skillId)}`);
    }
  }
  lines.push('');

  // Non-certifiable: derived from detected minus certifiable (honest,
  // never a silent drop), reason from the server when provided.
  const nonCertifiableTechs = detected.filter((t) => !certifiableTechs.has(t));
  lines.push(c.nonCertifiableHeading);
  if (nonCertifiableTechs.length === 0) {
    lines.push(`  ${c.nonCertifiableEmpty}`);
  } else {
    for (const tech of nonCertifiableTechs) {
      lines.push(`  ${c.nonCertifiableLine(tech, reasonText(catalog, reasonByTech.get(tech)))}`);
    }
  }

  return lines.join('\n');
}

module.exports = { formatResolveReport };
