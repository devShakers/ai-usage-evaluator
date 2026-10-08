'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const { requestAvailability, fetchAvailability, saveAvailability, normalizeAvailability } = require('../src/availability-client');
const { runAvailability, locationLine } = require('../src/availability-flow');
const { makeAvailabilityTools } = require('../src/mcp-availability-tools');
const { getCatalog } = require('../src/i18n');

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => handler(req, res));
    server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

function fakeIo() {
  const lines = [];
  return { lines, section: (t) => lines.push(`SECTION ${t}`), notify: (t) => lines.push(String(t).replace(/\x1b\[[0-9;]*m/g, '')), error: (t) => lines.push(`ERROR ${t}`), warn: () => {}, success: (t) => lines.push(`OK ${t}`), withProgress: (_l, task) => task() };
}

function setIo(answers, confirmValue) {
  const lines = [];
  const q = [...answers];
  return {
    lines,
    section: (t) => lines.push(`SECTION ${t}`),
    notify: (t) => lines.push(String(t).replace(/\x1b\[[0-9;]*m/g, '')),
    error: (t) => lines.push(`ERROR ${t}`),
    warn: () => {},
    success: (t) => lines.push(`OK ${t}`),
    withProgress: (_l, task) => task(),
    ask: async () => (q.length ? q.shift() : ''),
    confirm: async () => confirmValue,
  };
}

const AVAIL = { available: true, monthlyHours: '40', workModes: ['REMOTE', 'HYBRID'], country: 'ES', subdivision: 'ES-CT', timezone: 'Europe/Madrid', city: 46002, longFullTimeProjects: false, availabilityExpiringDate: '2026-06-01' };

test('requestAvailability: parses TalentAvailabilityDto + Bearer; 404 -> not-found', async () => {
  let auth;
  const { server, base } = await startServer((req, res) => { auth = req.headers.authorization; res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ status: 'OK', data: AVAIL })); });
  try {
    const r = await requestAvailability({ hubAccessToken: 'hub-jwt' }, { endpoint: `${base}/works/me/availability` });
    assert.equal(r.ok, true);
    assert.equal(r.availability.available, true);
    assert.equal(r.availability.monthlyHours, '40');
    assert.equal(auth, 'Bearer hub-jwt');
  } finally { server.close(); }
  const { server: s2, base: b2 } = await startServer((req, res) => { res.writeHead(404); res.end('{}'); });
  try { assert.equal((await requestAvailability({ hubAccessToken: 't' }, { endpoint: `${b2}/a` })).reason, 'not-found'); } finally { s2.close(); }
});

test('normalizeAvailability + locationLine', () => {
  const a = normalizeAvailability(AVAIL);
  assert.deepEqual(a.workModes, ['REMOTE', 'HYBRID']);
  assert.deepEqual(normalizeAvailability({ workModes: ['REMOTE', 'BOGUS'] }).workModes, ['REMOTE'], 'unknown modes are dropped');
  assert.deepEqual(normalizeAvailability({}).workModes, [], 'absent -> empty array');
  assert.equal(locationLine(a), 'ES · ES-CT · Europe/Madrid');
});

test('normalizeAvailability: a numeric monthlyHours (incl. 0) survives as a string, not dropped', () => {
  assert.equal(normalizeAvailability({ monthlyHours: 0 }).monthlyHours, '0');
  assert.equal(normalizeAvailability({ monthlyHours: 40 }).monthlyHours, '40');
  assert.equal(normalizeAvailability({ monthlyHours: '0' }).monthlyHours, '0');
  assert.equal(normalizeAvailability({ monthlyHours: null }).monthlyHours, null);
});

test('runAvailability view: monthlyHours "0" renders as 0, not "not set"', async () => {
  const io = fakeIo();
  await runAvailability({ io, session: { hubAccessToken: 't' }, catalog: getCatalog('en'), opts: {}, deps: { fetchAvailability: async () => ({ ok: true, availability: normalizeAvailability({ available: true, monthlyHours: 0 }) }) } });
  const out = io.lines.join('\n');
  assert.match(out, /Monthly hours: 0/);
  assert.doesNotMatch(out, /Monthly hours: not set/);
});

test('fetchAvailability / saveAvailability resolve endpoints', async () => {
  assert.equal((await fetchAvailability({ getMeAvailabilityEndpoint: () => null }, { hubAccessToken: 't' })).reason, 'no-endpoint');
  let sent;
  await saveAvailability({ getSetAvailabilityEndpoint: () => 'http://hub/av', requestSetAvailability: async ({ availability }, { endpoint }) => { sent = { availability, endpoint }; return { ok: true }; } }, { hubAccessToken: 't', availability: { available: true } });
  assert.equal(sent.endpoint, 'http://hub/av');
  assert.deepEqual(sent.availability, { available: true });
});

