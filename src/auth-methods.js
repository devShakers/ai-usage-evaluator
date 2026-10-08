'use strict';

// The SINGLE source of truth for which auth methods exist and where each one is offered (talents-ai-score).
const AUTH_METHODS = [
  { id: 'email', labelKey: 'methodEmail', availableFor: { login: true, register: true } },
  { id: 'google', labelKey: 'methodGoogle', availableFor: { login: true, register: true } },
  { id: 'linkedin', labelKey: 'methodLinkedin', availableFor: { login: true, register: true } },
];

// Social methods share ONE device flow; only the `provider` query param differs.
const SOCIAL_METHODS = new Set(['google', 'linkedin']);
function isSocialMethod(id) {
  return SOCIAL_METHODS.has(id);
}

function methodsForFlow(flow) {
  return AUTH_METHODS.filter((m) => m.availableFor && m.availableFor[flow] === true);
}

function methodIdsForFlow(flow) {
  return methodsForFlow(flow).map((m) => m.id);
}

function isMethodAvailable(id, flow) {
  return methodIdsForFlow(flow).includes(id);
}

function methodLabel(method, catalog) {
  const entry = typeof method === 'string' ? AUTH_METHODS.find((m) => m.id === method) : method;
  const key = entry && entry.labelKey;
  if (catalog && key && catalog[key]) return catalog[key];
  return entry ? entry.id : String(method);
}

module.exports = { AUTH_METHODS, SOCIAL_METHODS, isSocialMethod, methodsForFlow, methodIdsForFlow, isMethodAvailable, methodLabel };
