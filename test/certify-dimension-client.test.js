'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

const {
  requestTemplatesByDimension,
  requestMyCertifications,
  composeOfferableDimensions,
  discoverOfferableDimensions,
  composeDimensionKey,
} = require('../src/certify-dimension-client');
const fs = require('fs');
const path = require('path');
const { runCertifyDimension, buildWebLink, makeCertifyDimensionDeps } = require('../src/certify-dimension-flow');
const { getCatalog } = require('../src/i18n');

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => handler(req, res, Buffer.concat(chunks).toString('utf8')));
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

function okItems(res, data) {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ status: 'OK', data }));
}

/* -------- requestTemplatesByDimension: the REAL {data:{items:[...]}} shape -------- */

test('requestTemplatesByDimension: reads rows from data.items (the real certs shape) into the formats map', async () => {
  const seen = {};
  const { server, base } = await startServer((req, res) => {
    seen.method = req.method;
    seen.url = req.url;
    seen.auth = req.headers.authorization;
    okItems(res, {
      items: [
        { dimensionKey: 'product-manager/terminal-test', templateId: 'dddd', deliveryFormat: 'terminal', estimatedMinutes: 10 },
        { dimensionKey: 'product-manager/other', templateId: 'eeee', deliveryFormat: 'voice', estimatedMinutes: 20 },
      ],
    });
  });
  try {
    const r = await requestTemplatesByDimension(
      { dimensionKeys: ['product-manager/terminal-test', 'product-manager/other'] },
      { endpoint: `${base}/templates/by-dimension` },
    );
    assert.equal(r.ok, true);
    assert.equal(r.formats.get('product-manager/terminal-test'), 'terminal');
    assert.equal(r.formats.get('product-manager/other'), 'voice');
    // @Public: no Authorization header, and the keys ride the query string.
    assert.equal(seen.method, 'GET');
    assert.equal(seen.auth, undefined);
    assert.match(seen.url, /dimensionKeys=product-manager%2Fterminal-test,product-manager%2Fother/);
  } finally {
    server.close();
  }
});

test('requestTemplatesByDimension: still reads data.templates and a bare-array body (tolerant fallbacks)', async () => {
  for (const body of [{ templates: [{ dimensionKey: 'a/b', deliveryFormat: 'terminal' }] }, [{ dimensionKey: 'a/b', deliveryFormat: 'terminal' }]]) {
    const { server, base } = await startServer((req, res) => okItems(res, body));
    try {
      const r = await requestTemplatesByDimension({ dimensionKeys: ['a/b'] }, { endpoint: `${base}/t` });
      assert.equal(r.ok, true);
      assert.equal(r.formats.get('a/b'), 'terminal');
    } finally {
      server.close();
    }
  }
});

test('requestTemplatesByDimension: no keys -> empty map, never hits the network', async () => {
  const r = await requestTemplatesByDimension({ dimensionKeys: [] }, { endpoint: 'http://127.0.0.1:1/t' });
  assert.equal(r.ok, true);
  assert.equal(r.formats.size, 0);
});

/* -------- requestMyCertifications: dimensions/items tolerance -------- */

test('requestMyCertifications: reads dimensions (and tolerates data.items) with defensive field names', async () => {
  for (const key of ['dimensions', 'items']) {
    const { server, base } = await startServer((req, res) => {
      assert.equal(req.headers.authorization, 'Bearer hub-jwt');
      okItems(res, { mainRole: 'Product Manager', [key]: [{ slug: 'terminal-test', clusterId: 'product-manager', state: 'UNCERTIFIED', band: null }] });
    });
    try {
      const r = await requestMyCertifications({ hubAccessToken: 'hub-jwt' }, { endpoint: `${base}/works/certifications/me` });
      assert.equal(r.ok, true);
      assert.equal(r.mainRole, 'Product Manager');
      assert.deepEqual(r.dimensions, [{ slug: 'terminal-test', clusterId: 'product-manager', state: 'UNCERTIFIED', band: null }]);
    } finally {
      server.close();
    }
  }
});

