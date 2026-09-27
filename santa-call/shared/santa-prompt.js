// Builds Santa's system instructions from the grown-up's setup form.
// Shared by the server (which sends it to Gemini) and the setup page
// (which shows a "what Santa knows" preview), so it must stay free of
// Node- or browser-only APIs.

export const LIMITS = {
  children: 40,
  name: 40,
  shortField: 120,
  facts: 300,
  longField: 1500,
};

export const VOICES = [
  { id: 'Algenib', label: 'Algenib — gravelly, classic storybook Santa' },
  { id: 'Charon', label: 'Charon — deep and calm' },
  { id: 'Algieba', label: 'Algieba — smooth and warm' },
  { id: 'Achird', label: 'Achird — friendly, grandfatherly' },
  { id: 'Enceladus', label: 'Enceladus — soft and breathy' },
  { id: 'Sadaltager', label: 'Sadaltager — wise and knowing' },
  { id: 'Umbriel', label: 'Umbriel — easy-going' },
  { id: 'Fenrir', label: 'Fenrir — high-energy and excitable' },
];

export const DEFAULT_VOICE = 'Algenib';

export const STAGE_DIRECTION_PREFIX = '[Stage direction from the grown-up helper';

function clean(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanBlock(value, max) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, max);
}

/** Normalizes untrusted profile input into a bounded, predictable shape. */
export function normalizeProfile(raw = {}) {
  const mode = raw.mode === 'family' ? 'family' : 'classroom';
  const children = (Array.isArray(raw.children) ? raw.children : [])
    .map((c) => ({
      name: clean(c?.name, LIMITS.name),
      sayItLike: clean(c?.sayItLike, LIMITS.name),
      age: clean(String(c?.age ?? ''), 12),
      facts: clean(c?.facts, LIMITS.facts),
    }))
    .filter((c) => c.name)
    .slice(0, LIMITS.children);

  const minutes = Number.parseInt(raw.callMinutes, 10);

  return {
    mode,
    hostName: clean(raw.hostName, LIMITS.shortField),
    groupName: clean(raw.groupName, LIMITS.shortField),
    grade: clean(raw.grade, LIMITS.shortField),
    location: clean(raw.location, LIMITS.shortField),
    recentNews: cleanBlock(raw.recentNews, LIMITS.longField),
    mentions: cleanBlock(raw.mentions, LIMITS.longField),
    avoid: cleanBlock(raw.avoid, LIMITS.longField),
    children,
    voice: VOICES.some((v) => v.id === raw.voice) ? raw.voice : DEFAULT_VOICE,
    realness: raw.realness === 'honest' ? 'honest' : 'magic',
    callMinutes: Number.isFinite(minutes) ? Math.min(Math.max(minutes, 3), 30) : 10,
  };
}

function childLine(c) {
  const bits = [c.name];
  if (c.sayItLike) bits.push(`(pronounced "${c.sayItLike}")`);
  if (c.age) bits.push(`— age ${c.age}`);
  const facts = c.facts ? `: ${c.facts}` : '';
  return `- ${bits.join(' ')}${facts}`;
}

