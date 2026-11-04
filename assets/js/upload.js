/* ExamArena — upload pipeline: question banks (JSON / CSV / TXT),
 * notes as PDF (pdf.js) or images (Tesseract OCR). */
import { hashStr } from './store.js';

const PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const TESS_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.0.5/dist/tesseract.min.js';

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if ([...document.scripts].some(s => s.src === src)) return resolve();
    const el = document.createElement('script');
    el.src = src; el.async = true;
    el.onload = resolve;
    el.onerror = () => reject(new Error('Could not load library from CDN: ' + src));
    document.head.appendChild(el);
  });
}

/* ---------- normalisation ---------- */
export function toBankQuestion(raw, i = 0) {
  const options = (raw.options || []).slice(0, 4).map(o => String(o).trim());
  while (options.length < 4) options.push('Option ' + (options.length + 1));
  let answer = Number(raw.answer);
  if (!Number.isInteger(answer) || answer < 0 || answer > 3) {
    // accept "A"/"B"/"C"/"D"
    const letter = String(raw.answer || '').trim().toUpperCase();
    answer = ['A', 'B', 'C', 'D'].indexOf(letter);
    if (answer < 0) answer = 0;
  }
  const why = Array.isArray(raw.why_wrong) ? raw.why_wrong.slice(0, 4).map(String) : [];
  while (why.length < 4) why.push('');
  why[answer] = '';
  const q = String(raw.q || raw.question || '').trim();
  return {
    id: raw.id || 'up-' + hashStr(q.slice(0, 90) + i),
    exams: raw.exams || [],
    stream: raw.stream || 'custom',
    course: raw.course || raw.exam || 'Uploaded bank',
    subject: raw.subject || 'Uploaded',
    topic: raw.topic || 'Uploaded question',
    difficulty: ['easy', 'medium', 'hard'].includes(raw.difficulty) ? raw.difficulty : 'medium',
    q,
    options,
    answer,
    history: raw.history || 'Background was not supplied with this uploaded question.',
    discussion: raw.discussion || '',
    wh: raw.wh && typeof raw.wh === 'object' ? raw.wh : {},
    status: raw.status || '',
    why_wrong: why,
    tip: raw.tip || '',
    improve: raw.improve || 'Revise the source paragraph this question came from.',
    source: raw.source || 'Uploaded question bank',
    origin: 'custom'
  };
}

/* ---------- JSON ---------- */
export function parseJSONBank(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error('That file is not valid JSON.'); }
  const list = Array.isArray(data) ? data : (data.questions || data.bank || data.items);
  if (!Array.isArray(list)) throw new Error('JSON must be an array of questions, or an object with a "questions" array.');
  const out = list
    .filter(x => x && (x.q || x.question) && (x.options || x.choices))
    .map((x, i) => toBankQuestion(Object.assign({}, x, { options: x.options || x.choices }), i))
    .filter(x => x.q && x.options.length === 4);
  if (!out.length) throw new Error('No usable questions found. Each item needs q/question, options/choices and answer.');
  return out;
}

/* ---------- CSV ---------- */
function csvRows(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c === '\r') { /* skip */ }
    else cell += c;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim() !== ''));
}

export function parseCSV(text) {
  const rows = csvRows(text);
  if (rows.length < 2) throw new Error('CSV needs a header row and at least one question.');
  const head = rows[0].map(h => h.trim().toLowerCase().replace(/\s+/g, ''));
  const idx = (...names) => head.findIndex(h => names.includes(h));

  const iQ = idx('question', 'q', 'questiontext');
  const iA = idx('optiona', 'a', 'opt1', 'option1');
  const iB = idx('optionb', 'b', 'opt2', 'option2');
  const iC = idx('optionc', 'c', 'opt3', 'option3');
  const iD = idx('optiond', 'd', 'opt4', 'option4');
  const iAns = idx('answer', 'correct', 'correctoption', 'ans');
  const iExp = idx('explanation', 'solution', 'reason', 'history');
  const iSub = idx('subject', 'topic');
  if (iQ < 0 || iA < 0 || iB < 0 || iC < 0 || iD < 0 || iAns < 0) {
    throw new Error('CSV header must include: question, optionA, optionB, optionC, optionD, answer (subject and explanation optional).');
  }

  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    if (!cells[iQ] || !String(cells[iQ]).trim()) continue;
    out.push(toBankQuestion({
      q: cells[iQ],
      options: [cells[iA], cells[iB], cells[iC], cells[iD]],
      answer: cells[iAns],
      subject: iSub >= 0 ? cells[iSub] : 'Uploaded',
      explanation: cells[iExp],
      discussion: iExp >= 0 ? cells[iExp] : ''
    }, r));
  }
  if (!out.length) throw new Error('No rows with a question and answer were found.');
  return out;
}

