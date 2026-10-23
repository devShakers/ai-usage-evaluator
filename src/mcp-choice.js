'use strict';

const { signupCopy, legalCopy, termsText } = require('./signup-copy');
const { CHOICE_RULE, QUESTION_RULE, OPEN_RULE, nextSayRule } = require('./mcp-instructions');

// Closed questions of the MCP sign-up: a dialog when the client can elicit; otherwise a step whose text the model
// already wrote (handed over one answer earlier as `nextSay`) goes to the chat's question tool as `question` and
// `options`, and a step whose text only exists now hands it over whole as `say`, the question and its options numbered
// at its end, and the talent answers by typing.

const CHOICE_MESSAGE = CHOICE_RULE;
const QUESTION_ONLY_MESSAGE = `${QUESTION_RULE} Call no other tool until the talent answers, and pass back the option they pick (or what they type).`;
const OPEN_MESSAGE = OPEN_RULE;

// Fixed texts that are not a question ride on the next question block: a model skips a standalone relay.
const notices = [];

function queueNotice(text) {
  if (text && !notices.includes(text)) notices.push(text);
}

function takeNotices() {
  return notices.splice(0);
}

// Texts handed to the model before the turn whose question they belong to: it writes them first in that turn, before
// any call, the only place a client shows them above its question tool. Each one keeps the question it was handed with
// (`from`) and the picks that lead to it, and counts as written only once the talent made one of those picks.
let handed = [];

function handOver(from, { step, ifAnswer, texts }) {
  const text = texts.join('\n\n');
  handed = [...handed.filter((h) => h.text !== text), { text, from, ifAnswer, picked: false }];
  return { step, ifAnswer, text };
}

// The talent answered `from` with `picked`: a text handed for that pick was written, one for another pick was not.
function settle(from, picked) {
  handed = handed
    .filter((h) => h.from !== from || h.ifAnswer.includes(picked))
    .map((h) => (h.from === from ? { ...h, picked: true } : h));
}

// Whether the model wrote this text at the start of the talent's turn.
function written(text) {
  return handed.some((h) => h.picked && h.text === text);
}

// The next question the model asks closes the turn the handed texts were written in: they cover that question only.
function closeTurn() {
  handed = [];
}

// A reply that hands over the next step's text, with what the model does with it; a list when two answers lead to two texts.
function withNextSay(reply, nextSay) {
  if (!nextSay) return reply;
  if (!Array.isArray(nextSay)) return { ...reply, nextSay, message: `${reply.message} ${nextSayRule(nextSay.ifAnswer)}` };
  const rules = nextSay.map((n, i) => nextSayRule(n.ifAnswer, `nextSay[${i}].text`));
  return { ...reply, nextSay, message: [reply.message, ...rules].join(' ') };
}

const numbered = (items) => items.map((item, i) => `${i + 1}. ${item}`).join('\n');

// What the talent has not read yet goes first, then the question and its options numbered; with `listed`, each option
// is numbered with its own block, the texts after the list follow it and the question comes last. A question whose
// texts the model already wrote goes alone to the question tool.
function chatChoice(question, options, texts = [], listed = null, queued = takeNotices()) {
  const fresh = (blocks) => (blocks.length && written(blocks.join('\n\n')) ? [] : blocks);
  const own = [...new Set([...fresh(queued), ...fresh(texts)])];
  closeTurn();
  if (!own.length && !listed) return { question, options, choiceMessage: QUESTION_ONLY_MESSAGE };
  const body = listed ? [...listed.blocks.map((block, i) => `${i + 1}. ${block}`), ...listed.after, question] : [question, numbered(options)];
  return { say: [...own, ...body].join('\n\n'), choiceMessage: CHOICE_MESSAGE };
}

// What the talent reads or picks from a chat question; its rule travels in the reply's `message`.
const forChat = ({ choiceMessage: _rule, ...chat }) => chat;

// An open question: the step's text ends with what the talent answers by typing, so it is all `say`.
function openQuestion(text) {
  closeTurn();
  return { say: [...takeNotices(), text].join('\n\n'), message: OPEN_MESSAGE };
}

const plain = (text) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const NUMBERED = /^(?:(?:opcion|opcao|opzione|option|numero|number|la|el|the)\s+)?(\d+)(?:\s+(.*))?$/;

// The option an answer names: its label, its number, or the talent's own words when they point at one option only:
// the start of its label, its whole label inside them, or its first word ("si", "no", "backend").
function optionFor(answer, options) {
  if (typeof answer !== 'string') return null;
  if (options.includes(answer.trim())) return answer.trim();
  const said = plain(answer);
  if (!said) return null;
  const labels = options.map(plain);
  const n = NUMBERED.exec(said);
  if (n) {
    const label = labels[Number(n[1]) - 1];
    return label !== undefined && (!n[2] || label.startsWith(n[2])) ? options[Number(n[1]) - 1] : null;
  }
  const first = (text) => text.split(' ')[0];
  const readings = [(l) => l === said, (l) => l.startsWith(`${said} `), (l) => ` ${said} `.includes(` ${l} `), (l) => first(l) === first(said)];
  for (const reads of readings) {
    const hits = options.filter((_, i) => reads(labels[i]));
    if (hits.length) return hits.length === 1 ? hits[0] : null;
  }
  return null;
}

function narrationOf(ctx) {
  return ctx && typeof ctx.narration === 'string' && ctx.narration ? [ctx.narration] : [];
}

