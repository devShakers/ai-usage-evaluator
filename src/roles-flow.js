'use strict';

// Shared role flows: add a GROWTH role, change the MAIN role, and the onboarding
// final main-role step. Every choice uses the dynamic arrow selector (io.select).

function makeRolesDeps(overrides = {}) {
  const config = require('./config');
  const client = require('./roles-client');
  const certs = require('./certifications-client');
  return {
    getAvailableRolesEndpoint: config.getAvailableRolesEndpoint,
    getSetMainRoleEndpoint: config.getSetMainRoleEndpoint,
    getAssignedClustersEndpoint: config.getAssignedClustersEndpoint,
    getMyCertificationsEndpoint: config.getMyCertificationsEndpoint,
    requestAvailableRoles: client.requestAvailableRoles,
    requestAssignedClusters: client.requestAssignedClusters,
    requestAddGrowthRole: client.requestAddGrowthRole,
    requestSetMainRole: client.requestSetMainRole,
    requestMeCertifications: (args, opts) => certs.requestMeCertifications(args, opts),
    ...overrides,
  };
}

function roleLabel(role) {
  if (!role) return '';
  const name = role.name || role.clusterId;
  return role.category ? `${name} — ${role.category}` : name;
}

function dedupeByCluster(roles) {
  const seen = new Set();
  const out = [];
  for (const r of roles || []) {
    if (!r || !r.clusterId || seen.has(r.clusterId)) continue;
    seen.add(r.clusterId);
    out.push(r);
  }
  return out;
}

async function chooseRole({ io, roles, header, hint, initialClusterId = null }) {
  const initialMarked = [];
  if (initialClusterId) {
    const idx = roles.findIndex((r) => r.clusterId === initialClusterId);
    if (idx >= 0) initialMarked.push(idx);
  }
  return io.select({ header, hint, items: roles, labelFor: roleLabel, initialMarked });
}

// `add-role`: list the addable catalog and add the chosen one as a GROWTH role.
async function runAddRole({ io, session, catalog, deps = makeRolesDeps() }) {
  const r = catalog.roles;
  const hubAccessToken = session ? session.hubAccessToken : null;

  const listEndpoint = deps.getAvailableRolesEndpoint();
  const res = await io.withProgress(r.loadingAvailable, () =>
    deps.requestAvailableRoles({ hubAccessToken }, { endpoint: listEndpoint }));
  if (!res.ok) {
    io.error(r.fetchFailed(res.reason));
    return { ok: false, reason: res.reason };
  }
  const roles = dedupeByCluster(res.roles);
  if (roles.length === 0) {
    io.notify(r.noneAvailable);
    return { ok: true, added: null };
  }

  io.section(r.addTitle);
  const choice = await chooseRole({ io, roles, header: r.addPrompt, hint: r.selectHint });
  if (!choice) {
    io.notify(r.cancelled);
    return { ok: true, added: null };
  }

  const addEndpoint = deps.getAssignedClustersEndpoint();
  const added = await io.withProgress(r.savingAdd, () =>
    deps.requestAddGrowthRole({ clusterId: choice.clusterId, hubAccessToken }, { endpoint: addEndpoint }));
  if (!added.ok) {
    if (added.reason === 'already-assigned') { io.warn(r.alreadyAssigned(roleLabel(choice))); return { ok: true, added: choice.clusterId }; }
    io.error(r.addFailed(added.reason));
    return { ok: false, reason: added.reason };
  }
  io.success(r.addedOk(roleLabel(choice)));
  return { ok: true, added: choice.clusterId };
}

// Candidate roles the talent already holds (their own GROWTH picks + growing-into),
// deduped, for setting/switching the MAIN role.
async function fetchHeldRoles({ deps, hubAccessToken }) {
  const held = [];
  let mainClusterId = null;
  const certEndpoint = deps.getMyCertificationsEndpoint();
  if (certEndpoint) {
    const cert = await deps.requestMeCertifications({ hubAccessToken }, { endpoint: certEndpoint });
    if (cert.ok) {
      if (cert.mainRole && cert.mainRole.clusterId) { held.push(cert.mainRole); mainClusterId = cert.mainRole.clusterId; }
      for (const g of cert.growingInto || []) held.push(g);
    }
  }
  const assignedEndpoint = deps.getAssignedClustersEndpoint();
  if (assignedEndpoint) {
    const assigned = await deps.requestAssignedClusters({ hubAccessToken }, { endpoint: assignedEndpoint });
    if (assigned.ok) for (const c of assigned.clusters || []) held.push(c);
  }
  return { held: dedupeByCluster(held), mainClusterId };
}

