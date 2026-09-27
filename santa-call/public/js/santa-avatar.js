// An illustrated, animated Santa drawn in SVG. His mouth follows the loudness
// and brightness of his streamed voice, and he blinks, breathes, nods while
// kids talk, glances up while "thinking", and bounces when he laughs.
//
// Anything that implements the same small interface (setState, attachVoice,
// setMicLevel, laugh) could replace this, such as a photoreal streaming
// avatar from a vendor.

const SVG = `
<svg viewBox="0 0 400 460" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="sa-skin" cx="50%" cy="38%" r="65%"><stop offset="0" stop-color="#FDDCC4"/><stop offset="1" stop-color="#EBAE88"/></radialGradient>
    <linearGradient id="sa-coat" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#D93030"/><stop offset="1" stop-color="#8A1212"/></linearGradient>
    <linearGradient id="sa-hat" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#E53935"/><stop offset="1" stop-color="#9A1414"/></linearGradient>
    <radialGradient id="sa-fur" cx="45%" cy="30%" r="80%"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#DCE3EC"/></radialGradient>
    <radialGradient id="sa-cheek"><stop offset="0" stop-color="#F06A6E" stop-opacity=".7"/><stop offset="1" stop-color="#F06A6E" stop-opacity="0"/></radialGradient>
    <radialGradient id="sa-nose" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="#F9B1A6"/><stop offset="1" stop-color="#D86865"/></radialGradient>
    <linearGradient id="sa-chair" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1F5E3A"/><stop offset="1" stop-color="#0E3320"/></linearGradient>
    <clipPath id="sa-mouth-clip"><path id="sa-mouth-clip-path"/></clipPath>
    <filter id="sa-shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="8" stdDeviation="10" flood-color="#000" flood-opacity=".35"/></filter>
  </defs>

  <g id="sa-chair">
    <path d="M52 460 L58 170 C60 95 120 58 200 58 C280 58 340 95 342 170 L348 460 Z" fill="url(#sa-chair)"/>
    <path d="M52 460 L58 170 C60 95 120 58 200 58 C280 58 340 95 342 170 L348 460" fill="none" stroke="#C9A04A" stroke-width="5" opacity=".9"/>
    <g fill="#D9B45A" opacity=".85">
      <circle cx="120" cy="120" r="4"/><circle cx="200" cy="96" r="4"/><circle cx="280" cy="120" r="4"/>
      <circle cx="96" cy="190" r="4"/><circle cx="304" cy="190" r="4"/>
    </g>
  </g>

  <g filter="url(#sa-shadow)">
    <g id="sa-body">
      <path d="M36 460 C44 382 110 336 200 333 C290 336 356 382 364 460 Z" fill="url(#sa-coat)"/>
      <path d="M86 398 C112 356 158 340 200 340 C242 340 288 356 314 398 L330 424 C296 382 250 368 200 368 C150 368 104 382 70 424 Z" fill="url(#sa-fur)"/>
      <rect x="184" y="396" width="32" height="64" rx="8" fill="url(#sa-fur)"/>
    </g>

    <g id="sa-head">
      <g fill="url(#sa-fur)">
        <circle cx="124" cy="186" r="22"/><circle cx="116" cy="214" r="20"/><circle cx="124" cy="240" r="18"/>
        <circle cx="276" cy="186" r="22"/><circle cx="284" cy="214" r="20"/><circle cx="276" cy="240" r="18"/>
      </g>
      <ellipse cx="200" cy="210" rx="76" ry="82" fill="url(#sa-skin)"/>
      <ellipse id="sa-cheek-l" cx="150" cy="238" rx="22" ry="15" fill="url(#sa-cheek)"/>
      <ellipse id="sa-cheek-r" cx="250" cy="238" rx="22" ry="15" fill="url(#sa-cheek)"/>

      <g id="sa-beard">
        <g fill="url(#sa-fur)">
          <ellipse cx="200" cy="318" rx="86" ry="74"/>
          <circle cx="132" cy="256" r="26"/><circle cx="268" cy="256" r="26"/>
          <circle cx="116" cy="290" r="30"/><circle cx="284" cy="290" r="30"/>
          <circle cx="126" cy="330" r="30"/><circle cx="274" cy="330" r="30"/>
          <circle cx="146" cy="368" r="30"/><circle cx="254" cy="368" r="30"/>
          <circle cx="174" cy="392" r="30"/><circle cx="226" cy="392" r="30"/>
          <circle cx="200" cy="404" r="30"/>
          <circle cx="186" cy="424" r="18"/><circle cx="214" cy="424" r="18"/>
        </g>
        <g fill="none" stroke="#C9D2DE" stroke-width="2" stroke-linecap="round" opacity=".7">
          <path d="M150 330 C146 348 150 364 160 376"/><path d="M250 330 C254 348 250 364 240 376"/>
          <path d="M178 350 C176 370 180 388 188 400"/><path d="M222 350 C224 370 220 388 212 400"/>
          <path d="M128 296 C124 310 126 322 132 332"/><path d="M272 296 C276 310 274 322 268 332"/>
        </g>
      </g>

      <path id="sa-mouth" fill="#5B1B1F"/>
      <g clip-path="url(#sa-mouth-clip)">
        <ellipse id="sa-tongue" cx="200" cy="300" rx="12" ry="6" fill="#C9545A"/>
      </g>

      <g id="sa-mustache" fill="url(#sa-fur)" stroke="#CDD5E0" stroke-width="1.5">
        <path d="M201 250 C190 240 164 236 146 248 C134 257 136 276 152 276 C164 276 172 268 184 270 C194 272 200 266 201 258 Z"/>
        <path d="M199 250 C210 240 236 236 254 248 C266 257 264 276 248 276 C236 276 228 268 216 270 C206 272 200 266 199 258 Z"/>
      </g>

      <ellipse cx="200" cy="233" rx="16" ry="13" fill="url(#sa-nose)"/>
      <ellipse cx="195" cy="227" rx="5.5" ry="3.2" fill="#fff" opacity=".55"/>

      <g id="sa-eyes">
        <g id="sa-eye-l" transform="translate(174 203)">
          <ellipse rx="7.5" ry="9.5" fill="#2A2733"/><circle cx="-2.4" cy="-3.2" r="2.6" fill="#fff"/>
        </g>
        <g id="sa-eye-r" transform="translate(226 203)">
          <ellipse rx="7.5" ry="9.5" fill="#2A2733"/><circle cx="-2.4" cy="-3.2" r="2.6" fill="#fff"/>
        </g>
      </g>

      <g id="sa-glasses" fill="#fff" fill-opacity=".1" stroke="#D1A33A" stroke-width="3">
        <circle cx="174" cy="204" r="19"/><circle cx="226" cy="204" r="19"/>
        <path d="M193 201 Q200 195 207 201" fill="none"/>
        <path d="M155 200 L130 194" fill="none"/><path d="M245 200 L270 194" fill="none"/>
      </g>

      <g id="sa-brows" fill="none" stroke="#FFFFFF" stroke-width="10" stroke-linecap="round">
        <path id="sa-brow-l" d="M152 178 Q170 166 190 175"/>
        <path id="sa-brow-r" d="M210 175 Q230 166 248 178"/>
      </g>

      <g id="sa-hat">
        <path d="M120 150 C118 94 160 46 222 42 C278 39 320 76 334 152 L318 158 C306 112 286 94 262 92 C272 112 280 132 282 150 Z" fill="url(#sa-hat)"/>
        <path d="M150 90 C175 64 210 56 240 60" fill="none" stroke="#fff" stroke-opacity=".18" stroke-width="8" stroke-linecap="round"/>
        <g fill="url(#sa-fur)">
          <rect x="108" y="130" width="184" height="34" rx="17"/>
          <circle cx="116" cy="147" r="17"/><circle cx="146" cy="142" r="15"/><circle cx="182" cy="140" r="15"/>
          <circle cx="218" cy="140" r="15"/><circle cx="254" cy="142" r="15"/><circle cx="284" cy="147" r="17"/>
        </g>
        <g id="sa-pom">
          <circle cx="328" cy="166" r="19" fill="url(#sa-fur)"/>
          <circle cx="322" cy="160" r="6" fill="#fff"/>
        </g>
      </g>
    </g>
  </g>
</svg>`;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export class SantaAvatar {
  constructor(container) {
    container.innerHTML = SVG;
    const $ = (id) => container.querySelector(`#${id}`);
    this.el = {
      head: $('sa-head'),
      body: $('sa-body'),
      beard: $('sa-beard'),
      mouth: $('sa-mouth'),
      mouthClip: $('sa-mouth-clip-path'),
      tongue: $('sa-tongue'),
      mustache: $('sa-mustache'),
      eyeL: $('sa-eye-l'),
      eyeR: $('sa-eye-r'),
      brows: $('sa-brows'),
      cheekL: $('sa-cheek-l'),
      cheekR: $('sa-cheek-r'),
      pom: $('sa-pom'),
    };

    this.state = 'idle';
    this.analyser = null;
    this.td = null;
    this.fd = null;
    this.voice = 0;
    this.shape = 1;
    this.mic = 0;
    this.micTarget = 0;
    this.laughUntil = 0;
    this.blinkAt = performance.now() + 2000;
    this.blinkEnd = 0;
    this.gaze = { x: 0, y: 0, tx: 0, ty: 0, next: 0 };
    this.pom = { angle: 0, vel: 0 };
    this.lastT = performance.now();

    this.reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const loop = (now) => {
      this.#tick(now);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  /** 'idle' | 'listening' | 'thinking' | 'speaking' */
  setState(state) {
    this.state = state;
  }

  attachVoice(analyser) {
    this.analyser = analyser;
    this.td = new Float32Array(analyser.fftSize);
    this.fd = new Uint8Array(analyser.frequencyBinCount);
  }

  setMicLevel(level) {
    this.micTarget = clamp((level - 0.01) * 10, 0, 1);
  }

  laugh(ms = 1400) {
    this.laughUntil = performance.now() + ms;
  }

  #voiceLevel() {
    if (!this.analyser) return { level: 0, shape: 1 };
    this.analyser.getFloatTimeDomainData(this.td);
    let sum = 0;
    for (let i = 0; i < this.td.length; i += 1) sum += this.td[i] * this.td[i];
    const rms = Math.sqrt(sum / this.td.length);
    const level = clamp((rms - 0.006) * 7.5, 0, 1);

    // Brighter sounds ("ee", "s") read as wider, rounder sounds ("oo") as narrower.
    this.analyser.getByteFrequencyData(this.fd);
    const hz = this.analyser.context.sampleRate / this.analyser.fftSize;
    const band = (lo, hi) => {
      let s = 0;
      let n = 0;
      for (let i = Math.floor(lo / hz); i <= Math.ceil(hi / hz) && i < this.fd.length; i += 1) {
        s += this.fd[i];
        n += 1;
      }
      return n ? s / n : 0;
    };
    const low = band(150, 900);
    const high = band(1800, 4000);
    const shape = low > 8 ? clamp(0.8 + (high / low) * 0.9, 0.8, 1.35) : 1;
    return { level, shape };
  }

  #tick(now) {
    const dt = Math.min((now - this.lastT) / 1000, 0.1);
    this.lastT = now;
    const t = now / 1000;
    const motion = this.reduceMotion ? 0.3 : 1;

    const { level, shape } = this.#voiceLevel();
    this.voice += (level - this.voice) * (level > this.voice ? 0.6 : 0.25);
    this.shape += (shape - this.shape) * 0.2;
    this.mic += (this.micTarget - this.mic) * 0.2;

    const speaking = this.state === 'speaking';
    const listening = this.state === 'listening';
    const thinking = this.state === 'thinking';
    const laughing = now < this.laughUntil;
    const laughEnv = laughing ? Math.sin(Math.PI * (1 - (this.laughUntil - now) / 1400)) : 0;

    // Head: gentle idle drift, speech emphasis, curious tilt while listening.
    let rot = Math.sin(t * 0.45) * 1.4;
    let dx = Math.sin(t * 0.55) * 2.2;
    let dy = Math.sin(t * 1.2) * 1.4;
    if (speaking) {
      rot += Math.sin(t * 6.8) * this.voice * 1.8;
      dy -= this.voice * 2.5;
    }
    if (listening) {
      rot += 3.5;
      dy += Math.sin(t * 5) * this.mic * 3.5;
    }
    if (thinking) rot -= 2.5;
    dy -= Math.abs(Math.sin(t * 13)) * 5 * laughEnv;
    this.el.head.setAttribute('transform', `translate(${(dx * motion).toFixed(2)} ${(dy * motion).toFixed(2)}) rotate(${(rot * motion).toFixed(2)} 200 330)`);

    // Body: breathing plus a belly-laugh bounce.
    const breath = Math.sin(t * 1.5) * 0.01 + Math.abs(Math.sin(t * 13)) * 0.025 * laughEnv;
    this.el.body.setAttribute('transform', `translate(200 460) scale(1 ${(1 + breath * motion).toFixed(4)}) translate(-200 -460)`);

    // Mouth: open with loudness, width with brightness. At rest it's a small smile.
    const open = this.voice;
    const cx = 200;
    const y = 282;
    const w = 15 + open * 5 + (this.shape - 1) * 10;
    const upper = y - open * 3;
    const lower = y + 6 + open * 26;
    const d = `M${cx - w} ${y} Q${cx} ${upper} ${cx + w} ${y} Q${cx} ${lower} ${cx - w} ${y}Z`;
    this.el.mouth.setAttribute('d', d);
    this.el.mouthClip.setAttribute('d', d);
    this.el.tongue.setAttribute('cy', (y + 4 + open * 18).toFixed(1));
    this.el.tongue.setAttribute('rx', (w * 0.55).toFixed(1));
    this.el.tongue.setAttribute('ry', (2 + open * 6).toFixed(1));
    this.el.beard.setAttribute('transform', `translate(0 ${(open * 7).toFixed(2)})`);
    this.el.mustache.setAttribute('transform', `translate(0 ${(-open * 1.8 + Math.sin(t * 9) * open * 0.8).toFixed(2)})`);

    // Brows lift with emphasis, curiosity, and thought.
    const lift = this.voice * 3 + (listening ? 3 + this.mic * 2 : 0) + (thinking ? 4 : 0) + laughEnv * 2;
    this.el.brows.setAttribute('transform', `translate(0 ${(-lift).toFixed(2)})`);

    // Eyes: blinks, small glances, a look upward while thinking, squint when laughing.
    if (now > this.blinkAt) {
      this.blinkEnd = now + 140;
      this.blinkAt = now + 2200 + Math.random() * 3200;
    }
    const blink = now < this.blinkEnd ? 0.12 : 1;
    const eyeScale = Math.min(blink, 1 - laughEnv * 0.7);
    if (now > this.gaze.next) {
      this.gaze.tx = (Math.random() - 0.5) * 3;
      this.gaze.ty = (Math.random() - 0.5) * 2;
      this.gaze.next = now + 900 + Math.random() * 2200;
    }
    const gx = thinking ? 3 : this.gaze.tx;
    const gy = thinking ? -4 : this.gaze.ty;
    this.gaze.x += (gx - this.gaze.x) * 0.15;
    this.gaze.y += (gy - this.gaze.y) * 0.15;
    for (const [eye, x] of [[this.el.eyeL, 174], [this.el.eyeR, 226]]) {
      eye.setAttribute('transform', `translate(${(x + this.gaze.x).toFixed(2)} ${(203 + this.gaze.y).toFixed(2)}) scale(1 ${eyeScale.toFixed(2)})`);
    }

    // Rosy cheeks swell a little with big sounds and laughs.
    const cheek = 1 + open * 0.08 + laughEnv * 0.18;
    this.el.cheekL.setAttribute('transform', `translate(150 238) scale(${cheek.toFixed(3)}) translate(-150 -238)`);
    this.el.cheekR.setAttribute('transform', `translate(250 238) scale(${cheek.toFixed(3)}) translate(-250 -238)`);

    // Pom-pom: a damped pendulum nudged by head motion.
    const force = -this.pom.angle * 40 - this.pom.vel * 4 + Math.sin(t * 6.8) * this.voice * 60 * (speaking ? 1 : 0) + Math.sin(t * 13) * laughEnv * 120;
    this.pom.vel += force * dt;
    this.pom.angle += this.pom.vel * dt;
    this.el.pom.setAttribute('transform', `rotate(${(this.pom.angle * motion).toFixed(2)} 318 150)`);
  }
}