// { answer } from the dialog, { dismissed: <action> } when the talent closed it, or { chat } when there is no dialog.
async function askChoice(ctx, { texts: own = [], question, options, listed = null }) {
  const queued = takeNotices();
  const elicit = ctx && typeof ctx.elicit === 'function' ? ctx.elicit : null;
  const reply = elicit
    ? await elicit({
      message: [...narrationOf(ctx), ...queued, ...own, ...(listed ? [...listed.blocks, ...listed.after] : []), question].join('\n\n'),
      requestedSchema: { type: 'object', properties: { choice: { type: 'string', title: question, enum: options } }, required: ['choice'] },
    })
    : null;
  if (!reply) return { chat: chatChoice(question, options, own, listed, queued) };
  const choice = reply.action === 'accept' && reply.content ? reply.content.choice : undefined;
  if (options.includes(choice)) return { answer: choice };
  return { dismissed: reply.action, chat: chatChoice(question, options, own, listed, queued) };
}

// The steps whose text went to the chat, keyed by what their answer decides (`about`, the texts by default): an answer
// counts only after its text was handed over, so the model cannot confirm a draft the talent never read.
const shownTexts = new Set();

// A closed question after fixed texts: the chat answer the model passed back, else the dialog, else the block to print.
async function askAfterTexts(ctx, { tool, texts, question, options, answer, listed = null, about = texts, nextSay = null }) {
  const withText = texts.length > 0 || !!listed;
  const key = JSON.stringify([tool, question, options, about]);
  const picked = withText && !shownTexts.has(key) ? null : optionFor(answer, options);
  if (picked) {
    shownTexts.delete(key);
    settle(key, picked);
    return { answer: picked };
  }
  const asked = ctx && ctx.elicitation ? await askChoice(ctx, { texts, question, options, listed }) : { chat: chatChoice(question, options, texts, listed) };
  if (asked.answer) return { answer: asked.answer };
  if (withText) shownTexts.add(key);
  const reply = {
    ok: false,
    reason: 'answer-required',
    ...(asked.dismissed ? { dismissed: asked.dismissed } : {}),
    ...forChat(asked.chat),
    message: `${asked.chat.choiceMessage} Then call ${tool} again with answer = what the talent answers: the number, the option or their own words.`,
  };
  const handed = Array.isArray(nextSay) ? nextSay.map((n) => handOver(key, n)) : nextSay && handOver(key, nextSay);
  return { reply: nextSay ? withNextSay(reply, handed) : reply };
}

// Questions this process put to the talent in the chat, keyed by exactly what they would allow:
// an answer counts only for a question the tool asked, so a flag the AI sets by itself never does.
const pendingConsent = new Set();

// The talent's yes or no before a tool reads this computer or sends data: { granted } or { reply } to return.
async function askConsent(ctx, { tool, key, texts = [], question, yes, no, answer, field = 'answer' }) {
  const options = [yes, no];
  const picked = pendingConsent.has(key) ? optionFor(answer, options) : null;
  if (picked) {
    pendingConsent.delete(key);
    return { granted: picked === yes };
  }
  const asked = ctx && ctx.elicitation ? await askChoice(ctx, { texts, question, options }) : { chat: chatChoice(question, options, texts) };
  if (asked.answer) return { granted: asked.answer === yes };
  pendingConsent.add(key);
  return {
    reply: {
      ok: false,
      reason: 'consent-required',
      ...(asked.dismissed ? { dismissed: asked.dismissed } : {}),
      ...forChat(asked.chat),
      message: `Nothing was read or sent. ${asked.chat.choiceMessage} Then call ${tool} again with the same arguments and ${field} = what the talent answers: the number, the option or their own words.`,
    },
  };
}

const termsAccepted = new Set();

// The terms block the terms question carries, with its links: the sign-up hands the same text over one answer early.
function registrationTermsText(lang) {
  return termsText(lang, (label, url) => `[${label}](${url})`);
}

async function askRegistrationTerms(ctx, { tool, lang, termsAnswer, newsletterAnswer }) {
  const c = signupCopy(lang);
  if (!termsAccepted.has(tool)) {
    const terms = await askConsent(ctx, {
      tool,
      key: `${tool}:terms`,
      field: 'termsAnswer',
      texts: [registrationTermsText(lang)],
      question: c.termsQuestion,
      yes: c.termsAccept,
      no: c.termsDecline,
      answer: termsAnswer,
    });
    if (terms.reply) return { reply: terms.reply };
    if (!terms.granted) return { declined: true };
    termsAccepted.add(tool);
  }
  const newsletter = legalCopy(lang).newsletter;
  const news = await askConsent(ctx, {
    tool,
    key: `${tool}:newsletter`,
    field: 'newsletterAnswer',
    question: c.newsletterQuestion,
    yes: newsletter,
    no: c.newsletterNo,
    answer: newsletterAnswer,
  });
  if (news.reply) return { reply: news.reply };
  termsAccepted.delete(tool);
  return { newsletterConsent: news.granted };
}

// A new sign-up in the same process starts with nothing queued, shown or asked.
function resetQuestions() {
  takeNotices();
  handed = [];
  shownTexts.clear();
  pendingConsent.clear();
  termsAccepted.clear();
}

module.exports = { askConsent, askChoice, askAfterTexts, askRegistrationTerms, registrationTermsText, narrationOf, chatChoice, forChat, openQuestion, optionFor, queueNotice, takeNotices, handOver, settle, withNextSay, written, resetQuestions, CHOICE_RULE, CHOICE_MESSAGE, QUESTION_ONLY_MESSAGE, OPEN_MESSAGE };
