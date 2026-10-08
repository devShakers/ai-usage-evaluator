'use strict';

// What the talent reads in the MCP sign-up (UX review 39574): fixed texts from the tools, in their language, in character, legal texts verbatim.
const test = require('node:test');
const assert = require('node:assert/strict');

const { makeSignupTools } = require('../src/mcp-signup-tools');
const { makeRegisterTools } = require('../src/mcp-register-tools');
const { makeAiUsageTool } = require('../src/mcp-ai-usage-tool');
const { signupCopy, legalCopy, SIGNUP_LANGUAGES, renderDraft, renderRole } = require('../src/signup-copy');
const { resetSignupLanguage, fixSignupLanguage } = require('../src/signup-language');
const { needle } = require('../test-fixtures/copy-needle');

const ES = signupCopy('es');
const SESSION = { accessToken: 'jwt', hubAccessToken: 'jwt', email: 'ada@example.com', expiresAt: '2999-01-01T00:00:00.000Z' };
const SIGNUP_TOOLS = ['signup_start', 'signup_email', 'signup_draft', 'signup_create_account', 'signup_status', 'update_existing_profile', 'save_profile_details', 'import_profile', 'open_web', 'open_linkedin_profile',
  'suggest_register_context', 'read_cv', 'onboarding_interview_start', 'onboarding_interview_turn', 'onboarding_interview_complete',
  'list_my_roles', 'list_available_roles', 'add_role', 'set_main_role', 'ai_usage', 'login', 'social_signin_start', 'social_signin_poll'];
// Words that pull the AI out of character: where the account lives, or whether it is real.
const OUT_OF_CHARACTER = /\b(local(ly|host)?|localmente|environments?|entornos?|staging|production|producción|development|desarrollo|tests?|testing|pruebas?|sandbox|e2e|demo|127\.0\.0\.1|alias(es)?)\b/i;
const DRAFT = { name: 'Ada Lovelace', role: 'Data Engineer', city: 'Madrid', yearsOfExperience: 8, stack: 'Spark, dbt', languages: 'Español nativo, inglés C1', workMode: 'Remoto', monthlyHours: '120-160', hourlyRate: 45, annualRate: 60000 };

test.beforeEach(() => resetSignupLanguage());

// Every string a copy entry can produce; functions get a one-item list, which serves as a name, an email, a count or the saved rates.
function texts(entry) {
  if (typeof entry === 'string') return [entry];
  if (typeof entry === 'function') return [entry(['7'], 8)];
  return Object.values(entry).flatMap(texts);
}

function signupHarness({ deps = {} } = {}) {
  const win = { finish: null, options: null, calls: 0 };
  let session = null;
  const calls = { opened: [], sleeps: [] };
  const held = [];
  const tools = makeSignupTools({
    lang: 'es',
    flowDeps: {
      loadAuthSession: () => session,
      sessionStatus: (s) => (s ? 'active' : 'none'),
      saveAuthSession: () => {},
      getTalentProfileUrl: () => 'https://works.test/login',
    },
    runLoopbackAuth: (args, options) => {
      win.calls += 1;
      win.options = options;
      options.onUrl('http://127.0.0.1:5555/');
      options.openBrowser('http://127.0.0.1:5555/');
      return new Promise((resolve) => { win.finish = (o) => { if (o.ok) session = SESSION; resolve(o); }; });
    },
    requestMcpSignup: async () => ({ ok: true, claimCode: 'CODE', claimCodeExpiresAt: 'x' }),
    requestMyImportStatus: async () => ({ ok: true, state: 'done', sources: {} }),
    requestOneTimeToken: async () => ({ ok: true, token: 'OTT' }),
    getMcpSignupEndpoint: () => 'https://hub.test/s',
    getMyImportStatusEndpoint: () => 'https://hub.test/i',
    getOneTimeTokenEndpoint: () => 'https://hub.test/o',
    getOneTimeLoginUrl: (t) => `https://works.test/auth/one-time?token=${t}`,
    checkOnboardingCompleted: async () => false,
    fetchPricingRate: async () => ({ ok: false }),
    fetchAvailability: async () => ({ ok: false }),
    openBrowser: (url) => { calls.opened.push(url); },
    // Browser openings wait on a sleep the test releases; every other wait is instant.
    sleep: (ms) => {
      calls.sleeps.push(ms);
      if (ms >= 1000) return new Promise((resolve) => { held.push(resolve); });
      return new Promise((resolve) => setImmediate(resolve));
    },
    ...deps,
  });
  return { tools: Object.fromEntries(tools.map((t) => [t.name, t])), win, calls, release: () => held.splice(0).forEach((r) => r()) };
}

