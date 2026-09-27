import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket from 'ws';
import { createSantaServer, resolveConfig } from '../server.js';

const quietLog = { info() {}, warn() {}, error() {} };
let server;
let base;

before(async () => {
  server = createSantaServer(resolveConfig({ SANTA_BACKEND: 'mock', SANTA_ACCESS_CODE: 'jingle', MAX_SESSIONS: '1' }), { log: quietLog });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `127.0.0.1:${server.address().port}`;
});

after(() => {
  server.closeAllConnections();
  server.close();
});

function open({ origin = `http://${base}` } = {}) {
  const ws = new WebSocket(`ws://${base}/ws/call`, { origin });
  const messages = [];
  const audio = [];
  const closed = once(ws, 'close');
  ws.on('message', (data, isBinary) => (isBinary ? audio.push(data) : messages.push(JSON.parse(data.toString()))));
  const waitFor = async (pred, ms = 4000) => {
    const start = Date.now();
    while (Date.now() - start < ms) {
      const hit = messages.find(pred);
      if (hit) return hit;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`timed out; got ${JSON.stringify(messages)}`);
  };
  const spoken = (from = 0) => messages.slice(from).filter((m) => m.type === 'transcript').map((m) => m.text).join('');
  return { ws, messages, audio, waitFor, closed, spoken };
}

const profile = {
  mode: 'classroom',
  groupName: 'Room 12',
  children: [{ name: 'Emma', facts: 'loves dinosaurs' }],
};

test('config endpoint reports demo mode and access code requirement', async () => {
  const res = await fetch(`http://${base}/api/config`);
  assert.deepEqual(await res.json(), { backend: 'mock', model: null, needsAccessCode: true, avatar: 'illustrated' });
});

test('serves the app and shared modules but not files outside them', async () => {
  const home = await fetch(`http://${base}/`);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /Call Santa/);
  const shared = await fetch(`http://${base}/shared/santa-prompt.js`);
  assert.equal(shared.status, 200);
  assert.match(shared.headers.get('content-type'), /javascript/);
  for (const path of ['/..%2fserver.js', '/shared/..%2f..%2fpackage.json', '/%2e%2e/.env']) {
    const res = await fetch(`http://${base}${path}`);
    assert.ok([403, 404].includes(res.status), `${path} -> ${res.status}`);
  }
});

test('rejects calls from other websites', async () => {
  const ws = new WebSocket(`ws://${base}/ws/call`, { origin: 'https://evil.example' });
  const [err] = await once(ws, 'error');
  assert.match(err.message, /403/);
});

test('rejects a wrong access code', async () => {
  const c = open();
  await once(c.ws, 'open');
  c.ws.send(JSON.stringify({ type: 'start', profile, accessCode: 'nope' }));
  const err = await c.waitFor((m) => m.type === 'error');
  assert.match(err.message, /access code/);
  await c.closed;
});

test('a demo call greets, streams audio, follows helper hints, and hangs up', async () => {
  const c = open();
  await once(c.ws, 'open');
  c.ws.send(JSON.stringify({ type: 'start', profile, accessCode: 'jingle' }));
  await c.waitFor((m) => m.type === 'status' && m.state === 'live');
  await c.waitFor((m) => m.type === 'turnComplete', 8000);
  assert.match(c.spoken(), /Merry Christmas, Room 12!/);
  assert.ok(c.audio.length > 5, 'received streamed audio');
  assert.equal(c.audio[0].length % 2, 0, '16-bit samples');

  // Only one call allowed at a time in this config.
  const other = open();
  await once(other.ws, 'open');
  other.ws.send(JSON.stringify({ type: 'start', profile, accessCode: 'jingle' }));
  const busy = await other.waitFor((m) => m.type === 'error');
  assert.match(busy.message, /too many calls/);

  const before = c.messages.length;
  c.ws.send(JSON.stringify({ type: 'hint', text: 'Emma is stepping up to talk to you now.' }));
  await c.waitFor((m) => m.type === 'turnComplete' && c.messages.indexOf(m) >= before, 8000);
  assert.match(c.spoken(before), /Well hello there, Emma!/);
  assert.match(c.spoken(before), /loves dinosaurs/);

  c.ws.send(JSON.stringify({ type: 'end' }));
  const ended = await c.waitFor((m) => m.type === 'ended');
  assert.equal(ended.reason, 'hung-up');
  await c.closed;
});

test('photoreal endpoints are off unless an Anam avatar is configured', async () => {
  const cfg = await (await fetch(`http://${base}/api/config`)).json();
  assert.equal(cfg.avatar, 'illustrated');
  const res = await fetch(`http://${base}/api/avatar-session`, {
    method: 'POST',
    headers: { Origin: `http://${base}` },
    body: '{}',
  });
  assert.equal(res.status, 404);
});

test('SANTA_AVATAR=anam requires its keys', () => {
  assert.throws(() => resolveConfig({ SANTA_AVATAR: 'anam' }), /ANAM_API_KEY/);
  assert.equal(resolveConfig({ ANAM_API_KEY: 'k', ANAM_AVATAR_ID: 'a' }).avatar, 'anam');
  assert.equal(resolveConfig({ ANAM_API_KEY: 'k', ANAM_AVATAR_ID: 'a', SANTA_AVATAR: 'illustrated' }).avatar, 'illustrated');
});

test('avatar sessions are minted server-side and guarded like calls', async () => {
  const calls = [];
  let upstreamOk = true;
  const fakeFetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization });
    return upstreamOk
      ? { ok: true, status: 200, json: async () => ({ sessionToken: 'anam-token' }) }
      : { ok: false, status: 500, text: async () => 'boom' };
  };
  const srv = createSantaServer(
    resolveConfig({ SANTA_BACKEND: 'mock', SANTA_ACCESS_CODE: 'jingle', ANAM_API_KEY: 'secret', ANAM_AVATAR_ID: 'santa-1', MAX_CALL_MINUTES: '20' }),
    { log: quietLog, fetch: fakeFetch },
  );
  srv.listen(0, '127.0.0.1');
  await once(srv, 'listening');
  const host = `127.0.0.1:${srv.address().port}`;
  const post = (body, origin = `http://${host}`) =>
    fetch(`http://${host}/api/avatar-session`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  try {
    assert.equal((await (await fetch(`http://${host}/api/config`)).json()).avatar, 'anam');

    const good = await post({ accessCode: 'jingle' });
    assert.equal(good.status, 200);
    assert.deepEqual(await good.json(), { provider: 'anam', sessionToken: 'anam-token' });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].auth, 'Bearer secret');
    assert.equal(calls[0].body.personaConfig.avatarId, 'santa-1');
    assert.equal(calls[0].body.personaConfig.enableAudioPassthrough, true);
    assert.equal(calls[0].body.personaConfig.maxSessionLengthSeconds, 1200);

    assert.equal((await post({ accessCode: 'nope' })).status, 401);
    assert.equal((await post({ accessCode: 'jingle' }, 'https://evil.example')).status, 403);
    assert.equal(calls.length, 1, 'rejected requests never reach Anam');

    upstreamOk = false;
    const failed = await post({ accessCode: 'jingle' });
    assert.equal(failed.status, 502);
    assert.doesNotMatch(JSON.stringify(await failed.json()), /boom|secret/);

    const sdk = await fetch(`http://${host}/vendor/anam.js`);
    assert.equal(sdk.status, 200);
    assert.match(sdk.headers.get('content-type'), /javascript/);
    assert.match(await sdk.text(), /anam/);
  } finally {
    srv.closeAllConnections();
    srv.close();
  }
});
