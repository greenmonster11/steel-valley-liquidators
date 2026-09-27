import { VOICES, buildSantaPrompt, parseRoster } from '/shared/santa-prompt.js';
import { DEFAULT_PROFILE, EXAMPLE_PROFILE, loadProfile, saveProfile } from '/js/profile-store.js';

const form = document.getElementById('setup');
const childrenEl = document.getElementById('children');
const childTpl = document.getElementById('child-row');
const saveState = document.getElementById('save-state');
const preview = document.getElementById('prompt-preview');
const countEl = document.getElementById('child-count');

const TEXT_FIELDS = ['hostName', 'groupName', 'grade', 'location', 'recentNews', 'mentions', 'avoid', 'voice', 'callMinutes'];
const RADIO_FIELDS = ['mode', 'realness', 'talkMode'];

// Voices
const voiceSelect = document.getElementById('voice');
for (const v of VOICES) voiceSelect.add(new Option(v.label, v.id));

function addChildRow(child = {}) {
  const row = childTpl.content.firstElementChild.cloneNode(true);
  row.querySelector('.c-name').value = child.name ?? '';
  row.querySelector('.c-say').value = child.sayItLike ?? '';
  row.querySelector('.c-age').value = child.age ?? '';
  row.querySelector('.c-facts').value = child.facts ?? '';
  row.querySelector('.c-remove').addEventListener('click', () => {
    row.remove();
    onChange();
  });
  childrenEl.append(row);
  return row;
}

function readForm() {
  const data = { ...DEFAULT_PROFILE };
  for (const name of TEXT_FIELDS) data[name] = form.elements[name].value;
  for (const name of RADIO_FIELDS) data[name] = form.querySelector(`input[name="${name}"]:checked`)?.value ?? DEFAULT_PROFILE[name];
  data.allowInterrupt = form.elements.allowInterrupt.checked;
  data.callMinutes = Number(data.callMinutes);
  data.children = [...childrenEl.querySelectorAll('.child')]
    .map((row) => ({
      name: row.querySelector('.c-name').value.trim(),
      sayItLike: row.querySelector('.c-say').value.trim(),
      age: row.querySelector('.c-age').value.trim(),
      facts: row.querySelector('.c-facts').value.trim(),
    }))
    .filter((c) => c.name || c.facts);
  return data;
}

function fillForm(p) {
  for (const name of TEXT_FIELDS) form.elements[name].value = p[name] ?? '';
  for (const name of RADIO_FIELDS) {
    const input = form.querySelector(`input[name="${name}"][value="${p[name]}"]`);
    if (input) input.checked = true;
  }
  form.elements.allowInterrupt.checked = Boolean(p.allowInterrupt);
  childrenEl.replaceChildren();
  for (const c of p.children ?? []) addChildRow(c);
  if (!childrenEl.children.length) addChildRow();
  applyMode(p.mode);
  refresh();
}

function applyMode(mode) {
  const family = mode === 'family';
  document.querySelectorAll('[data-classroom]').forEach((el) => { el.hidden = family; });
  document.querySelectorAll('[data-family]').forEach((el) => { el.hidden = !family; });
  document.body.dataset.mode = mode;
}

function refresh() {
  const p = readForm();
  preview.textContent = buildSantaPrompt(p);
  const n = p.children.filter((c) => c.name).length;
  countEl.textContent = `${n} ${n === 1 ? 'kid' : 'kids'}`;
  return p;
}

let saveTimer;
function onChange() {
  const p = refresh();
  saveState.textContent = 'Saving…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveState.textContent = saveProfile(p) ? 'Saved on this device' : "Couldn't save in this browser (private mode?)";
  }, 300);
}

form.addEventListener('input', onChange);
form.addEventListener('change', (e) => {
  if (e.target.name === 'mode') {
    applyMode(e.target.value);
    // Sensible defaults: interruptions feel natural one-on-one, chaotic in a classroom.
    form.elements.allowInterrupt.checked = e.target.value === 'family';
  }
  onChange();
});

document.getElementById('add-child').addEventListener('click', () => {
  addChildRow().querySelector('.c-name').focus();
  onChange();
});

const pasteBox = document.getElementById('paste-box');
document.getElementById('toggle-paste').addEventListener('click', () => {
  pasteBox.hidden = !pasteBox.hidden;
  if (!pasteBox.hidden) document.getElementById('paste-text').focus();
});
document.getElementById('paste-add').addEventListener('click', () => {
  const textarea = document.getElementById('paste-text');
  const kids = parseRoster(textarea.value);
  // Replace a lone empty row rather than leaving it dangling at the top.
  const rows = [...childrenEl.querySelectorAll('.child')];
  if (rows.length === 1 && !rows[0].querySelector('.c-name').value && !rows[0].querySelector('.c-facts').value) rows[0].remove();
  for (const k of kids) addChildRow(k);
  textarea.value = '';
  pasteBox.hidden = true;
  onChange();
});

document.getElementById('example').addEventListener('click', () => {
  fillForm(EXAMPLE_PROFILE);
  onChange();
});

document.getElementById('export').addEventListener('click', () => {
  const p = readForm();
  const blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `santa-call-${(p.groupName || p.mode).replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

document.getElementById('import').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const p = { ...DEFAULT_PROFILE, ...JSON.parse(await file.text()) };
    fillForm(p);
    onChange();
  } catch {
    alert("That file doesn't look like a Call Santa setup.");
  }
  e.target.value = '';
});

document.getElementById('go').addEventListener('click', () => {
  saveProfile(readForm());
});

// Tell the grown-up what the server is connected to.
fetch('/api/config')
  .then((r) => r.json())
  .then((cfg) => {
    const note = document.getElementById('backend-note');
    if (cfg.backend === 'mock') {
      note.innerHTML = '<strong>Demo mode.</strong> No AI is connected yet, so Santa will hum canned lines instead of talking. You can still try the whole call screen. See the README to connect Gemini.';
      note.hidden = false;
    } else if (cfg.backend === 'gemini-api') {
      note.innerHTML = "<strong>Testing mode.</strong> This server uses the Gemini Developer API, whose terms don't allow use by anyone under 18. Test it yourself, then switch to the Vertex AI backend before calling with kids.";
      note.classList.add('warn');
      note.hidden = false;
    }
  })
  .catch(() => {});

fillForm(loadProfile() ?? DEFAULT_PROFILE);
