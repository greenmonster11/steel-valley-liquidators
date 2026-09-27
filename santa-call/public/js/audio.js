// Microphone capture and gapless playback of Santa's streamed voice.

export const OUTPUT_RATE = 24000;

export async function createAudioContext() {
  const ctx = new AudioContext({ latencyHint: 'interactive' });
  await ctx.audioWorklet.addModule('/js/mic-worklet.js');
  if (ctx.state === 'suspended') await ctx.resume();
  return ctx;
}

export class Microphone {
  constructor(ctx) {
    this.ctx = ctx;
    this.stream = null;
    this.source = null;
    this.node = null;
    this.sink = null;
  }

  /** @param {(pcm: ArrayBuffer, level: number) => void} onChunk */
  async start(onChunk) {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, 'mic-capture');
    this.node.port.onmessage = (e) => onChunk(e.data.pcm, e.data.level);
    // Route through a silent gain so the worklet is pulled by the graph
    // without the mic being played out of the speakers.
    this.sink = this.ctx.createGain();
    this.sink.gain.value = 0;
    this.source.connect(this.node).connect(this.sink).connect(this.ctx.destination);
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.source?.disconnect();
    this.node?.disconnect();
    this.sink?.disconnect();
    if (this.node) this.node.port.onmessage = null;
    this.stream = this.source = this.node = this.sink = null;
  }
}

/** Schedules 24 kHz PCM chunks back to back and exposes an analyser for lip-sync. */
export class VoicePlayer {
  constructor(ctx) {
    this.ctx = ctx;
    this.gain = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.45;
    this.gain.connect(this.analyser).connect(ctx.destination);
    this.sources = new Set();
    this.nextTime = 0;
    this.playing = false;
    this.onPlayingChange = () => {};
  }

  enqueue(arrayBuffer) {
    const samples = new Int16Array(arrayBuffer);
    if (!samples.length) return;
    const floats = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i += 1) floats[i] = samples[i] / 32768;

    const buffer = this.ctx.createBuffer(1, floats.length, OUTPUT_RATE);
    buffer.copyToChannel(floats, 0);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.gain);

    // A small cushion on the first chunk of a turn absorbs network jitter.
    const now = this.ctx.currentTime;
    const startAt = this.nextTime > now ? this.nextTime : now + 0.12;
    src.start(startAt);
    this.nextTime = startAt + buffer.duration;

    this.sources.add(src);
    src.onended = () => {
      this.sources.delete(src);
      if (!this.sources.size) this.#setPlaying(false);
    };
    this.#setPlaying(true);
  }

  /** Stops everything queued, e.g. when Santa is interrupted. */
  clear() {
    for (const src of this.sources) {
      src.onended = null;
      try {
        src.stop();
      } catch {
        // not started yet
      }
    }
    this.sources.clear();
    this.nextTime = 0;
    this.#setPlaying(false);
  }

  #setPlaying(value) {
    if (this.playing === value) return;
    this.playing = value;
    this.onPlayingChange(value);
  }
}
