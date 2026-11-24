// Hardcoded routine. Edit here when the plan changes.

export const PHASE3_START = '2026-11-23';

// Main compounds use Phase 3 top-set / back-off blocks.
export const MAIN = {
  top: { sets: 1, range: [3, 5], rir: '0–1' },
  backoff: { sets: 3, range: [8, 10], rir: '1–2' },
  backoffFloor: 0.75,
  backoffInitial: 0.78,
};

export const EX = {
  bench: { name: 'Barbell Bench Press', short: 'Bench', kind: 'main', inc: 5 },
  sp: { name: 'Seated DB Shoulder Press', short: 'Shoulder Press', kind: 'main', inc: 5, unit: 'per hand' },
  pec_fly: { name: 'Pec Fly', short: 'Pec Fly', kind: 'acc', range: [10, 12], sets: 3, inc: 5 },
  triceps: { name: 'Triceps Rope Pushdown', short: 'Triceps', kind: 'acc', range: [10, 12], sets: 3, inc: 5 },
  ab_crunch: { name: 'Ab Crunch Machine', short: 'Ab Crunch', kind: 'acc', range: [8, 15], sets: 3, inc: 5 },
  knee_raise: { name: 'Hanging Knee Raise', short: 'Knee Raise', kind: 'acc', range: [8, 15], sets: 3, inc: 2.5, added: true },
  pulldown: { name: 'Lat Pulldown', short: 'Pulldown', kind: 'main', inc: 5 },
  row: { name: 'Seated Cable Row', short: 'Row', kind: 'main', inc: 5 },
  rev_fly: { name: 'Reverse Fly (Machine)', short: 'Rev Fly', kind: 'acc', range: [8, 15], sets: 3, inc: 5 },
  curl: { name: 'Seated DB Curl', short: 'Curl', kind: 'acc', range: [8, 15], sets: 3, inc: 2.5, unit: 'per hand' },
  side_lean: { name: 'Cable Side Lean', short: 'Side Lean', kind: 'acc', range: [8, 12], sets: 3, inc: 5, unit: 'per side' },
  leg_press: { name: 'Leg Press', short: 'Leg Press', kind: 'main', inc: 10 },
  leg_curl: { name: 'Lying Leg Curl', short: 'Leg Curl', kind: 'main', inc: 5 },
  rdl: { name: 'RDL (Barbell)', short: 'RDL', kind: 'main', inc: 5 },
  leg_ext: { name: 'Leg Extension', short: 'Leg Ext', kind: 'acc', range: [8, 15], sets: 3, inc: 5 },
  calf: { name: 'Standing Calf Raise', short: 'Calf', kind: 'acc', range: [8, 15], sets: 3, inc: 10 },
  adductor: { name: 'Adductor Machine', short: 'Adductor', kind: 'acc', range: [8, 12], sets: 3, inc: 5 },
  abductor: { name: 'Abductor Machine', short: 'Abductor', kind: 'acc', range: [8, 12], sets: 3, inc: 5 },
  gripper: { name: 'Home Gripper', short: 'Gripper', kind: 'acc', range: [8, 12], sets: 3, inc: 5, rirToBump: 3, unit: 'per hand' },
};

export const DAYS = {
  push: { title: 'Push (Day A)', tab: 'Push', group: 'push', lifts: ['bench', 'sp', 'pec_fly', 'triceps', 'ab_crunch', 'knee_raise'], warm: true, cool: true },
  intervals: { title: 'Intervals · 4×4', tab: 'Int', group: 'intervals', cardio: 'intervals', lifts: ['gripper'] },
  pull: { title: 'Pull (Day B)', tab: 'Pull', group: 'pull', lifts: ['pulldown', 'row', 'rev_fly', 'curl', 'ab_crunch', 'side_lean'], warm: true, cool: true },
  rest: { title: 'Rest day', tab: 'Rest', group: 'rest', lifts: ['gripper'] },
  legs: { title: 'Legs (Day C)', tab: 'Legs', group: 'legs', lifts: ['leg_press', 'leg_curl', 'rdl', 'leg_ext', 'calf', 'ab_crunch', 'knee_raise'], warm: true },
  z2sat: { title: 'Zone 2', tab: 'Z2', group: 'z2', cardio: 'z2', lifts: ['gripper'] },
  z2sun: { title: 'Zone 2 + Hip', tab: 'Z2', group: 'z2', cardio: 'z2', lifts: ['adductor', 'abductor'] },
};

// Mon..Sun
export const WEEK = ['push', 'intervals', 'pull', 'rest', 'legs', 'z2sat', 'z2sun'];

// Sessions expected per Mon–Sun week, by group (used for gap detection).
export const WEEKLY_EXPECTED = { push: 1, intervals: 1, pull: 1, legs: 1, z2: 2 };

export const GROUP_LABEL = { push: 'Push', intervals: 'Intervals', pull: 'Pull', legs: 'Legs', z2: 'Zone 2' };
export const GROUP_DEFAULT_DAY = { push: 'push', intervals: 'intervals', pull: 'pull', legs: 'legs', z2: 'z2sun' };

export const Z2 = { hr: [138, 152], modalities: ['Bike', 'Incline walk', 'Stairmaster', 'Elliptical', 'Rower'] };
export const INTERVALS = { reps: 4, modalities: ['Bike', 'Stairmaster', 'Treadmill', 'Rower'] };

export const MEALS = {
  standard: { am: 'STD-AM', lunch: 'GC', snack: 'STD-SNK', dinner: 'GC' },
  standardLabel: 'STD-AM · GC 10/0.5 · STD-SNK · GC 10/0.5',
  slots: [
    ['am', 'Morning', ['STD-AM', 'Skip', 'Other']],
    ['lunch', 'Lunch', ['GC', 'SPAG', 'BURG', 'GYU', 'Other']],
    ['snack', 'Snack', ['STD-SNK', 'Skip', 'Other']],
    ['dinner', 'Dinner', ['GC', 'SPAG', 'BURG', 'GYU', 'Other']],
  ],
};

export const MAIN_LIFTS = Object.keys(EX).filter((k) => EX[k].kind === 'main');
