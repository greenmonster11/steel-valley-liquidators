import { SantaAvatar } from '/js/santa-avatar.js';
import { Microphone, VoicePlayer, createAudioContext } from '/js/audio.js';
import { DEFAULT_PROFILE, loadProfile } from '/js/profile-store.js';

const $ = (id) => document.getElementById(id);

const profile = loadProfile() ?? { ...DEFAULT_PROFILE };
const pushToTalk = profile.talkMode === 'ptt';
const allowInterrupt = Boolean(profile.allowInterrupt);
const classroom = profile.mode !== 'family';

const avatar = new SantaAvatar($('santa'));
startSnow($('snow'));

let ctx = null;
let mic = null;
let player = null;
let ws = null;
let live = false;
let muted = false;
let pttDown = false;
let gateUntil = 0;
let lastChildSound = 0;
let awaitingSanta = false;
let callStartedAt = 0;
const targetMinutes = Number(profile.callMinutes) || 10;
let endReason = '';
let tickTimer = null;

// ---------- Setup summary & helper panel ----------

const kids = (profile.children ?? []).filter((c) => c.name);
$('setup-summary').textContent = [
  profile.groupName || (classroom ? 'Classroom call' : 'Family call'),
  kids.length ? `${kids.length} ${kids.length === 1 ? 'kid' : 'kids'}` : 'no names yet',
  pushToTalk ? 'hold to talk' : 'hands-free',
].join(' · ');
if (pushToTalk) $('ptt').hidden = false;

function renderKidChips() {
  const wrap = $('kid-chips');
  wrap.replaceChildren();
  $('no-kids').hidden = kids.length > 0;
  for (const kid of kids) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.textContent = kid.name;
    chip.title = kid.facts || '';
    chip.addEventListener('click', () => {
      const say = kid.sayItLike ? ` (pronounced "${kid.sayItLike}")` : '';
      const text = classroom
        ? `${kid.name}${say} is stepping up to talk to you now. Greet them warmly by name.`
        : `You're talking with ${kid.name}${say} now. Give them your full attention.`;
      sendHint(text);
      wrap.querySelectorAll('.chip.current').forEach((c) => c.classList.replace('current', 'done'));
      chip.classList.remove('done');
      chip.classList.add('current');
    });
    wrap.append(chip);
  }
}
renderKidChips();

const NUDGES = [
  { label: '🎁 Christmas wish', text: 'Ask the child you are talking with what they are hoping for this Christmas.' },
  ...(classroom ? [{ label: '👋 Next friend', text: 'Wrap up warmly with this child and invite the next friend to come say hi.' }] : []),
  { label: '🙈 Shy child', text: 'The child is being very quiet or shy. Gently encourage them with an easy either-or question.' },
  { label: '🦌 Reindeer story', text: 'Tell a very short, funny story about what the reindeer got up to at the North Pole today.' },
  { label: '😂 Tell a joke', text: 'Tell one short, silly, kid-friendly Christmas joke.' },
  { label: '💛 Be kind', text: 'Gently encourage everyone to be kind and helpful to each other.' },
  { label: '⏰ Wrap up', text: "We're almost out of time. Finish up with whoever you're talking to, then begin a warm goodbye to everyone." },
  { label: '🎄 Goodbye now', text: 'Say a warm, cheerful goodbye to everyone right now and wish them a Merry Christmas.' },
];
for (const n of NUDGES) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'nudge';
  b.textContent = n.label;
  b.addEventListener('click', () => sendHint(n.text));
  $('nudges').append(b);
}
$('custom-nudge').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('nudge-text');
  if (input.value.trim()) sendHint(input.value.trim());
  input.value = '';
});

function toggleHelper(force) {
  const helper = $('helper');
  helper.hidden = typeof force === 'boolean' ? !force : !helper.hidden;
  document.body.classList.toggle('helper-open', !helper.hidden);
  if (!helper.hidden) $('alert-badge').hidden = true;
}
$('toggle-helper').addEventListener('click', () => toggleHelper());
$('close-helper').addEventListener('click', () => toggleHelper(false));

function toggleCaptions() {
  const on = document.body.classList.toggle('no-captions') === false;
  $('toggle-cc').setAttribute('aria-pressed', String(on));
}
$('toggle-cc').addEventListener('click', toggleCaptions);

// ---------- Transcript & captions ----------

const bubbles = { child: null, santa: null };
let captionTimer = null;

function appendTranscript(role, text) {
  const other = role === 'child' ? 'santa' : 'child';
  bubbles[other] = null;
  if (!bubbles[role]) {
    const el = document.createElement('p');
    el.className = `line ${role}`;
    const who = document.createElement('strong');
    who.textContent = role === 'santa' ? 'Santa' : 'Kid';
    const body = document.createElement('span');
    el.append(who, body);
    $('transcript').append(el);
    bubbles[role] = body;
  }
  bubbles[role].textContent += text;
  const box = $('transcript');
  box.scrollTop = box.scrollHeight;
}

