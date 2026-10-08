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
const { runCertifyDimension, buildWebLink } = require('../src/certify-dimension-flow');
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

test('certify: prints the main role by name, as the hub sends it ({ clusterId, name }), not "[object Object]"', async () => {
  let printed = '';
  const io = { notify: (s) => { printed += `${s}\n`; }, error: (s) => { printed += `${s}\n`; }, warn: () => {}, section: () => {}, success: (s) => { printed += `${s}\n`; }, withProgress: (_l, fn) => fn() };
  await runCertifyDimension({
    io,
    ask: async () => '',
    stdinIsTTY: false,
    session: { accessToken: 'a', hubAccessToken: 'h' },
    lang: 'es',
    catalog: getCatalog('es'),
    opts: { dimension: 'case' },
    deps: {
      discoverOfferableDimensions: async () => ({
        ok: true,
        mainRole: { clusterId: 'full-stack-developer', name: 'Full-stack Developer' },
        offerable: [{ slug: 'case', clusterId: 'full-stack-developer', dimensionKey: 'full-stack-developer/case', state: 'UNCERTIFIED' }],
        unmatched: [],
      }),
      getTalentProfileUrl: () => 'https://works.example.com/login',
    },
  });
  assert.match(printed, /Full-stack Developer/);
  assert.doesNotMatch(printed, /object Object/);
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

/* -------- buildWebLink: deep link into the web profile, filtered to the dimension -------- */

test('buildWebLink: builds /certifications?dimension=<cluster>/<slug> from the profile origin', () => {
  const link = buildWebLink('https://works.example.com/login', { clusterId: 'product-manager', slug: 'discovery' });
  assert.equal(link, 'https://works.example.com/certifications?dimension=product-manager/discovery');
});

test('buildWebLink: null when the profile URL or dimension parts are missing', () => {
  assert.equal(buildWebLink(null, { clusterId: 'c', slug: 's' }), null);
  assert.equal(buildWebLink('https://w/login', { clusterId: 'c' }), null);
  assert.equal(buildWebLink('not a url', { clusterId: 'c', slug: 's' }), null);
});

function certifyIo() {
  const lines = [];
  return {
    lines,
    io: { notify: (s) => lines.push(s), error: (s) => lines.push(s), warn: (s) => lines.push(s), section: () => {}, success: (s) => lines.push(s), withProgress: (_l, fn) => fn() },
  };
}

function certifyDeps(extra) {
  return {
    discoverOfferableDimensions: async () => ({ ok: true, mainRole: { name: 'PM' }, offerable: [{ slug: 'case', clusterId: 'pm', dimensionKey: 'pm/case', state: 'UNCERTIFIED' }], unmatched: [] }),
    getTalentProfileUrl: () => 'https://works.example.com/login',
    ...extra,
  };
}

const runCertify = (io, deps) => runCertifyDimension({ io, ask: async () => '', stdinIsTTY: false, session: { accessToken: 'a' }, lang: 'es', catalog: getCatalog('es'), opts: { dimension: 'case' }, deps });

test('certify: hands off to the web with the dimension deep link, no interview run locally', async () => {
  const { io, lines } = certifyIo();
  const result = await runCertify(io, certifyDeps());
  const out = lines.join('\n');
  assert.match(out, /se hace en la web/);
  assert.match(out, /https:\/\/works\.example\.com\/certifications\?dimension=pm\/case/);
  assert.equal(result.handoff, true);
  assert.equal(result.webLink, 'https://works.example.com/certifications?dimension=pm/case');
});

test('certify: with no profile URL configured, points the talent to Certifications on the web', async () => {
  const { io, lines } = certifyIo();
  await runCertify(io, certifyDeps({ getTalentProfileUrl: () => null }));
  assert.match(lines.join('\n'), /Certificaciones/);
});

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
