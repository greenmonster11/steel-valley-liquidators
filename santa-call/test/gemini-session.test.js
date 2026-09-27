import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ActivityHandling } from '@google/genai';
import { GeminiSantaSession, buildLiveConfig } from '../lib/gemini-session.js';
import { STAGE_DIRECTION_PREFIX } from '../shared/santa-prompt.js';

/** A stand-in for GoogleGenAI whose live sessions record what they're sent. */
function fakeAi({ setupBeforeResolve = false } = {}) {
  const connections = [];
  return {
    connections,
    live: {
      async connect({ model, config, callbacks }) {
        const sent = [];
        const conn = {
          model,
          config,
          callbacks,
          sent,
          closed: false,
          sendRealtimeInput: (p) => sent.push(['realtime', p]),
          sendClientContent: (p) => sent.push(['client', p]),
          sendToolResponse: (p) => sent.push(['tool', p]),
          close: () => {
            conn.closed = true;
          },
        };
        connections.push(conn);
        if (setupBeforeResolve) callbacks.onmessage({ setupComplete: {} });
        return conn;
      },
    },
  };
}

function recorder() {
  const json = [];
  const audio = [];
  return { json, audio, emit: { json: (m) => json.push(m), audio: (b) => audio.push(b) } };
}

const quietLog = { info() {}, warn() {}, error() {} };

function makeSession(ai, overrides = {}) {
  const rec = recorder();
  const session = new GeminiSantaSession({
    ai,
    model: 'gemini-3.8-live',
    profile: { mode: 'classroom', groupName: 'Room 12', voice: 'Charon', callMinutes: 10 },
    options: {},
    emit: rec.emit,
    log: quietLog,
    ...overrides,
  });
  return { session, rec };
}

test('buildLiveConfig sets voice, transcription, and turn-taking', () => {
  const handsFree = buildLiveConfig({ voice: 'Charon' }, { allowInterrupt: false });
  assert.equal(handsFree.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName, 'Charon');
  assert.deepEqual(handsFree.inputAudioTranscription, {});
  assert.deepEqual(handsFree.outputAudioTranscription, {});
  assert.equal(handsFree.realtimeInputConfig.automaticActivityDetection.disabled, undefined);
  assert.equal(handsFree.realtimeInputConfig.activityHandling, ActivityHandling.NO_INTERRUPTION);
  assert.equal(handsFree.tools[0].functionDeclarations[0].name, 'notify_grown_up');
  assert.match(handsFree.systemInstruction, /Santa Claus/);

  const ptt = buildLiveConfig({}, { pushToTalk: true });
  assert.equal(ptt.realtimeInputConfig.automaticActivityDetection.disabled, true);
  assert.equal(ptt.realtimeInputConfig.activityHandling, ActivityHandling.START_OF_ACTIVITY_INTERRUPTS);
});

test('greets once setup completes, even if setupComplete beats connect()', async () => {
  for (const setupBeforeResolve of [false, true]) {
    const ai = fakeAi({ setupBeforeResolve });
    const { session, rec } = makeSession(ai);
    await session.start();
    const conn = ai.connections[0];
    if (!setupBeforeResolve) conn.callbacks.onmessage({ setupComplete: {} });

    assert.equal(conn.model, 'gemini-3.8-live');
    const greetings = conn.sent.filter(([kind]) => kind === 'client');
    assert.equal(greetings.length, 1, `greets exactly once (setupBeforeResolve=${setupBeforeResolve})`);
    const text = greetings[0][1].turns[0].parts[0].text;
    assert.ok(text.startsWith(STAGE_DIRECTION_PREFIX));
    assert.deepEqual(rec.json.map((m) => m.state).filter(Boolean), ['connecting', 'live']);
    session.close();
  }
});

test('relays audio both ways and forwards transcripts and interruptions', async () => {
  const ai = fakeAi();
  const { session, rec } = makeSession(ai);
  await session.start();
  const conn = ai.connections[0];

  session.pushAudio(Buffer.from([1, 0, 2, 0]));
  const [, input] = conn.sent.find(([kind, p]) => kind === 'realtime' && p.audio);
  assert.equal(input.audio.mimeType, 'audio/pcm;rate=16000');
  assert.equal(input.audio.data, Buffer.from([1, 0, 2, 0]).toString('base64'));

  conn.callbacks.onmessage({
    serverContent: {
      modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: Buffer.from([9, 9]).toString('base64') } }] },
      outputTranscription: { text: 'Ho ho ho!' },
      inputTranscription: { text: 'Hi Santa' },
    },
  });
  conn.callbacks.onmessage({ serverContent: { interrupted: true } });
  conn.callbacks.onmessage({ serverContent: { turnComplete: true } });

  assert.deepEqual([...rec.audio[0]], [9, 9]);
  assert.deepEqual(
    rec.json.filter((m) => m.type !== 'status'),
    [
      { type: 'transcript', role: 'child', text: 'Hi Santa' },
      { type: 'transcript', role: 'santa', text: 'Ho ho ho!' },
      { type: 'interrupted' },
      { type: 'turnComplete' },
    ],
  );
  session.close();
});

