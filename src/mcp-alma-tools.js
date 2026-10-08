'use strict';

const ALMA_CHAT_SCHEMA = {
  type: 'object',
  properties: {
    message: { type: 'string', description: 'The message for Alma.' },
  },
  required: ['message'],
};

const ALMA_DECISION_SCHEMA = {
  type: 'object',
  properties: {
    approved: { type: 'boolean', description: "The talent's decision on the pending confirmation: true = go ahead, false = cancel." },
  },
  required: ['approved'],
};

function makeAlmaTools(deps = {}) {
  const {
    askAlma = (opts) => require('./alma-client').askAlma({}, opts),
    decideAlma = (opts) => require('./alma-client').decideAlma({}, opts),
    loadAuthSession = require('./auth-session-store').loadAuthSession,
    sessionStatus = require('./auth-session-store').sessionStatus,
  } = deps;

  const requireSession = () => {
    const session = loadAuthSession();
    if (sessionStatus(session) !== 'active') {
      throw new Error('no active Shakers session — call the login tool (or run `shakers login`) first (alma is session-gated).');
    }
    return session;
  };

  const captureEvents = () => {
    let pending = null;
    const links = [];
    const onEvent = (evt) => {
      if (!evt) return;
      if (evt.type === 'confirmation_required') {
        pending = { text: evt.text || '', irreversible: !!(evt.detail && String(evt.detail).length) };
      } else if (evt.type === 'link' && evt.data && evt.data.to) {
        links.push(String(evt.data.to));
      }
    };
    return { onEvent, snapshot: () => ({ pending, links }) };
  };

  const relay = (res, cap) => {
    if (!res.ok) return { ok: false, reason: res.reason };
    const { pending, links } = cap.snapshot();
    const out = { ok: true, answer: res.text };
    if (pending) out.pendingConfirmation = pending;
    if (links.length) out.webLinks = links;
    return out;
  };

  async function almaChat(args = {}) {
    const session = requireSession();
    const message = typeof args.message === 'string' ? args.message.trim() : '';
    if (!message) return { ok: false, reason: 'no-message' };
    const cap = captureEvents();
    const res = await askAlma({ hubAccessToken: session.hubAccessToken, message, onEvent: cap.onEvent });
    return relay(res, cap);
  }

  async function almaDecision(args = {}) {
    const session = requireSession();
    if (typeof args.approved !== 'boolean') return { ok: false, reason: 'no-decision' };
    const cap = captureEvents();
    const res = await decideAlma({ hubAccessToken: session.hubAccessToken, approved: args.approved, onEvent: cap.onEvent });
    return relay(res, cap);
  }

  return [
    {
      name: 'alma_chat',
      description: "Send a message to Alma, the Shakers AI assistant, and get her answer (about the talent's profile, rate, availability, skills, positions, applications). Continuity is automatic across turns (same session). When Alma proposes a profile change she returns `pendingConfirmation { text, irreversible }` — DO NOT auto-approve: show the talent `pendingConfirmation.text` (and warn when irreversible), ask them yes/no, then call `alma_decision` with their answer. `webLinks` are web-only navigation targets. Relay the answer as-is; never show internal Shakers ids/codes.",
      inputSchema: ALMA_CHAT_SCHEMA,
      handler: almaChat,
    },
    {
      name: 'alma_decision',
      description: "Relay the talent's decision on the pending Alma action from alma_chat: approved=true makes Alma perform the change, approved=false cancels it. Call this ONLY after the talent has explicitly answered yes/no to the pendingConfirmation — never decide on their behalf.",
      inputSchema: ALMA_DECISION_SCHEMA,
      handler: almaDecision,
    },
  ];
}

module.exports = { makeAlmaTools, ALMA_CHAT_SCHEMA, ALMA_DECISION_SCHEMA };
