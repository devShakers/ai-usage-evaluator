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
  requestCertificationReport,
  requestCreateCertificationInterview,
  requestDimensionCase,
} = require('../src/certify-dimension-client');
const { runCertifyDimension, renderVerdict } = require('../src/certify-dimension-flow');
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

test('requestCertificationReport: a finished report without a level (band null) is ready, not polled until timeout', async () => {
  const { server, base } = await startServer((req, res) => okItems(res, { evaluationId: 'ev-1', band: null, certified: false, dimensionName: 'Estrategia' }));
  try {
    const r = await requestCertificationReport({ interviewId: 'i-1', accessToken: 't' }, { base });
    assert.equal(r.ready, true);
    assert.equal(r.report.evaluationId, 'ev-1');
  } finally {
    server.close();
  }
});

test('certify: prints the main role by name, as the hub sends it ({ clusterId, name }), not "[object Object]"', async () => {
  let printed = '';
  const io = { notify: (s) => { printed += `${s}\n`; }, error: (s) => { printed += `${s}\n`; }, warn: () => {}, section: () => {}, success: () => {}, withProgress: (_l, fn) => fn() };
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
      getCertificationInterviewsEndpoint: () => 'http://127.0.0.1:1/unused',
      requestCreateCertificationInterview: async () => ({ ok: false, reason: 'stop-here' }),
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

test('renderVerdict: says whether the dimension was certified, also when the report carries no level', () => {
  const cd = getCatalog('en').certifyDimension;
  assert.match(renderVerdict({ dimensionName: 'Discovery', band: null, certified: false }, cd), /Discovery[\s\S]*not certified this time/);
  assert.match(renderVerdict({ dimensionName: 'Discovery', band: 'PROFICIENT', certified: true }, cd), /PROFICIENT[\s\S]*Result: certified/);
});

test('requestCreateCertificationInterview: a dimension on cooldown comes back as such, with the day it opens again', async () => {
  const { server, base } = await startServer((req, res) => {
    res.writeHead(409, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'KO', code: 'certification.dimension_on_cooldown', message: 'Dimension a/b cannot be sat again yet: 30 day(s) to go, available on 2026-10-28T14:50:38.265Z' }));
  });
  try {
    const r = await requestCreateCertificationInterview({ dimensionKey: 'a/b', accessToken: 't' }, { endpoint: `${base}/x` });
    assert.deepEqual(r, { ok: false, reason: 'dimension-on-cooldown', availableOn: '2026-10-28T14:50:38.265Z' });
  } finally {
    server.close();
  }
});

function certifyIo() {
  const lines = [];
  return {
    lines,
    io: { notify: (s) => lines.push(s), error: (s) => lines.push(s), warn: (s) => lines.push(s), section: () => {}, success: () => {}, withProgress: (_l, fn) => fn() },
  };
}

function certifyDeps(extra) {
  return {
    discoverOfferableDimensions: async () => ({ ok: true, mainRole: { name: 'PM' }, offerable: [{ slug: 'case', clusterId: 'pm', dimensionKey: 'pm/case', state: 'UNCERTIFIED' }], unmatched: [] }),
    getCertificationInterviewsEndpoint: () => 'http://127.0.0.1:1/unused',
    requestCreateCertificationInterview: async () => ({ ok: true, interviewId: 'i-1' }),
    getInterviewsBase: () => 'http://127.0.0.1:1/interviews',
    requestDimensionCase: async () => ({ ok: true, case: null }),
    ...extra,
  };
}

const runCertify = (io, deps) => runCertifyDimension({ io, ask: async () => '', stdinIsTTY: false, session: { accessToken: 'a' }, lang: 'es', catalog: getCatalog('es'), opts: { dimension: 'case' }, deps });

test('certify: a dimension on cooldown says when it can be retaken instead of "http-409"', async () => {
  const { io, lines } = certifyIo();
  await runCertify(io, certifyDeps({ requestCreateCertificationInterview: async () => ({ ok: false, reason: 'dimension-on-cooldown', availableOn: '2026-10-28T14:50:38.265Z' }) }));
  assert.match(lines.join('\n'), /Podrás repetirla a partir del 28 de octubre de 2026/);
  assert.doesNotMatch(lines.join('\n'), /409/);
});

test('certify: an exercise the text interview cannot run points to the web instead of "http-400"', async () => {
  const { io, lines } = certifyIo();
  await runCertify(io, certifyDeps({ conductLivekitInterview: async () => ({ ok: false, reason: 'needs-web' }) }));
  assert.match(lines.join('\n'), /solo se hace en la web/);
});

