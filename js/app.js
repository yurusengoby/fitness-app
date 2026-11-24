import {
  EX, DAYS, WEEK, MAIN, PHASE3_START, WEEKLY_EXPECTED, GROUP_LABEL, GROUP_DEFAULT_DAY, Z2, INTERVALS, MEALS, MAIN_LIFTS,
} from './routine.js';
import { recommend, lastEntry } from './engine.js';
import {
  state, loadLocal, view, enqueue, sync, onChange, saveSettings, saveDrafts, validSettings, testConnection,
} from './data.js';

const $app = document.getElementById('app');
const ui = { histTab: 'sessions', liftSel: 'bench', msg: '', daily: null };

// ---------- utils ----------
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
const pad = (n) => String(n).padStart(2, '0');
const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayISO = () => isoOf(new Date());
const parse = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (iso, n) => { const d = parse(iso); d.setDate(d.getDate() + n); return isoOf(d); };
const dow = (iso) => (parse(iso).getDay() + 6) % 7;
const monday = (iso) => addDays(iso, -dow(iso));
const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
const fmtDay = (iso) => parse(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
const fmtMD = (iso) => iso.slice(5);
const fmtW = (w) => (Number.isInteger(w) ? String(w) : w.toFixed(1));
const num = (v) => (v === '' || v == null || Number.isNaN(+v) ? null : +v);
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

function phaseLabel(iso) {
  if (iso < PHASE3_START) return 'Phase 2';
  return `Phase 3 · Wk ${Math.floor(daysBetween(PHASE3_START, iso) / 7) + 1}`;
}

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => o?.[k], obj);
}
function setPath(obj, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  keys.reduce((o, k) => o[k], obj)[last] = value;
}

// ---------- routing ----------
function route() {
  const [path, qs] = (location.hash.slice(2) || 'today').split('?');
  return { parts: path.split('/'), q: new URLSearchParams(qs || '') };
}

function render() {
  const { parts, q } = route();
  const views = { today: renderToday, session: renderSession, history: renderHistory, checkin: renderCheckin, settings: renderSettings };
  $app.innerHTML = (views[parts[0]] || renderToday)(parts, q);
}

// ---------- shell ----------
function statusHtml() {
  let dot = '', text = 'synced';
  if (!validSettings()) { dot = 'off'; text = 'not connected'; }
  else if (state.status === 'syncing') { dot = 'queued'; text = 'syncing…'; }
  else if (state.status === 'error') { dot = 'err'; text = 'sync error'; }
  else if (state.queue.length) { dot = 'queued'; text = `${state.queue.length} queued`; }
  else if (state.status === 'offline') { dot = 'off'; text = 'offline'; }
  return `<a class="sync" id="sync-status" href="#/settings"><span class="dot ${dot}"></span>${text}</a>`;
}

function dayTabs(active) {
  const todayKey = WEEK[dow(todayISO())];
  return `<nav class="daytabs">${WEEK.map((k, i) =>
    `<a href="#/session/${k}" class="${k === todayKey ? 'today' : ''} ${k === active ? 'active' : ''}"><b>${'MTWTFSS'[i]}</b>${DAYS[k].tab}</a>`).join('')}</nav>`;
}

function bottomNav(active) {
  const items = [['today', '●', 'Today'], ['history', '▤', 'History'], ['checkin', '◔', 'Body'], ['settings', '⚙', 'Settings']];
  return `<nav class="bottom">${items.map(([k, ico, label]) =>
    `<a href="#/${k}" class="${k === active ? 'active' : ''}"><span class="ico">${ico}</span>${label}</a>`).join('')}</nav>`;
}

function shell({ title, sub, tabs, nav, body, footer = '' }) {
  return `<div class="app">
    <header class="top">
      <div class="row"><div><h1>${esc(title)}</h1><div class="sub">${esc(sub)}</div></div>${statusHtml()}</div>
      ${tabs ? dayTabs(tabs) : ''}
    </header>
    <main>${body}</main>
    ${footer}
    ${bottomNav(nav)}
  </div>`;
}

const pill = (status) => {
  const map = { bump: ['bump', 'Bump'], hold: ['hold', 'Hold'], est: ['main', 'Est.'], new: ['main', 'New'] };
  const [cls, label] = map[status] || map.hold;
  return `<span class="pill ${cls}">${label}</span>`;
};

function liftSummary(lift) {
  const parts = lift.blocks.map((b) => `${b.reps.join(',')} @ ${fmtW(b.w)}`);
  const rir = Math.min(...lift.blocks.map((b) => b.rir ?? 0));
  return `${parts.join(' · ')} · RIR ${rir}`;
}

