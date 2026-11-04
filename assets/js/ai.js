/* ExamArena — AI layer. Bring your own key; works with Sarvam, OpenAI, Gemini
 * or any OpenAI-compatible endpoint. With no key the app stays fully usable on
 * the built-in bank and clearly labels any locally drafted question. */
import { settings, hashStr } from './store.js';

export const PROVIDERS = {
  none:     { label: 'No key — built-in bank only', needsKey: false },
  sarvam:   { label: 'Sarvam AI (sarvam-105b)', needsKey: true, model: 'sarvam-105b', endpoint: 'https://api.sarvam.ai/v1/chat/completions', kind: 'openai' },
  openai:   { label: 'OpenAI (gpt-4o-mini)', needsKey: true, model: 'gpt-4o-mini', endpoint: 'https://api.openai.com/v1/chat/completions', kind: 'openai' },
  gemini:   { label: 'Google Gemini (gemini-2.0-flash)', needsKey: true, model: 'gemini-2.0-flash', endpoint: '', kind: 'gemini' },
  custom:   { label: 'Custom OpenAI-compatible endpoint', needsKey: true, model: '', endpoint: '', kind: 'openai' }
};

export function aiStatus() {
  const s = settings();
  const p = PROVIDERS[s.provider] || PROVIDERS.none;
  return { ready: !!(s.provider !== 'none' && s.key), provider: s.provider, label: p.label };
}

const SCHEMA_HINT = `Return ONLY a JSON array. No prose, no markdown fences. Each element must be:
{
 "q": "question text",
 "options": ["option A","option B","option C","option D"],
 "answer": 0,
 "subject": "subject name",
 "topic": "narrow topic",
 "difficulty": "easy|medium|hard",
 "history": "1-2 sentences of background: origin, date, who, where",
 "discussion": "2-3 sentences of conceptual discussion",
 "wh": {"what":"...","why":"...","when":"...","where":"...","who":"...","how":"..."},
 "status": "current status or latest development",
 "why_wrong": ["why A is wrong","why B is wrong","","why D is wrong"],
 "tip": "one exam technique for this concept",
 "improve": "one concrete thing the student should practise",
 "source": "NCERT / Act / standard reference"
}
"answer" is the 0-based index of the correct option. "why_wrong" must have exactly 4 entries, with an empty string at the correct option's index. Every question must be factually accurate, unambiguous, and have exactly one correct option.`;

function buildPrompt({ count, exam, subject, difficulty, context, topic }) {
  const lines = [
    `You are an examiner for Indian competitive and university examinations.`,
    `Write ${count} single-correct multiple choice questions.`,
    `Exam: ${exam || 'general competitive exam'}. Subject: ${subject || 'mixed'}. Difficulty: ${difficulty === 'any' ? 'mixed easy, medium and hard' : difficulty}.`,
    topic ? `Focus topic: ${topic}.` : '',
    context ? `Base the questions strictly on these study notes:\n---\n${context.slice(0, 6000)}\n---` : '',
    `Style: previous-year-paper style, precise, no trick wording, no "all of the above" options.`,
    SCHEMA_HINT
  ];
  return lines.filter(Boolean).join('\n');
}

function extractJSON(text) {
  if (!text) return null;
  let t = String(text).trim();
  t = t.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = t.indexOf('[');
  const end = t.lastIndexOf(']');
  if (start === -1 || end === -1) return null;
  try { return JSON.parse(t.slice(start, end + 1)); } catch { return null; }
}

export async function generateQuestions(opts) {
  const s = settings();
  const p = PROVIDERS[s.provider] || PROVIDERS.none;
  if (!p.needsKey || !s.key) {
    throw new Error('NO_KEY');
  }
  const prompt = buildPrompt(opts);

  if (p.kind === 'gemini') {
    const model = s.model || p.model;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(s.key)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.7, responseMimeType: 'application/json' }
      })
    });
    if (!res.ok) throw new Error('AI request failed (' + res.status + ')');
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.map(x => x.text).join('') || '';
    return normalize(extractJSON(text), opts);
  }

  const endpoint = s.endpoint || p.endpoint;
  const model = s.model || p.model;
  if (!endpoint) throw new Error('No endpoint set for this provider.');
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + s.key };
  if (s.provider === 'sarvam') headers['api-subscription-key'] = s.key;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
      temperature: 0.7,
      messages: [
        { role: 'system', content: 'You write exam questions and reply with strict JSON only.' },
        { role: 'user', content: prompt }
      ]
    })
  });
  if (!res.ok) throw new Error('AI request failed (' + res.status + '). Check the key, model and endpoint.');
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content || '';
  return normalize(extractJSON(text), opts);
}

