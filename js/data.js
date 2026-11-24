// Local persistence (IndexedDB) + GitHub Contents API sync.

export const FILES = { sessions: 'data/sessions.json', body: 'data/body.json', meals: 'data/meals.json' };
const KEY_OF = { sessions: (e) => e.id, body: (e) => e.date, meals: (e) => e.date };
const NAME_RE = /^[A-Za-z0-9_.-]+$/;
const BRANCH_RE = /^[A-Za-z0-9_./-]+$/;

let dbp;
function db() {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('rebuild', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function kv(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction('kv', mode);
    const req = fn(tx.objectStore('kv'));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}
export const kvGet = (k) => kv('readonly', (s) => s.get(k));
export const kvSet = (k, v) => kv('readwrite', (s) => s.put(v, k));

export const state = {
  settings: { owner: 'yurusengoby', repo: 'fitness-tracking', branch: 'main', token: '' },
  cache: { sessions: [], body: [], meals: [] },
  queue: [],
  drafts: {},
  status: 'idle', // idle | syncing | error | offline
  error: '',
};

export async function loadLocal() {
  const [settings, cache, queue, drafts] = await Promise.all([
    kvGet('settings'), kvGet('cache'), kvGet('queue'), kvGet('drafts'),
  ]);
  if (settings) Object.assign(state.settings, settings);
  if (cache) Object.assign(state.cache, cache);
  state.queue = queue || [];
  state.drafts = drafts || {};
  navigator.storage?.persist?.();
}

export const saveSettings = () => kvSet('settings', { ...state.settings });
export const saveDrafts = () => kvSet('drafts', state.drafts);

export function validSettings(s = state.settings) {
  return NAME_RE.test(s.owner) && NAME_RE.test(s.repo) && BRANCH_RE.test(s.branch) && !!s.token;
}

// --- merged views (remote cache + unsynced local ops) ---

function upsert(list, kind, entry) {
  const key = KEY_OF[kind](entry);
  const i = list.findIndex((e) => KEY_OF[kind](e) === key);
  if (i === -1) list.push(entry);
  else list[i] = kind === 'sessions' ? entry : { ...list[i], ...entry };
  list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return list;
}

export function view(kind) {
  const list = [...state.cache[kind]];
  for (const op of state.queue) if (op.kind === kind) upsert(list, kind, op.entry);
  return list;
}

export async function enqueue(kind, entry) {
  state.queue.push({ kind, entry });
  await kvSet('queue', state.queue);
  sync();
}

// --- GitHub ---

function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function b64decode(b64) {
  const bin = atob(b64.replace(/\n/g, ''));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

function apiUrl(path) {
  const { owner, repo } = state.settings;
  return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path}`;
}

async function gh(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    cache: 'no-store',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${state.settings.token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  return res;
}

async function getFile(path) {
  const res = await gh(`${apiUrl(path)}?ref=${encodeURIComponent(state.settings.branch)}`);
  if (res.status === 404) return { data: [], sha: null };
  if (!res.ok) throw new Error(`GET ${path}: ${res.status}`);
  const j = await res.json();
  return { data: JSON.parse(b64decode(j.content)), sha: j.sha };
}

const serialize = (arr) => '[\n' + arr.map((e) => JSON.stringify(e)).join(',\n') + '\n]\n';

async function putFile(path, data, sha, message) {
  const res = await gh(apiUrl(path), {
    method: 'PUT',
    body: JSON.stringify({ message, content: b64encode(serialize(data)), branch: state.settings.branch, ...(sha ? { sha } : {}) }),
  });
  if (res.status === 409 || res.status === 422) return false;
  if (!res.ok) throw new Error(`PUT ${path}: ${res.status}`);
  return true;
}

export async function testConnection() {
  const { owner, repo } = state.settings;
  const res = await gh(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
  if (!res.ok) return `Failed (${res.status})`;
  const j = await res.json();
  return j.private ? 'Connected (private repo)' : 'Connected — warning: repo is PUBLIC';
}

let listeners = [];
export const onChange = (fn) => listeners.push(fn);
const notify = () => listeners.forEach((fn) => fn());

let running = null;
export function sync() {
  running ??= doSync().finally(() => { running = null; notify(); });
  return running;
}

async function doSync() {
  if (!validSettings()) return;
  if (!navigator.onLine) { state.status = 'offline'; return; }
  state.status = 'syncing';
  notify();
  try {
    for (const kind of Object.keys(FILES)) {
      const ops = state.queue.filter((o) => o.kind === kind);
      for (let attempt = 0; ; attempt++) {
        const { data, sha } = await getFile(FILES[kind]);
        if (!ops.length) { state.cache[kind] = data; break; }
        for (const op of ops) upsert(data, kind, op.entry);
        if (await putFile(FILES[kind], data, sha, `app: ${kind} (${ops.length})`)) {
          state.cache[kind] = data;
          state.queue = state.queue.filter((o) => !ops.includes(o));
          await kvSet('queue', state.queue);
          break;
        }
        if (attempt >= 1) throw new Error(`${kind}: write conflict`);
      }
    }
    await kvSet('cache', state.cache);
    state.status = 'idle';
    state.error = '';
  } catch (e) {
    state.status = 'error';
    state.error = e.message;
  }
}
