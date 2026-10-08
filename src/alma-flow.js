'use strict';

const EXIT_WORDS = new Set(['exit', 'quit', 'salir', 'q']);

function makeAlmaDeps(overrides = {}) {
  const client = require('./alma-client');
  return {
    askAlma: (opts) => client.askAlma({}, opts),
    decideAlma: (opts) => client.decideAlma({}, opts),
    startSpinner: (label) => require('./terminal-progress').startSpinner(label),
    collectContextBlock: (o) => require('./alma-repo-context').collectContextBlock(o),
    withStatus: (label, fn) => require('./terminal-progress').withStaticStatus(label, fn),
    ...overrides,
  };
}

async function oneTurn({ io, hubAccessToken, message, catalog, deps, onStreamEvent = null, sendTurn = null }) {
  const fp = catalog.ask;
  const stop = deps.startSpinner ? deps.startSpinner(fp.thinking) : () => {};
  const onEvent = (evt) => { if (typeof onStreamEvent === 'function') onStreamEvent(evt); };
  const call = sendTurn || ((o) => deps.askAlma(o));
  const res = await call({ hubAccessToken, message, onEvent });
  stop();
  if (!res.ok) io.error(fp.failed(res.reason));
  return res;
}

module.exports = {
  makeAlmaDeps,
  oneTurn,
  EXIT_WORDS,
};
