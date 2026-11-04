/* ExamArena — question engine: bank loading, filters, daily paper, series bundling, scoring */
import { hashStr, customBank } from './store.js';

const BANK_FILES = ['upsc-gs', 'bpsc-ssc', 'commerce', 'science-arts', 'advanced'];
const BASE = 'data/';

let catalogueCache = null;
let bankCache = null;

async function getJSON(path) {
  const res = await fetch(path, { cache: 'no-cache' });
  if (!res.ok) throw new Error('Could not load ' + path);
  return res.json();
}

export async function loadCatalogue() {
  if (!catalogueCache) catalogueCache = await getJSON(BASE + 'exams.json');
  return catalogueCache;
}

export async function loadBank() {
  if (bankCache) return bankCache;
  const files = await Promise.all(BANK_FILES.map(f => getJSON(`${BASE}bank/${f}.json`)));
  const seeded = files.flat().map(q => Object.assign({ origin: 'bank' }, q));
  const custom = customBank().map(q => Object.assign({ origin: 'custom' }, q));
  bankCache = seeded.concat(custom);
  return bankCache;
}

export function invalidateBank() { bankCache = null; }

/* ---------- deterministic randomness ---------- */
export function rngFromSeed(seed) {
  let a = typeof seed === 'number' ? seed >>> 0 : parseInt(hashStr(String(seed)), 16) >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle(arr, rnd) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/* ---------- filters ---------- */
export function filterBank(bank, opts = {}) {
  const { exams = [], subjects = [], streams = [], difficulty = 'any', ids = null } = opts;
  return bank.filter(q => {
    if (ids && !ids.includes(q.id)) return false;
    if (streams.length && !streams.includes(q.stream)) return false;
    if (exams.length && !exams.some(e => (q.exams || []).includes(e))) return false;
    if (subjects.length && !subjects.includes(q.subject)) return false;
    if (difficulty !== 'any' && q.difficulty !== difficulty) return false;
    return true;
  });
}

export function subjectsInBank(bank) {
  const map = new Map();
  bank.forEach(q => {
    const s = map.get(q.subject) || { subject: q.subject, count: 0, exams: new Set() };
    s.count++;
    (q.exams || []).forEach(e => s.exams.add(e));
    map.set(q.subject, s);
  });
  return [...map.values()].sort((a, b) => b.count - a.count);
}

/* ---------- daily paper ---------- */
const TOPIC_HINTS = [
  [/polity|constitution|political science/i, ['Polity', 'Political Science']],
  [/history|ancient|medieval|freedom/i, ['History']],
  [/geograph|river|landform/i, ['Geography']],
  [/econom|budget|banking|inflation/i, ['Economy', 'Economics']],
  [/environment|ecology|conservation/i, ['Environment']],
  [/bihar/i, ['Bihar Special']],
  [/quantitative|arithmetic|aptitude/i, ['Quantitative Aptitude']],
  [/reasoning|puzzle|seating/i, ['Reasoning']],
  [/english|grammar|vocabulary/i, ['English']],
  [/account|journal/i, ['Accountancy']],
  [/business|management/i, ['Business Studies', 'Management']],
  [/science|physics|chemistry/i, ['Physics', 'Chemistry']],
  [/biology|health/i, ['Biology']],
  [/computer|digital/i, ['Computer Fundamentals', 'DBMS', 'Networking']],
  [/statistics|data interpretation/i, ['Statistics']],
  [/sociology|social issues/i, ['Sociology']]
];

export function dailyTopic(catalogue, dateStr) {
  const list = catalogue.dailyTopics || ['Mixed revision'];
  const day = Math.floor(new Date(dateStr + 'T00:00:00Z').getTime() / 864e5);
  return list[day % list.length];
}

export function hintSubjects(topic) {
  for (const [re, subs] of TOPIC_HINTS) if (re.test(topic)) return subs;
  return [];
}

export function todayStr(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 864e5);
  return d.toISOString().slice(0, 10);
}

/**
 * Builds the free daily paper. Deterministic per date, so every visitor on the
 * same day gets the same paper and tomorrow's is different — no server needed.
 */
