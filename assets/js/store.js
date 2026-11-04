/* ExamArena — storage, permanent device identity, history */
const NS = 'ea.v1.';

export function hashStr(str) {
  // FNV-1a, 32-bit, stable across sessions
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function read(k, fallback) {
  try {
    const raw = localStorage.getItem(NS + k);
    return raw === null ? fallback : JSON.parse(raw);
  } catch { return fallback; }
}
function write(k, v) {
  try { localStorage.setItem(NS + k, JSON.stringify(v)); return true; }
  catch { return false; }
}
function del(k) { try { localStorage.removeItem(NS + k); } catch {} }

/* ---------- cookie backup so the ID survives a cache clear ---------- */
function setCookie(name, value, days) {
  try {
    const d = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie = `${name}=${encodeURIComponent(value)}; expires=${d}; path=/; SameSite=Lax`;
  } catch {}
}
function getCookie(name) {
  try {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
  } catch { return null; }
}

/* ---------- permanent device identity ---------- */
export function fingerprint() {
  const parts = [
    navigator.userAgent, navigator.language, (navigator.languages || []).join(','),
    screen.width, screen.height, screen.colorDepth, screen.pixelDepth,
    window.devicePixelRatio, navigator.hardwareConcurrency || 0,
    navigator.maxTouchPoints || 0,
    Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    new Date().getTimezoneOffset()
  ];
  return hashStr(parts.join('|'));
}

let cachedIdentity = null;

export function deviceId() {
  return cachedIdentity ? cachedIdentity.id : (read('device', null) || getCookie('ea_device') || null);
}

export async function initDevice() {
  if (cachedIdentity) return cachedIdentity;

  let stored = read('device', null);
  const cookieId = getCookie('ea_device');
  if (!stored && cookieId) { stored = cookieId; write('device', stored); }

  const fp = fingerprint();
  let ipHash = read('ipHash', null);
  if (!ipHash) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 3500);
      const res = await fetch('https://api.ipify.org?format=json', { signal: ctrl.signal });
      clearTimeout(t);
      const data = await res.json();
      if (data && data.ip) { ipHash = hashStr(data.ip).slice(0, 4); write('ipHash', ipHash); }
    } catch { /* offline or blocked: fall back to device fingerprint only */ }
  }

  const derived = 'EX-' + fp.slice(0, 6).toUpperCase() + (ipHash ? '-' + ipHash.toUpperCase() : '');
  const id = stored || derived;

  write('device', id);
  setCookie('ea_device', id, 3650);
  if (!read('firstSeen', null)) write('firstSeen', Date.now());

  cachedIdentity = { id, fingerprint: fp, ipHash: ipHash || null, derived };
  return cachedIdentity;
}

/* ---------- profile ---------- */
export function profile() {
  return {
    name: read('name', ''),
    goalExam: read('goalExam', ''),
    goalDate: read('goalDate', ''),
    dailyGoal: read('dailyGoal', 50)
  };
}
export function setProfile(patch) {
  Object.entries(patch).forEach(([k, v]) => write(k, v));
  return profile();
}

/* ---------- settings (AI) ---------- */
export function settings() {
  return Object.assign(
    { provider: 'none', key: '', model: '', endpoint: '', autoAI: false },
    read('settings', {})
  );
}
export function setSettings(patch) {
  const next = Object.assign(settings(), patch);
  write('settings', next);
  return next;
}

/* ---------- attempts ---------- */
export function attempts() { return read('attempts', []); }
export function saveAttempt(rec) {
  const all = attempts();
  all.unshift(rec);
  write('attempts', all.slice(0, 300));
  return all;
}
export function stats() {
  const all = attempts();
  if (!all.length) return { count: 0, accuracy: 0, totalQ: 0, best: 0, streak: 0, bySubject: {}, days: [] };
  let correct = 0, attempted = 0;
  const bySubject = {};
  all.forEach(a => {
    correct += a.correct; attempted += a.attempted;
    Object.entries(a.bySubject || {}).forEach(([s, v]) => {
      bySubject[s] = bySubject[s] || { correct: 0, attempted: 0 };
      bySubject[s].correct += v.correct; bySubject[s].attempted += v.attempted;
    });
  });
  const days = [...new Set(all.map(a => new Date(a.ts).toISOString().slice(0, 10)))].sort();
  return {
    count: all.length,
    accuracy: attempted ? Math.round((correct / attempted) * 100) : 0,
    totalQ: all.reduce((s, a) => s + a.total, 0),
    best: Math.max(...all.map(a => (a.attempted ? Math.round((a.correct / a.total) * 100) : 0))),
    streak: streakFrom(days),
    bySubject,
    days
  };
}
function streakFrom(days) {
  if (!days.length) return 0;
  const today = new Date().toISOString().slice(0, 10);
  const y = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  const set = new Set(days);
  let start = set.has(today) ? today : (set.has(y) ? y : null);
  if (!start) return 0;
  let n = 0, cursor = new Date(start + 'T00:00:00Z');
  while (set.has(cursor.toISOString().slice(0, 10))) {
    n++; cursor = new Date(cursor.getTime() - 864e5);
  }
  return n;
}

/* ---------- custom bank ---------- */
export function customBank() { return read('customBank', []); }
export function addCustomQuestions(qs) {
  const all = customBank().concat(qs);
  write('customBank', all.slice(-3000));
  return all.length;
}
export function removeCustomBank() { del('customBank'); }

/* ---------- notes corpus (for AI / draft generation) ---------- */
export function notes() { return read('notes', []); }
export function addNote(note) {
  const all = notes();
  all.unshift(note);
  write('notes', all.slice(0, 12));
  return all.length;
}
export function removeNote(id) {
  write('notes', notes().filter(n => n.id !== id));
}

/* ---------- series ---------- */
export function seriesList() { return read('series', []); }
export function saveSeries(s) {
  const all = seriesList().filter(x => x.id !== s.id);
  all.unshift(s);
  write('series', all.slice(0, 20));
  return all;
}
export function getSeries(id) { return seriesList().find(s => s.id === id) || null; }

/* ---------- in-progress attempt ---------- */
export function saveLive(state) { write('live', state); }
export function liveState() { return read('live', null); }
export function saveLivePaper(paper) { write('livePaper', paper); }
export function livePaper() { return read('livePaper', null); }
export function clearLive() { del('live'); del('livePaper'); }
