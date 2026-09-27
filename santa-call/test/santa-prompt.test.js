import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LIMITS,
  buildSantaPrompt,
  normalizeProfile,
  parseRoster,
  stageDirection,
  STAGE_DIRECTION_PREFIX,
} from '../shared/santa-prompt.js';

test('normalizeProfile bounds and defaults untrusted input', () => {
  const p = normalizeProfile({
    mode: 'party',
    hostName: '  Mrs.   Alvarez  ',
    voice: 'NotAVoice',
    callMinutes: '999',
    realness: 'weird',
    children: [
      { name: 'Emma', facts: 'x'.repeat(1000) },
      { name: '', facts: 'orphan fact' },
      ...Array.from({ length: 60 }, (_, i) => ({ name: `Kid${i}` })),
    ],
  });
  assert.equal(p.mode, 'classroom');
  assert.equal(p.hostName, 'Mrs. Alvarez');
  assert.equal(p.voice, 'Algenib');
  assert.equal(p.callMinutes, 30);
  assert.equal(p.realness, 'magic');
  assert.equal(p.children.length, LIMITS.children);
  assert.equal(p.children[0].facts.length, LIMITS.facts);
  assert.ok(p.children.every((c) => c.name));
});

test('classroom prompt includes the class, kids, and safety rules', () => {
  const prompt = buildSantaPrompt({
    mode: 'classroom',
    hostName: 'Mrs. Alvarez',
    groupName: 'Room 12',
    grade: '1st grade',
    recentNews: 'Learning about penguins',
    children: [{ name: 'Siobhan', sayItLike: 'shih-VAWN', facts: 'Drew a penguin' }],
    avoid: "Don't mention pets",
    callMinutes: 15,
  });
  assert.match(prompt, /Room 12 \(1st grade\)/);
  assert.match(prompt, /Mrs\. Alvarez/);
  assert.match(prompt, /Learning about penguins/);
  assert.match(prompt, /- Siobhan \(pronounced "shih-VAWN"\): Drew a penguin/);
  assert.match(prompt, /Never promise a specific present/);
  assert.match(prompt, /notify_grown_up/);
  assert.match(prompt, /Don't mention pets/);
  assert.match(prompt, /about 15 minutes/);
  assert.match(prompt, /one at a time/);
  assert.ok(prompt.includes(STAGE_DIRECTION_PREFIX));
});

test('family prompt and realness setting change the instructions', () => {
  const magic = buildSantaPrompt({ mode: 'family' });
  const honest = buildSantaPrompt({ mode: 'family', realness: 'honest' });
  assert.match(magic, /a family/);
  assert.match(magic, /ask each child their name/);
  assert.match(magic, /North Pole magic/);
  assert.match(honest, /computer version of Santa/);
  assert.doesNotMatch(honest, /North Pole magic!/);
});

test('stageDirection wraps and trims helper notes', () => {
  const note = stageDirection(`  Emma is up next.  ${'x'.repeat(1000)}`);
  assert.ok(note.startsWith(`${STAGE_DIRECTION_PREFIX}: Emma is up next.`));
  assert.ok(note.endsWith(']'));
  assert.ok(note.length < 460);
});

test('parseRoster handles common pasted formats', () => {
  const kids = parseRoster([
    'Emma: lost her first tooth, loves dinosaurs',
    'Liam - new baby sister',
    '2. Mary-Kate – great at art',
    '• Sofia',
    '',
    'Noah, plays soccer',
  ].join('\n'));
  assert.deepEqual(
    kids.map((k) => [k.name, k.facts]),
    [
      ['Emma', 'lost her first tooth, loves dinosaurs'],
      ['Liam', 'new baby sister'],
      ['Mary-Kate', 'great at art'],
      ['Sofia', ''],
      ['Noah', 'plays soccer'],
    ],
  );
});