function cardioSummary(c) {
  if (!c) return '';
  if (c.segments) return c.segments.map((s) => `${esc(s.modality)} ${s.min} min · HR ${s.hr}`).join('<br>');
  if (c.kind === 'z2') return `${esc(c.modality || 'Z2')} · ${c.min ?? '?'} min${c.hr ? ` · HR ${c.hr}` : ''}`;
  const hard = (c.reps || []).map((r) => r.hard).filter(Boolean);
  return `4×4 · ${esc(c.modality || '')}${hard.length ? ` · hard ${Math.min(...hard)}–${Math.max(...hard)}` : ' · HR not recorded'}`;
}

// ---------- Today ----------
function bodyStats() {
  const body = view('body');
  const today = todayISO();
  const inRange = (from, to) => body.filter((e) => e.weight != null && e.date >= from && e.date <= to).map((e) => e.weight);
  const wNow = avg(inRange(addDays(today, -6), today));
  const wPrev = avg(inRange(addDays(today, -13), addDays(today, -7)));
  const lastW = [...body].reverse().find((e) => e.weight != null);
  const muscles = body.filter((e) => e.muscle != null && e.weight != null).map((e) => e.weight * e.muscle / 100);
  const rhr = [...body].reverse().find((e) => e.rhr != null);
  return { wNow: wNow ?? lastW?.weight ?? null, wIsAvg: wNow != null, wDelta: wNow != null && wPrev != null ? wNow - wPrev : null,
    muscle: muscles.at(-1) ?? null, muscleDelta: muscles.length > 1 ? muscles.at(-1) - muscles.at(-2) : null, rhr: rhr?.rhr ?? null };
}

const signed = (x, d = 1) => (x > 0 ? '+' : x < 0 ? '−' : '±') + Math.abs(x).toFixed(d);