function normalize(list, opts) {
  if (!Array.isArray(list)) throw new Error('The model did not return a usable JSON array. Try again.');
  const out = [];
  list.forEach((raw, i) => {
    if (!raw || typeof raw.q !== 'string' || !Array.isArray(raw.options) || raw.options.length < 4) return;
    const options = raw.options.slice(0, 4).map(o => String(o).trim());
    let answer = Number(raw.answer);
    if (!Number.isInteger(answer) || answer < 0 || answer > 3) answer = 0;
    const why = Array.isArray(raw.why_wrong) ? raw.why_wrong.slice(0, 4).map(String) : ['', '', '', ''];
    while (why.length < 4) why.push('');
    why[answer] = '';
    out.push({
      id: 'ai-' + hashStr(raw.q.slice(0, 90) + i),
      exams: opts.exams && opts.exams.length ? opts.exams : [],
      stream: 'ai',
      course: opts.exam || 'AI generated',
      subject: raw.subject || opts.subject || 'Mixed',
      topic: raw.topic || opts.topic || 'AI generated',
      difficulty: ['easy', 'medium', 'hard'].includes(raw.difficulty) ? raw.difficulty : (opts.difficulty === 'any' ? 'medium' : opts.difficulty),
      q: String(raw.q).trim(),
      options,
      answer,
      history: raw.history || 'Background not supplied by the model.',
      discussion: raw.discussion || '',
      wh: raw.wh && typeof raw.wh === 'object' ? raw.wh : {},
      status: raw.status || '',
      why_wrong: why,
      tip: raw.tip || '',
      improve: raw.improve || '',
      source: raw.source || 'AI generated',
      origin: 'ai'
    });
  });
  if (!out.length) throw new Error('The model returned no valid questions. Try a smaller count.');
  return out;
}

/* ---------- offline draft from uploaded notes ----------
 * Not AI, and labelled as a draft: blanks out a key term in a sentence from the
 * student's own notes and builds distractors from other terms in the same text. */
export function draftFromNotes(text, { count = 10, subject = 'Notes' } = {}) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length < 120) return [];
  const sentences = clean.split(/(?<=[.!?])\s+/).filter(s => s.split(' ').length > 7 && s.length < 320);
  const numbers = [...new Set((clean.match(/\b\d[\d,.]*\b/g) || []))].slice(0, 40);
  const caps = [...new Set((clean.match(/\b[A-Z][a-zA-Z]{3,}\b/g) || []))].slice(0, 60);
  const pool = caps.length >= 6 ? caps : numbers;
  const out = [];

  for (const s of sentences) {
    if (out.length >= count) break;
    const words = s.match(/\b[A-Z][a-zA-Z]{3,}\b/g) || [];
    const term = words.find(w => pool.includes(w));
    if (!term) continue;
    const distract = pool.filter(w => w !== term).slice(0, 3);
    if (distract.length < 3) continue;
    const options = [term, ...distract];
    // deterministic shuffle
    const order = options.map((o, i) => ({ o, k: (hashStr(o + s.slice(0, 20)) % 1000) + i })).sort((a, b) => a.k - b.k).map(x => x.o);
    out.push({
      id: 'note-' + hashStr(s.slice(0, 80) + out.length),
      exams: [], stream: 'notes', course: 'From your notes',
      subject, topic: 'Draft from uploaded notes', difficulty: 'medium',
      q: s.replace(term, '__________'),
      options: order,
      answer: order.indexOf(term),
      history: 'Drafted automatically from your uploaded notes.',
      discussion: 'The original sentence reads: "' + s + '"',
      wh: { what: term, where: 'Your notes' },
      status: 'Draft question — edit or replace it once an AI key is added.',
      why_wrong: order.map(o => (o === term ? '' : `"${o}" does not fit the sentence as written in your notes.`)),
      tip: 'Draft questions test recall of exact wording, so treat them as a first pass.',
      improve: 'Add an AI key to turn these notes into full exam-style questions with analysis.',
      source: 'Uploaded notes',
      origin: 'draft'
    });
  }
  return out;
}
