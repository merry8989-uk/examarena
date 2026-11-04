#!/usr/bin/env node
/**
 * ExamArena — daily question generator.
 *
 * Runs from GitHub Actions (see .github/workflows/daily.yml) or by hand:
 *   AI_PROVIDER=openai AI_API_KEY=sk-... QUESTIONS_PER_DAY=500 node tools/generate-daily.mjs
 *
 * Writes:
 *   data/daily/YYYY-MM-DD.json   that day's paper (archive is the folder itself)
 *   data/archive.json            date-wise index the site reads
 *
 * With no AI_API_KEY it still publishes a paper assembled from the curated
 * bank, marked source:"bank", so the archive never skips a day.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DATA = path.join(ROOT, 'data');
const DAILY = path.join(DATA, 'daily');
const BANK_DIR = path.join(DATA, 'bank');

const CHUNK = 20;
const RETRIES = 3;

const cfg = {
  provider: (process.env.AI_PROVIDER || 'none').toLowerCase(),
  key: (process.env.AI_API_KEY || '').trim(),
  model: (process.env.AI_MODEL || '').trim(),
  endpoint: (process.env.AI_ENDPOINT || '').trim(),
  count: Math.max(10, Math.min(2000, parseInt(process.env.QUESTIONS_PER_DAY || '500', 10))),
  date: process.env.FOR_DATE || istDate()
};

function istDate() {
  // The cron fires at 00:00 IST; name the file for the IST calendar day it serves.
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

/* ---------- helpers ---------- */
function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}
function rng(seed) {
  let a = typeof seed === 'number' ? seed >>> 0 : parseInt(hash(String(seed)), 16) >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(arr, r) {
  const o = arr.slice();
  for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [o[i], o[j]] = [o[j], o[i]]; }
  return o;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- prompt ---------- */
const SCHEMA = `Return ONLY a JSON array, no prose and no markdown fences. Each element:
{"q":"question","options":["A","B","C","D"],"answer":0,"subject":"subject","topic":"narrow topic","difficulty":"easy|medium|hard","history":"1-2 sentences of background","discussion":"2-3 sentences","wh":{"what":"","why":"","when":"","where":"","who":"","how":""},"status":"current status","why_wrong":["","why B is wrong","why C is wrong","why D is wrong"],"tip":"exam technique","improve":"what to practise","source":"NCERT / Act / standard reference"}
Rules: answer is the 0-based correct index; why_wrong has exactly 4 entries with "" at the correct index; exactly one correct option; no "all of the above"; factually accurate and unambiguous.`;

function promptFor({ count, exam, subject, difficulty }) {
  return `You are an examiner for Indian examinations (UPSC, State PSC, SSC, Banking, CA, university and board exams).
Write ${count} single-correct MCQs in the style of previous-year question papers.
Exam: ${exam}. Subject: ${subject}. Difficulty: ${difficulty === 'any' ? 'a mix of easy, medium and hard' : difficulty}.
Avoid repetition with these already-used stems: ${usedStems.slice(-40).join(' | ') || 'none'}.
${SCHEMA}`;
}

/* ---------- providers ---------- */
async function callOpenAI({ prompt, endpoint, model, key, provider }) {
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key };
  if (provider === 'sarvam') headers['api-subscription-key'] = key;
  const res = await fetch(endpoint, {
    method: 'POST', headers,
    body: JSON.stringify({
      model, temperature: 0.75,
      messages: [
        { role: 'system', content: 'You write exam questions and reply with strict JSON only.' },
        { role: 'user', content: prompt }
      ]
    })
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  return j?.choices?.[0]?.message?.content || '';
}

async function callGemini({ prompt, model, key }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.75, responseMimeType: 'application/json', maxOutputTokens: 8192 }
    })
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  return j?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
}