function showCaption(text) {
  const cap = $('caption');
  // Two lines at most, so the caption never covers Santa's face.
  cap.textContent = text.length > 110 ? `…${text.slice(-110).replace(/^\S*\s/, '')}` : text;
  cap.classList.add('show');
  clearTimeout(captionTimer);
  captionTimer = setTimeout(() => cap.classList.remove('show'), 4000);
}

function finishTurn() {
  bubbles.child = null;
  bubbles.santa = null;
}

// ---------- Call lifecycle ----------

function showOverlay(which) {
  $('overlay').hidden = !which;
  for (const id of ['ov-ready', 'ov-connecting', 'ov-ended']) $(id).hidden = id !== which;
}

function setError(message) {
  let el = $('ov-error');
  if (!el) {
    el = document.createElement('p');
    el.id = 'ov-error';
    el.className = 'error';
    $('ov-ready').insertBefore(el, $('call'));
  }
  el.textContent = message;
}

function sendJson(msg) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function sendHint(text) {
  if (!live) return;
  sendJson({ type: 'hint', text });
  finishTurn();
  const note = document.createElement('p');
  note.className = 'line note';
  note.textContent = `→ ${text}`;
  $('transcript').append(note);
}

async function startCall() {
  endReason = '';
  showOverlay('ov-connecting');
  const accessCode = $('access-code').value.trim();
  if (accessCode) sessionStorage.setItem('callSanta.code', accessCode);

  try {
    ctx = await createAudioContext();
    player = new VoicePlayer(ctx);
    player.onPlayingChange = (playing) => {
      if (playing) awaitingSanta = false;
      else gateUntil = performance.now() + 350; // let the room echo die down
    };
    avatar.attachVoice(player.analyser);
    mic = new Microphone(ctx);
    await mic.start(onMicChunk);
  } catch (err) {
    cleanup();
    showOverlay('ov-ready');
    setError(err?.name === 'NotAllowedError'
      ? 'Santa needs to hear you! Please allow microphone access and try again.'
      : `Couldn't start audio: ${err?.message ?? err}`);
    return;
  }

  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/call`);
  ws.binaryType = 'arraybuffer';
  ws.onopen = () => {
    sendJson({ type: 'start', profile, options: { pushToTalk, allowInterrupt }, accessCode });
  };
  ws.onmessage = (e) => {
    if (typeof e.data !== 'string') {
      player?.enqueue(e.data);
      return;
    }
    let msg;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }
    onServerMessage(msg);
  };
  ws.onclose = () => {
    const wasLive = live;
    cleanup();
    if (wasLive) {
      $('ended-msg').textContent = endReason || 'Santa had a wonderful time. Merry Christmas!';
      showOverlay('ov-ended');
    } else {
      showOverlay('ov-ready');
      setError(endReason || "Couldn't reach the North Pole. Is the server running?");
    }
  };
}

function onServerMessage(msg) {
  switch (msg.type) {
    case 'status':
      if (msg.state === 'live' && !live) goLive(msg.demo);
      if (msg.state === 'reconnecting') showCaption('(Reconnecting to the North Pole…)');
      if (msg.state === 'wrapping-up') $('timer').classList.add('wrapping');
      break;
    case 'transcript':
      if (msg.role === 'santa') {
        appendTranscript('santa', msg.text);
        showCaption(bubbles.santa.textContent);
        if (/ho,?\s*ho/i.test(bubbles.santa.textContent.slice(-40))) avatar.laugh();
      } else {
        appendTranscript('child', msg.text);
        awaitingSanta = true;
      }
      break;
    case 'interrupted':
      player?.clear();
      finishTurn();
      break;
    case 'turnComplete':
      finishTurn();
      break;
    case 'alert':
      showAlert(msg);
      break;
    case 'error':
      endReason = msg.message;
      break;
    case 'ended':
      if (!endReason && msg.reason === 'time-limit') endReason = 'The call reached its time limit.';
      break;
    default:
  }
}

function goLive(demo) {
  live = true;
  callStartedAt = Date.now();
  document.body.dataset.state = 'live';
  $('live-label').textContent = demo ? 'LIVE · Demo mode' : 'LIVE · North Pole';
  $('timer').hidden = false;
  $('timer').classList.remove('wrapping');
  $('controls').hidden = false;
  showOverlay(null);
  tickTimer = setInterval(tick, 100);
}

function tick() {
  const now = performance.now();
  if (player?.playing) avatar.setState('speaking');
  else if (now - lastChildSound < 700) avatar.setState('listening');
  else if (awaitingSanta && now - lastChildSound < 4000) avatar.setState('thinking');
  else avatar.setState('idle');

  document.body.classList.toggle('kid-talking', (pushToTalk ? pttDown : now - lastChildSound < 700) && !muted);

  const secs = Math.floor((Date.now() - callStartedAt) / 1000);
  $('timer').textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  if (secs >= targetMinutes * 60 - 75) $('timer').classList.add('wrapping');
}

function onMicChunk(pcm, level) {
  if (!live || ws?.readyState !== WebSocket.OPEN) return;
  const now = performance.now();
  if (muted) {
    avatar.setMicLevel(0);
    return;
  }

  if (pushToTalk) {
    if (!pttDown) return;
    avatar.setMicLevel(level);
    if (level > 0.02) lastChildSound = now;
    ws.send(pcm);
    return;
  }

  const santaTalking = player?.playing || now < gateUntil;
  if (santaTalking && !allowInterrupt) {
    // Keep the stream flowing with silence so Santa doesn't hear himself
    // through the classroom speakers.
    ws.send(new ArrayBuffer(pcm.byteLength));
    return;
  }
  avatar.setMicLevel(level);
  if (level > 0.03) lastChildSound = now;
  ws.send(pcm);
}

function pttStart() {
  if (!live || pttDown || muted) return;
  pttDown = true;
  player?.clear();
  sendJson({ type: 'activityStart' });
  $('ptt').classList.add('down');
}

function pttEnd() {
  if (!pttDown) return;
  pttDown = false;
  awaitingSanta = true;
  lastChildSound = performance.now();
  sendJson({ type: 'activityEnd' });
  $('ptt').classList.remove('down');
}

function toggleMute() {
  muted = !muted;
  if (muted) pttEnd();
  $('mute').classList.toggle('off', muted);
  $('mute').querySelector('.lbl').textContent = muted ? 'Unmute' : 'Mute';
  $('mute').querySelector('.ico').textContent = muted ? '🔇' : '🎙️';
}

function showAlert({ childName, reason }) {
  const card = document.createElement('div');
  card.className = 'alert';
  const title = document.createElement('strong');
  title.textContent = childName ? `Check in with ${childName}` : 'Check in with a child';
  const body = document.createElement('p');
  body.textContent = reason || 'Santa noticed something a grown-up should follow up on.';
  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'btn ghost small';
  dismiss.textContent = 'Got it';
  dismiss.addEventListener('click', () => card.remove());
  card.append(title, body, dismiss);
  $('alerts').prepend(card);
  if ($('helper').hidden) $('alert-badge').hidden = false;
}

function hangUp() {
  endReason = 'Santa had a wonderful time. Merry Christmas!';
  sendJson({ type: 'end' });
  setTimeout(() => ws?.close(), 300);
}

function cleanup() {
  live = false;
  pttDown = false;
  clearInterval(tickTimer);
  mic?.stop();
  player?.clear();
  ctx?.close().catch(() => {});
  mic = player = ctx = null;
  if (ws) {
    ws.onclose = null;
    if (ws.readyState <= WebSocket.OPEN) ws.close();
  }
  ws = null;
  document.body.dataset.state = 'idle';
  document.body.classList.remove('kid-talking');
  $('controls').hidden = true;
  $('timer').hidden = true;
  $('live-label').textContent = 'North Pole';
  avatar.setState('idle');
  finishTurn();
}

// ---------- Controls & keyboard ----------

$('call').addEventListener('click', startCall);
$('again').addEventListener('click', () => {
  $('transcript').replaceChildren();
  $('alerts').replaceChildren();
  renderKidChips();
  startCall();
});
$('hangup').addEventListener('click', hangUp);
$('mute').addEventListener('click', toggleMute);

const ptt = $('ptt');
ptt.addEventListener('pointerdown', (e) => {
  ptt.setPointerCapture(e.pointerId);
  pttStart();
});
for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) ptt.addEventListener(ev, pttEnd);

const typing = (e) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName);
window.addEventListener('keydown', (e) => {
  if (typing(e) || !live) return;
  if (e.code === 'Space' && pushToTalk) {
    e.preventDefault();
    if (!e.repeat) pttStart();
  } else if (e.key === 'h' || e.key === 'H') {
    toggleHelper();
  } else if (e.key === 'm' || e.key === 'M') {
    toggleMute();
  } else if (e.key === 'c' || e.key === 'C') {
    toggleCaptions();
  }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space' && pushToTalk) pttEnd();
});
window.addEventListener('blur', pttEnd);

// ---------- Server config ----------

fetch('/api/config')
  .then((r) => r.json())
  .then((cfg) => {
    if (cfg.needsAccessCode) {
      $('code-field').hidden = false;
      $('access-code').value = sessionStorage.getItem('callSanta.code') ?? '';
    }
    if (cfg.backend === 'mock') $('ov-sub').textContent = 'Demo mode: no AI is connected, so Santa will hum his lines. Everything else works for real.';
  })
  .catch(() => {});

// ---------- Snow outside the workshop window ----------

function startSnow(canvas) {
  const c = canvas.getContext('2d');
  const flakes = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), r: 0.6 + Math.random() * 2.2, s: 0.02 + Math.random() * 0.05, w: Math.random() * Math.PI * 2 }));
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  function draw(t) {
    const { clientWidth: w, clientHeight: h } = canvas;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    c.clearRect(0, 0, w, h);
    c.fillStyle = 'rgba(255,255,255,0.9)';
    for (const f of flakes) {
      if (!reduce) {
        f.y += f.s / 60;
        f.x += Math.sin(t / 1500 + f.w) * 0.0006;
        if (f.y > 1.05) {
          f.y = -0.05;
          f.x = Math.random();
        }
      }
      c.beginPath();
      c.arc(f.x * w, f.y * h, f.r, 0, Math.PI * 2);
      c.fill();
    }
    requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
}