/* -------- composeOfferableDimensions: the intersection -------- */

test('composeOfferableDimensions: keeps terminal + not-CERTIFIED, reports unmatched keys', () => {
  const dimensions = [
    { slug: 'terminal-test', clusterId: 'product-manager', state: 'UNCERTIFIED' },
    { slug: 'voice-one', clusterId: 'product-manager', state: 'UNCERTIFIED' },
    { slug: 'already', clusterId: 'product-manager', state: 'CERTIFIED' },
    { slug: 'no-template', clusterId: 'product-manager', state: 'EXPIRED' },
  ];
  const formats = new Map([
    ['product-manager/terminal-test', 'terminal'],
    ['product-manager/voice-one', 'voice'],
  ]);
  const { offerable, unmatched } = composeOfferableDimensions({ dimensions, formats });
  assert.deepEqual(offerable.map((d) => d.dimensionKey), ['product-manager/terminal-test']);
  assert.deepEqual(unmatched, ['product-manager/no-template']);
});

test('composeOfferableDimensions: a spoken case runs by text, so the terminal offers it; whiteboard and screen share stay on the web', () => {
  const dimensions = ['case', 'code', 'board', 'screen'].map((slug) => ({ slug, clusterId: 'ai-solutions-architect', state: 'UNCERTIFIED' }));
  const formats = new Map([
    ['ai-solutions-architect/case', 'spoken_case'],
    ['ai-solutions-architect/code', 'terminal'],
    ['ai-solutions-architect/board', 'whiteboard'],
    ['ai-solutions-architect/screen', 'screen_share'],
  ]);
  const { offerable } = composeOfferableDimensions({ dimensions, formats });
  assert.deepEqual(offerable.map((d) => d.slug), ['case', 'code']);
});

test('composeDimensionKey: <clusterRef>/<slug>, null when either missing', () => {
  assert.equal(composeDimensionKey('product-manager', 'terminal-test'), 'product-manager/terminal-test');
  assert.equal(composeDimensionKey(null, 'x'), null);
  assert.equal(composeDimensionKey('x', null), null);
});

/* -------- discoverOfferableDimensions: end-to-end intersection with injected fns -------- */

test('discoverOfferableDimensions: a terminal template for a hub dimension IS offered (the reported bug)', async () => {
  const res = await discoverOfferableDimensions(
    {
      getMyCertificationsEndpoint: () => 'http://certs/works/certifications/me',
      getTemplatesByDimensionEndpoint: () => 'http://certs/templates/by-dimension',
      requestMyCertifications: async () => ({ ok: true, mainRole: 'Product Manager', dimensions: [{ slug: 'terminal-test', clusterId: 'product-manager', state: 'UNCERTIFIED', band: null }] }),
      // Mirrors the real {data:{items:[...]}} shape already parsed into a Map.
      requestTemplatesByDimension: async ({ dimensionKeys }) => {
        assert.deepEqual(dimensionKeys, ['product-manager/terminal-test']);
        return { ok: true, formats: new Map([['product-manager/terminal-test', 'terminal']]) };
      },
    },
    { accessToken: 'certs', hubAccessToken: 'hub' },
  );
  assert.equal(res.ok, true);
  assert.equal(res.mainRole, 'Product Manager');
  assert.deepEqual(res.offerable.map((d) => d.dimensionKey), ['product-manager/terminal-test']);
  assert.deepEqual(res.unmatched, []);
});

test('discoverOfferableDimensions: all CERTIFIED -> no templates call, empty offerable', async () => {
  let templatesCalled = false;
  const res = await discoverOfferableDimensions(
    {
      getMyCertificationsEndpoint: () => 'http://certs/me',
      getTemplatesByDimensionEndpoint: () => 'http://certs/t',
      requestMyCertifications: async () => ({ ok: true, mainRole: 'R', dimensions: [{ slug: 's', clusterId: 'c', state: 'CERTIFIED' }] }),
      requestTemplatesByDimension: async () => { templatesCalled = true; return { ok: true, formats: new Map() }; },
    },
    {},
  );
  assert.equal(res.ok, true);
  assert.deepEqual(res.offerable, []);
  assert.equal(templatesCalled, false);
});

