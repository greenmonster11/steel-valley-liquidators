// One live Santa conversation: relays a browser's microphone audio to a
// Gemini Live session and streams Santa's voice, transcripts, and alerts back.

import {
  ActivityHandling,
  EndSensitivity,
  Modality,
  Type,
} from '@google/genai';
import {
  buildSantaPrompt,
  normalizeProfile,
  stageDirection,
} from '../shared/santa-prompt.js';

export const INPUT_MIME = 'audio/pcm;rate=16000';

const NOTIFY_TOOL = {
  functionDeclarations: [
    {
      name: 'notify_grown_up',
      description:
        'Quietly alert the adult running the call that a child shared something an adult should follow up on: being hurt or unsafe, deep sadness or grief, not having enough food, being bullied, or anything similarly worrying. Never mention this tool to the child.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          child_name: {
            type: Type.STRING,
            description: "The child's first name, if known.",
          },
          reason: {
            type: Type.STRING,
            description: 'One short, factual sentence describing what the child shared.',
          },
        },
        required: ['reason'],
      },
    },
  ],
};

/** Builds the Gemini Live connect config for a call. */
export function buildLiveConfig(rawProfile, options = {}) {
  const profile = normalizeProfile(rawProfile);
  const pushToTalk = Boolean(options.pushToTalk);

  const automaticActivityDetection = pushToTalk
    ? { disabled: true }
    : {
        // Kids pause mid-sentence a lot; lean toward letting them finish.
        endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_LOW,
        silenceDurationMs: 800,
        prefixPaddingMs: 200,
      };

  return {
    responseModalities: [Modality.AUDIO],
    systemInstruction: buildSantaPrompt(profile),
    speechConfig: {
      voiceConfig: { prebuiltVoiceConfig: { voiceName: profile.voice } },
    },
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    tools: [NOTIFY_TOOL],
    // Sliding-window compression lets a call outlast the raw context limit,
    // and resumption handles let us reconnect when the server sends goAway.
    contextWindowCompression: { slidingWindow: {} },
    sessionResumption: {},
    realtimeInputConfig: {
      automaticActivityDetection,
      activityHandling:
        pushToTalk || options.allowInterrupt
          ? ActivityHandling.START_OF_ACTIVITY_INTERRUPTS
          : ActivityHandling.NO_INTERRUPTION,
    },
  };
}

export class GeminiSantaSession {
  /**
   * @param {object} args
   * @param {import('@google/genai').GoogleGenAI} args.ai
   * @param {string} args.model
   * @param {object} args.profile Raw profile from the setup page.
   * @param {{pushToTalk?: boolean, allowInterrupt?: boolean}} args.options
   * @param {{audio: (buf: Buffer) => void, json: (msg: object) => void}} args.emit
   * @param {'client-content'|'realtime'} [args.textMode]
   * @param {number} [args.maxMinutes] Hard stop for the call.
   */
  constructor({ ai, model, profile, options, emit, textMode = 'client-content', maxMinutes = 30, log = console }) {
    this.ai = ai;
    this.model = model;
    this.profile = normalizeProfile(profile);
    this.options = options ?? {};
    this.emit = emit;
    this.textMode = textMode;
    this.maxMinutes = maxMinutes;
    this.log = log;

    this.session = null;
    this.connToken = null;
    this.setupPending = false;
    this.resumeHandle = null;
    this.greeted = false;
    this.closed = false;
    this.reconnecting = false;
    this.timers = [];
  }

  async start() {
    this.emit.json({ type: 'status', state: 'connecting' });
    await this.#connect();
    if (!this.closed) this.#scheduleTimers();
  }

  async #connect() {
    const config = buildLiveConfig(this.profile, this.options);
    if (this.resumeHandle) config.sessionResumption = { handle: this.resumeHandle };

    // Each connection gets a token so late events from a replaced or closed
    // connection are ignored.
    const token = Symbol('live-connection');
    this.connToken = token;
    this.setupPending = false;

