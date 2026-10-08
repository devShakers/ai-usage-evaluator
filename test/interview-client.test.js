'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { InterviewClient, LiveKitNotInstalledError, loadLiveKitSdk } = require('../src/interview-client');

const RoomEvent = { Disconnected: 'disconnected', ParticipantDisconnected: 'participantDisconnected', DataReceived: 'dataReceived' };

function makeFakeSdk() {
  const state = { handlers: {}, listeners: {}, sent: [], connected: false, disposed: false, connectArgs: null };
  class Room {
    constructor() {
      this.localParticipant = {
        sendText: async (text, opts) => { state.sent.push({ text, opts }); },
      };
    }
    registerTextStreamHandler(topic, cb) { state.handlers[topic] = cb; }
    unregisterTextStreamHandler(topic) { delete state.handlers[topic]; }
    on(evt, cb) { (state.listeners[evt] = state.listeners[evt] || []).push(cb); return this; }
    async connect(url, token, opts) { state.connected = true; state.connectArgs = { url, token, opts }; }
    async disconnect() { state.connected = false; }
  }
  const sdk = { Room, RoomEvent, dispose: async () => { state.disposed = true; } };
  // Test helpers to simulate the agent side.
  const agentSays = (text, { topic = 'lk.chat' } = {}) => {
    const cb = state.handlers[topic];
    if (!cb) throw new Error('no handler registered');
    return cb({ readAll: async () => text, info: { topic } });
  };
  const agentLeaves = () => { (state.listeners[RoomEvent.Disconnected] || []).forEach((cb) => cb()); };
  const agentSignals = (message, topic = 'interview-protocol') => {
    const payload = new TextEncoder().encode(JSON.stringify(message));
    (state.listeners[RoomEvent.DataReceived] || []).forEach((cb) => cb(payload, {}, 0, topic));
  };
  return { sdk, state, agentSays, agentLeaves, agentSignals };
}

test('connect registers a lk.chat handler and forwards url/token', async () => {
  const { sdk, state } = makeFakeSdk();
  const client = new InterviewClient({ sdk });
  const r = await client.connect('wss://lk.example', 'tok123');
  assert.deepEqual(r, { ok: true });
  assert.equal(state.connected, true);
  assert.deepEqual(state.connectArgs, { url: 'wss://lk.example', token: 'tok123', opts: {} });
  assert.equal(typeof state.handlers['lk.chat'], 'function');
});

test('the agent opening line is delivered by the first receiveTurn (greeting-first)', async () => {
  const { sdk, agentSays } = makeFakeSdk();
  const client = new InterviewClient({ sdk });
  await client.connect('wss://x', 't');
  // Agent greets right after join, BEFORE we call receiveTurn -> must be queued.
  await agentSays('Hi, ready to start?');
  const opening = await client.receiveTurn();
  assert.deepEqual(opening, { text: 'Hi, ready to start?', ended: false });
});

test('sendTurn sends candidate text on lk.chat and resolves the agent reply', async () => {
  const { sdk, state, agentSays } = makeFakeSdk();
  const client = new InterviewClient({ sdk });
  await client.connect('wss://x', 't');
  const p = client.sendTurn('my answer');
  // reply arrives after the send
  await agentSays('Next question?');
  const res = await p;
  assert.deepEqual(res, { text: 'Next question?', ended: false });
  assert.deepEqual(state.sent, [{ text: 'my answer', opts: { topic: 'lk.chat' } }]);
});

test('receiveTurn resolves ended:true when the room disconnects (agent left)', async () => {
  const { sdk, agentLeaves } = makeFakeSdk();
  const client = new InterviewClient({ sdk });
  await client.connect('wss://x', 't');
  const p = client.receiveTurn();
  agentLeaves();
  assert.deepEqual(await p, { text: '', ended: true });
});

test('a queued closing message ends the turn via the isClosing predicate', async () => {
  const { sdk, agentSays } = makeFakeSdk();
  const client = new InterviewClient({ sdk, isClosing: (t) => t.includes('Thanks, all done') });
  await client.connect('wss://x', 't');
  const p = client.sendTurn('bye');
  await agentSays('Thanks, all done. Your profile is ready.');
  assert.deepEqual(await p, { text: 'Thanks, all done. Your profile is ready.', ended: true });
});

test('receiveTurn rejects with turn-timeout when nothing arrives', async () => {
  const { sdk } = makeFakeSdk();
  const client = new InterviewClient({ sdk, turnTimeoutMs: 20 });
  await client.connect('wss://x', 't');
  await assert.rejects(() => client.receiveTurn(), (e) => e.kind === 'turn-timeout');
});