/* -------- buildWebLink: the deep link the web certifications route validates -------- */

test('buildWebLink: origin + /certifications?dimension=<cluster>/<slug>, decoded value is exactly clusterId/slug', () => {
  const link = buildWebLink('https://works.test/login', { clusterId: 'product-manager', slug: 'role-play' });
  assert.equal(link, 'https://works.test/certifications?dimension=product-manager/role-play');
  const value = new URL(link).searchParams.get('dimension');
  assert.equal(value, 'product-manager/role-play');
  // The web route validates the decoded param against `^[^/]+\/[^/]+$`.
  assert.match(value, /^[^/]+\/[^/]+$/);
});

test('buildWebLink: each segment is url-encoded while the separator slash stays literal', () => {
  const link = buildWebLink('https://p.prod/talent/profile', { clusterId: 'a b', slug: 'c/d' });
  assert.equal(link, 'https://p.prod/certifications?dimension=a%20b/c%2Fd');
  assert.equal(new URL(link).searchParams.get('dimension'), 'a b/c/d');
});

test('buildWebLink: no profile url, missing parts, or an unparseable url all give null (the no-link path)', () => {
  assert.equal(buildWebLink(null, { clusterId: 'c', slug: 's' }), null);
  assert.equal(buildWebLink('https://x/y', { clusterId: '', slug: 's' }), null);
  assert.equal(buildWebLink('https://x/y', { clusterId: 'c' }), null);
  assert.equal(buildWebLink('not a url', { clusterId: 'c', slug: 's' }), null);
});

/* -------- the web hand-off flow: pick a dimension, print the link, never launch LiveKit -------- */

function certifyIo() {
  const lines = [];
  return {
    lines,
    io: { notify: (s) => lines.push(s), error: (s) => lines.push(s), warn: (s) => lines.push(s), section: () => {}, success: () => {}, withProgress: (_l, fn) => fn() },
  };
}

// No conductLivekitInterview is wired: if the flow tried to run an interview it would throw.
function certifyDeps(extra) {
  return {
    discoverOfferableDimensions: async () => ({ ok: true, mainRole: { name: 'PM' }, offerable: [{ slug: 'role-play', clusterId: 'pm', dimensionKey: 'pm/role-play', state: 'UNCERTIFIED' }], unmatched: [] }),
    getTalentProfileUrl: () => 'https://works.test/login',
    buildWebLink,
    ...extra,
  };
}

const runCertify = (io, deps, { lang = 'es', dimension = 'role-play' } = {}) =>
  runCertifyDimension({ io, ask: async () => '', stdinIsTTY: false, session: { accessToken: 'a', hubAccessToken: 'h' }, lang, catalog: getCatalog(lang), opts: { dimension }, deps });

test('certify: prints the web hand-off and the deep link for the chosen dimension, and never starts an interview', async () => {
  const { io, lines } = certifyIo();
  const r = await runCertify(io, certifyDeps());
  const out = lines.join('\n');
  assert.match(out, /se hace en la web/);
  assert.match(out, /https:\/\/works\.test\/certifications\?dimension=pm\/role-play/);
  assert.equal(r.handoff, 'https://works.test/certifications?dimension=pm/role-play');
  assert.equal(r.ok, true);
});

