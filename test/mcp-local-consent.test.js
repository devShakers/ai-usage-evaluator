'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const { makeRegisterTools } = require('../src/mcp-register-tools');
const { makeOnboardingTools } = require('../src/mcp-onboarding-tools');
const { signupCopy } = require('../src/signup-copy');
const { resetSignupLanguage } = require('../src/signup-language');
const { takeNotices } = require('../src/mcp-choice');

const EN = signupCopy('en').consent;

test.beforeEach(() => { resetSignupLanguage(); takeNotices(); });

// A client with a dialog that answers with the given label (or closes it).
function dialog(reply) {
  const asked = [];
  return { asked, ctx: { elicitation: true, elicit: async (req) => { asked.push(req); return reply; } } };
}

function registerTools() {
  const calls = { search: 0, read: [] };
  const tools = makeRegisterTools({
    lang: 'en',
    readRegisterContextSuggestions: () => { calls.search += 1; return { cvCandidates: [{ path: '~/Documents/cv.pdf', nameMatch: null }] }; },
    readCvText: (file) => { calls.read.push(file); return { ok: true, mentionsTalent: true, links: {}, text: 'Ada' }; },
  });
  return { calls, tools: Object.fromEntries(tools.map((t) => [t.name, t])) };
}

function projectTools(home = os.homedir()) {
  const sent = [];
  const root = path.join(home, 'code', 'my-repo');
  const tools = makeOnboardingTools({
    getPortfoliosDeclareEndpoint: () => 'http://svc/portfolios/declare',
    getPortfoliosListEndpoint: () => null,
    loadAuthSession: () => ({ accessToken: 'A', hubAccessToken: 'H' }),
    sessionStatus: () => 'active',
    requestDeclarePortfolio: async (p) => { sent.push(p); return { ok: true }; },
    getRemoteUrl: () => 'https://github.com/me/my-repo',
    getCommitDateRange: () => ({ startDate: '2025-01-01', endDate: '2025-06-01' }),
    consentCopy: () => EN,
  });
  return { sent, root, add: tools.find((t) => t.name === 'add_project') };
}

test('read_cv: names the file, reads nothing until the talent answers, ignores a yes it never asked for, and reads after yes', async () => {
  const { calls, tools } = registerTools();
  const cv = path.join(os.homedir(), 'Documents', 'cv.pdf');
  const forged = await tools.read_cv.handler({ path: cv, talentConsent: true, answer: EN.yes });
  assert.equal(forged.reason, 'consent-required');
  assert.equal(calls.read.length, 0, 'an AI-set flag or answer is not consent');
  assert.match(forged.say, /Shakers will read the file ~\/Documents\/cv\.pdf to prepare your profile draft\. Nothing is sent yet\. Continue\?/);
  assert.deepEqual(forged.options, [EN.yes, EN.no]);

  const other = await tools.read_cv.handler({ path: path.join(os.homedir(), 'Downloads', 'x.pdf'), answer: EN.yes });
  assert.equal(other.reason, 'consent-required', 'a yes for one file does not open another');
  assert.equal(calls.read.length, 0);

  const r = await tools.read_cv.handler({ path: '~/Documents/cv.pdf', answer: EN.yes });
  assert.equal(r.ok, true);
  assert.deepEqual(calls.read, [cv]);

  const again = await tools.read_cv.handler({ path: cv, answer: EN.yes });
  assert.equal(again.reason, 'consent-required', 'a yes is used once');
});

test('read_cv: a no reads nothing; a dialog yes reads at once', async () => {
  const { calls, tools } = registerTools();
  const cv = path.join(os.homedir(), 'cv-no.pdf');
  await tools.read_cv.handler({ path: cv });
  const no = await tools.read_cv.handler({ path: cv, answer: EN.no });
  assert.equal(no.reason, 'consent-declined');
  assert.equal(calls.read.length, 0);

  const d = dialog({ action: 'accept', content: { choice: EN.yes } });
  const r = await tools.read_cv.handler({ path: cv }, d.ctx);
  assert.equal(r.ok, true);
  assert.match(d.asked[0].message, /cv-no\.pdf/);
  assert.equal(calls.read.length, 1);

  const closed = dialog({ action: 'decline' });
  const back = await tools.read_cv.handler({ path: cv }, closed.ctx);
  assert.equal(back.reason, 'consent-required', 'a closed dialog falls back to the question in the chat');
  assert.equal(calls.read.length, 1);
});

test('suggest_register_context: searches nothing until the talent says yes', async () => {
  const { calls, tools } = registerTools();
  const forged = await tools.suggest_register_context.handler({ answer: EN.yes });
  assert.equal(forged.reason, 'consent-required');
  assert.equal(calls.search, 0);
  assert.match(forged.say, /Desktop, Documents, Downloads and iCloud Drive/);
  const no = await tools.suggest_register_context.handler({ answer: EN.no });
  assert.equal(no.reason, 'consent-declined');
  assert.equal(calls.search, 0);
  await tools.suggest_register_context.handler({});
  const r = await tools.suggest_register_context.handler({ answer: EN.yes });
  assert.equal(r.ok, true);
  assert.equal(calls.search, 1);
});

test('add_project: names folder, web address and dates, sends nothing before the answer, and sends after yes', async () => {
  const { sent, root, add } = projectTools();
  const asked = await add.handler({ root });
  assert.equal(asked.reason, 'consent-required');
  assert.equal(sent.length, 0);
  assert.match(asked.say, /Shakers will add the project in the folder ~\/code\/my-repo to your portfolio and send the name "my-repo", the web address https:\/\/github\.com\/me\/my-repo and the dates 2025-01-01 to 2025-06-01\. Continue\?/);

  const changed = await add.handler({ root, url: 'https://evil.test/x', answer: EN.yes });
  assert.equal(changed.reason, 'consent-required', 'a yes covers only what the question named');
  assert.equal(sent.length, 0);

  await add.handler({ root });
  const no = await add.handler({ root, answer: EN.no });
  assert.equal(no.reason, 'consent-declined');
  assert.equal(sent.length, 0);

  await add.handler({ root });
  const r = await add.handler({ root, answer: EN.yes });
  assert.deepEqual(r, { ok: true, name: 'my-repo', type: 'PORTFOLIO' });
  assert.equal(sent[0].url, 'https://github.com/me/my-repo');
});
