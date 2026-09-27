// Photoreal Santa via Anam (https://anam.ai). In "audio passthrough" mode we
// stream Santa's Gemini voice into an Anam avatar, and Anam sends back
// lip-synced video over WebRTC. Anam only ever receives Santa's generated
// voice, never the children's.

export const ANAM_API = 'https://api.anam.ai';

// Baseline performance for Cara 4 avatars ("Director Notes").
export const SANTA_STYLE =
  'A warm, jolly, grandfatherly Santa Claus talking with young children. Twinkling eyes, easy smiles, cheeks that crinkle when he laughs, and attentive little nods while listening. Gentle and calm, never intense or startling.';

/** Mints a short-lived, single-session token the browser uses to stream the avatar. */
export async function createAnamSessionToken({
  apiKey,
  avatarId,
  avatarModel = 'cara-4',
  maxSeconds,
  fetchImpl = fetch,
  apiBase = ANAM_API,
}) {
  const res = await fetchImpl(`${apiBase}/v1/auth/session-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      personaConfig: {
        avatarId,
        avatarModel,
        enableAudioPassthrough: true,
        maxSessionLengthSeconds: maxSeconds,
        directorNotes: { customStylePrompt: SANTA_STYLE, expressivity: 0.55 },
      },
    }),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    throw new Error(`Anam session-token request failed (${res.status}): ${detail}`);
  }
  const data = await res.json();
  if (!data?.sessionToken) throw new Error('Anam session-token response had no sessionToken');
  return data.sessionToken;
}
