'use strict';

const { palette } = require('./ansi');
const { BRAND_ANSI } = require('./brand-ansi');
const { promptSelect } = require('./prompt-select');
const { renderMarkdown } = require('./markdown-ansi');
const { typeOut } = require('./typewriter');
const { firstNameFromSession } = require('./auth-session-store');
const { oneTurn, makeAlmaDeps, EXIT_WORDS } = require('./alma-flow');

const BOLT = '⚡';

const BANNER = [
  '███████╗██╗  ██╗ █████╗ ██╗  ██╗███████╗██████╗ ███████╗',
  '██╔════╝██║  ██║██╔══██╗██║ ██╔╝██╔════╝██╔══██╗██╔════╝',
  '███████╗███████║███████║█████╔╝ █████╗  ██████╔╝███████╗',
  '╚════██║██╔══██║██╔══██║██╔═██╗ ██╔══╝  ██╔══██╗╚════██║',
  '███████║██║  ██║██║  ██║██║  ██╗███████╗██║  ██║███████║',
  '╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝╚══════╝',
];

function brandColors() {
  return palette({
    primary: BRAND_ANSI.primary,
    accent: BRAND_ANSI.accent,
    muted: BRAND_ANSI.muted,
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    reset: '\x1b[0m',
  });
}

function brandHeader(catalog, out) {
  const C = brandColors();
  const a = catalog.alma;
  out('\n');
  BANNER.forEach((line, idx) => {
    if (idx === 0) out(`  ${C.accent}${C.bold}${BOLT}${C.reset} ${C.primary}${C.bold}${line}${C.reset}\n`);
    else out(`    ${C.primary}${C.bold}${line}${C.reset}\n`);
  });
  out(`    ${C.accent}${C.bold}${a.title}${C.reset}  ${C.dim}· ${a.tagline}${C.reset}\n`);
  out(`    ${C.dim}${a.replHint}${C.reset}\n`);
}

function userPrompt(catalog, session) {
  const C = palette({ primary: BRAND_ANSI.primary, reset: '\x1b[0m' });
  const first = firstNameFromSession(session);
  const label = first ? `${first}:` : catalog.alma.prompt;
  return `${C.primary}${BOLT}${C.reset} ${label}`;
}

function displayWidth(s) {
  let w = 0;
  for (const ch of s) w += ch === BOLT ? 2 : 1;
  return w;
}

async function printAlmaReply(res, catalog, write, { streamIsTTY = false, env = null } = {}) {
  if (!res || !res.ok) return;
  const body = String(res.text || '').trim();
  if (!body) return;
  const C = brandColors();
  const label = `${C.accent}${C.bold}${BOLT} ${catalog.alma.title}:${C.reset}`;
  const pad = ' '.repeat(displayWidth(`  ${BOLT} ${catalog.alma.title}: `));
  const lines = renderMarkdown(body).split('\n');
  let block = `\n  ${label} ${lines[0]}\n`;
  for (let i = 1; i < lines.length; i++) block += lines[i] ? `${pad}${lines[i]}\n` : '\n';
  const animate = !!streamIsTTY && !(env && env.NO_ANIMATION);
  const outStream = { write: (s) => { write(s); return true; }, isTTY: animate };
  await typeOut(block, { stream: outStream });
}

async function almaTurn({ io, ask, stdinIsTTY, streamIsTTY, env, write, hubAccessToken, catalog, deps, message }) {
  const a = catalog.alma;
  const C = brandColors();
  const dimNote = (text) => write(`  ${C.dim}${text}${C.reset}\n`);

  let pending = null;
  const links = [];
  const capture = (evt) => {
    if (!evt) return;
    if (evt.type === 'confirmation_required') pending = { text: evt.text || '', detail: evt.detail || '', data: evt.data || {} };
    else if (evt.type === 'link' && evt.data && evt.data.to) links.push(String(evt.data.to));
  };

  const res = await oneTurn({ io, hubAccessToken, message, catalog: { ask: a }, deps, onStreamEvent: capture });
  await printAlmaReply(res, catalog, write, { streamIsTTY, env });
  for (const to of links) dimNote(a.webLink(to));
  if (!res.ok || !pending) return res;

  if (pending.text) write(`\n  ${renderMarkdown(pending.text)}\n`);
  if (pending.detail) io.warn(a.irreversible);
  if (pending.data && pending.data.to) dimNote(a.webLink(pending.data.to));

  const choice = await promptSelect({
    ask,
    stdinIsTTY,
    out: (line) => write(`  ${line}\n`),
    header: a.confirmPrompt,
    items: [{ id: 'yes', label: a.confirmYes }, { id: 'no', label: a.confirmNo }],
    labelFor: (it) => it.label,
  });
  const approved = !!(choice && choice.id === 'yes');

  const dres = await oneTurn({
    io,
    hubAccessToken,
    message: null,
    catalog: { ask: a },
    deps,
    sendTurn: ({ onEvent }) => deps.decideAlma({ hubAccessToken, approved, onEvent }),
  });
  await printAlmaReply(dres, catalog, write, { streamIsTTY, env });
  return res;
}

async function runAlmaShell({ io, ask, stdinIsTTY, streamIsTTY, env = process.env, rawOut, session, catalog, deps = makeAlmaDeps() }) {
  const a = catalog.alma;
  const write = rawOut || ((s) => process.stdout.write(s));
  const hubAccessToken = session ? session.hubAccessToken : null;

  brandHeader(catalog, write);

  // Collect the (code-free) project map ONCE, then ask consent before ever sending
  // it — privacy gate. Declining (or no TTY to ask) sends every turn without context.
  const ctxBlock = deps.collectContextBlock
    ? deps.collectContextBlock({ status: (fn) => (deps.withStatus ? deps.withStatus(a.contextLabel, fn) : fn()) })
    : '';
  const readLine = typeof ask === 'function' ? ask : (p) => io.ask(p);

  let ctxConsent = false;
  if (ctxBlock && stdinIsTTY) {
    const choice = await promptSelect({
      ask: readLine,
      stdinIsTTY,
      out: (line) => write(`  ${line}\n`),
      header: a.contextConsentHeader,
      hint: a.contextConsentHint,
      items: [{ id: 'yes', label: a.contextConsentYes }, { id: 'no', label: a.contextConsentNo }],
      labelFor: (it) => it.label,
    });
    ctxConsent = !!(choice && choice.id === 'yes');
    if (!ctxConsent) io.notify(a.contextConsentDeclined);
  }
  const withCtx = (msg) => (ctxConsent && ctxBlock ? `${ctxBlock}\n\n${msg}` : msg);
  const prompt = userPrompt(catalog, session);
  let first = true;
  for (;;) {
    const line = (await readLine(prompt)).trim();
    if (!line || EXIT_WORDS.has(line.toLowerCase())) {
      io.notify(a.bye);
      break;
    }
    const message = first ? withCtx(line) : line;
    first = false;
    await almaTurn({ io, ask, stdinIsTTY, streamIsTTY, env, write, hubAccessToken, catalog, deps, message });
  }
  return { ok: true };
}

module.exports = { runAlmaShell, almaTurn, printAlmaReply, brandHeader, userPrompt };
