// Demo-mode Santa used when no AI backend is configured. It speaks canned
// lines as a synthesized "hum" so the call screen, avatar lip-sync, helper
// panel, and transcript can all be tried without any API keys or cost.

import { normalizeProfile } from '../shared/santa-prompt.js';

const OUTPUT_RATE = 24000;
const CHUNK_SAMPLES = 2400; // 100 ms

const REPLIES = [
  "Oh my, that sounds wonderful! I'll tell my elves all about it.",
  'Ho ho! And what are you hoping for this Christmas?',
  "Well now, my reindeer would love to hear that! Have you been helping out at home?",
  "That's just marvelous. Mrs. Claus is baking cookies right now — what's your favorite kind?",
  "Ho ho ho! You're making my cheeks rosy. Tell me more!",
];

/** Synthesizes a warm, speech-like hum whose rhythm follows the text. */
export function synthesizeHum(text) {
  const syllables = Math.max(4, Math.round(text.length / 3.2));
  const syllableSec = 0.19;
  const total = Math.round(syllables * syllableSec * OUTPUT_RATE);
  const pcm = new Int16Array(total);

  // Deterministic pseudo-random so tests are repeatable.
  let seed = text.length * 7919;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const sylAmp = Array.from({ length: syllables + 1 }, () => 0.55 + rand() * 0.45);
  const sylPitch = Array.from({ length: syllables + 1 }, () => (rand() - 0.5) * 30);
  const sylVowel = Array.from({ length: syllables + 1 }, () => rand());
  const gaps = new Set(Array.from({ length: syllables }, (_, i) => i).filter(() => rand() < 0.18));

  let phase = 0;
  for (let i = 0; i < total; i += 1) {
    const t = i / OUTPUT_RATE;
    const s = Math.min(Math.floor(t / syllableSec), syllables);
    const p = (t % syllableSec) / syllableSec;
    const env = gaps.has(s) ? 0 : Math.pow(Math.sin(Math.PI * p), 0.7) * sylAmp[s];
    const f0 = 108 + sylPitch[s] + 6 * Math.sin(2 * Math.PI * 5.5 * t);
    phase += (2 * Math.PI * f0) / OUTPUT_RATE;

    // Sum harmonics, emphasizing ones near two moving "vowel" formants.
    const f1 = 450 + sylVowel[s] * 400;
    const f2 = 1100 + sylVowel[s] * 900;
    let sample = 0;
    for (let k = 1; k <= 14; k += 1) {
      const hz = k * f0;
      const formant = Math.exp(-(((hz - f1) / 220) ** 2)) + 0.6 * Math.exp(-(((hz - f2) / 300) ** 2));
      sample += (0.25 / k + formant) * Math.sin(k * phase);
    }
    const fade = Math.min(1, i / 600, (total - i) / 600);
    pcm[i] = Math.max(-1, Math.min(1, sample * env * 0.16 * fade)) * 32767;
  }
  return pcm;
}

export class MockSantaSession {
  constructor({ profile, options, emit, maxMinutes = 30 }) {
    this.profile = normalizeProfile(profile);
    this.options = options ?? {};
    this.emit = emit;
    this.maxMinutes = maxMinutes;
    this.closed = false;
    this.speakingUntil = 0;
    this.replyIndex = 0;
    this.loudChunks = 0;
    this.quietChunks = 0;
    this.heardSpeech = false;
    this.timers = [];
    this.lineTimers = [];
  }

  async start() {
    this.emit.json({ type: 'status', state: 'connecting' });
    await new Promise((r) => setTimeout(r, 600));
    if (this.closed) return;
    this.emit.json({ type: 'status', state: 'live', demo: true });
    const who = this.profile.groupName || (this.profile.mode === 'classroom' ? 'boys and girls' : 'my friends');
    this.#say(`Ho ho ho! Merry Christmas, ${who}! It's me, Santa, calling all the way from the North Pole. This is demo mode, so I can only hum — connect Gemini to hear my real voice!`);

    const wrapUpMs = Math.max(this.profile.callMinutes * 60 - 75, 60) * 1000;
    this.timers.push(setTimeout(() => this.emit.json({ type: 'status', state: 'wrapping-up' }), wrapUpMs));
    this.timers.push(setTimeout(() => this.close('time-limit'), this.maxMinutes * 60 * 1000));
  }