function renderToday() {
  const today = todayISO();
  const key = WEEK[dow(today)];
  const day = DAYS[key];
  const sessions = view('sessions');
  const mon = monday(today);

  const week = WEEK.map((k, i) => {
    const date = addDays(mon, i);
    const done = sessions.some((s) => s.date === date && !s.skipped);
    return `<a class="day ${date === today ? 'today' : ''} ${done ? 'done' : ''}" href="#/session/${k}"><b>${'MTWTFSS'[i]}</b>${DAYS[k].tab}</a>`;
  }).join('');

  const items = day.lifts.map((id) => {
    const r = recommend(id, sessions);
    const w = r.blocks.map((b) => (EX[id].added ? '+' : '') + fmtW(b.w)).join(' · ');
    return `<li><span>${EX[id].name}</span><span>${w}${r.status === 'bump' ? ' ↑' : ''}</span></li>`;
  });
  if (day.cardio === 'z2') items.unshift(`<li><span>Zone 2 cardio</span><span>${Z2.hr[0]}–${Z2.hr[1]}</span></li>`);
  if (day.cardio === 'intervals') items.unshift('<li><span>4×4 intervals</span><span>4 / 3 min</span></li>');
  const logged = sessions.some((s) => s.date === today && s.type === key && !s.skipped);

  ui.daily ??= (() => {
    const m = view('meals').find((e) => e.date === today);
    return m ? { standard: !!m.standard, ...MEALS.standard, ...m } : { standard: true, ...MEALS.standard };
  })();
  const bodyToday = view('body').find((e) => e.date === today);
  const mealRows = MEALS.slots.map(([slot, label, opts]) =>
    `<div class="meal-row"><span class="k">${label}</span><div class="chips">${opts.map((o) =>
      `<button class="chip ${ui.daily[slot] === o ? 'on' : ''}" data-act="meal" data-slot="${slot}" data-v="${o}">${o}</button>`).join('')}</div></div>`).join('');

  const b = bodyStats();
  const stat = (k, v, d, cls) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div><div class="d ${cls || ''}">${d}</div></div>`;

  const body = `
    ${validSettings() ? '' : '<section class="card notice"><h2>Not connected</h2><div class="meta">Add your GitHub token in Settings to sync.</div><a class="btn mt" href="#/settings">Open settings</a></section>'}
    <section class="card"><h2>This week</h2><div class="week">${week}</div></section>
    <section class="card">
      <div class="card-head"><div><h2>${day.title}</h2><div class="meta">${phaseLabel(today)}</div></div>${logged ? '<span class="pill bump">Logged</span>' : ''}</div>
      <ul class="list">${items.join('')}</ul>
      <a class="btn mt" href="#/session/${key}">${state.drafts[key] ? 'Continue' : logged ? 'Edit' : 'Start'}</a>
    </section>
    <section class="card">
      <h2>Daily</h2><div class="meta">Morning, before eating</div>
      <div class="field"><label>Weight<small>lb</small></label><input id="daily-weight" inputmode="decimal" placeholder="—" value="${esc(bodyToday?.weight ?? '')}"></div>
      <div class="toggle-row"><div><div>Standard day</div><div class="meta">${MEALS.standardLabel}</div></div>
        <button class="switch ${ui.daily.standard ? '' : 'off'}" data-act="std-toggle" aria-label="Standard day"></button></div>
      ${ui.daily.standard ? '' : mealRows}
      <button class="btn ghost mt" data-act="save-daily">Save daily</button>
    </section>
    <section class="card">
      <div class="card-head"><div><h2>Body</h2><div class="meta">${b.wIsAvg ? 'Weight = 7-day avg' : 'Latest weight'} · check-in Thu</div></div></div>
      <div class="stat-grid">
        ${stat('Weight', b.wNow != null ? b.wNow.toFixed(1) : '—', b.wDelta != null ? `${signed(b.wDelta)} vs prior wk` : '&nbsp;')}
        ${stat('Muscle est.', b.muscle != null ? b.muscle.toFixed(1) : '—', b.muscleDelta != null ? `${signed(b.muscleDelta)} lb` : '&nbsp;', b.muscleDelta > 0 ? 'up' : '')}
        ${stat('RHR', b.rhr ?? '—', '&nbsp;')}
      </div>
    </section>`;
  return shell({ title: 'Today', sub: `${fmtDay(today)} · ${phaseLabel(today)}`, nav: 'today', body });
}

// ---------- Session ----------
function newCardio(kind, sessions) {
  const prev = [...sessions].reverse().find((s) => s.cardio?.kind === kind && !s.cardio.segments);
  if (kind === 'z2') return { kind, modality: prev?.cardio.modality || Z2.modalities[0], min: 45, hr: null, setting: '', nose: 'Held' };
  return { kind, protocol: '4x4', modality: INTERVALS.modalities[0], hard: '', easy: '',
    reps: Array.from({ length: INTERVALS.reps }, () => ({ hard: null, easy: null })), rpe: null, warm: 10, cool: 5 };
}

function buildDraft(key, date) {
  const day = DAYS[key];
  const sid = `${date}-${key}`;
  const all = view('sessions');
  // Editing an already-logged session: prefill it, and recommend from everything before it.
  const existing = all.find((s) => s.id === sid && !s.skipped);
  const sessions = all.filter((s) => s.id !== sid);
  return {
    type: key,
    date,
    lifts: day.lifts.map((id) => {
      const r = recommend(id, sessions);
      const logged = existing?.lifts?.find((l) => l.ex === id);
      const planned = (kind) => r.blocks.find((b) => b.kind === kind) || r.blocks[0];
      const blocks = logged
        ? logged.blocks.map((b) => ({ kind: b.kind, w: b.w, range: planned(b.kind).range, rirHint: planned(b.kind).rir, reps: [...b.reps], rir: b.rir }))
        : r.blocks.map((b) => ({ kind: b.kind, w: b.w, range: b.range, rirHint: b.rir, reps: Array(b.sets).fill(null), rir: null }));
      return { ex: id, status: r.status, blocks };
    }),
    cardio: day.cardio ? (existing?.cardio && !existing.cardio.segments ? structuredClone(existing.cardio) : newCardio(day.cardio, sessions)) : null,
    warm: day.warm ? { min: null, hr: null, ...existing?.warm } : null,
    cool: day.cool ? { min: null, hr: null, ...existing?.cool } : null,
  };
}

function currentDraft() {
  const { parts, q } = route();
  const key = DAYS[parts[1]] ? parts[1] : WEEK[dow(todayISO())];
  const qDate = ISO_RE.test(q.get('date') || '') ? q.get('date') : null;
  let d = state.drafts[key];
  if (!d || (qDate && d.date !== qDate)) d = buildDraft(key, qDate || todayISO());
  return { key, d };
}

function blockLabel(b, ex) {
  const range = `${b.range[0]}–${b.range[1]}`;
  if (b.kind === 'top') return `Top set · ${MAIN.top.sets} × ${range}`;
  if (b.kind === 'backoff') return `Back-off · ${MAIN.backoff.sets} × ${range}`;
  return `${ex.sets ?? b.reps.length} × ${range}${ex.unit ? ` · ${ex.unit}` : ''}`;
}

function liftCard(lift, li, sessions) {
  const ex = EX[lift.ex];
  const last = lastEntry(sessions, lift.ex);
  const blocks = lift.blocks.map((b, bi) => {
    const sets = b.reps.map((r, si) => {
      const cls = r == null ? '' : r >= b.range[0] ? 'done' : 'short';
      return `<button class="set ${cls}" data-act="set" data-li="${li}" data-bi="${bi}" data-si="${si}">${r ?? b.range[1]}</button>`;
    }).join('');
    const rir = [0, 1, 2, 3].map((v) =>
      `<button class="${b.rir === v ? 'on' : ''}" data-act="rir" data-li="${li}" data-bi="${bi}" data-v="${v}">${v === 3 ? '3+' : v}</button>`).join('');
    return `<div class="block">
      <div class="block-label"><span>${blockLabel(b, ex)}</span><span>RIR ${b.rirHint}</span></div>
      <div class="stepper"><button data-act="w" data-li="${li}" data-bi="${bi}" data-d="${-ex.inc}">−</button><div class="val"><span>${ex.added ? '+' : ''}${fmtW(b.w)}</span><small>lb</small></div><button data-act="w" data-li="${li}" data-bi="${bi}" data-d="${ex.inc}">+</button></div>
      <div class="sets">${sets}<button class="set add" data-act="addset" data-li="${li}" data-bi="${bi}">+</button></div>
      <div class="rir"><span class="lbl">RIR</span>${rir}</div>
    </div>`;
  }).join('');
  return `<section class="card">
    <div class="card-head"><div><h2>${ex.name}</h2><div class="meta">${last ? `Last ${fmtMD(last.date)}: ${esc(liftSummary(last.lift))}` : 'No history yet'}</div></div>${pill(lift.status)}</div>
    ${blocks}
  </section>`;
}

const chips = (field, options, current, isNum = false) => options.map((o) =>
  `<button class="chip ${current === o ? 'on' : ''}" data-act="pick" data-field="${field}" data-v="${esc(o)}"${isNum ? ' data-num="1"' : ''}>${esc(o)}</button>`).join('');

const inputNum = (field, value, placeholder = '—') =>
  `<input class="num" inputmode="numeric" data-field="${field}" value="${esc(value ?? '')}" placeholder="${esc(placeholder)}">`;
const inputText = (field, value, placeholder = '') =>
  `<input class="num" data-field="${field}" data-text="1" value="${esc(value ?? '')}" placeholder="${esc(placeholder)}">`;

function cardioCard(c, sessions) {
  const prev = [...sessions].reverse().find((s) => s.cardio?.kind === c.kind && !s.skipped);
  const meta = prev ? `Last ${fmtMD(prev.date)}: ${cardioSummary(prev.cardio)}` : 'No history yet';
  if (c.kind === 'z2') {
    return `<section class="card">
      <div class="card-head"><div><h2>Cardio</h2><div class="meta">${meta}</div></div><span class="pill cardio">${Z2.hr[0]}–${Z2.hr[1]}</span></div>
      <div class="block"><div class="block-label"><span>Modality</span></div><div class="chips">${chips('cardio.modality', Z2.modalities, c.modality)}</div></div>
      <div class="block"><div class="block-label"><span>Duration</span></div>
        <div class="stepper"><button data-act="num" data-field="cardio.min" data-d="-5">−</button><div class="val"><span>${c.min ?? 0}</span><small>min</small></div><button data-act="num" data-field="cardio.min" data-d="5">+</button></div></div>
      <div class="block"><div class="irow two head"><span>Avg HR</span><span>Setting</span></div>
        <div class="irow two">${inputNum('cardio.hr', c.hr)}${inputText('cardio.setting', c.setting, 'e.g. R10 / 80')}</div></div>
      <div class="block"><div class="block-label"><span>Nose-breathing</span></div><div class="chips">${chips('cardio.nose', ['Held', 'Broke'], c.nose)}</div></div>
    </section>`;
  }
  const rows = c.reps.map((r, i) =>
    `<div class="irow"><span class="rep">${i + 1}</span>${inputNum(`cardio.reps.${i}.hard`, r.hard)}${inputNum(`cardio.reps.${i}.easy`, r.easy)}</div>`).join('');
  return `<section class="card">
      <div class="card-head"><div><h2>Setup</h2><div class="meta">${meta}</div></div><span class="pill cardio">4×4</span></div>
      <div class="block"><div class="block-label"><span>Modality</span></div><div class="chips">${chips('cardio.modality', INTERVALS.modalities, c.modality)}</div></div>
      <div class="block"><div class="irow two head"><span>Hard setting</span><span>Easy setting</span></div>
        <div class="irow two">${inputText('cardio.hard', c.hard, 'e.g. R13 / 85')}${inputText('cardio.easy', c.easy, 'e.g. R8 / 60')}</div></div>
    </section>
    <section class="card">
      <h2>Reps</h2><div class="meta">Peak HR at the end of each segment</div>
      <div class="block"><div class="irow head"><span>Rep</span><span>Hard HR</span><span>Easy HR</span></div>${rows}</div>
      <div class="block"><div class="block-label"><span>Effort (RPE, hardest rep)</span></div><div class="chips">${chips('cardio.rpe', [6, 7, 8, 9, 10], c.rpe, true)}</div></div>
      <div class="block"><div class="irow two head"><span>Warm-up min</span><span>Cool-down min</span></div>
        <div class="irow two">${inputNum('cardio.warm', c.warm)}${inputNum('cardio.cool', c.cool)}</div></div>
    </section>`;
}

function warmCoolCard(d) {
  const row = (label, k) => `<div class="irow"><span class="rep">${label}</span>${inputNum(`${k}.min`, d[k].min, 'min')}${inputNum(`${k}.hr`, d[k].hr, 'HR')}</div>`;
  return `<section class="card"><h2>Warm-up / cool-down</h2>
    <div class="block"><div class="irow head"><span></span><span>Minutes</span><span>Avg HR</span></div>
    ${d.warm ? row('Warm', 'warm') : ''}${d.cool ? row('Cool', 'cool') : ''}</div></section>`;
}

function renderSession() {
  const { key, d } = currentDraft();
  const day = DAYS[key];
  const sessions = view('sessions').filter((s) => s.id !== `${d.date}-${key}`);
  const body = `
    <section class="card"><div class="field"><label>Date<small>change to backfill</small></label><input type="date" data-field="date" data-text="1" value="${esc(d.date)}"></div></section>
    ${d.cardio ? cardioCard(d.cardio, sessions) : ''}
    ${d.lifts.map((l, i) => liftCard(l, i, sessions)).join('')}
    ${d.warm || d.cool ? warmCoolCard(d) : ''}
    <button class="btn ghost" data-act="discard">Discard</button>`;
  const footer = `<div class="finish-bar"><button class="btn" data-act="finish">Finish ${d.cardio && !d.lifts.length ? 'session' : 'workout'}</button></div>`;
  return shell({ title: day.title, sub: `${fmtDay(d.date)} · ${phaseLabel(d.date)}`, tabs: key, nav: 'today', body, footer });
}

function finishSession(key, d) {
  const lifts = d.lifts
    .map((l) => ({ ex: l.ex, blocks: l.blocks.map((b) => ({ kind: b.kind, w: b.w, reps: b.reps.filter((r) => r != null), rir: b.rir ?? 0 })).filter((b) => b.reps.length) }))
    .filter((l) => l.blocks.length);
  const s = { id: `${d.date}-${key}`, date: d.date, type: key };
  if (lifts.length) s.lifts = lifts;
  const c = d.cardio;
  if (c) {
    const hasData = c.kind === 'z2' ? c.min > 0 : c.reps.some((r) => r.hard != null) || c.rpe != null;
    if (hasData) s.cardio = c.kind === 'z2' ? { ...c } : { ...c, reps: c.reps.filter((r) => r.hard != null || r.easy != null) };
  }
  for (const k of ['warm', 'cool']) if (d[k]?.min) s[k] = { ...d[k] };
  if (!s.lifts && !s.cardio) { alert('Nothing logged yet.'); return; }
  delete state.drafts[key];
  saveDrafts();
  enqueue('sessions', s);
  location.hash = '#/today';
}

// ---------- History ----------
function renderHistory() {
  const seg = `<div class="seg mt">${[['sessions', 'Sessions'], ['lifts', 'Lifts']].map(([k, l]) =>
    `<button class="${ui.histTab === k ? 'on' : ''}" data-act="seg" data-v="${k}">${l}</button>`).join('')}</div>`;
  const body = ui.histTab === 'sessions' ? historySessions() : historyLifts();
  return shell({ title: 'History', sub: `${view('sessions').length} sessions`, nav: 'history', body: seg + body });
}

function sessionCard(s) {
  const day = DAYS[s.type] || { title: s.type };
  if (s.skipped) {
    return `<section class="card hist skipped"><div class="date"><b>${parse(s.date).getDate()}</b><span>${fmtDay(s.date).slice(0, 3)}</span></div>
      <div class="body"><div class="card-head"><h2>${esc(day.title)}</h2><span class="pill rest">Skipped</span></div></div></section>`;
  }
  const lines = (s.lifts || []).map((l) => `<b>${esc(EX[l.ex]?.short || l.ex)}</b> ${esc(l.blocks.map((b) => `${b.reps.join(',')} @ ${fmtW(b.w)}`).join(' · '))}`);
  if (s.cardio) lines.unshift(cardioSummary(s.cardio));
  const kind = DAYS[s.type]?.warm ? ['main', 'Lift'] : s.cardio ? ['cardio', 'Cardio'] : ['rest', 'Grip'];
  return `<section class="card hist"><div class="date"><b>${parse(s.date).getDate()}</b><span>${fmtDay(s.date).slice(0, 3)}</span></div>
    <div class="body"><div class="card-head"><h2>${esc(day.title)}</h2><span class="pill ${kind[0]}">${kind[1]}</span></div>
    <div class="lines">${lines.join('<br>')}</div></div></section>`;
}

function weekGaps(weekSessions, mon) {
  const counts = {};
  for (const s of weekSessions) {
    const g = DAYS[s.type]?.group;
    if (g) counts[g] = (counts[g] || 0) + 1;
  }
  const gaps = [];
  for (const [g, n] of Object.entries(WEEKLY_EXPECTED)) {
    const missing = n - (counts[g] || 0);
    const defaults = g === 'z2' ? ['z2sun', 'z2sat'] : [GROUP_DEFAULT_DAY[g]];
    for (let i = 0; i < missing; i++) {
      const type = defaults[i] || defaults[0];
      gaps.push({ type, label: GROUP_LABEL[g], date: addDays(mon, WEEK.indexOf(type)) });
    }
  }
  return gaps;
}

function historySessions() {
  const sessions = view('sessions');
  if (!sessions.length) return '<section class="card"><div class="meta">No sessions yet.</div></section>';
  const thisMon = monday(todayISO());
  const firstMon = monday(sessions[0].date);
  let html = '';
  for (let mon = thisMon; mon >= firstMon; mon = addDays(mon, -7)) {
    const sun = addDays(mon, 6);
    const ws = sessions.filter((s) => s.date >= mon && s.date <= sun);
    const gaps = mon < thisMon ? weekGaps(ws, mon) : [];
    const logged = ws.filter((s) => !s.skipped).length;
    html += `<div class="hist-week"><span>${fmtMD(mon)} – ${fmtMD(sun)} · ${phaseLabel(mon)}</span><span class="${gaps.length ? 'warn' : ''}">${logged} logged${gaps.length ? ` · ${gaps.length} gap${gaps.length > 1 ? 's' : ''}` : ''}</span></div>`;
    html += gaps.map((g) => `<section class="card missing"><div class="card-head"><h2>${g.label} — not logged</h2></div>
      <div class="check-row"><a class="chip" href="#/session/${g.type}?date=${g.date}">Backfill</a><button class="chip" data-act="skip" data-type="${g.type}" data-date="${g.date}">Skip</button></div></section>`).join('');
    html += [...ws].reverse().map(sessionCard).join('');
  }
  return html;
}

function liftPoints(sessions, id) {
  return sessions.filter((s) => !s.skipped).flatMap((s) => {
    const l = (s.lifts || []).find((x) => x.ex === id);
    return l ? [{ date: s.date, w: Math.max(...l.blocks.map((b) => b.w)), lift: l }] : [];
  });
}

function chartSvg(points) {
  if (points.length < 2) return '<div class="meta mt">Not enough data for a chart yet.</div>';
  const ws = points.map((p) => p.w);
  const lo = Math.min(...ws), hi = Math.max(...ws), span = hi - lo || 1;
  const x = (i) => 40 + (i * 280) / (points.length - 1);
  const y = (w) => 110 - ((w - lo) / span) * 95;
  const pts = points.map((p, i) => `${x(i).toFixed(1)},${y(p.w).toFixed(1)}`).join(' ');
  const p3 = points.findIndex((p) => p.date >= PHASE3_START);
  const mx = p3 > 0 ? (x(p3 - 1) + x(p3)) / 2 : 0;
  const marker = p3 > 0 ? `<line x1="${mx}" y1="6" x2="${mx}" y2="118" class="c-phase"/><text x="${mx + 3}" y="12" class="c-phase-t">P3</text>` : '';
  return `<div class="chart"><svg viewBox="0 0 340 140" role="img" aria-label="Weight trend">
    <line x1="40" y1="15" x2="330" y2="15" class="c-grid"/><line x1="40" y1="110" x2="330" y2="110" class="c-grid"/>
    <text x="0" y="18" class="c-t">${fmtW(hi)}</text><text x="0" y="113" class="c-t">${fmtW(lo)}</text>
    <text x="30" y="134" class="c-t">${fmtMD(points[0].date)}</text><text x="296" y="134" class="c-t">${fmtMD(points.at(-1).date)}</text>
    ${marker}
    <polyline points="${pts}" class="c-line"/>
    ${points.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.w).toFixed(1)}" r="3.5" class="c-dot"/>`).join('')}
  </svg></div>`;
}

function historyLifts() {
  const sessions = view('sessions');
  const sel = ui.liftSel;
  const points = liftPoints(sessions, sel);
  const chipsHtml = MAIN_LIFTS.map((id) => `<button class="chip ${id === sel ? 'on' : ''}" data-act="lift-sel" data-v="${id}">${EX[id].short}</button>`).join('');
  const recent = [...points].reverse().slice(0, 4).map((p) => `<li><span>${fmtMD(p.date)} · ${esc(p.lift.blocks.map((b) => b.reps.join(',')).join(' / '))}</span><span>${esc(p.lift.blocks.map((b) => fmtW(b.w)).join(' / '))}</span></li>`).join('');
  const cutoff = addDays(todayISO(), -28);
  const changes = MAIN_LIFTS.map((id) => {
    const pts = liftPoints(sessions, id);
    if (!pts.length) return '';
    const base = [...pts].reverse().find((p) => p.date <= cutoff) || pts[0];
    const now = pts.at(-1);
    const arrow = now.w > base.w ? '<span class="up">▲</span>' : now.w < base.w ? '<span class="down">▼</span>' : '<span class="down">■</span>';
    return `<li><span>${EX[id].short}</span><span>${fmtW(base.w)} → ${fmtW(now.w)} ${arrow}</span></li>`;
  }).join('');
  return `<section class="card"><div class="chips">${chipsHtml}</div></section>
    <section class="card"><h2>${EX[sel].name}</h2><div class="meta">Heaviest weight per session</div>${chartSvg(points)}<ul class="list">${recent}</ul></section>
    <section class="card"><h2>Main lifts · 4-week change</h2><ul class="list">${changes}</ul></section>`;
}

// ---------- Weekly check-in ----------
const CHECKIN = [
  ['Scale', 'From this morning’s weigh-in', [['bf', 'Body fat', '%'], ['water', 'Water', '%'], ['muscle', 'Muscle', '%'], ['bone', 'Bone', '%']]],
  ['Fitbit', '7-day averages from the Fitbit app', [['rhr', 'Resting HR', 'bpm, 7-day avg'], ['sleep', 'Sleep', 'hrs, 7-day avg']]],
  ['Tape', '', [['waist', 'Waist', 'in, at navel'], ['neck', 'Neck', 'in, below larynx']]],
];

function renderCheckin(parts, q) {
  const date = ISO_RE.test(q.get('date') || '') ? q.get('date') : todayISO();
  const e = view('body').find((x) => x.date === date) || {};
  const sections = CHECKIN.map(([title, meta, fields]) => `<section class="card"><h2>${title}</h2>${meta ? `<div class="meta">${meta}</div>` : ''}
    ${fields.map(([k, label, unit]) => `<div class="field"><label>${label}<small>${unit}</small></label><input id="ci-${k}" inputmode="decimal" placeholder="—" value="${esc(e[k] ?? '')}"></div>`).join('')}</section>`).join('');
  const body = `<section class="card"><div class="field"><label>Date</label><input type="date" id="ci-date" value="${date}"></div></section>
    ${sections}<button class="btn" data-act="save-checkin">Save</button>${ui.msg ? `<div class="meta center">${esc(ui.msg)}</div>` : ''}`;
  return shell({ title: 'Weekly check-in', sub: fmtDay(date), nav: 'checkin', body });
}

// ---------- Settings ----------
function renderSettings() {
  const s = state.settings;
  const field = (id, label, value, extra = '') => `<div class="field"><label>${label}</label><input id="${id}" value="${esc(value)}" autocomplete="off" autocapitalize="off" spellcheck="false" ${extra}></div>`;
  const body = `<section class="card"><h2>GitHub</h2><div class="meta">Fine-grained token · Contents read/write · this repo only</div>
      ${field('set-owner', 'Owner', s.owner)}${field('set-repo', 'Repo', s.repo)}${field('set-branch', 'Branch', s.branch)}
      <div class="field"><label>Token</label><input id="set-token" type="password" autocomplete="off" placeholder="${s.token ? 'saved — blank keeps it' : 'github_pat_…'}"></div>
      <div class="row-btns mt"><button class="btn" data-act="save-settings">Save</button><button class="btn ghost" data-act="test-conn">Test</button></div>
    </section>
    <section class="card"><h2>Sync</h2>
      <ul class="list"><li><span>Unsynced changes</span><span>${state.queue.length}</span></li><li><span>Status</span><span>${esc(state.status)}</span></li></ul>
      ${state.error ? `<div class="meta warn">${esc(state.error)}</div>` : ''}
      <button class="btn ghost mt" data-act="sync-now">Sync now</button>
    </section>
    ${ui.msg ? `<div class="meta center">${esc(ui.msg)}</div>` : ''}`;
  return shell({ title: 'Settings', sub: 'Stored on this device only', nav: 'settings', body });
}

// ---------- events ----------
async function onClick(e) {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const act = t.dataset.act;
  const sessionActs = ['w', 'set', 'addset', 'rir', 'pick', 'num', 'finish', 'discard'];

  if (sessionActs.includes(act)) {
    const { key, d } = currentDraft();
    const blk = t.dataset.li != null ? d.lifts[+t.dataset.li].blocks[+t.dataset.bi] : null;
    if (act === 'w') blk.w = Math.max(0, Math.round((blk.w + +t.dataset.d) * 100) / 100);
    if (act === 'set') {
      const r = blk.reps[+t.dataset.si];
      const next = r == null ? blk.range[1] : r - 1;
      blk.reps[+t.dataset.si] = next < 0 ? null : next;
    }
    if (act === 'addset') blk.reps.push(null);
    if (act === 'rir') blk.rir = blk.rir === +t.dataset.v ? null : +t.dataset.v;
    if (act === 'pick') setPath(d, t.dataset.field, t.dataset.num ? +t.dataset.v : t.dataset.v);
    if (act === 'num') setPath(d, t.dataset.field, Math.max(0, (getPath(d, t.dataset.field) || 0) + +t.dataset.d));
    if (act === 'finish') return finishSession(key, d);
    if (act === 'discard') {
      if (!confirm('Discard this workout?')) return;
      delete state.drafts[key];
      saveDrafts();
      location.hash = '#/today';
      return;
    }
    state.drafts[key] = d;
    saveDrafts();
    return render();
  }

  if (act === 'seg') ui.histTab = t.dataset.v;
  if (act === 'lift-sel') ui.liftSel = t.dataset.v;
  if (act === 'skip') await enqueue('sessions', { id: `${t.dataset.date}-${t.dataset.type}`, date: t.dataset.date, type: t.dataset.type, skipped: true });
  if (act === 'std-toggle') {
    ui.daily.standard = !ui.daily.standard;
    if (ui.daily.standard) Object.assign(ui.daily, MEALS.standard);
  }
  if (act === 'meal') ui.daily[t.dataset.slot] = t.dataset.v;
  if (act === 'save-daily') {
    const date = todayISO();
    const w = num(document.getElementById('daily-weight').value);
    if (w != null) await enqueue('body', { date, weight: w });
    const { am, lunch, snack, dinner, standard } = ui.daily;
    await enqueue('meals', standard ? { date, standard: true } : { date, standard: false, am, lunch, snack, dinner });
    t.textContent = 'Saved ✓';
    return;
  }
  if (act === 'save-checkin') {
    const date = document.getElementById('ci-date').value;
    if (!ISO_RE.test(date)) return;
    const entry = { date };
    for (const [, , fields] of CHECKIN) for (const [k] of fields) {
      const v = num(document.getElementById(`ci-${k}`).value);
      if (v != null) entry[k] = v;
    }
    await enqueue('body', entry);
    ui.msg = 'Saved.';
  }
  if (act === 'save-settings') {
    const next = {
      owner: document.getElementById('set-owner').value.trim(),
      repo: document.getElementById('set-repo').value.trim(),
      branch: document.getElementById('set-branch').value.trim(),
      token: document.getElementById('set-token').value.trim() || state.settings.token,
    };
    if (!validSettings(next)) { ui.msg = 'Invalid owner/repo/branch, or missing token.'; return render(); }
    Object.assign(state.settings, next);
    await saveSettings();
    ui.msg = 'Saved.';
    sync();
  }
  if (act === 'test-conn') {
    ui.msg = validSettings() ? await testConnection().catch((err) => err.message) : 'Save settings first.';
  }
  if (act === 'sync-now') { await sync(); ui.msg = state.status === 'error' ? 'Sync failed.' : 'Synced.'; }
  render();
}

function onInput(e) {
  const el = e.target;
  if (!el.dataset.field || route().parts[0] !== 'session') return;
  const { key, d } = currentDraft();
  setPath(d, el.dataset.field, el.dataset.text ? el.value : num(el.value));
  if (el.dataset.field === 'date' && !ISO_RE.test(el.value)) return;
  state.drafts[key] = d;
  saveDrafts();
}

function onChangeEvent(e) {
  if (e.target.id === 'ci-date' && ISO_RE.test(e.target.value)) location.hash = `#/checkin?date=${e.target.value}`;
  if (e.target.dataset.field === 'date' && ISO_RE.test(e.target.value)) {
    // Keep the URL date in sync so currentDraft() doesn't rebuild the draft.
    history.replaceState(null, '', `#/session/${route().parts[1]}?date=${e.target.value}`);
    render();
  }
}

// ---------- init ----------
$app.addEventListener('click', onClick);
$app.addEventListener('input', onInput);
$app.addEventListener('change', onChangeEvent);
window.addEventListener('hashchange', () => { ui.msg = ''; ui.daily = null; render(); window.scrollTo(0, 0); });
window.addEventListener('online', () => sync());
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync(); });
onChange(() => {
  if (document.activeElement?.matches('input')) {
    document.getElementById('sync-status')?.replaceWith(Object.assign(document.createElement('div'), { innerHTML: statusHtml() }).firstElementChild);
  } else render();
});

await loadLocal();
render();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js');
sync();