    const session = await this.ai.live.connect({
      model: this.model,
      config,
      callbacks: {
        onmessage: (msg) => {
          if (token === this.connToken) this.#onMessage(msg);
        },
        onerror: (err) => this.log.error('[santa] live error:', err?.message ?? err),
        onclose: (evt) => {
          if (token === this.connToken) this.#onClose(evt);
        },
      },
    });
    if (token !== this.connToken) {
      session.close();
      return;
    }
    this.session = session;
    // setupComplete can land before connect() resolves; replay it now that
    // the session exists.
    if (this.setupPending) this.#onSetupComplete();
  }

  #onSetupComplete() {
    if (!this.session) return;
    this.reconnecting = false;
    this.emit.json({ type: 'status', state: 'live' });
    if (!this.greeted) {
      this.greeted = true;
      const opener =
        this.profile.mode === 'classroom'
          ? 'The call just connected and the whole class is watching the screen. Give them a big, warm Santa hello!'
          : 'The call just connected and the family is watching the screen. Give them a big, warm Santa hello!';
      this.sendHint(opener);
    }
  }

  #onMessage(msg) {
    if (msg.setupComplete) {
      if (this.session) this.#onSetupComplete();
      else this.setupPending = true;
    }

    const content = msg.serverContent;
    if (content) {
      for (const part of content.modelTurn?.parts ?? []) {
        if (part.inlineData?.data && part.inlineData.mimeType?.startsWith('audio/')) {
          this.emit.audio(Buffer.from(part.inlineData.data, 'base64'));
        }
      }
      if (content.inputTranscription?.text) {
        this.emit.json({ type: 'transcript', role: 'child', text: content.inputTranscription.text });
      }
      if (content.outputTranscription?.text) {
        this.emit.json({ type: 'transcript', role: 'santa', text: content.outputTranscription.text });
      }
      if (content.interrupted) this.emit.json({ type: 'interrupted' });
      if (content.turnComplete) this.emit.json({ type: 'turnComplete' });
    }

    if (msg.toolCall?.functionCalls?.length) this.#onToolCall(msg.toolCall.functionCalls);

    const update = msg.sessionResumptionUpdate;
    if (update?.resumable && update.newHandle) this.resumeHandle = update.newHandle;

    if (msg.goAway) {
      this.log.info(`[santa] goAway received (time left ${msg.goAway.timeLeft ?? '?'}), resuming`);
      this.#reconnect();
    }
  }

  #onToolCall(calls) {
    const functionResponses = calls.map((call) => {
      if (call.name === 'notify_grown_up') {
        this.emit.json({
          type: 'alert',
          childName: String(call.args?.child_name ?? '').slice(0, 60),
          reason: String(call.args?.reason ?? '').slice(0, 300),
        });
        return { id: call.id, name: call.name, response: { result: 'The grown-up has been quietly notified.' } };
      }
      return { id: call.id, name: call.name, response: { error: 'Unknown tool' } };
    });
    this.session?.sendToolResponse({ functionResponses });
  }

  #onClose(evt) {
    if (this.closed || this.reconnecting) return;
    const reason = evt?.reason || `code ${evt?.code ?? 'unknown'}`;
    if (this.resumeHandle) {
      this.log.warn(`[santa] live connection dropped (${reason}), resuming`);
      this.#reconnect();
      return;
    }
    this.log.warn(`[santa] live connection closed: ${reason}`);
    this.emit.json({ type: 'error', message: `Santa's line disconnected (${reason}).` });
    this.close('upstream-closed');
  }

  async #reconnect() {
    if (this.reconnecting || this.closed) return;
    if (!this.resumeHandle) {
      this.emit.json({ type: 'error', message: "Santa's line needs to restart. Please start the call again." });
      this.close('no-resume-handle');
      return;
    }
    this.reconnecting = true;
    this.emit.json({ type: 'status', state: 'reconnecting' });
    const old = this.session;
    this.session = null;
    this.connToken = null;
    try {
      old?.close();
    } catch {
      // already closed
    }
    try {
      await this.#connect();
    } catch (err) {
      this.log.error('[santa] resume failed:', err?.message ?? err);
      this.emit.json({ type: 'error', message: "Santa's line dropped and couldn't reconnect. Please start the call again." });
      this.close('resume-failed');
    }
  }

  #scheduleTimers() {
    const wrapUpMs = Math.max(this.profile.callMinutes * 60 - 75, 60) * 1000;
    this.timers.push(
      setTimeout(() => {
        this.sendHint("We're almost out of time. Finish up with whoever you're talking to, then begin a warm goodbye to everyone.");
        this.emit.json({ type: 'status', state: 'wrapping-up' });
      }, wrapUpMs),
    );
    this.timers.push(
      setTimeout(() => {
        this.emit.json({ type: 'error', message: 'This call reached its time limit.' });
        this.close('time-limit');
      }, this.maxMinutes * 60 * 1000),
    );
  }

  /** Streams one chunk of 16 kHz, 16-bit mono PCM from the microphone. */
  pushAudio(buf) {
    if (!this.session || this.reconnecting || this.closed) return;
    this.session.sendRealtimeInput({ audio: { data: buf.toString('base64'), mimeType: INPUT_MIME } });
  }

  /** Sends a behind-the-scenes note from the adult; Santa acts on it but never reads it out. */
  sendHint(text) {
    if (!this.session || this.closed || !text) return;
    const note = stageDirection(text);
    if (this.textMode === 'realtime') {
      this.session.sendRealtimeInput({ text: note });
    } else {
      this.session.sendClientContent({ turns: [{ role: 'user', parts: [{ text: note }] }], turnComplete: true });
    }
  }

  activityStart() {
    if (this.options.pushToTalk) this.session?.sendRealtimeInput({ activityStart: {} });
  }

  activityEnd() {
    if (this.options.pushToTalk) this.session?.sendRealtimeInput({ activityEnd: {} });
  }

  close(reason = 'closed') {
    if (this.closed) return;
    this.closed = true;
    this.connToken = null;
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    try {
      this.session?.close();
    } catch {
      // already closed
    }
    this.session = null;
    this.emit.json({ type: 'ended', reason });
  }
}
