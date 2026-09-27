#!/usr/bin/env node
// Turns a Santa portrait into a photoreal Anam avatar and prints the ID to put
// in .env as ANAM_AVATAR_ID.
//
//   node scripts/create-santa-avatar.mjs ./santa.jpg ["Santa Claus"]
//
// Photo tips: square, at least 1152x1152, face in focus looking at the camera,
// hands out of view, .png/.jpg/.webp up to 4.5 MB.

import { openAsBlob, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ANAM_API } from '../lib/anam.js';

try {
  process.loadEnvFile(join(fileURLToPath(new URL('..', import.meta.url)), '.env'));
} catch {
  // No .env; use the real environment.
}

const TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const [file, name = 'Santa Claus'] = process.argv.slice(2);
const apiKey = process.env.ANAM_API_KEY;

function fail(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

if (!file) fail('Usage: node scripts/create-santa-avatar.mjs ./santa.jpg ["Santa Claus"]');
if (!apiKey) fail('Set ANAM_API_KEY in santa-call/.env first (get one at https://lab.anam.ai).');
const type = TYPES[extname(file).toLowerCase()];
if (!type) fail('Use a .png, .jpg, or .webp image.');
if (statSync(file).size > 4.5 * 1024 * 1024) fail('The image must be 4.5 MB or smaller.');

const form = new FormData();
form.append('displayName', name);
form.append('avatarModel', 'cara-4');
form.append('imageFile', await openAsBlob(file, { type }), basename(file));

console.log(`Uploading ${basename(file)} to Anam…`);
const res = await fetch(`${ANAM_API}/v1/avatars`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${apiKey}` },
  body: form,
});
if (!res.ok) fail(`Anam said ${res.status}: ${(await res.text()).slice(0, 400)}`);
const avatar = await res.json();
console.log(`✔ Created avatar ${avatar.id}. Anam is building it now (usually a couple of minutes).`);

// videoUrl stays empty until the avatar is ready.
const ready = (a) => a?.videoUrl && a.videoUrl !== 'null';
let latest = avatar;
for (let i = 0; i < 60 && !ready(latest); i += 1) {
  await new Promise((r) => setTimeout(r, 10000));
  const check = await fetch(`${ANAM_API}/v1/avatars/${encodeURIComponent(avatar.id)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!check.ok) {
    console.log('  (Couldn\'t check progress automatically; see https://lab.anam.ai for status.)');
    break;
  }
  latest = await check.json();
  process.stdout.write('.');
}
if (ready(latest)) console.log(`\n✔ Ready. Preview: ${latest.videoUrl}`);

console.log(`
Add these to santa-call/.env, then restart the server:

  ANAM_API_KEY=…your key…
  ANAM_AVATAR_ID=${avatar.id}
`);