async function toWindow(tools) {
  await tools.signup_start.handler({ language: 'es' });
  await tools.signup_email.handler({ email: 'ada@gmail.com', typed: true });
  await tools.signup_draft.handler({ ...DRAFT, answer: ES.draftOk });
  return tools.signup_create_account.handler({ windowAnnounced: true, linkedinUrl: 'https://www.linkedin.com/in/ada', firstName: 'Ada', lastName: 'Lovelace' });
}

test('Adrián\'s copy (es), word for word: welcome, question and options', () => {
  assert.equal(ES.welcome(null), '¡Hola! Gracias por querer unirte a Shakers 🙌\n\nSomos una comunidad de profesionales tech freelance. Nuestro objetivo es tener siempre tu versión más actual como profesional (lo que sabes hacer hoy, cómo trabajas con IA y qué buscas) para conectarte con proyectos que de verdad encajen contigo.\n\nEl alta son tres pasos y la mayor parte la hago yo por ti:\n1. Tu perfil (2 min). Lo relleno a partir de tu CV y LinkedIn, tú solo revisas y confirmas.\n2. Cómo trabajas con IA (1-2 min, opcional). Analizo qué herramientas usas en este equipo. Tu código y tus prompts nunca salen de tu máquina.\n3. Una breve entrevista (opcional). Para afinar tu rol y lo que buscas. Puedes hacerla ahora o más tarde.\n\nTodo lo puedes editar después desde la web.');
  assert.equal(ES.welcomeQuestion, '¿Empezamos? Si me das permiso, busco tu CV en este equipo y te preparo un borrador para que solo tengas que confirmarlo.');
  assert.deepEqual([ES.cvSearch, ES.cvAttach], ['Sí, búscalo', 'Te lo adjunto yo']);
  assert.equal(ES.linkedinAsk, '¿Me pasas tu perfil de LinkedIn?');
});

test('Adrián\'s copy (es), word for word: email, draft, window, AI usage, existing account and main role', () => {
  assert.equal(ES.emailKnown('ada@gmail.com'), '¿Te registro con ada@gmail.com? Usa el email que más mires: ahí te llegarán los proyectos que encajen contigo y las novedades de Shakers.');
  assert.equal(ES.emailUnknown, '¿Con qué email te registro? Usa el que más mires: ahí te llegarán los proyectos que encajen contigo y las novedades de Shakers.');
  assert.equal(ES.emailWorkHint, 'Si es el de tu trabajo actual, quizá prefieras uno personal para no perder el acceso si cambias de empresa.');
  assert.deepEqual([ES.emailYes, ES.emailOther], ['Sí, ese', 'Usar otro']);
  assert.equal(renderDraft('es', DRAFT), 'Esto es lo que he preparado para tu perfil:\nAda Lovelace · Data Engineer · Madrid\n8 años de experiencia · Spark, dbt\nEspañol nativo, inglés C1 · Remoto · 120-160 h/mes\nTarifa estimada: 45 €/h · 60.000 €/año (estimación mía, ajústala)');
  assert.equal(ES.draftQuestion, '¿Está bien o cambio algo?');
  assert.deepEqual([ES.draftOk, ES.draftChange], ['Todo correcto', 'Quiero cambiar algo']);
  assert.equal(ES.windowOpening, 'Perfecto. Ahora solo falta crear tu cuenta para guardar todo esto y que puedas entrar en Shakers cuando quieras.\n\nTe abro una ventana en el navegador, elige cómo entrar:\n· Con Google\n· Con email y contraseña\n\nLa contraseña la escribes allí directamente, nunca pasa por este chat. En esa misma pantalla aceptas los términos y la política de privacidad.\n\n👉 Mira tu navegador. Cuando termines, vuelve aquí y seguimos.');
  assert.doesNotMatch(ES.windowOpening, /LinkedIn/);
  assert.equal(ES.aiUsageQuestion, '¿Quieres que analice cómo trabajas con IA? Es opcional y tarda 1-2 min. Solo veo qué herramientas usas, tu código y tus prompts no salen de tu máquina. Te ayuda a destacar en proyectos de IA.');
  assert.deepEqual([ES.aiUsageYes, ES.aiUsageSkip], ['Sí, analízalo', 'Saltar este paso']);
  assert.equal(ES.existingTitle, 'He visto que ya tienes cuenta. ¿Actualizo tu perfil con esto?');
  assert.equal(ES.rolesIntro, 'Con todo lo que me has contado, encajas en estos perfiles:');
  assert.equal(ES.rolesOutro, 'Tu perfil principal es el que ven primero las empresas y el que usamos para recomendarte proyectos. Puedes añadir más y cambiarlo cuando quieras.');
  assert.equal(
    renderRole('es', { name: 'Data Engineer', source: 'IMPORT', evidence: '8 años con Spark', openProjects: 12, recommended: true }),
    '**Data Engineer** (recomendado)\nPor tu CV y tu LinkedIn: 8 años con Spark\nAhora mismo hay 12 proyectos abiertos que buscan este perfil.',
  );
  assert.equal(renderRole('es', { name: 'ML Engineer', source: 'ONBOARDING_INTERVIEW', openProjects: 0 }), '**ML Engineer**\nPor lo que me contaste en la entrevista');
  assert.equal(renderRole('es', { name: 'X', source: 'IMPORT', openProjects: 1 }).split('\n')[2], 'Ahora mismo hay 1 proyecto abierto que busca este perfil.');
});