test('notify_grown_up raises an alert and answers the tool call', async () => {
  const ai = fakeAi();
  const { session, rec } = makeSession(ai);
  await session.start();
  const conn = ai.connections[0];

  conn.callbacks.onmessage({
    toolCall: { functionCalls: [{ id: 'c1', name: 'notify_grown_up', args: { child_name: 'Liam', reason: 'Said he is sad because his dog died.' } }] },
  });

  assert.deepEqual(rec.json.at(-1), { type: 'alert', childName: 'Liam', reason: 'Said he is sad because his dog died.' });
  const [, reply] = conn.sent.find(([kind]) => kind === 'tool');
  assert.equal(reply.functionResponses[0].id, 'c1');
  assert.equal(reply.functionResponses[0].name, 'notify_grown_up');
  session.close();
});

test('goAway resumes on a new connection with the latest handle', async () => {
  const ai = fakeAi();
  const { session, rec } = makeSession(ai);
  await session.start();
  const first = ai.connections[0];
  first.callbacks.onmessage({ setupComplete: {} });
  first.callbacks.onmessage({ sessionResumptionUpdate: { resumable: true, newHandle: 'handle-1' } });
  first.callbacks.onmessage({ sessionResumptionUpdate: { resumable: false, newHandle: '' } });
  first.callbacks.onmessage({ goAway: { timeLeft: '5s' } });
  await new Promise((r) => setImmediate(r));

  assert.equal(ai.connections.length, 2);
  assert.ok(first.closed);
  const second = ai.connections[1];
  assert.equal(second.config.sessionResumption.handle, 'handle-1');

  // A late close from the old connection must not end the call.
  first.callbacks.onclose({ code: 1000 });
  second.callbacks.onmessage({ setupComplete: {} });
  assert.ok(!rec.json.some((m) => m.type === 'ended'));
  // No second greeting after resuming.
  assert.equal(second.sent.filter(([kind]) => kind === 'client').length, 0);
  assert.ok(rec.json.some((m) => m.state === 'reconnecting'));

  session.close();
  assert.ok(second.closed);
  assert.equal(rec.json.at(-1).type, 'ended');
});

test('an unexpected close without a resume handle ends the call with a reason', async () => {
  const ai = fakeAi();
  const { session, rec } = makeSession(ai);
  await session.start();
  ai.connections[0].callbacks.onclose({ code: 1007, reason: 'Invalid model' });
  assert.ok(rec.json.some((m) => m.type === 'error' && m.message.includes('Invalid model')));
  assert.equal(rec.json.at(-1).type, 'ended');
  session.pushAudio(Buffer.from([0, 0]));
  assert.equal(ai.connections[0].sent.filter(([, p]) => p.audio).length, 0);
});

test('push-to-talk sends activity signals; hands-free ignores them', async () => {
  const ai = fakeAi();
  const { session } = makeSession(ai, { options: { pushToTalk: true } });
  await session.start();
  session.activityStart();
  session.activityEnd();
  const signals = ai.connections[0].sent.filter(([, p]) => p.activityStart || p.activityEnd);
  assert.equal(signals.length, 2);
  session.close();

  const ai2 = fakeAi();
  const { session: s2 } = makeSession(ai2);
  await s2.start();
  s2.activityStart();
  assert.equal(ai2.connections[0].sent.filter(([, p]) => p.activityStart).length, 0);
  s2.close();
});

test('realtime text mode sends hints as realtime text', async () => {
  const ai = fakeAi();
  const { session } = makeSession(ai, { textMode: 'realtime' });
  await session.start();
  session.sendHint('Emma is next');
  const [, p] = ai.connections[0].sent.find(([kind, x]) => kind === 'realtime' && x.text);
  assert.match(p.text, /Emma is next/);
  session.close();
});
