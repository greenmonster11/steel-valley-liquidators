// Keeps the call setup in this browser only (localStorage), so children's
// names and notes never sit on the server between calls.

const KEY = 'callSanta.profile.v1';

export const DEFAULT_PROFILE = {
  mode: 'classroom',
  hostName: '',
  groupName: '',
  grade: '',
  location: '',
  recentNews: '',
  mentions: '',
  avoid: '',
  children: [],
  voice: 'Algenib',
  callMinutes: 10,
  realness: 'magic',
  talkMode: 'handsfree',
  allowInterrupt: false,
};

export const EXAMPLE_PROFILE = {
  ...DEFAULT_PROFILE,
  hostName: 'Mrs. Alvarez',
  groupName: 'Room 12, the Busy Bees',
  grade: '1st grade',
  location: 'Pittsburgh',
  recentNews: 'Learning about penguins and the Arctic. Reading The Polar Express. Practicing "Jingle Bells" for the winter concert on December 12.',
  mentions: 'Remind them to include everyone at recess. They just celebrated 100 days of school!',
  avoid: '',
  children: [
    { name: 'Emma', sayItLike: '', age: '', facts: 'Lost her first tooth last week; loves dinosaurs' },
    { name: 'Liam', sayItLike: '', age: '', facts: 'Has a brand new baby sister; great at soccer' },
    { name: 'Siobhan', sayItLike: 'shih-VAWN', age: '', facts: 'Drew a beautiful penguin for the class wall' },
    { name: 'Mateo', sayItLike: '', age: '', facts: 'Learning to read chapter books; very helpful cleaning up' },
    { name: 'Ava', sayItLike: '', age: '', facts: 'Loves to sing; has a puppy named Biscuit' },
  ],
};

export function loadProfile() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULT_PROFILE, ...JSON.parse(raw) } : null;
  } catch {
    return null;
  }
}

export function saveProfile(profile) {
  try {
    localStorage.setItem(KEY, JSON.stringify(profile));
    return true;
  } catch {
    return false;
  }
}