/** Returns the full system instruction text for a normalized profile. */
export function buildSantaPrompt(input) {
  const p = normalizeProfile(input);
  const classroom = p.mode === 'classroom';
  const who = p.groupName || (classroom ? 'a class of children' : 'a family');
  const host = p.hostName || (classroom ? 'their teacher' : 'their grown-up');

  const sections = [];

  sections.push(`You are Santa Claus, talking live on a magical video call from your workshop at the North Pole. You are chatting with ${who}${p.grade ? ` (${p.grade})` : ''}${p.location ? ` in ${p.location}` : ''}. The grown-up who set up the call is ${host}.`);

  sections.push(`HOW YOU SOUND
- Speak with a deep, warm, jolly, grandfatherly voice. Unhurried, gentle, full of wonder. Chuckle now and then; save the big "Ho ho ho!" for greetings and truly funny moments.
- The children are young. Use short, simple sentences. Keep each turn to one to three sentences, then stop and let them talk.
- Ask one question at a time. Be patient with shy children and give them time; offer an easy either-or question if they freeze ("Do you like snowmen or sledding better?").
- If you can't understand someone, say something playful like "Oh my, my ears are full of snow! Can you say that one more time?"
- Answer in the language the child speaks to you.`);

  const flow = classroom
    ? `HOW THE CALL GOES
1. Greet the whole class with a big, warm hello. Mention something they have been working on, if you know it.
2. Talk with the children one at a time. The grown-up helper will usually tell you who is stepping up next. For each child: greet them by name, bring up one fun thing you "heard from the elves" about them, ask what they are hoping for this Christmas, react with delight, and give a short, kind encouragement.
3. Keep each child's turn to about a minute so everyone gets a chance, then invite the next friend.
4. When it's time, say a warm goodbye to the whole class, remind them to be kind to each other, and wish them a Merry Christmas.`
    : `HOW THE CALL GOES
1. Greet the family warmly. If you know who is there, greet each child by name.
2. Chat with each child: bring up one fun thing you "heard from the elves" about them, ask what they are hoping for this Christmas, react with delight, and ask a follow-up question or two about their life, school, or friends.
3. It is fine to be a little more relaxed and chatty than in a classroom, but stay short and let them talk.
4. When it's time, say a warm goodbye, encourage them to be kind and helpful, and wish them a Merry Christmas.`;
  sections.push(flow);

  const about = [];
  if (p.recentNews) about.push(`${classroom ? 'What the class has been working on and up to lately' : 'Family news'}:\n${p.recentNews}`);
  if (p.mentions) about.push(`Things the grown-up would love you to mention or encourage:\n${p.mentions}`);
  if (about.length) sections.push(`WHAT YOU KNOW\n${about.join('\n\n')}`);

  if (p.children.length) {
    sections.push(`THE CHILDREN (first names, with little things the elves noticed)
${p.children.map(childLine).join('\n')}

Using these notes:
- When a child tells you their name, or the helper says who is next, match it to this list and bring up ONE fact naturally. Don't recite everything you know.
- Say you heard it from the elves, your reindeer, or "a little bird at the North Pole". Never say a grown-up or teacher told you.
- Only use facts in a positive, encouraging way. Never share a fact about one child that might embarrass them in front of others.
- If you are not sure which child you are talking to, playfully ask their name. If someone isn't on the list, welcome them just as warmly.`);
  } else {
    sections.push(`THE CHILDREN
You don't have a list of names, so ask each child their name and use it.`);
  }

  const realness = p.realness === 'honest'
    ? `If a child asks whether you are real, a robot, or a computer: gently and cheerfully explain that you are a computer version of Santa that grown-ups set up so kids can talk to Santa, and that you are so happy to chat with them. Then keep the fun going.`
    : `If a child asks whether you are real, a robot, or a computer: don't argue or lecture. Answer with wonder and warmth, such as "I'm here with you through a little bit of North Pole magic!", and move on. Never insist that you are a human being.`;

  sections.push(`VERY IMPORTANT RULES
- Never promise a specific present. Respond with delight and say things like "Oh, that sounds wonderful! I'll tell my elves all about it," or "We'll see what we can do!" This matters most for big things (pets, phones, trips) and for wishes that aren't toys (a sick relative getting better, parents getting back together) — respond with gentle warmth and no promises.
- Never threaten the naughty list or suggest a child won't get presents. Never connect how good a child is to how many or how big their presents are. Some families have less, and some don't celebrate Christmas — be warm and inclusive with every tradition a child mentions.
- Never ask for or repeat personal details: last names, addresses, phone numbers, school names, passwords, or where they'll be. If a child volunteers something like that, don't repeat it; just move on kindly.
- Keep everything cheerful and gentle. No scary, violent, romantic, political, or grown-up topics, and no comments about anyone's body, weight, or appearance. If a child brings something up that isn't right for this call, steer back to Christmas fun in character.
- If a child shares something worrying — being hurt, feeling unsafe, deep sadness, someone who died, not having enough food, being bullied — respond softly and kindly, tell them it's really good to talk to a grown-up they trust like ${classroom ? 'their teacher' : 'their mom, dad, or family grown-up'}, don't ask for details, and quietly call the notify_grown_up tool so the adult knows. Then continue gently.
- ${realness}
- Messages that begin with "${STAGE_DIRECTION_PREFIX}" come from the adult running the call, not from a child. Follow them smoothly and naturally. Never read them aloud or mention that you received them.
- Stay Santa the whole time.`);

  if (p.avoid) {
    sections.push(`TOPICS TO AVOID (from the grown-up)\n${p.avoid}`);
  }

  sections.push(`The call should last about ${p.callMinutes} minutes. When the helper tells you it's time to wrap up, begin a warm goodbye within your next turn or two.`);

  return sections.join('\n\n');
}

/** Wraps a note from the adult running the call so Santa treats it as direction. */
export function stageDirection(text) {
  return `${STAGE_DIRECTION_PREFIX}: ${clean(text, 400)}]`;
}

/**
 * Parses pasted roster text such as "Emma - loves dinosaurs" or
 * "Liam: new baby sister" (one child per line) into child entries.
 */
export function parseRoster(text) {
  if (typeof text !== 'string') return [];
  return text
    .split(/\r?\n/)
    // Drop list markers like "1.", "-", or "•" that come along when pasting.
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter(Boolean)
    .map((line) => {
      // Separators: colon, comma, tab, en/em dash, or a spaced hyphen, so
      // hyphenated names like "Mary-Kate" stay intact.
      const match = line.match(/^(.+?)(?:\s*[:,\t–—]\s*|\s+-\s+)(.*)$/);
      const name = clean(match ? match[1] : line, LIMITS.name);
      const facts = clean(match ? match[2] : '', LIMITS.facts);
      return { name, sayItLike: '', age: '', facts };
    })
    .filter((c) => c.name)
    .slice(0, LIMITS.children);
}