test('certify: asks the interview loop for plain rendering (no "Pregunta N", no "Gracias. Sigamos:")', async () => {
  let seen;
  const { io } = certifyIo();
  await runCertify(io, certifyDeps({ conductLivekitInterview: async (_io, _deps, opts) => { seen = opts; return { ok: false, reason: 'stop' }; } }));
  assert.equal(seen.plain, true);
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

/* -------- the case, shown before the interview (QA 07/10: the terminal never showed it) -------- */

test('requestDimensionCase: reads the case the web preview shows, statement first, from the certs case route', async () => {
  let seen;
  const { server, base } = await startServer((req, res) => {
    seen = { url: req.url, auth: req.headers.authorization };
    okItems(res, { candidateBrief: 'Brief.', statement: '  **La empresa.** Una marca.  ', testType: 'ROLE_PLAY', attentionCheck: null });
  });
  try {
    const r = await requestDimensionCase({ dimensionKey: 'product-manager/role-play', accessToken: 't' }, { base: `${base}/interviews` });
    assert.deepEqual(r, { ok: true, case: { brief: '**La empresa.** Una marca.', testType: 'ROLE_PLAY' } });
    assert.equal(seen.url, '/interviews/dimension/product-manager/role-play/case');
    assert.equal(seen.auth, 'Bearer t');
  } finally {
    server.close();
  }
});

test('requestDimensionCase: an old template with no statement falls back to its brief, and one with neither has no case', async () => {
  const bodies = [{ candidateBrief: 'Solo el brief.', statement: null, testType: null }, { candidateBrief: '  ', statement: null }];
  const { server, base } = await startServer((req, res) => okItems(res, bodies.shift()));
  try {
    const briefOnly = await requestDimensionCase({ dimensionKey: 'a/b', accessToken: 't' }, { base });
    assert.deepEqual(briefOnly, { ok: true, case: { brief: 'Solo el brief.', testType: null } });
    const none = await requestDimensionCase({ dimensionKey: 'a/b', accessToken: 't' }, { base });
    assert.deepEqual(none, { ok: true, case: null });
  } finally {
    server.close();
  }
});

test('requestDimensionCase: a failed read is a reason, not a throw', async () => {
  const { server, base } = await startServer((req, res) => { res.writeHead(404); res.end(''); });
  try {
    const r = await requestDimensionCase({ dimensionKey: 'a/b', accessToken: 't' }, { base });
    assert.equal(r.ok, false);
  } finally {
    server.close();
  }
});

test('certify: prints the case and what is expected before connecting to the interview', async () => {
  const { io, lines } = certifyIo();
  let printedBeforeInterview;
  let caseAsked;
  await runCertify(io, certifyDeps({
    requestDimensionCase: async (args, opts) => {
      caseAsked = { args, opts };
      return { ok: true, case: { brief: '**La empresa.** Una marca de moda.\n\n**El problema.** Bajan las ventas.', testType: 'ROLE_PLAY' } };
    },
    conductLivekitInterview: async () => { printedBeforeInterview = lines.join('\n'); return { ok: false, reason: 'stop' }; },
  }));
  assert.deepEqual(caseAsked, { args: { dimensionKey: 'pm/case', accessToken: 'a' }, opts: { base: 'http://127.0.0.1:1/interviews' } });
  assert.match(printedBeforeInterview, /La empresa\. Una marca de moda\.[\s\S]*El problema\. Bajan las ventas\./);
  assert.doesNotMatch(printedBeforeInterview, /\*\*/);
  assert.match(printedBeforeInterview, /Qué se espera[\s\S]*Puedes pedir a la otra parte datos que no están en el caso/);
  assert.match(printedBeforeInterview, /Alma te va a hacer preguntas sobre este caso/);
});

test('certify: waits for Enter after the case only when a person is at the terminal', async () => {
  const asked = [];
  const { io } = certifyIo();
  await runCertifyDimension({
    io,
    ask: async (q) => { asked.push(q); return ''; },
    stdinIsTTY: true,
    session: { accessToken: 'a' },
    lang: 'en',
    catalog: getCatalog('en'),
    opts: { dimension: 'case' },
    deps: certifyDeps({
      requestDimensionCase: async () => ({ ok: true, case: { brief: 'The company.', testType: 'CASE_STUDY' } }),
      conductLivekitInterview: async () => ({ ok: false, reason: 'stop' }),
    }),
  });
  assert.equal(asked.length, 1);
  assert.match(asked[0], /Press Enter/);
});

test('certify: no case (old template) or a failed read prints nothing and still starts the interview', async () => {
  for (const read of [{ ok: true, case: null }, { ok: false, reason: 'http-404' }]) {
    const { io, lines } = certifyIo();
    let started = false;
    await runCertify(io, certifyDeps({
      requestDimensionCase: async () => read,
      conductLivekitInterview: async () => { started = true; return { ok: false, reason: 'stop' }; },
    }));
    assert.equal(started, true);
    assert.doesNotMatch(lines.join('\n'), /Qué se espera|preguntas sobre este caso|http-404/);
  }
});
