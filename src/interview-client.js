'use strict';

// InterviewClient — the TEXT-over-LiveKit transport for a turn-based interview.

const CHAT_TOPIC = 'lk.chat';
// The agent's own protocol channel; it announces the end there with `interview-complete`.
const PROTOCOL_TOPIC = 'interview-protocol';
const DEFAULT_TURN_TIMEOUT_MS = 90000;
// A message is held this long before it is shown, so an `interview-complete`
// sent right after the goodbye marks it as the last one instead of prompting
// the Talent to answer a farewell.
const DEFAULT_SETTLE_MS = 400;

class LiveKitNotInstalledError extends Error {
  constructor(cause) {
    super('The optional @livekit/rtc-node package is not installed');
    this.name = 'LiveKitNotInstalledError';
    this.kind = 'livekit-not-installed';
    this.cause = cause || null;
  }
}

// Mute rtc-node's pino logger ("lk-rtc").
function silenceLiveKitLogger() {
  try {
    const path = require('path');
    const logPath = path.join(path.dirname(require.resolve('@livekit/rtc-node')), 'log.cjs');
    const logModule = require(logPath);
    if (logModule && logModule.log) logModule.log.level = 'silent';
  } catch {}
}

// The ONLY place the native package is required.
function loadLiveKitSdk() {
  try {
    // eslint-disable-next-line global-require
    const sdk = require('@livekit/rtc-node');
    silenceLiveKitLogger();
    return sdk;
  } catch (e) {
    throw new LiveKitNotInstalledError(e);
  }
}

class InterviewClient {
  constructor({ topic = CHAT_TOPIC, turnTimeoutMs = DEFAULT_TURN_TIMEOUT_MS, sdk = null, isClosing = null, settleMs = DEFAULT_SETTLE_MS } = {}) {
    this._topic = topic;
    this._turnTimeoutMs = turnTimeoutMs;
    this._sdk = sdk; // injectable; null => lazy-require the native SDK at connect()
    this._isClosing = typeof isClosing === 'function' ? isClosing : null;
    this._room = null;
    this._queue = []; // completed agent messages waiting to be delivered
    this._waiter = null; // { resolve, timer } for a pending receiveTurn()
    this._disconnected = false;
    this._connected = false;
    this._settleMs = settleMs;
    this._settling = 0; // messages still inside their settle window
    this._ended = false; // the agent said the interview is over
  }

  get connected() {
    return this._connected;
  }

  // Join the room.
  async connect(livekitUrl, token, opts = {}) {
    if (this._connected) throw new Error('already-connected');
    if (!livekitUrl || !token) throw new Error('missing-credentials');
    // A client reused after disconnect() starts clean, not already ended.
    this._ended = false;
    this._disconnected = false;
    this._settling = 0;
    this._queue = [];

    const sdk = this._sdk || loadLiveKitSdk();
    this._sdk = sdk;
    const { Room, RoomEvent } = sdk;
    const room = new Room();
    this._room = room;

    if (typeof room.registerTextStreamHandler !== 'function') {
      // Text streams landed in @livekit/rtc-node ~0.13; older builds cannot carry lk.chat.
      throw Object.assign(new Error('installed @livekit/rtc-node is too old for text streams'), { kind: 'livekit-no-text-streams' });
    }

    room.registerTextStreamHandler(this._topic, (reader) => {
      // Counted as settling from the moment the stream opens, so an end signal that
      // lands while a long goodbye is still being read waits for it.
      this._settling += 1;
      Promise.resolve()
        .then(() => reader.readAll())
        .then((text) => this._settle(String(text == null ? '' : text)))
        // A failed read yields no turn; the loop still ends via the end signal, timeout or Disconnected.
        .catch(() => this._settle(null));
    });

    if (RoomEvent && RoomEvent.Disconnected && typeof room.on === 'function') {
      room.on(RoomEvent.Disconnected, () => this._markDisconnected());
    }

    // The end of the interview is a protocol message, not a sentence: matching the
    // goodbye text never fired (certs sends no closingMessage), so the CLI kept
    // asking for answers until its turn-timeout (new-works, 2026-09-25).
    if (RoomEvent && RoomEvent.DataReceived && typeof room.on === 'function') {
      room.on(RoomEvent.DataReceived, (payload, _participant, _kind, topic) => {
        if (topic !== PROTOCOL_TOPIC) return;
        let message = null;
        try {
          message = JSON.parse(Buffer.from(payload).toString('utf8'));
        } catch {
          return;
        }
        if (message && message.type === 'interview-complete') this._markEnded();
      });
    }

    await room.connect(livekitUrl, token, opts);
    this._connected = true;
    return { ok: true };
  }

