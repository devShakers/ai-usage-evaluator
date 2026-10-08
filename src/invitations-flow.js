'use strict';

// `invitations` flow: list the talent's unread position invitations. Read-only.

const { styleLabelPrefix } = require('./ansi');

function makeInvitationsDeps(overrides = {}) {
  const client = require('./invitations-client');
  return {
    fetchInvitations: (opts) => client.fetchInvitations({}, opts),
    ...overrides,
  };
}

async function runInvitations({ io, rawOut, session, catalog, opts = {}, deps = makeInvitationsDeps() }) {
  const fp = catalog.invitations;
  const hubAccessToken = session ? session.hubAccessToken : null;

  const doFetch = () => deps.fetchInvitations({ hubAccessToken });
  const res = opts.json ? await doFetch() : await io.withProgress(fp.loading, doFetch);
  if (!res.ok) {
    io.error(fp.fetchFailed(res.reason));
    return { ok: false, reason: res.reason };
  }
  const items = Array.isArray(res.items) ? res.items : [];

  if (opts.json) {
    (rawOut || ((s) => process.stdout.write(s)))(`${JSON.stringify({ ok: true, items }, null, 2)}\n`);
    return { ok: true, items };
  }

  io.section(fp.title);
  if (items.length === 0) {
    io.notify(fp.none);
    return { ok: true, items };
  }
  // Human render never prints the project id (it stays in --json only).
  items.forEach((inv, i) => {
    if (i > 0) io.notify('');
    io.notify(`${i + 1}) ${inv.name || fp.untitled}${inv.invitationChatId ? ` · ${fp.hasChat}` : ''}`);
  });
  io.notify(styleLabelPrefix(fp.countNote(items.length)));
  io.success(fp.done);
  return { ok: true, items };
}

module.exports = {
  makeInvitationsDeps,
  runInvitations,
};
