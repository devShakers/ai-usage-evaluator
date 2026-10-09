'use strict';

// Closed questions of the MCP sign-up: a dialog when the client can elicit, otherwise one block the model prints, question last.

const SAY_MESSAGE = 'Print `say` word for word as your whole reply: it already holds the texts, the question and its numbered options. Add nothing of your own and call no tool until the talent answers.';

// Fixed texts that are not a question ride on the next question block: a model skips a standalone relay.
const notices = [];

function queueNotice(text) {
  if (text && !notices.includes(text)) notices.push(text);
}

function takeNotices() {
  return notices.splice(0);
}

// Fixed texts travel with their question, so a model that skips "show this first" still shows them.
function sayBlock(texts, question, options) {
  return [...texts, question, options.map((o, i) => `${i + 1}. ${o}`).join('\n')].join('\n\n');
}

function chatChoice(question, options, texts = []) {
  return { say: sayBlock([...takeNotices(), ...texts], question, options), options, choiceMessage: SAY_MESSAGE };
}

// The option an answer names, by its text or by its number in the printed list.
function optionFor(answer, options) {
  if (typeof answer !== 'string') return null;
  const text = answer.trim();
  if (options.includes(text)) return text;
  const n = /^\d+$/.test(text) ? Number(text) : 0;
  return n >= 1 && n <= options.length ? options[n - 1] : null;
}

// { answer } from the dialog, { dismissed: <action> } when the talent closed it, or { chat } when there is no dialog.
async function askChoice(ctx, { texts: own = [], question, options }) {
  const texts = [...takeNotices(), ...own];
  const elicit = ctx && typeof ctx.elicit === 'function' ? ctx.elicit : null;
  const reply = elicit
    ? await elicit({
      message: [...texts, question].join('\n\n'),
      requestedSchema: { type: 'object', properties: { choice: { type: 'string', title: question, enum: options } }, required: ['choice'] },
    })
    : null;
  if (!reply) return { chat: chatChoice(question, options, texts) };
  const choice = reply.action === 'accept' && reply.content ? reply.content.choice : undefined;
  if (options.includes(choice)) return { answer: choice };
  return { dismissed: reply.action, chat: chatChoice(question, options, texts) };
}

// A closed question after fixed texts: the chat answer the model passed back, else the dialog, else the block to print.
async function askAfterTexts(ctx, { tool, texts, question, options, answer }) {
  const picked = optionFor(answer, options);
  if (picked) return { answer: picked };
  const asked = ctx && ctx.elicitation ? await askChoice(ctx, { texts, question, options }) : { chat: chatChoice(question, options, texts) };
  if (asked.answer) return { answer: asked.answer };
  return {
    reply: {
      ok: false,
      reason: 'answer-required',
      ...(asked.dismissed ? { dismissed: asked.dismissed } : {}),
      ...asked.chat,
      message: `${asked.chat.choiceMessage} Then call ${tool} again with answer set to the option they pick.`,
    },
  };
}

module.exports = { askChoice, askAfterTexts, chatChoice, optionFor, queueNotice, takeNotices, SAY_MESSAGE };
