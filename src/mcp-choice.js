'use strict';

// Closed questions of the MCP sign-up: a dialog when the client can elicit, otherwise options the model offers in the chat.

const CHAT_CHOICE_MESSAGE = 'Ask `question` with exactly these `options`, word for word: with your native choice buttons if you have them, otherwise as a short numbered list after the question. Accept the number or the text.';

function chatChoice(question, options) {
  return { question, options, choiceMessage: CHAT_CHOICE_MESSAGE };
}

// { answer } from the dialog, { dismissed: <action> } when the talent closed it, or { chat } when there is no dialog.
async function askChoice(ctx, { question, options }) {
  const elicit = ctx && typeof ctx.elicit === 'function' ? ctx.elicit : null;
  const reply = elicit
    ? await elicit({
      message: question,
      requestedSchema: { type: 'object', properties: { choice: { type: 'string', title: question, enum: options } }, required: ['choice'] },
    })
    : null;
  if (!reply) return { chat: chatChoice(question, options) };
  const choice = reply.action === 'accept' && reply.content ? reply.content.choice : undefined;
  if (options.includes(choice)) return { answer: choice };
  return { dismissed: reply.action, chat: chatChoice(question, options) };
}

// A closed question that follows fixed texts: a chat answer the model passed back, a dialog once the texts are shown, or the texts plus the question for the chat.
async function askAfterTexts(ctx, { tool, texts, question, options, shown, answer }) {
  if (typeof answer === 'string' && options.includes(answer.trim())) return { answer: answer.trim() };
  if (ctx && ctx.elicitation && texts.length && shown !== true) {
    return { reply: { ok: false, reason: 'show-first', relayVerbatim: texts, message: `Show each relayVerbatim text word for word, each as its own block, with nothing of your own before or after; then call ${tool} again with shown:true: it asks the question in a dialog.` } };
  }
  const asked = ctx && ctx.elicitation ? await askChoice(ctx, { question, options }) : { chat: chatChoice(question, options) };
  if (asked.answer) return { answer: asked.answer };
  const repeat = shown === true || asked.dismissed;
  return {
    reply: {
      ok: false,
      reason: 'answer-required',
      ...(asked.dismissed ? { dismissed: asked.dismissed } : {}),
      ...(repeat || !texts.length ? {} : { relayVerbatim: texts }),
      ...asked.chat,
      message: `${repeat || !texts.length ? '' : 'Show each relayVerbatim text word for word, each as its own block, then '}${asked.chat.choiceMessage} Then call ${tool} again with answer set to the option they pick.`,
    },
  };
}

module.exports = { askChoice, askAfterTexts, chatChoice, CHAT_CHOICE_MESSAGE };