test('certify: prints the main role by name, as the hub sends it ({ clusterId, name }), not "[object Object]"', async () => {
  const { io, lines } = certifyIo();
  await runCertify(io, certifyDeps({
    discoverOfferableDimensions: async () => ({
      ok: true,
      mainRole: { clusterId: 'full-stack-developer', name: 'Full-stack Developer' },
      offerable: [{ slug: 'case', clusterId: 'full-stack-developer', dimensionKey: 'full-stack-developer/case', state: 'UNCERTIFIED' }],
      unmatched: [],
    }),
  }), { dimension: 'case' });
  const out = lines.join('\n');
  assert.match(out, /Full-stack Developer/);
  assert.doesNotMatch(out, /object Object/);
});

test('certify: when no web link can be built, points the talent to their profile instead of a broken link', async () => {
  const { io, lines } = certifyIo();
  const r = await runCertify(io, certifyDeps({ getTalentProfileUrl: () => null }));
  assert.equal(r.handoff, null);
  assert.match(lines.join('\n'), /No se pudo generar el enlace/);
  assert.doesNotMatch(lines.join('\n'), /certifications\?dimension/);
});

test('certify: a --dimension that is not among the offerable ones is rejected', async () => {
  const { io, lines } = certifyIo();
  const r = await runCertify(io, certifyDeps(), { dimension: 'not-there' });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'bad-dimension');
  assert.match(lines.join('\n'), /no está entre las certificables/);
});

test('certify: nothing offerable exits cleanly with the none message, no link', async () => {
  const { io, lines } = certifyIo();
  const r = await runCertify(io, certifyDeps({ discoverOfferableDimensions: async () => ({ ok: true, mainRole: null, offerable: [], unmatched: [] }) }));
  assert.deepEqual(r, { ok: true, none: true });
  assert.match(lines.join('\n'), /no hay dimensiones certificables/);
});

/* -------- the interview loop still renders plainly for onboarding (shared machinery, untouched) -------- */

test('interview loop: plain rendering prints Alma\'s messages only; onboarding keeps its headings', async () => {
  const { makeIo } = require('../bin/register');
  const render = async (plain) => {
    let printed = '';
    const answers = ['uno'];
    const io = makeIo({ ask: async () => answers.shift() || '', lang: 'es', out: (s) => { printed += s; }, stdinIsTTY: false });
    await io.interviewLoop({
      plain,
      open: async () => ({ ok: true, greeting: 'Hola, soy Alma.' }),
      turn: (() => { let n = 0; return async () => { n += 1; return n === 1 ? { ok: true, response: 'Yo haré de cliente.', ended: false } : { ok: true, response: 'Gracias.', ended: true }; }; })(),
    }).catch(() => {});
    return printed;
  };
  const cert = await render(true);
  assert.match(cert, /Yo haré de cliente/);
  assert.doesNotMatch(cert, /Pregunta \d|Gracias\. Sigamos/);
  assert.match(await render(false), /Pregunta 2[\s\S]*|Gracias\. Sigamos/);
});

/* -------- the real deps wire everything the flow reads -------- */

test('makeCertifyDimensionDeps wires every dep the certify flow reads', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'certify-dimension-flow.js'), 'utf8');
  const used = [...new Set([...src.matchAll(/\bdeps\.(\w+)/g)].map((m) => m[1]))];
  const deps = makeCertifyDimensionDeps();
  assert.ok(used.includes('buildWebLink'));
  assert.ok(used.includes('getTalentProfileUrl'));
  assert.ok(used.includes('discoverOfferableDimensions'));
  for (const name of used) assert.notEqual(deps[name], undefined, `deps.${name} is not wired`);
});

test('certify with the real deps builds the /certifications link from the talent profile origin', async () => {
  const { io, lines } = certifyIo();
  const r = await runCertify(io, makeCertifyDimensionDeps({
    discoverOfferableDimensions: certifyDeps().discoverOfferableDimensions,
    getTalentProfileUrl: () => 'https://p.prod/login',
  }));
  assert.equal(r.handoff, 'https://p.prod/certifications?dimension=pm/role-play');
  assert.match(lines.join('\n'), /https:\/\/p\.prod\/certifications\?dimension=pm\/role-play/);
});