test('runAvailability: view renders open-to-work/hours/location, no register hint', async () => {
  const io = fakeIo();
  await runAvailability({ io, session: { hubAccessToken: 't' }, catalog: getCatalog('en'), opts: {}, deps: { fetchAvailability: async () => ({ ok: true, availability: normalizeAvailability(AVAIL) }) } });
  const out = io.lines.join('\n');
  assert.match(out, /Open to work: yes/);
  assert.match(out, /Monthly hours: 40/);
  assert.match(out, /Work modes: Remote, Hybrid/);
  assert.match(out, /Location: ES · ES-CT · Europe\/Madrid/);
  assert.doesNotMatch(out, /register/);
});

// open-to-work is a yes/no arrow picker (deps.promptSelect queue); work modes is a
// multi-pick (deps.promptMultiSelect returns the array). Hours stays a free-text io.ask answer.
function setDeps(openPicks, modes, over = {}) {
  const q = [...openPicks];
  return {
    fetchAvailability: async () => ({ ok: true, availability: normalizeAvailability(AVAIL) }),
    saveAvailability: async () => ({ ok: true }),
    promptSelect: async () => (q.length ? q.shift() : null),
    promptMultiSelect: async () => (Array.isArray(modes) ? modes : []),
    ...over,
  };
}

test('runAvailability --set: open-picker + hours + workModes multi-pick, confirms, sends only asked fields', async () => {
  let sent;
  const io = setIo(['80'], true); // hours only
  const r = await runAvailability({
    io, session: { hubAccessToken: 't' }, catalog: getCatalog('en'),
    opts: { set: true, stdinIsTTY: true },
    deps: setDeps([{ label: 'yes', value: true }], ['REMOTE', 'HYBRID'], { saveAvailability: async ({ availability }) => { sent = availability; return { ok: true }; } }),
  });
  assert.equal(r.ok, true);
  assert.deepEqual(sent, { available: true, monthlyHours: '80', workModes: ['REMOTE', 'HYBRID'] });
  assert.match(io.lines.join('\n'), /OK Availability updated/);
});

test('runAvailability --set: picking only REMOTE shows the remote-only note', async () => {
  const io = setIo([''], true); // keep hours
  await runAvailability({
    io, session: { hubAccessToken: 't' }, catalog: getCatalog('en'),
    opts: { set: true, stdinIsTTY: true },
    deps: setDeps([{ value: true }], ['REMOTE']),
  });
  assert.match(io.lines.join('\n'), /you will not see hybrid or on-site projects/);
});

test('runAvailability --set: decline does not write; bad hours aborts; picker cancel; non-interactive refused', async () => {
  let called = false;
  const rDecline = await runAvailability({ io: setIo(['40'], false), session: { hubAccessToken: 't' }, catalog: getCatalog('en'), opts: { set: true, stdinIsTTY: true }, deps: setDeps([{ value: true }], ['REMOTE'], { saveAvailability: async () => { called = true; return { ok: true }; } }) });
  assert.equal(rDecline.cancelled, true);
  assert.equal(called, false);

  const noWrite = { saveAvailability: async () => { throw new Error('no'); } };
  const rBad = await runAvailability({ io: setIo(['abc'], true), session: { hubAccessToken: 't' }, catalog: getCatalog('en'), opts: { set: true, stdinIsTTY: true }, deps: setDeps([{ value: true }], [], noWrite) });
  assert.equal(rBad.reason, 'bad-hours');

  const rCancel = await runAvailability({ io: setIo([], true), session: { hubAccessToken: 't' }, catalog: getCatalog('en'), opts: { set: true, stdinIsTTY: true }, deps: setDeps([null], [], noWrite) }); // first picker esc
  assert.equal(rCancel.cancelled, true);

  const rNi = await runAvailability({ io: setIo([], true), session: { hubAccessToken: 't' }, catalog: getCatalog('en'), opts: { set: true, stdinIsTTY: false }, deps: setDeps([], []) });
  assert.equal(rNi.reason, 'non-interactive');
});

test('get_availability tool: read-only, session-gated (no set tool exists)', async () => {
  const tools = makeAvailabilityTools({ loadAuthSession: () => ({ hubAccessToken: 't' }), sessionStatus: () => 'active', fetchAvailability: async () => ({ ok: true, availability: normalizeAvailability(AVAIL) }) });
  assert.deepEqual(tools.map((t) => t.name), ['get_availability']); // exactly one, read-only
  assert.equal((await tools[0].handler({})).availability.available, true);
});