test('every sign-up language carries every text, the legal ones too, and nothing is left in another language by mistake', () => {
  const keys = (o) => Object.keys(o).sort();
  for (const lang of SIGNUP_LANGUAGES) {
    assert.deepEqual(keys(signupCopy(lang)), keys(ES), lang);
    assert.deepEqual(keys(signupCopy(lang).saved), keys(ES.saved), lang);
    assert.deepEqual(keys(signupCopy(lang).roleReason), keys(ES.roleReason), lang);
    assert.deepEqual(keys(legalCopy(lang)), keys(legalCopy('es')), lang);
    for (const text of [...texts(signupCopy(lang)), ...texts(legalCopy(lang))]) assert.ok(text && text.length > 0, lang);
  }
  for (const lang of ['it', 'pt']) {
    assert.notEqual(signupCopy(lang).welcomeQuestion, signupCopy('en').welcomeQuestion, `${lang} is translated`);
    assert.notEqual(legalCopy(lang).usageInfoAccessed, legalCopy('en').usageInfoAccessed, `${lang} legal is translated`);
  }
  assert.equal(signupCopy('fr'), signupCopy('en'), 'a language without copy falls back to English');
});

test('legal texts: "redacted" is "anonimizados" in Spanish, and the es texts keep their accents', () => {
  const es = legalCopy('es');
  assert.match(es.usageInfoAccessed, /extractos anonimizados/);
  assert.doesNotMatch(es.usageInfoAccessed, /redactad/);
  for (const copy of Object.values(es)) assert.doesNotMatch(copy, /\b(codigo|maquina|como trabajas|Duracion|dedicacion)\b/, copy);
  const { getCatalog } = require('../src/i18n');
  assert.equal(getCatalog('es').onboarding.usageInfoAccessed, es.usageInfoAccessed, 'the CLI shows the same legal text');
});

test('in character: no instruction, prompt, tool description, schema or sign-up text talks about where the account lives or whether it is real', async () => {
  const { buildServerInstructions, buildServer } = require('../bin/mcp');
  const all = [['instructions', buildServerInstructions({})], ['instructions elicitation', buildServerInstructions({ elicitation: true })]];
  const server = buildServer();
  const prompt = await server.handleMessage({ jsonrpc: '2.0', id: 1, method: 'prompts/get', params: { name: 'onboarding' } });
  all.push(['/onboarding', prompt.result.messages[0].content.text]);
  const list = await server.handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  for (const t of list.result.tools.filter((x) => SIGNUP_TOOLS.includes(x.name))) {
    all.push([`${t.name} description`, t.description], [`${t.name} schema`, JSON.stringify(t.inputSchema)]);
  }
  for (const lang of SIGNUP_LANGUAGES) {
    for (const text of [...texts(signupCopy(lang)), ...texts(legalCopy(lang))]) all.push([`copy ${lang}`, text]);
  }
  const hits = all.filter(([, text]) => OUT_OF_CHARACTER.test(text)).map(([where, text]) => `${where}: ${text.match(OUT_OF_CHARACTER)[0]}`);
  assert.deepEqual(hits, []);
});