export function buildDaily({ catalogue, bank, date, count = 50, topicalShare = 0.6 }) {
  const topic = dailyTopic(catalogue, date);
  const hints = hintSubjects(topic);
  const rnd = rngFromSeed('daily-' + date);

  const topical = seededShuffle(bank.filter(q => hints.includes(q.subject)), rnd);
  const related = seededShuffle(bank.filter(q => !hints.includes(q.subject) && q.stream === 'competition'), rnd);
  const general = seededShuffle(bank.filter(q => !hints.includes(q.subject) && q.stream !== 'competition'), rnd);

  const wantTopical = Math.min(topical.length, Math.round(count * topicalShare));
  const picked = topical.slice(0, wantTopical);
  let need = count - picked.length;
  const relatedPick = related.slice(0, need);
  need -= relatedPick.length;
  const rest = general.slice(0, need);
  const generalCount = relatedPick.length + rest.length;

  const questions = seededShuffle(picked.concat(relatedPick, rest), rnd);
  return {
    kind: 'daily',
    date,
    topic,
    title: `Daily Mock Test — ${new Date(date + 'T00:00:00Z').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`,
    subtitle: topic,
    questions,
    seed: 'daily-' + date,
    topicalCount: picked.length,
    generalCount,
    shortfall: Math.max(0, count - questions.length)
  };
}

/* ---------- custom paper ---------- */
export function buildPaper({ bank, exams = [], subjects = [], streams = [], difficulty = 'any', count = 50, seed = Date.now(), exclude = [] }) {
  const rnd = rngFromSeed(seed);
  let pool = filterBank(bank, { exams, subjects, streams, difficulty });
  if (exclude.length) {
    const filtered = pool.filter(q => !exclude.includes(q.id));
    if (filtered.length >= Math.min(count, 10)) pool = filtered;
  }
  if (!pool.length) return { questions: [], shortfall: count, seed };

  const shuffled = seededShuffle(pool, rnd);
  const questions = shuffled.slice(0, Math.min(count, shuffled.length));
  return {
    kind: 'custom',
    questions,
    seed,
    shortfall: Math.max(0, count - questions.length),
    poolSize: pool.length
  };
}

/* ---------- series bundling ----------
 * A 500-question demand becomes 150 + 150 + 150 + 50: separate papers, each
 * with its own timer, exactly like exam shifts. */
export function planSeries(total, maxPer = 150, minTail = 20) {
  const n = Math.max(1, Math.floor(total));
  if (n <= maxPer) return [n];
  const papers = [];
  let left = n;
  while (left > 0) {
    if (left <= maxPer) { papers.push(left); break; }
    papers.push(maxPer);
    left -= maxPer;
  }
  // A tiny tail paper is not a real paper: split the last two evenly instead.
  if (papers.length > 1 && papers[papers.length - 1] < minTail) {
    const combined = papers[papers.length - 1] + papers[papers.length - 2];
    const half = Math.ceil(combined / 2);
    papers.splice(papers.length - 2, 2, half, combined - half);
  }
  return papers;
}

/* ---------- scoring ---------- */
export function evaluate(questions, answers) {
  let correct = 0, wrong = 0, skipped = 0;
  const bySubject = {};
  const rows = questions.map((q, i) => {
    const sel = answers[q.id];
    const isSkipped = sel === undefined || sel === null;
    const ok = !isSkipped && sel === q.answer;
    if (isSkipped) skipped++; else if (ok) correct++; else wrong++;
    const s = bySubject[q.subject] || (bySubject[q.subject] = { correct: 0, wrong: 0, skipped: 0, attempted: 0 });
    s.attempted += isSkipped ? 0 : 1;
    if (isSkipped) s.skipped++; else if (ok) s.correct++; else s.wrong++;
    return { index: i, q, sel: isSkipped ? null : sel, ok, skipped: isSkipped };
  });
  const attempted = correct + wrong;
  return {
    rows, correct, wrong, skipped, attempted,
    total: questions.length,
    accuracy: attempted ? Math.round((correct / attempted) * 100) : 0,
    score: Math.round((correct / Math.max(1, questions.length)) * 100),
    bySubject
  };
}

export function weakTopics(result, limit = 4) {
  return Object.entries(result.bySubject)
    .map(([subject, v]) => ({ subject, ...v, rate: v.attempted ? v.correct / v.attempted : 0 }))
    .filter(x => x.attempted > 0)
    .sort((a, b) => a.rate - b.rate)
    .slice(0, limit);
}

export function fmtClock(sec) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  const pad = n => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(x)}` : `${pad(m)}:${pad(x)}`;
}

export function examName(catalogue, id) {
  const e = (catalogue.exams || []).find(x => x.id === id);
  return e ? e.short || e.name : id;
}
