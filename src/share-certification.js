'use strict';

// Certification-persistence payload (skill-code-certification, issue 005), extracted from src/share.js (structure refactor, issue 020).

const { scrubSecrets } = require('./agent-synthesis');

const CERTIFY_SEND_THROTTLE_MS = 60 * 60 * 1000;
const CERT_SCHEMA_VERSION = 1;

// Strict whitelist: the analyzed RESULT + observability provenance (ADR-017), rebuilt field-by-field (never spread).
const CERT_DIMENSION_KEYS = ['idiomatic', 'correctness', 'depth', 'structure', 'testing'];
function deriveDimensionScores(dimensions) {
  if (!dimensions || typeof dimensions !== 'object') return null;
  const out = {};
  let any = false;
  for (const key of CERT_DIMENSION_KEYS) {
    const v = dimensions[key];
    if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 4) {
      out[key] = v;
      any = true;
    } else {
      out[key] = null;
    }
  }
  return any ? out : null;
}

const MAX_INTERVIEW_EVIDENCE_TOKEN_CHARS = 4096;
function interviewEvidenceTokenOf(item) {
  const t = item && item.interviewEvidenceToken;
  return typeof t === 'string' && t ? t.slice(0, MAX_INTERVIEW_EVIDENCE_TOKEN_CHARS) : null;
}

const MAX_CERTIFY_EVIDENCE_TOKEN_CHARS = 4096;
function certifyEvidenceTokenOf(item) {
  const t = item && item.result && item.result.evidenceToken;
  return typeof t === 'string' && t ? t.slice(0, MAX_CERTIFY_EVIDENCE_TOKEN_CHARS) : null;
}

function deriveCertificationPayload(items, { repository = null, commitRange = null, toolVersion = null } = {}) {
  const list = Array.isArray(items) ? items : [];
  const skillCodeAssessments = list
    .filter((i) => i && i.result && typeof i.result === 'object')
    .map((i) => {
      const assessment = {
      skillId: i.skillId != null ? i.skillId : null,
      skillName: typeof i.skillName === 'string' ? i.skillName : null,
      technology: typeof i.technology === 'string' ? i.technology : null,
      score: typeof i.result.score === 'number' ? i.result.score : null,
      rationale: scrubSecrets(typeof i.result.rationale === 'string' ? i.result.rationale : ''),
      improvements: Array.isArray(i.result.improvements)
        ? i.result.improvements.filter((x) => typeof x === 'string' && x).map((x) => scrubSecrets(x))
        : [],
      sampled: !!(i.sampling && i.sampling.sampleable),
      model: typeof i.result.model === 'string' && i.result.model ? i.result.model : null,
      // Paths only (never content). The attribution gate already filtered
      // these to the Talent's own files (bin/certify.js).
      sampledFiles: Array.isArray(i.sampledFiles)
        ? i.sampledFiles.filter((p) => typeof p === 'string' && p)
        : [],
      // Verified-authorship evidence: every considered author-email + match flag.
      authorEmails: Array.isArray(i.authorEmails)
        ? i.authorEmails
            .filter((a) => a && typeof a.email === 'string' && a.email)
            .map((a) => ({ email: a.email, matched: !!a.matched }))
        : [],
      // Model's per-file scores; `[]` when the model degraded to aggregate-only.
      perFileBreakdown: Array.isArray(i.result.perFileBreakdown)
        ? i.result.perFileBreakdown
            .filter((f) => f && typeof f.path === 'string' && typeof f.score === 'number')
            .map((f) => ({
              path: f.path,
              score: f.score,
              note: typeof f.note === 'string' && f.note ? scrubSecrets(f.note) : null,
            }))
        : [],
      // ADR-024 rubric dimensions (0-4 or null) — the inputs the server used to
      // compute the deterministic score. Rebuilt key-by-key, never spread.
      dimensionScores: deriveDimensionScores(i.result.dimensions),
      };
      const certifyToken = certifyEvidenceTokenOf(i);
      if (certifyToken) assessment.evidenceToken = certifyToken;
      // ADR-049 / issue 128: the attested combined level, bound ONLY when an
      // interview ran. Added conditionally so an item without one is byte-identical.
      const token = interviewEvidenceTokenOf(i);
      if (token) assessment.interviewEvidenceToken = token;
      return assessment;
    });
  return {
    schemaVersion: CERT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    kind: 'skill-code-assessment',
    skillCodeAssessments,
    toolVersion: typeof toolVersion === 'string' && toolVersion ? toolVersion : null,
    repository: typeof repository === 'string' && repository ? repository : null,
    commitRange: typeof commitRange === 'string' && commitRange ? commitRange : null,
  };
}

function isCertifyThrottled(state, now = Date.now()) {
  if (!state || !state.lastCertifySentAt) return false;
  const last = new Date(state.lastCertifySentAt).getTime();
  if (Number.isNaN(last)) return false;
  return now - last < CERTIFY_SEND_THROTTLE_MS;
}

module.exports = {
  deriveCertificationPayload,
  isCertifyThrottled,
  CERTIFY_SEND_THROTTLE_MS,
};