test('in character: the instructions keep the AI as the sign-up assistant and forbid telling where data came from', () => {
  const { buildServerInstructions } = require('../bin/mcp');
  const text = buildServerInstructions({});
  assert.match(text, /You are Shakers' sign-up assistant/);
  assert.match(text, /never question whether they want the account/i);
  assert.match(text, /Never say where a piece of data came from/);
  assert.match(text, /never show internal codes, ids or the claim code/);
  assert.match(text, /Never narrate/);
  assert.doesNotMatch(text, /¿|Hola|Gracias/, 'no talent-facing copy lives in the instructions: it comes from the tools, localized');
});

test('in character: tool results of the sign-up path carry no out-of-character wording and no address unless the talent asked for it', async () => {
  const { tools, win, release } = signupHarness();
  const results = [];
  results.push(await tools.signup_start.handler({ language: 'es' }));
  results.push(await tools.signup_email.handler({ email: 'ada@corp.example' }));
  results.push(await tools.signup_draft.handler(DRAFT));
  results.push(await toWindow(tools));
  results.push(await tools.signup_status.handler({}));
  assert.doesNotMatch(JSON.stringify(results), /https?:\/\/|127\.0\.0\.1/);
  win.finish({ ok: true, email: 'ada@gmail.com', accountExists: false, claimed: true });
  results.push(await tools.signup_status.handler({ waitSeconds: 5 }));
  results.push(await tools.update_existing_profile.handler({}));
  results.push(await tools.open_web.handler({ open: false }));
  release();
  const register = Object.fromEntries(makeRegisterTools({ lang: 'es', checkOnboardingCompleted: async () => false }).map((t) => [t.name, t]));
  results.push(await register.onboarding_interview_start.handler({}));
  const usage = makeAiUsageTool({ signupPhase: () => 'account', scanUsage: () => new Promise(() => {}), loadAuthSession: () => null, sessionStatus: () => 'none', recordConsent: () => {} });
  results.push(await usage.handler({ lang: 'es' }));
  const text = JSON.stringify(results).replace(/https?:\/\/[^"\s]+/g, '<url>');
  assert.doesNotMatch(text, OUT_OF_CHARACTER);
});

test('legal texts: the draft step carries the data notice verbatim, before its question', async () => {
  const { tools } = signupHarness();
  await tools.signup_start.handler({ language: 'es' });
  const r = await tools.signup_draft.handler(DRAFT);
  assert.equal(r.relayVerbatim[1], needle(legalCopy('es').signupNotice));
  assert.match(r.message, /word for word, each as its own block/);
});

test('legal texts: the two AI-usage disclaimers come right before the AI-usage question, never in the welcome', async () => {
  const { tools } = signupHarness();
  const welcome = await tools.signup_start.handler({ language: 'es' });
  assert.doesNotMatch(JSON.stringify(welcome), new RegExp(legalCopy('es').usageInfoAccessed.slice(0, 30)));
  fixSignupLanguage('es');
  const usage = makeAiUsageTool({ signupPhase: () => 'account', recordConsent: () => {} });
  const chat = await usage.handler({});
  assert.deepEqual(chat.relayVerbatim, [legalCopy('es').usageInfoAccessed, legalCopy('es').usageGoalDuration]);
  assert.equal(chat.question, needle(ES.aiUsageQuestion));
  assert.deepEqual(chat.options, [ES.aiUsageYes, ES.aiUsageSkip]);
  const dialog = await usage.handler({}, { elicitation: true, elicit: async () => null });
  assert.deepEqual(dialog.relayVerbatim, chat.relayVerbatim, 'the dialog path shows the disclaimers first too');
  assert.equal(dialog.question, undefined);
});

test('legal texts: the interview disclaimers come back in the talent\'s language before the interview can start', async () => {
  fixSignupLanguage('pt');
  const register = Object.fromEntries(makeRegisterTools({ lang: 'es', checkOnboardingCompleted: async () => false, }).map((t) => [t.name, t]));
  const r = await register.onboarding_interview_start.handler({ where: 'here' });
  assert.equal(r.reason, 'disclaimers-not-acknowledged');
  assert.deepEqual(r.relayVerbatim, [legalCopy('pt').interviewInfoAccessed, legalCopy('pt').interviewGoalDuration]);
});

test('window warning: signup_create_account answers at once and the browser opens about 4 s later, so the text is read first', async () => {
  const { tools, calls, release } = signupHarness();
  const r = await toWindow(tools);
  assert.equal(r.ok, true);
  assert.deepEqual(calls.opened, [], 'nothing pops up while the AI is still writing');
  assert.ok(calls.sleeps.includes(4000));
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls.opened, ['http://127.0.0.1:5555/']);
});

test('the LinkedIn opener waits the same few seconds and is not part of the default path', async () => {
  const { tools, calls, release } = signupHarness();
  const start = await tools.signup_start.handler({ language: 'es', answer: ES.cvSearch });
  assert.match(start.message, /only if they say they do not know where to find it/);
  const r = tools.open_linkedin_profile.handler({});
  assert.equal(r.ok, true);
  assert.deepEqual(calls.opened, []);
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls.opened, ['https://www.linkedin.com/in/me/']);
});

test('ai_usage in the sign-up: refused while the window is open, so nothing is scanned before the account and the talent\'s yes', async () => {
  let scanned = 0;
  const usage = makeAiUsageTool({ signupPhase: () => 'waiting', scanUsage: async () => { scanned += 1; return {}; }, recordConsent: () => {} });
  const r = await usage.handler({ consent: { granted: true }, repoScope: { mode: 'all' } });
  assert.equal(r.reason, 'account-pending');
  assert.equal(scanned, 0);
});