test('disconnect tears down the room and disposes the FFI runtime', async () => {
  const { sdk, state } = makeFakeSdk();
  const client = new InterviewClient({ sdk });
  await client.connect('wss://x', 't');
  await client.disconnect();
  assert.equal(state.connected, false);
  assert.equal(state.disposed, true);
  assert.equal(client.connected, false);
});

test('connect throws on missing credentials without touching the SDK', async () => {
  const { sdk, state } = makeFakeSdk();
  const client = new InterviewClient({ sdk });
  await assert.rejects(() => client.connect('', ''), /missing-credentials/);
  assert.equal(state.connected, false);
});

test('a too-old SDK (no registerTextStreamHandler) is rejected with livekit-no-text-streams', async () => {
  class OldRoom { constructor() { this.localParticipant = {}; } async connect() {} async disconnect() {} on() { return this; } }
  const sdk = { Room: OldRoom, RoomEvent };
  const client = new InterviewClient({ sdk });
  await assert.rejects(() => client.connect('wss://x', 't'), (e) => e.kind === 'livekit-no-text-streams');
});

test('loadLiveKitSdk throws a typed LiveKitNotInstalledError when the package is absent', () => {
  // @livekit/rtc-node is not installed in the zero-dep repo/sandbox.
  let threw = null;
  try { loadLiveKitSdk(); } catch (e) { threw = e; }
  // If a machine DOES have it installed, this test is a no-op assertion.
  if (threw) {
    assert.ok(threw instanceof LiveKitNotInstalledError);
    assert.equal(threw.kind, 'livekit-not-installed');
  } else {
    assert.ok(true, '@livekit/rtc-node happens to be installed here; loader returned it');
  }
});

test('interview-complete on the protocol topic ends a pending turn', async () => {
  const { sdk, agentSignals } = makeFakeSdk();
  const client = new InterviewClient({ sdk, settleMs: 0 });
  await client.connect('wss://lk.example', 'tok');
  const turn = client.receiveTurn();
  agentSignals({ type: 'interview-complete', reason: 'end_call', transcript: [] });
  assert.deepEqual(await turn, { text: '', ended: true });
});

test('a goodbye followed by interview-complete arrives as the last turn', async () => {
  const { sdk, agentSays, agentSignals } = makeFakeSdk();
  const client = new InterviewClient({ sdk, settleMs: 50 });
  await client.connect('wss://lk.example', 'tok');
  const turn = client.receiveTurn();
  await agentSays('Gracias, con esto tengo lo que necesitaba.');
  agentSignals({ type: 'interview-complete', reason: 'end_call', transcript: [] });
  assert.deepEqual(await turn, { text: 'Gracias, con esto tengo lo que necesitaba.', ended: true });
});

test('other protocol messages do not end the interview', async () => {
  const { sdk, agentSays, agentSignals } = makeFakeSdk();
  const client = new InterviewClient({ sdk, settleMs: 0 });
  await client.connect('wss://lk.example', 'tok');
  agentSignals({ type: 'transcript-update', message: {} });
  agentSignals({ type: 'interview-complete' }, 'lk.chat');
  const turn = client.receiveTurn();
  await agentSays('¿Y qué más?');
  assert.deepEqual(await turn, { text: '¿Y qué más?', ended: false });
});

test('a goodbye still being read when interview-complete lands is not cut off', async () => {
  const { sdk, state, agentSignals } = makeFakeSdk();
  const client = new InterviewClient({ sdk, settleMs: 5 });
  await client.connect('wss://x', 't');
  let finishRead;
  state.handlers['lk.chat']({ readAll: () => new Promise((r) => { finishRead = r; }), info: { topic: 'lk.chat' } });
  const turn = client.receiveTurn();
  agentSignals({ type: 'interview-complete' });
  await new Promise((r) => setTimeout(r, 30));
  finishRead('Gracias, con esto tengo lo que necesitaba.');
  assert.deepEqual(await turn, { text: 'Gracias, con esto tengo lo que necesitaba.', ended: true });
});

test('a client reused after disconnect does not start already ended', async () => {
  const { sdk, agentSignals, agentSays } = makeFakeSdk();
  const client = new InterviewClient({ sdk, settleMs: 0 });
  await client.connect('wss://x', 't');
  agentSignals({ type: 'interview-complete' });
  await client.disconnect();
  await client.connect('wss://x', 't2');
  await agentSays('Hola de nuevo');
  assert.deepEqual(await client.receiveTurn(), { text: 'Hola de nuevo', ended: false });
});
