import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAnamSessionToken, SANTA_STYLE } from '../lib/anam.js';

function fakeFetch(response) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : undefined });
    return typeof response === 'function' ? response() : response;
  };
  fn.calls = calls;
  return fn;
}

const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });

test('requests an audio-passthrough session for the Santa avatar', async () => {
  const fetchImpl = fakeFetch(ok({ sessionToken: 'tok-123' }));
  const token = await createAnamSessionToken({ apiKey: 'key', avatarId: 'santa-1', maxSeconds: 1800, fetchImpl });
  assert.equal(token, 'tok-123');
  const [call] = fetchImpl.calls;
  assert.equal(call.url, 'https://api.anam.ai/v1/auth/session-token');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.headers.Authorization, 'Bearer key');
  assert.deepEqual(call.body, {
    personaConfig: {
      avatarId: 'santa-1',
      avatarModel: 'cara-4',
      enableAudioPassthrough: true,
      maxSessionLengthSeconds: 1800,
      directorNotes: { customStylePrompt: SANTA_STYLE, expressivity: 0.55 },
    },
  });
});

test('surfaces Anam errors and malformed responses', async () => {
  const denied = fakeFetch({ ok: false, status: 401, text: async () => 'bad key' });
  await assert.rejects(createAnamSessionToken({ apiKey: 'x', avatarId: 'y', fetchImpl: denied }), /401.*bad key/);
  const empty = fakeFetch(ok({}));
  await assert.rejects(createAnamSessionToken({ apiKey: 'x', avatarId: 'y', fetchImpl: empty }), /no sessionToken/);
});