  #say(text) {
    if (this.closed) return;
    // A new line cuts off the one in progress, like the real API does.
    if (this.lineTimers.length) {
      this.lineTimers.forEach(clearTimeout);
      this.emit.json({ type: 'interrupted' });
    }
    this.lineTimers = [];
    const pcm = synthesizeHum(text);
    const words = text.split(' ');
    const chunks = Math.ceil(pcm.length / CHUNK_SAMPLES);
    this.speakingUntil = Date.now() + (pcm.length / OUTPUT_RATE) * 1000 + 400;

    // Stream a little faster than real time, like the real API does.
    for (let c = 0; c < chunks; c += 1) {
      this.lineTimers.push(
        setTimeout(() => {
          if (this.closed) return;
          const slice = pcm.subarray(c * CHUNK_SAMPLES, (c + 1) * CHUNK_SAMPLES);
          this.emit.audio(Buffer.from(slice.buffer, slice.byteOffset, slice.byteLength));
          const from = Math.floor((c / chunks) * words.length);
          const to = Math.floor(((c + 1) / chunks) * words.length);
          if (to > from) this.emit.json({ type: 'transcript', role: 'santa', text: `${words.slice(from, to).join(' ')} ` });
          if (c === chunks - 1) {
            this.lineTimers = [];
            this.emit.json({ type: 'turnComplete' });
          }
        }, c * 60),
      );
    }
  }

  pushAudio(buf) {
    if (this.closed || this.options.pushToTalk) return;
    if (Date.now() < this.speakingUntil) return;
    const samples = new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 2));
    let sum = 0;
    for (const s of samples) sum += (s / 32768) ** 2;
    const rms = Math.sqrt(sum / Math.max(samples.length, 1));

    if (rms > 0.02) {
      this.loudChunks += 1;
      this.quietChunks = 0;
      if (this.loudChunks >= 5) this.heardSpeech = true;
    } else {
      this.quietChunks += 1;
      if (this.quietChunks > 3) this.loudChunks = 0;
      if (this.heardSpeech && this.quietChunks >= 20) {
        this.heardSpeech = false;
        this.#reply();
      }
    }
  }

  #reply() {
    this.emit.json({ type: 'transcript', role: 'child', text: '(demo mode: Santa heard someone talking)' });
    this.emit.json({ type: 'turnComplete' });
    this.#say(REPLIES[this.replyIndex++ % REPLIES.length]);
  }

  sendHint(text) {
    if (this.closed || !text) return;
    const lower = text.toLowerCase();
    const child = this.profile.children.find((c) => lower.includes(c.name.toLowerCase()));
    if (/goodbye|wrap/.test(lower)) {
      this.#say("Well, my friends, the reindeer are getting restless, so it's almost time for me to go. Be kind to each other, and Merry Christmas! Ho ho ho!");
    } else if (child) {
      const fact = child.facts ? ` The elves told me all about you — ${child.facts.replace(/\.$/, '')}!` : '';
      this.#say(`Well hello there, ${child.name}!${fact} What are you hoping for this Christmas?`);
    } else {
      this.#say(REPLIES[this.replyIndex++ % REPLIES.length]);
    }
  }

  activityStart() {}

  activityEnd() {
    if (this.options.pushToTalk && !this.closed) this.#reply();
  }

  close(reason = 'closed') {
    if (this.closed) return;
    this.closed = true;
    for (const t of [...this.timers, ...this.lineTimers]) clearTimeout(t);
    this.timers = [];
    this.lineTimers = [];
    this.emit.json({ type: 'ended', reason });
  }
}
