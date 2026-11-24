import { EX, MAIN } from './routine.js';

const floorTo = (x, inc) => Math.floor(x / inc + 1e-9) * inc;
const roundTo = (x, inc) => Math.round(x / inc) * inc;

export function lastEntry(sessions, exId) {
  for (let i = sessions.length - 1; i >= 0; i--) {
    const s = sessions[i];
    if (s.skipped) continue;
    const lift = (s.lifts || []).find((l) => l.ex === exId);
    if (lift && lift.blocks.some((b) => b.reps.length)) return { date: s.date, lift };
  }
  return null;
}

// Sets performed at the heaviest weight in the entry, plus the lowest RIR among them.
function working(lift) {
  const w = Math.max(...lift.blocks.map((b) => b.w));
  const blocks = lift.blocks.filter((b) => b.w === w);
  return { w, reps: blocks.flatMap((b) => b.reps), rir: Math.min(...blocks.map((b) => b.rir ?? 0)) };
}

function mainRec(ex, last) {
  const top = last.lift.blocks.find((b) => b.kind === 'top');
  const bo = last.lift.blocks.find((b) => b.kind === 'backoff');
  let topW, boW, status;

  if (top) {
    const topBump = Math.max(...top.reps) >= MAIN.top.range[1];
    topW = topBump ? top.w + ex.inc : top.w;
    const boBump = !!bo && bo.reps.length >= MAIN.backoff.sets && Math.min(...bo.reps) >= MAIN.backoff.range[1];
    boW = bo ? bo.w + (boBump ? ex.inc : 0) : roundTo(topW * MAIN.backoffInitial, ex.inc);
    boW = Math.max(boW, roundTo(topW * MAIN.backoffFloor, ex.inc));
    status = topBump || boBump ? 'bump' : 'hold';
  } else {
    // First top/back-off session: estimate a 5RM from the last flat sets (Epley, reps + RIR).
    const { w, reps, rir } = working(last.lift);
    const e1rm = w * (1 + (Math.min(...reps) + rir) / 30);
    topW = floorTo(e1rm / (1 + 5 / 30), ex.inc);
    boW = roundTo(topW * MAIN.backoffInitial, ex.inc);
    status = 'est';
  }

  return {
    status,
    blocks: [
      { kind: 'top', w: topW, sets: MAIN.top.sets, range: MAIN.top.range, rir: MAIN.top.rir },
      { kind: 'backoff', w: boW, sets: MAIN.backoff.sets, range: MAIN.backoff.range, rir: MAIN.backoff.rir },
    ],
  };
}

function accRec(ex, last) {
  const { w, reps, rir } = working(last.lift);
  const bump = reps.length >= ex.sets && Math.min(...reps) >= ex.range[1] && (!ex.rirToBump || rir >= ex.rirToBump);
  return {
    status: bump ? 'bump' : 'hold',
    blocks: [{ kind: 'work', w: bump ? w + ex.inc : w, sets: ex.sets, range: ex.range, rir: ex.rirToBump ? `${ex.rirToBump}+` : '1–2' }],
  };
}

export function recommend(exId, sessions) {
  const ex = EX[exId];
  const last = lastEntry(sessions, exId);
  if (!last) {
    const blocks = ex.kind === 'main'
      ? [{ kind: 'top', w: 0, ...MAIN.top }, { kind: 'backoff', w: 0, ...MAIN.backoff }]
      : [{ kind: 'work', w: 0, sets: ex.sets, range: ex.range, rir: '1–2' }];
    return { status: 'new', blocks, last: null };
  }
  const rec = ex.kind === 'main' ? mainRec(ex, last) : accRec(ex, last);
  return { ...rec, last };
}