// `change-role`: switch the MAIN role to one of the roles the talent already holds.
async function runChangeMainRole({ io, session, catalog, deps = makeRolesDeps() }) {
  const r = catalog.roles;
  const hubAccessToken = session ? session.hubAccessToken : null;

  const { held, mainClusterId } = await io.withProgress(r.loadingHeld, () => fetchHeldRoles({ deps, hubAccessToken }));
  const candidates = held.filter((c) => c.clusterId !== mainClusterId);
  if (candidates.length === 0) {
    io.notify(r.noOtherRoles);
    return { ok: true, changed: null };
  }

  io.section(r.changeTitle);
  const current = held.find((c) => c.clusterId === mainClusterId);
  if (current) io.notify(r.currentMain(roleLabel(current)));
  const choice = await chooseRole({ io, roles: candidates, header: r.changePrompt, hint: r.selectHint });
  if (!choice) {
    io.notify(r.cancelled);
    return { ok: true, changed: null };
  }
  return applySetMain({ io, deps, hubAccessToken, choice, catalog });
}

// The onboarding final step: pick a MAIN role from the roles resolved for the
// talent (interview recommendations + any held). Degrades gracefully to a skip.
async function runOnboardingMainRoleStep({ io, session, catalog, deps = makeRolesDeps() }) {
  const r = catalog.roles;
  const hubAccessToken = session ? session.hubAccessToken : null;

  io.section(r.mainRoleTitle);
  const { held, mainClusterId } = await io.withProgress(r.loadingHeld, () => fetchHeldRoles({ deps, hubAccessToken }));

  // Prefer the talent's own/recommended roles; fall back to the catalog for a
  // fresh talent so a main role can always be set (picking one adds it first).
  let roles = held;
  let fromCatalog = false;
  if (held.length === 0) {
    const av = await deps.requestAvailableRoles({ hubAccessToken }, { endpoint: deps.getAvailableRolesEndpoint() });
    roles = av.ok ? dedupeByCluster(av.roles) : [];
    fromCatalog = true;
  }
  if (roles.length === 0) {
    io.notify(r.mainRolePending);
    return { ok: true, chosen: null };
  }
  const choice = await chooseRole({
    io, roles, header: r.mainRolePrompt, hint: r.selectHint, initialClusterId: mainClusterId,
  });
  if (!choice) {
    io.notify(r.mainRoleSkipped);
    return { ok: true, chosen: null };
  }
  if (choice.clusterId === mainClusterId) {
    io.notify(r.mainRoleUnchanged(roleLabel(choice)));
    return { ok: true, chosen: choice.clusterId };
  }
  // main-role requires the cluster to be a held assignment: add it first if it came from the catalog.
  if (fromCatalog) {
    await deps.requestAddGrowthRole({ clusterId: choice.clusterId, hubAccessToken }, { endpoint: deps.getAssignedClustersEndpoint() });
  }
  return applySetMain({ io, deps, hubAccessToken, choice, catalog });
}

async function applySetMain({ io, deps, hubAccessToken, choice, catalog }) {
  const r = catalog.roles;
  const endpoint = deps.getSetMainRoleEndpoint();
  const set = await io.withProgress(r.savingMain, () =>
    deps.requestSetMainRole({ clusterId: choice.clusterId, hubAccessToken }, { endpoint }));
  if (!set.ok) {
    io.error(r.setMainFailed(set.reason));
    return { ok: false, reason: set.reason };
  }
  io.success(r.mainSetOk(roleLabel(choice)));
  return { ok: true, chosen: choice.clusterId, changed: choice.clusterId };
}

module.exports = {
  makeRolesDeps,
  roleLabel,
  dedupeByCluster,
  fetchHeldRoles,
  runAddRole,
  runChangeMainRole,
  runOnboardingMainRoleStep,
};