/* ---------- TXT ---------- */
export function parseTXT(text) {
  const blocks = text.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
  const out = [];

  blocks.forEach((block, bi) => {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    const qLine = lines.find(l => /^(q(uestion)?\s*[.:)\-]|\d+[.)])/i.test(l)) || (lines.length > 4 ? lines[0] : null);
    const optLines = lines.filter(l => /^[\(\[]?[a-dA-D1-4][\)\].:\-]\s+/.test(l));
    const ansLine = lines.find(l => /^(answer|ans|correct)\s*[.:\-]/i.test(l));
    if (!qLine || optLines.length < 4 || !ansLine) return;

    const options = optLines.slice(0, 4).map(l => l.replace(/^[\(\[]?[a-dA-D1-4][\)\].:\-]\s+/, '').trim());
    const ansRaw = ansLine.split(/[.:\-]/).slice(1).join(' ').trim();
    const expLine = lines.find(l => /^(explanation|solution|reason)\s*[.:\-]/i.test(l)) || '';
    const qText = qLine.replace(/^(q(uestion)?\s*[.:)\-]|\d+[.)])\s*/i, '').trim();

    out.push(toBankQuestion({
      q: qText,
      options,
      answer: ansRaw,
      discussion: expLine ? expLine.split(/[.:\-]/).slice(1).join(' ').trim() : ''
    }, bi));
  });

  if (!out.length) {
    throw new Error('Could not read questions. Use blocks like: "Q: ...", four lines "A) ... B) ... C) ... D) ...", then "Answer: B".');
  }
  return out;
}

/* ---------- entry point for question banks ---------- */
export function parseQuestionFile(name, text) {
  const lower = name.toLowerCase();
  if (lower.endsWith('.json')) return parseJSONBank(text);
  if (lower.endsWith('.csv')) return parseCSV(text);
  if (lower.endsWith('.txt') || lower.endsWith('.md')) {
    try { return parseTXT(text); }
    catch (e) { return { notes: text, questions: [], error: e.message }; }
  }
  // sniff
  const t = text.trim();
  if (t.startsWith('[') || t.startsWith('{')) return parseJSONBank(t);
  if (t.split('\n')[0].includes(',')) { try { return parseCSV(t); } catch {} }
  return parseTXT(t);
}

/* ---------- PDF notes ---------- */
export async function extractPDF(file, onProgress) {
  await loadScript(PDFJS_URL);
  const pdfjs = window.pdfjsLib;
  if (!pdfjs) throw new Error('PDF reader did not load. Check your connection and try again.');
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;

  const buffer = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buffer }).promise;
  let text = '';
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    text += content.items.map(i => i.str).join(' ') + '\n\n';
    if (onProgress) onProgress(Math.round((p / doc.numPages) * 100));
  }
  return { text: text.trim(), pages: doc.numPages };
}

/* ---------- image notes (OCR) ---------- */
export async function extractImage(file, onProgress) {
  await loadScript(TESS_URL);
  const Tesseract = window.Tesseract;
  if (!Tesseract) throw new Error('OCR engine did not load. Check your connection and try again.');
  const worker = await Tesseract.createWorker('eng', 1, {
    logger: m => { if (onProgress && typeof m.progress === 'number') onProgress(Math.round(m.progress * 100)); }
  });
  try {
    const { data } = await worker.recognize(file);
    return { text: (data.text || '').trim(), confidence: data.confidence };
  } finally {
    await worker.terminate();
  }
}

export function readTextFile(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ''));
    fr.onerror = () => reject(new Error('Could not read the file.'));
    fr.readAsText(file);
  });
}
