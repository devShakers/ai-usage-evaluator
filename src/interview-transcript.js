'use strict';

// TranscriptBuffer — records the onboarding interview Q&A as it happens over LiveKit text (lk.chat), in the exact shape certs' `PATCH /interviews/:id/ complete` persists.

// Upper case: certs validates the role against its AGENT/USER enum and 400s the
// whole PATCH otherwise, so every terminal onboarding lost its transcript
// ("no se pudo guardar la transcripcion (http-400)", new-works 2026-09-25).
const ROLE_AGENT = 'AGENT';
const ROLE_USER = 'USER';

class TranscriptBuffer {
  constructor({ now = Date.now } = {}) {
    this._now = typeof now === 'function' ? now : Date.now;
    this._turns = [];
    this._firstAt = null;
  }

  // Returns true if the turn was recorded, false if dropped (empty / bad role).
  record(role, message) {
    if (role !== ROLE_AGENT && role !== ROLE_USER) return false;
    const msg = String(message == null ? '' : message).trim();
    if (!msg) return false;
    const at = this._now();
    if (this._firstAt === null) this._firstAt = at;
    this._turns.push({
      role,
      message: msg,
      timestamp: new Date(at).toISOString(),
      timeInCallSecs: Math.max(0, Math.floor((at - this._firstAt) / 1000)),
    });
    return true;
  }

  recordAgent(message) {
    return this.record(ROLE_AGENT, message);
  }

  recordUser(message) {
    return this.record(ROLE_USER, message);
  }

  get length() {
    return this._turns.length;
  }

  // A defensive copy so callers cannot mutate the buffered turns.
  toTranscripts() {
    return this._turns.map((t) => ({ ...t }));
  }
}

module.exports = {
  TranscriptBuffer,
  ROLE_AGENT,
  ROLE_USER,
};
