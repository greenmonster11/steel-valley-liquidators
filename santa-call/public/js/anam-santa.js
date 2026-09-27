// Photoreal Santa: streams Santa's Gemini voice (24 kHz PCM) into an Anam
// avatar and shows the lip-synced video it sends back. It has the same shape
// as VoicePlayer (enqueue / clear / endTurn / playing / onPlayingChange), so
// the call screen can use either one.

const SAMPLE_RATE = 24000;
const RENDER_DELAY_S = 0.9; // Anam buffers ~800 ms of audio before it starts drawing frames.

function loadScript(src) {
  if (window.anam) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`Couldn't load ${src}`));
    document.head.append(el);
  });
}

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

export class AnamSantaPlayer {
  /**
   * @param {AudioContext} ctx Used only to watch when Santa is audible.
   * @param {HTMLVideoElement} video Must have an id; Anam attaches its stream to it.
   */
  constructor(ctx, video) {
    this.ctx = ctx;
    this.video = video;
    this.client = null;
    this.input = null;
    this.inTurn = false;
    this.playing = false;
    this.onPlayingChange = () => {};
    this.onDisconnect = () => {};
    this.estimatedEnd = 0; // ctx time when queued speech should finish
    this.lastAudible = 0;
    this.analyser = null;
    this.samples = null;
    this.watch = null;
  }

  async start(sessionToken, { timeoutMs = 20000 } = {}) {
    await loadScript('/vendor/anam.js');
    const { createClient, AnamEvent } = window.anam;

    // Our own mic goes to Gemini; Anam only needs Santa's voice.
    this.client = createClient(sessionToken, {
      disableInputAudio: true,
      metrics: { disableClientMetrics: true },
    });

    const firstFrame = new Promise((resolve, reject) => {
      this.client.addListener(AnamEvent.VIDEO_PLAY_STARTED, resolve);
      this.client.addListener(AnamEvent.CONNECTION_CLOSED, (code, details) => reject(new Error(details || code)));
    });
    this.client.addListener(AnamEvent.AUDIO_STREAM_STARTED, (stream) => this.#listenTo(stream));
    this.client.addListener(AnamEvent.CONNECTION_CLOSED, () => {
      if (this.client) this.onDisconnect();
    });

    await withTimeout(
      (async () => {
        await this.client.streamToVideoElement(this.video.id);
        this.input = this.client.createAgentAudioInputStream({ encoding: 'pcm_s16le', sampleRate: SAMPLE_RATE, channels: 1 });
        await firstFrame;
      })(),
      timeoutMs,
      'Photoreal Santa took too long to connect',
    );

    this.watch = setInterval(() => this.#update(), 100);
  }

  enqueue(arrayBuffer) {
    if (!this.input || !arrayBuffer.byteLength) return;
    this.input.sendAudioChunk(arrayBuffer);
    this.inTurn = true;
    const now = this.ctx.currentTime;
    const seconds = arrayBuffer.byteLength / 2 / SAMPLE_RATE;
    this.estimatedEnd = Math.max(this.estimatedEnd, now + RENDER_DELAY_S) + seconds;
    this.#setPlaying(true);
  }

  /** Gemini finished this reply; tell Anam the sequence is complete. */
  endTurn() {
    if (!this.inTurn) return;
    this.inTurn = false;
    this.input?.endSequence();
  }

  /** Santa was interrupted: stop talking now and drop anything queued. */
  clear() {
    if (this.inTurn || this.playing) {
      try {
        this.client?.interruptPersona();
      } catch {
        // Not streaming yet; nothing to interrupt.
      }
      this.input?.endSequence();
    }
    this.inTurn = false;
    this.estimatedEnd = 0;
    this.lastAudible = 0;
    this.#setPlaying(false);
  }

  /** Nudges Santa's expression, e.g. 'laughter' or 'supportive'. */
  cue(tag) {
    try {
      this.client?.sendDirectorNoteCue(tag);
    } catch {
      // Cues are a nicety; older avatar models don't support them.
    }
  }

  stop() {
    clearInterval(this.watch);
    const client = this.client;
    this.client = null;
    this.input = null;
    client?.stopStreaming().catch(() => {});
    this.#setPlaying(false);
  }

  // Watch Santa's actual audio so the mic stays gated until he's truly done.
  #listenTo(stream) {
    try {
      const source = this.ctx.createMediaStreamSource(stream);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.samples = new Float32Array(this.analyser.fftSize);
      source.connect(this.analyser);
    } catch {
      this.analyser = null; // fall back to the timing estimate
    }
  }

  #update() {
    const now = this.ctx.currentTime;
    if (this.analyser) {
      this.analyser.getFloatTimeDomainData(this.samples);
      let sum = 0;
      for (let i = 0; i < this.samples.length; i += 1) sum += this.samples[i] * this.samples[i];
      if (Math.sqrt(sum / this.samples.length) > 0.01) this.lastAudible = now;
    }
    this.#setPlaying(this.inTurn || now < this.estimatedEnd || now - this.lastAudible < 0.6);
  }

  #setPlaying(value) {
    if (this.playing === value) return;
    this.playing = value;
    this.onPlayingChange(value);
  }
}