const DEFAULTS = {
  sarvam: { endpoint: 'https://api.sarvam.ai/v1/chat/completions', model: 'sarvam-105b' },
  openai: { endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini' },
  gemini: { endpoint: '', model: 'gemini-2.0-flash' },
  custom: { endpoint: '', model: '' }
};

async function ask(prompt) {
  const d = DEFAULTS[cfg.provider] || {};
  const endpoint = cfg.endpoint || d.endpoint;
  const model = cfg.model || d.model;
  const raw = cfg.provider === 'gemini'
    ? await callGemini({ prompt, model, key: cfg.key })
    : await callOpenAI({ prompt, endpoint, model, key: cfg.key, provider: cfg.provider });
  return parseJSON(raw);
}

function parseJSON(text) {
  if (!text) return [];
  let t = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const s = t.indexOf('['), e = t.lastIndexOf(']');
  if (s === -1 || e === -1) return [];
  try {
    const arr = JSON.parse(t.slice(s, e + 1));
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

/* ---------- normalise + validate ---------- */
const usedStems = [];
const usedIds = new Set();

function normalise(raw, meta, dateStr, i) {
  if (!raw || typeof raw.q !== 'string') return null;
  const q = raw.q.trim().replace(/\s+/g, ' ');
  if (q.length < 15) return null;
  if (!Array.isArray(raw.options) || raw.options.length !== 4) return null;
  const options = raw.options.map(o => String(o).trim());
  if (options.some(o => !o) || new Set(options).size !== 4) return null;
  let answer = Number(raw.answer);
  if (!Number.isInteger(answer) || answer < 0 || answer > 3) {
    const letter = String(raw.answer || '').trim().toUpperCase();
    answer = ['A', 'B', 'C', 'D'].indexOf(letter);
    if (answer < 0) return null;
  }
  const stemKey = q.toLowerCase().slice(0, 90);
  if (usedStems.includes(stemKey)) return null;

  const why = Array.isArray(raw.why_wrong) ? raw.why_wrong.slice(0, 4).map(x => String(x || '')) : ['', '', '', ''];
  while (why.length < 4) why.push('');
  why[answer] = '';

  const id = `d-${dateStr}-${hash(q).slice(0, 6)}${i}`;
  if (usedIds.has(id)) return null;
  usedIds.add(id);
  usedStems.push(stemKey);

  return {
    id,
    exams: meta.exams || [],
    stream: 'daily',
    course: meta.exam || 'Daily paper',
    subject: (raw.subject || meta.subject || 'General').trim(),
    topic: (raw.topic || meta.topic || 'Daily practice').trim(),
    difficulty: ['easy', 'medium', 'hard'].includes(raw.difficulty) ? raw.difficulty : 'medium',
    q,
    options,
    answer,
    history: raw.history || '',
    discussion: raw.discussion || '',
    wh: raw.wh && typeof raw.wh === 'object' ? raw.wh : {},
    status: raw.status || '',
    why_wrong: why,
    tip: raw.tip || '',
    improve: raw.improve || '',
    source: raw.source || 'AI generated',
    origin: 'daily'
  };
}

/* ---------- subject plan ---------- */
function buildPlan(catalogue) {
  const seen = new Map();
  for (const ex of catalogue.exams) {
    for (const s of ex.subjects) {
      if (!seen.has(s)) seen.set(s, { subject: s, exam: ex.short || ex.name, exams: [ex.id] });
      else {
        const e = seen.get(s);
        if (!e.exams.includes(ex.id)) e.exams.push(ex.id);
      }
    }
  }
  return [...seen.values()];
}

/* ---------- bank fallback ---------- */
function bankPaper(dateStr, want) {
  if (!fs.existsSync(BANK_DIR)) return [];
  const files = fs.readdirSync(BANK_DIR).filter(f => f.endsWith('.json'));
  const all = files.flatMap(f => JSON.parse(fs.readFileSync(path.join(BANK_DIR, f), 'utf8')));
  const r = rng('daily-' + dateStr);
  const shuffled = shuffle(all, r);
  return shuffled.slice(0, Math.min(want, shuffled.length)).map(q => Object.assign({}, q, { origin: 'bank' }));
}

/* ---------- main ---------- */
async function main() {
  const catalogue = JSON.parse(fs.readFileSync(path.join(DATA, 'exams.json'), 'utf8'));
  const plan = buildPlan(catalogue);
  const aiReady = !!(cfg.key && cfg.provider !== 'none' && (cfg.provider === 'gemini' || cfg.endpoint || DEFAULTS[cfg.provider]?.endpoint));

  log(`date ${cfg.date} · target ${cfg.count} · provider ${cfg.provider}${aiReady ? '' : ' (no key → bank mode)'} · ${plan.length} subjects`);

  let questions = [];
  let failures = 0;

  if (aiReady) {
    const chunks = Math.ceil(cfg.count / CHUNK);
    for (let c = 0; c < chunks; c++) {
      const meta = plan[c % plan.length];
      const want = Math.min(CHUNK, cfg.count - questions.length);
      if (want <= 0) break;
      const prompt = promptFor({ count: want, exam: meta.exam, subject: meta.subject, difficulty: 'any' });
      let got = [];
      for (let attempt = 1; attempt <= RETRIES && !got.length; attempt++) {
        try {
          const raw = await ask(prompt);
          got = raw.map((r, i) => normalise(r, meta, cfg.date, i)).filter(Boolean);
        } catch (err) {
          log(`  chunk ${c + 1}/${chunks} attempt ${attempt} failed: ${err.message}`);
          if (attempt < RETRIES) await sleep(2000 * attempt);
        }
      }
      if (!got.length) failures++;
      questions = questions.concat(got.slice(0, want));
      log(`  chunk ${c + 1}/${chunks} · ${meta.subject} · +${Math.min(got.length, want)} (total ${questions.length})`);
      await sleep(400);
    }
  }

  const source = questions.length ? 'ai' : 'bank';
  if (!questions.length) {
    log('falling back to the curated bank');
    questions = bankPaper(cfg.date, cfg.count);
  }

  if (!questions.length) {
    log('nothing to publish — no AI output and no bank files');
    process.exit(1);
  }

  const bySubject = {};
  questions.forEach(q => { bySubject[q.subject] = (bySubject[q.subject] || 0) + 1; });

  const topic = catalogue.dailyTopics[
    Math.floor(new Date(cfg.date + 'T00:00:00Z').getTime() / 864e5) % catalogue.dailyTopics.length
  ];

  fs.mkdirSync(DAILY, { recursive: true });
  const paper = {
    date: cfg.date,
    topic,
    source,
    requested: cfg.count,
    count: questions.length,
    generatedAt: new Date().toISOString(),
    provider: aiReady ? cfg.provider : 'none',
    failedChunks: failures,
    subjects: bySubject,
    questions
  };
  fs.writeFileSync(path.join(DAILY, `${cfg.date}.json`), JSON.stringify(paper));

  const archivePath = path.join(DATA, 'archive.json');
  let archive = [];
  if (fs.existsSync(archivePath)) {
    try { archive = JSON.parse(fs.readFileSync(archivePath, 'utf8')); } catch { archive = []; }
  }
  archive = archive.filter(a => a.date !== cfg.date);
  archive.push({
    date: cfg.date, count: questions.length, source, topic,
    subjects: Object.keys(bySubject).length, provider: paper.provider,
    generatedAt: paper.generatedAt
  });
  archive.sort((a, b) => b.date.localeCompare(a.date));
  fs.writeFileSync(archivePath, JSON.stringify(archive, null, 1));

  log(`published ${questions.length} questions for ${cfg.date} (${source}) across ${Object.keys(bySubject).length} subjects; archive now holds ${archive.length} days`);
  if (source === 'bank') log('NOTE: bank mode repeats curated questions — add AI_API_KEY to generate fresh ones');
}

main().catch(err => { console.error(err); process.exit(1); });
