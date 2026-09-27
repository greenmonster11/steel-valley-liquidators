// AudioWorklet that turns the microphone into 16 kHz, 16-bit mono PCM chunks
// (the format Gemini Live expects) and reports a loudness level per chunk.

const TARGET_RATE = 16000;
const CHUNK = 640; // 40 ms at 16 kHz

class MicCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / TARGET_RATE;
    this.acc = 0;
    this.accCount = 0;
    this.pos = 0;
    this.out = new Int16Array(CHUNK);
    this.outIdx = 0;
    this.sumSq = 0;
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;

    for (let i = 0; i < channel.length; i += 1) {
      // Box-filter downsampling: average the input samples that fall into
      // each output sample. Cheap, and a decent low-pass for speech.
      this.acc += channel[i];
      this.accCount += 1;
      this.pos += 1;
      if (this.pos >= this.ratio) {
        this.pos -= this.ratio;
        const v = Math.max(-1, Math.min(1, this.acc / this.accCount));
        this.acc = 0;
        this.accCount = 0;
        this.out[this.outIdx++] = v < 0 ? v * 0x8000 : v * 0x7fff;
        this.sumSq += v * v;
        if (this.outIdx === CHUNK) {
          const pcm = this.out.buffer;
          this.port.postMessage({ pcm, level: Math.sqrt(this.sumSq / CHUNK) }, [pcm]);
          this.out = new Int16Array(CHUNK);
          this.outIdx = 0;
          this.sumSq = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('mic-capture', MicCapture);