  // Resolve the NEXT agent message.
  receiveTurn() {
    return new Promise((resolve, reject) => {
      if (this._queue.length) return resolve(this._deliver(this._queue.shift()));
      if (this._disconnected || (this._ended && this._settling === 0)) return resolve({ text: '', ended: true });
      const timer = setTimeout(() => {
        this._waiter = null;
        reject(Object.assign(new Error('turn-timeout'), { kind: 'turn-timeout' }));
      }, this._turnTimeoutMs);
      this._waiter = { resolve, timer };
    });
  }

  // Send one candidate turn as lk.chat text, then wait for the agent's reply.
  async sendTurn(text) {
    if (!this._connected) throw new Error('not-connected');
    const lp = this._room && this._room.localParticipant;
    if (!lp || typeof lp.sendText !== 'function') throw new Error('no-local-participant');
    await lp.sendText(String(text == null ? '' : text), { topic: this._topic });
    return this.receiveTurn();
  }

  async disconnect() {
    const room = this._room;
    const sdk = this._sdk;
    this._room = null;
    this._connected = false;
    if (this._waiter) {
      const w = this._waiter;
      this._waiter = null;
      clearTimeout(w.timer);
      w.resolve({ text: '', ended: true });
    }
    if (room) {
      try { room.unregisterTextStreamHandler(this._topic); } catch {}
      try { await room.disconnect(); } catch {}
    }
    // The FFI runtime keeps the event loop alive; dispose lets a one-shot CLI exit.
    if (sdk && typeof sdk.dispose === 'function') {
      try { await sdk.dispose(); } catch {}
    }
  }

  _deliver(text) {
    const ended = this._ended || (this._isClosing ? !!this._isClosing(text) : false);
    return { text, ended };
  }

  _settle(text) {
    const done = () => {
      this._settling -= 1;
      if (text !== null) this._release(text);
      else if (this._ended) this._resolveEnded();
    };
    if (this._settleMs > 0) setTimeout(done, this._settleMs);
    else done();
  }

  _resolveEnded() {
    if (this._settling > 0 || !this._waiter || this._queue.length) return;
    const w = this._waiter;
    this._waiter = null;
    clearTimeout(w.timer);
    w.resolve({ text: '', ended: true });
  }

  _release(text) {
    if (this._waiter) {
      const w = this._waiter;
      this._waiter = null;
      clearTimeout(w.timer);
      w.resolve(this._deliver(text));
    } else {
      this._queue.push(text);
    }
  }

  _markEnded() {
    this._ended = true;
    // The goodbye and the end signal travel on different channels and can land in
    // either order: give a goodbye still being read the same window to arrive, so
    // it is shown as the last message instead of being cut off. A message still
    // settling carries `ended` itself when it is released.
    setTimeout(() => this._resolveEnded(), this._settleMs > 0 ? this._settleMs : 0);
  }

  _markDisconnected() {
    this._disconnected = true;
    if (this._waiter && !this._queue.length) {
      const w = this._waiter;
      this._waiter = null;
      clearTimeout(w.timer);
      w.resolve({ text: '', ended: true });
    }
  }
}

module.exports = {
  InterviewClient,
  LiveKitNotInstalledError,
  loadLiveKitSdk,
  CHAT_TOPIC,
  PROTOCOL_TOPIC,
  DEFAULT_TURN_TIMEOUT_MS,
};
