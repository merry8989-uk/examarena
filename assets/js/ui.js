/* ExamArena — views, test player, result analysis, modals */
import * as S from './store.js';
import * as E from './engine.js';
import * as AI from './ai.js';
import * as U from './upload.js';

const runtime = { timer: null, live: null, paper: null, result: null };

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const P = (n) => ['A', 'B', 'C', 'D'][n] || '?';

export function toast(msg, ms = 3200) {
  const old = document.querySelector('.toast');
  if (old) old.remove();
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

/* ---------------- modal ---------------- */
export function modal(html, { slim = false } = {}) {
  const root = document.getElementById('modalRoot');
  root.innerHTML = `<div class="modalback" data-close="1"><div class="modal ${slim ? 'slim' : ''}" role="dialog" aria-modal="true">${html}</div></div>`;
  root.querySelector('.modalback').addEventListener('click', e => {
    if (e.target.dataset.close) closeModal();
  });
  root.querySelectorAll('[data-dismiss]').forEach(b => b.addEventListener('click', closeModal));
  return root;
}
export function closeModal() { document.getElementById('modalRoot').innerHTML = ''; }

export function teardown() {
  if (runtime.timer) { clearInterval(runtime.timer); runtime.timer = null; }
}

/* ================= HOME ================= */
export async function mountHome(app, view) {
  const st = S.stats();
  const p = S.profile();
  const ui = app.ui.home = app.ui.home || { stream: 'all', q: '', subject: 'all' };
  const date = E.todayStr();
  const todayFile = await E.loadDailyFile(date);
  let daily;
  if (todayFile) {
    daily = { topic: todayFile.topic, questions: todayFile.questions, source: todayFile.source };
  } else {
    const d = E.buildDaily({ catalogue: app.catalogue, bank: app.bank, date });
    daily = { topic: d.topic, questions: d.questions, source: 'bank' };
  }
  const subjects = E.subjectsInBank(app.bank);

  view.innerHTML = `
    <section class="hero">
      <div class="hero-main">
        <span class="eyebrow">${esc(p.goalExam ? 'Goal: ' + p.goalExam : 'Every exam · every subject')}</span>
        <h1>Mock tests that explain<br>why you got it wrong.</h1>
        <p class="lead">A fresh 50-question paper every day for UPSC, BPSC, SSC, Banking, CA, B.Com, BBA, BCA, Arts, Science and Commerce — plus a builder that will bind a 500-question test into timed papers. Every answer comes with background, discussion, WH analysis, current status and the confidence work to fix it.</p>
        <div class="row">
          <button class="btn" data-act="start-daily">Start today's 50-question test</button>
          <a class="btn ghost" href="#/builder">Build a custom paper</a>
        </div>
      </div>
      <div class="hero-side">
        <div class="today">
          <span class="eyebrow" style="color:var(--teal)">Today · ${esc(new Date(date + 'T00:00:00Z').toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }))}</span>
          <div class="topic">${esc(daily.topic)}</div>
          <div class="muted" style="font-size:.86rem">${daily.questions.length} questions · ${daily.source === 'ai' ? 'AI generated' : 'curated bank'} · free</div>
          <button class="btn small" data-act="start-daily" style="align-self:flex-start">Begin</button>
        </div>
        <div class="statcard">
          ${st.count
            ? `<div class="big">${st.accuracy}%</div><div class="lbl">accuracy across ${st.totalQ} questions</div>`
            : `<div class="big" style="font-size:1.05rem;color:var(--muted);font-weight:600">No test yet</div><div class="lbl">Your first paper takes 50 minutes</div>`}
        </div>
        <div class="statcard">
          <div class="big">${st.streak || 0}<span style="font-size:.9rem;color:var(--muted)"> day${st.streak === 1 ? '' : 's'}</span></div>
          <div class="lbl">current streak · your ID ${esc(app.identity.id)}</div>
        </div>
      </div>
    </section>

    <div class="sectionhead">
      <h2 style="margin:0">Choose your exam</h2>
      <span class="muted" style="font-size:.84rem">${app.bank.length} questions in your bank · ${subjects.length} subjects</span>
    </div>

    <div class="filters" id="homeFilters">
      <button class="chip ${ui.stream === 'all' ? 'on' : ''}" data-stream="all">All streams</button>
      ${app.catalogue.streams.map(s => `<button class="chip ${ui.stream === s.id ? 'on' : ''}" data-stream="${s.id}">${esc(s.name)}</button>`).join('')}
      <input type="text" id="homeSearch" placeholder="Search exam or subject…" value="${esc(ui.q)}" style="max-width:260px" />
    </div>

    <div class="examgrid" id="examGrid">${examCards(app, ui)}</div>

    <div class="sectionhead"><h2 style="margin:0">Pick a subject</h2></div>
    <div class="filters">
      <button class="chip ${ui.subject === 'all' ? 'on' : ''}" data-subject="all">All subjects</button>
      ${subjects.map(s => `<button class="chip ${ui.subject === s.subject ? 'on' : ''}" data-subject="${esc(s.subject)}">${esc(s.subject)} <span class="dim">${s.count}</span></button>`).join('')}
    </div>
  `;

  view.querySelectorAll('[data-stream]').forEach(b => b.addEventListener('click', () => {
    ui.stream = b.dataset.stream; mountHome(app, view);
  }));
  view.querySelectorAll('[data-subject]').forEach(b => b.addEventListener('click', () => {
    ui.subject = b.dataset.subject; mountHome(app, view);
  }));
  const search = view.querySelector('#homeSearch');
  if (search) search.addEventListener('input', () => {
    ui.q = search.value;
    const grid = view.querySelector('#examGrid');
    grid.innerHTML = examCards(app, ui);
    wireExamCards(app, view);
  });
  view.querySelectorAll('[data-act="start-daily"]').forEach(b => b.addEventListener('click', () => startDaily(app, date, 50)));
  wireExamCards(app, view);
}

function examCards(app, ui) {
  const q = ui.q.toLowerCase();
  let exams = app.catalogue.exams;
  if (ui.stream !== 'all') exams = exams.filter(e => e.stream === ui.stream);
  if (q) exams = exams.filter(e => (e.name + ' ' + e.short + ' ' + e.subjects.join(' ')).toLowerCase().includes(q));
  if (ui.subject !== 'all') exams = exams.filter(e => e.subjects.includes(ui.subject) || app.bank.some(b => b.subject === ui.subject && (b.exams || []).includes(e.id)));

  if (!exams.length) return `<div class="empty" style="grid-column:1/-1">No exam matches that filter. Try another subject or search term.</div>`;

  return exams.map(e => {
    const available = app.bank.filter(b => (b.exams || []).includes(e.id)).length;
    const subs = ui.subject !== 'all' ? [ui.subject] : e.subjects.slice(0, 5);
    return `<div class="examcard">
      <div class="row between" style="gap:.4rem">
        <h4>${esc(e.name)}</h4>
        <span class="pill">${available} Q</span>
      </div>
      <div class="meta">${esc(e.papers)}</div>
      <div class="subs">${subs.map(s => `<span class="chip sm">${esc(s)}</span>`).join('')}</div>
      <div class="row" style="margin-top:auto">
        <button class="btn small" data-exam="${e.id}">Start 50 Q</button>
        <a class="btn small ghost" href="#/builder" data-exam-build="${e.id}">Customise</a>
      </div>
    </div>`;
  }).join('');
}

function wireExamCards(app, view) {
  view.querySelectorAll('[data-exam]').forEach(b => b.addEventListener('click', () => {
    startExam(app, b.dataset.exam, 50);
  }));
  view.querySelectorAll('[data-exam-build]').forEach(a => a.addEventListener('click', () => {
    app.ui.builder = Object.assign({ streams: [], exams: [a.dataset.examBuild], subjects: [], difficulty: 'any', count: 50, mode: 'bank', noteId: '' });
  }));
}

/* ================= DAILY + ARCHIVE ================= */
export async function mountDaily(app, view) {
  const days = Array.from({ length: 7 }, (_, i) => E.todayStr(-i));
  const today = days[0];
  const file = await E.loadDailyFile(today);
  const archive = await E.loadArchive();
  const fallback = file ? null : E.buildDaily({ catalogue: app.catalogue, bank: app.bank, date: today });
  const count = file ? file.count : fallback.questions.length;
  const parts = file ? E.splitParts(file.questions, 150) : [];
  const src = file ? (file.source === 'ai' ? 'AI generated' : 'curated bank') : 'curated bank';
  const subjectCount = file
    ? Object.keys(file.subjects || {}).length
    : new Set(fallback.questions.map(q => q.subject)).size;

  const archivedOthers = archive.filter(a => a.date !== today);
  const recent = archivedOthers.length
    ? archivedOthers.slice(0, 6)
    : days.slice(1).map(d => ({ date: d, count: null, topic: E.dailyTopic(app.catalogue, d), source: 'bank' }));

  view.innerHTML = `
    <span class="eyebrow">Daily paper · archived date wise</span>
    <h1 style="font-size:2rem">Today's mock test</h1>
    <p class="muted" style="max-width:74ch">${file
      ? 'The overnight job generated this paper and stored it in the repository, so it is identical for every visitor today and kept forever in the archive.'
      : 'The overnight job has not published a paper for today yet, so this one is assembled live from the curated bank using a date seed. It is the same for every visitor today and different tomorrow.'}</p>

    <div class="card pad" style="margin:1.2rem 0">
      <div class="row between" style="align-items:flex-start">
        <div>
          <span class="eyebrow" style="color:var(--teal)">${esc(new Date(today + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }))}</span>
          <h2 style="margin:.2rem 0 .3rem">${esc(file ? file.topic : fallback.topic)}</h2>
          <p class="muted" style="margin:0">${count} questions · ${subjectCount} subjects · ${esc(src)}${file && file.provider && file.provider !== 'none' ? ' · ' + esc(file.provider) : ''}</p>
        </div>
        <div class="row">
          <button class="btn" data-quick="50">Quick 50</button>
          ${count > 100 ? `<button class="btn soft" data-quick="100">100 Q</button>` : ''}
        </div>
      </div>
      ${parts.length > 1 ? `<div class="hr"></div>
        <span class="eyebrow">Attempt by part</span>
        <div class="optrow" style="margin:0">
          ${parts.map(p => `<button class="chip" data-part="${p.index - 1}">Part ${p.index} · ${p.count} Q</button>`).join('')}
          <button class="chip" data-all="1">All ${count} Q</button>
        </div>
        <p class="dim" style="font-size:.76rem;margin:.6rem 0 0">A 500-question day is bound into separate timed papers, the way a real exam runs its shifts.</p>` : ''}
    </div>

    <div class="sectionhead">
      <h3 style="margin:0">Recent papers</h3>
      <a href="#/archive" class="dim" style="font-size:.84rem">Full archive · ${archive.length} day${archive.length === 1 ? '' : 's'} →</a>
    </div>
    <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(250px,1fr))">
      ${recent.map(a => `<div class="examcard">
        <div class="row between">
          <span class="meta">${esc(new Date(a.date + 'T00:00:00Z').toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }))}</span>
          <span class="pill ${a.source === 'ai' ? 'easy' : ''}">${a.source === 'ai' ? 'AI' : 'bank'}</span>
        </div>
        <h4 style="font-size:.95rem">${esc(a.topic || 'Daily paper')}</h4>
        <div class="meta">${a.count ? a.count + ' questions' : '50 questions'}</div>
        <button class="btn small ghost" data-arch="${esc(a.date)}" style="align-self:flex-start">Attempt</button>
      </div>`).join('')}
    </div>
  `;

  view.querySelectorAll('[data-quick]').forEach(b => b.addEventListener('click', () => openDaily(app, today, { quick: Number(b.dataset.quick) })));
  view.querySelectorAll('[data-part]').forEach(b => b.addEventListener('click', () => openDaily(app, today, { part: Number(b.dataset.part) })));
  const all = view.querySelector('[data-all]');
  if (all) all.addEventListener('click', () => openDaily(app, today, {}));
  view.querySelectorAll('[data-arch]').forEach(b => b.addEventListener('click', () => openArchived(app, b.dataset.arch)));
}

export async function mountArchive(app, view) {
  const archive = await E.loadArchive();
  if (!archive.length) {
    view.innerHTML = `
      <span class="eyebrow">Archive</span>
      <h1 style="font-size:2rem">Question archive</h1>
      <div class="empty" style="margin-top:1.2rem;text-align:left;padding:1.6rem">
        <strong>No archived papers yet.</strong>
        <p class="muted" style="margin:.6rem 0 0">The daily job runs at 00:00 IST and writes one file per day into <code>data/daily/</code>, listed in <code>data/archive.json</code>. Until it has run, every page falls back to the date-seeded paper from the curated bank — nothing is ever lost, it just is not archived as a file yet.</p>
        <p class="muted" style="margin:.6rem 0 0">To publish one now, run <code>node tools/generate-daily.mjs</code> locally, or trigger the workflow manually from the Actions tab.</p>
      </div>`;
    return;
  }

  const months = {};
  archive.forEach(a => { const m = a.date.slice(0, 7); (months[m] = months[m] || []).push(a); });
  const monthName = m => new Date(m + '-01T00:00:00Z').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  const totalQ = archive.reduce((s, a) => s + (a.count || 0), 0);

  view.innerHTML = `
    <span class="eyebrow">Archive · ${archive.length} days · ${totalQ} questions</span>
    <h1 style="font-size:2rem">Every paper, date wise</h1>
    <p class="muted" style="max-width:74ch">Each day's paper is its own file in the repository and is never overwritten. Open any date, attempt it as often as you like, and the analysis is the same every time.</p>
    ${Object.entries(months).map(([m, list]) => `
      <div class="sectionhead"><h3 style="margin:0">${esc(monthName(m))}</h3><span class="dim" style="font-size:.82rem">${list.length} paper${list.length === 1 ? '' : 's'}</span></div>
      <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr))">
        ${list.map(a => `<div class="examcard">
          <div class="row between">
            <strong>${esc(new Date(a.date + 'T00:00:00Z').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', weekday: 'short' }))}</strong>
            <span class="pill ${a.source === 'ai' ? 'easy' : ''}">${a.source === 'ai' ? 'AI' : 'bank'}</span>
          </div>
          <div class="meta">${esc(a.topic || 'Daily paper')}</div>
          <div class="meta">${a.count} questions${a.subjects ? ' · ' + a.subjects + ' subjects' : ''}</div>
          <div class="row" style="margin-top:auto">
            ${E.planSeries(a.count, 150).map((n, i) => `<button class="chip sm" data-arch="${esc(a.date)}" data-part="${i}">P${i + 1} · ${n}</button>`).join('')}
          </div>
        </div>`).join('')}
      </div>`).join('')}
  `;

  view.querySelectorAll('[data-arch]').forEach(b => b.addEventListener('click', () => openArchived(app, b.dataset.arch, Number(b.dataset.part))));
}

async function openDaily(app, date, opts = {}) {
  try {
    const file = await E.loadDailyFile(date);
    let questions, title, subtitle;

    if (file) {
      const parts = E.splitParts(file.questions, 150);
      const src = file.source === 'ai' ? ' · AI generated' : ' · curated bank';
      if (opts.part != null && parts[opts.part]) {
        const p = parts[opts.part];
        questions = p.questions;
        title = `Daily paper ${date} — Part ${p.index} of ${p.total}`;
      } else if (opts.quick) {
        questions = E.seededShuffle(file.questions, E.rngFromSeed('quick-' + date)).slice(0, opts.quick);
        title = `Daily paper ${date} — quick ${questions.length}`;
      } else {
        questions = file.questions;
        title = `Daily paper ${date} — all ${questions.length}`;
      }
      subtitle = (file.topic || 'Daily paper') + src;
    } else {
      const paper = E.buildDaily({ catalogue: app.catalogue, bank: app.bank, date, count: opts.quick || 50 });
      questions = paper.questions;
      title = paper.title;
      subtitle = paper.topic + ' · curated bank';
    }

    if (!questions.length) return toast('No paper available for that date yet.');
    beginTest(app, { questions, title, subtitle, kind: 'daily' });
  } catch (err) {
    toast(err.message || 'Could not open that paper.');
  }
}

async function openArchived(app, date, partIdx) {
  try {
    const file = await E.loadDailyFile(date);
    if (!file) return toast('That paper is not in the archive.');
    const parts = E.splitParts(file.questions, 150);

    if (partIdx != null && parts[partIdx]) {
      const p = parts[partIdx];
      return beginTest(app, {
        questions: p.questions,
        title: `Daily paper ${date} — Part ${p.index} of ${p.total}`,
        subtitle: (file.topic || '') + (file.source === 'ai' ? ' · AI generated' : ' · curated bank'),
        kind: 'daily'
      });
    }
    if (parts.length === 1) {
      return beginTest(app, { questions: parts[0].questions, title: `Daily paper ${date}`, subtitle: file.topic || '', kind: 'daily' });
    }

    const root = modal(`
      <div class="modalhead"><h3>${esc(date)} — ${esc(file.topic || 'Daily paper')}</h3><button class="xbtn" data-dismiss="1">✕</button></div>
      <div class="modalbody">
        <p class="muted" style="font-size:.88rem">${file.count} questions in ${parts.length} parts. Pick one to attempt.</p>
        <div class="optrow">
          ${parts.map(p => `<button class="chip" data-go="${p.index - 1}">Part ${p.index} · ${p.count} Q</button>`).join('')}
        </div>
      </div>
    `, { slim: true });
    root.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => {
      const p = parts[Number(b.dataset.go)];
      closeModal();
      beginTest(app, {
        questions: p.questions,
        title: `Daily paper ${date} — Part ${p.index} of ${p.total}`,
        subtitle: file.topic || '',
        kind: 'daily'
      });
    }));
  } catch (err) {
    toast(err.message || 'Could not open that paper.');
  }
}

function startDaily(app, date, count) {
  openDaily(app, date, { quick: count });
}

function startExam(app, examId, count) {
  const paper = E.buildPaper({ bank: app.bank, exams: [examId], count, seed: Date.now() });
  if (!paper.questions.length) return toast('No questions in the bank for this exam yet — build one with AI or upload a bank.');
  if (paper.shortfall > 0) toast(`Only ${paper.questions.length} questions available for this exam in your bank.`, 4200);
  beginTest(app, {
    questions: paper.questions,
    title: E.examName(app.catalogue, examId) + ' — ' + count + ' question paper',
    subtitle: 'Mixed difficulty',
    kind: 'exam'
  });
}

/* ================= BUILDER ================= */
export function mountBuilder(app, view) {
  const b = app.ui.builder = Object.assign(
    { streams: [], exams: [], subjects: [], difficulty: 'any', count: 50, mode: 'bank', noteId: '' },
    app.ui.builder || {}
  );
  const ai = AI.aiStatus();
  const noteList = S.notes();

  view.innerHTML = `
    <span class="eyebrow">Test builder</span>
    <h1 style="font-size:2rem">Build any paper, any size</h1>
    <p class="muted" style="max-width:72ch">Filter by stream, exam, subject and difficulty. Ask for 500 questions and it is bound into separate timed papers of 150 — exactly how a real exam runs its shifts.</p>
    <div class="buildgrid" style="margin-top:1.2rem">
      <div>
        <div class="card pad" style="margin-bottom:1rem">
          <label class="field">1 · Stream</label>
          <div class="optrow" id="streamRow">
            ${app.catalogue.streams.map(s => `<button class="chip ${b.streams.includes(s.id) ? 'on' : ''}" data-stream="${s.id}">${esc(s.name)}</button>`).join('')}
          </div>
          <label class="field">2 · Exam</label>
          <div class="optrow" id="examRow"></div>
          <label class="field">3 · Subjects</label>
          <div class="optrow" id="subjectRow"></div>
          <label class="field">4 · Difficulty</label>
          <div class="optrow">
            ${['any', 'easy', 'medium', 'hard'].map(d => `<button class="chip ${b.difficulty === d ? 'on' : ''}" data-diff="${d}">${d === 'any' ? 'Mixed' : d[0].toUpperCase() + d.slice(1)}</button>`).join('')}
          </div>
          <label class="field">5 · How many questions</label>
          <div class="optrow" style="align-items:center">
            ${[10, 25, 50, 100, 150, 300, 500].map(n => `<button class="chip ${b.count === n ? 'on' : ''}" data-count="${n}">${n}</button>`).join('')}
            <div class="stepper"><input type="number" id="customCount" min="5" max="1000" value="${b.count}" aria-label="Custom question count" /></div>
          </div>
          <label class="field">6 · Question source</label>
          <div class="optrow">
            <button class="chip ${b.mode === 'bank' ? 'on' : ''}" data-mode="bank">Built-in + my bank</button>
            <button class="chip ${b.mode === 'ai' ? 'on' : ''}" data-mode="ai">AI generated${ai.ready ? '' : ' (key needed)'}</button>
            <button class="chip ${b.mode === 'notes' ? 'on' : ''}" data-mode="notes">From my notes</button>
          </div>
          ${b.mode === 'notes' ? `<div style="margin-top:.4rem">
              ${noteList.length ? `<select id="noteSelect">
                  <option value="">Choose a note…</option>
                  ${noteList.map(n => `<option value="${esc(n.id)}" ${b.noteId === n.id ? 'selected' : ''}>${esc(n.name)} (${n.chars} chars)</option>`).join('')}
                </select>` : `<p class="muted" style="font-size:.86rem">No notes yet. <a href="#/upload">Upload a PDF, image or text file</a> first.</p>`}
            </div>` : ''}
          ${!ai.ready && b.mode !== 'bank' ? `<p class="muted" style="font-size:.84rem;margin-top:.6rem">No AI key set. <a href="#" data-act="open-ai">Add your Sarvam, OpenAI or Gemini key</a> to generate fresh questions. Without it, notes mode produces clearly-labelled draft questions and AI mode falls back to the bank.</p>` : ''}
        </div>
      </div>
      <div class="summary">
        <div class="card pad">
          <h3>Paper summary</h3>
          <div id="summaryBody"></div>
          <button class="btn" id="startBuilt" style="width:100%;margin-top:1rem">Start test</button>
          <p class="dim" style="font-size:.76rem;margin:.7rem 0 0">Timer is set at 1 minute per question. You can pause by leaving — progress is saved on this device.</p>
        </div>
      </div>
    </div>
  `;

  const paintExams = () => {
    const exams = app.catalogue.exams.filter(e => !b.streams.length || b.streams.includes(e.stream));
    view.querySelector('#examRow').innerHTML = exams.map(e =>
      `<button class="chip ${b.exams.includes(e.id) ? 'on' : ''}" data-exam="${e.id}">${esc(e.short || e.name)}</button>`).join('') ||
      `<span class="dim" style="font-size:.85rem">No exams in this stream.</span>`;
    view.querySelectorAll('[data-exam]').forEach(el => el.addEventListener('click', () => {
      const id = el.dataset.exam;
      b.exams = b.exams.includes(id) ? b.exams.filter(x => x !== id) : b.exams.concat(id);
      b.subjects = [];
      paintExams(); paintSubjects(); paintSummary();
    }));
  };

  const paintSubjects = () => {
    let subs = new Set();
    if (b.exams.length) {
      b.exams.forEach(id => {
        const e = app.catalogue.exams.find(x => x.id === id);
        (e ? e.subjects : []).forEach(s => subs.add(s));
      });
    }
    E.subjectsInBank(app.bank).forEach(s => subs.add(s.subject));
    const list = [...subs].filter(s => {
      if (!b.exams.length) return true;
      return app.bank.some(q => q.subject === s && b.exams.some(id => (q.exams || []).includes(id))) || b.exams.some(id => {
        const e = app.catalogue.exams.find(x => x.id === id);
        return e && e.subjects.includes(s);
      });
    }).sort();
    view.querySelector('#subjectRow').innerHTML = list.map(s =>
      `<button class="chip ${b.subjects.includes(s) ? 'on' : ''}" data-sub="${esc(s)}">${esc(s)}</button>`).join('') ||
      `<span class="dim" style="font-size:.85rem">Choose an exam to see its subjects.</span>`;
    view.querySelectorAll('[data-sub]').forEach(el => el.addEventListener('click', () => {
      const s = el.dataset.sub;
      b.subjects = b.subjects.includes(s) ? b.subjects.filter(x => x !== s) : b.subjects.concat(s);
      paintSubjects(); paintSummary();
    }));
  };

  const paintSummary = () => {
    const pool = E.filterBank(app.bank, { exams: b.exams, subjects: b.subjects, streams: b.streams, difficulty: b.difficulty });
    const plan = E.planSeries(b.count);
    const ai = AI.aiStatus();
    const covered = Math.min(pool.length, b.count);
    view.querySelector('#summaryBody').innerHTML = `
      <div class="kv"><span>Exams</span><span>${b.exams.length ? b.exams.map(id => esc(E.examName(app.catalogue, id))).join(', ') : 'All'}</span></div>
      <div class="kv"><span>Subjects</span><span>${b.subjects.length ? esc(b.subjects.join(', ')) : 'All'}</span></div>
      <div class="kv"><span>Difficulty</span><span>${esc(b.difficulty === 'any' ? 'Mixed' : b.difficulty)}</span></div>
      <div class="kv"><span>Source</span><span>${b.mode === 'bank' ? 'Built-in + my bank' : b.mode === 'ai' ? (ai.ready ? 'AI' : 'AI (no key → bank)') : 'My notes'}</span></div>
      <div class="kv"><span>Questions requested</span><span>${b.count}</span></div>
      <div class="kv"><span>Matching questions</span><span>${pool.length}</span></div>
      <div class="kv"><span>Papers</span><span>${plan.length > 1 ? plan.length + ' papers (' + plan.join(' + ') + ')' : '1 paper'}</span></div>
      <div class="kv"><span>Time</span><span>${plan.reduce((s, n) => s + n, 0)} minutes total</span></div>
      ${covered < b.count && b.mode === 'bank' ? `<p style="color:var(--warn);font-size:.8rem;margin:.7rem 0 0">Your filters match only ${pool.length} questions. Switch the source to AI, or widen the filters, to reach ${b.count}.</p>` : ''}
      ${plan.length > 1 ? `<p style="font-size:.8rem;color:var(--muted);margin:.7rem 0 0">This becomes a series: each paper is a separate timed attempt, and the series page tracks which ones are done.</p>` : ''}
    `;
  };

  view.querySelectorAll('[data-stream]').forEach(el => el.addEventListener('click', () => {
    const id = el.dataset.stream;
    b.streams = b.streams.includes(id) ? b.streams.filter(x => x !== id) : b.streams.concat(id);
    b.exams = b.exams.filter(eid => {
      const e = app.catalogue.exams.find(x => x.id === eid);
      return e && (!b.streams.length || b.streams.includes(e.stream));
    });
    mountBuilder(app, view);
  }));
  view.querySelectorAll('[data-diff]').forEach(el => el.addEventListener('click', () => { b.difficulty = el.dataset.diff; mountBuilder(app, view); }));
  view.querySelectorAll('[data-count]').forEach(el => el.addEventListener('click', () => { b.count = Number(el.dataset.count); mountBuilder(app, view); }));
  view.querySelectorAll('[data-mode]').forEach(el => el.addEventListener('click', () => { b.mode = el.dataset.mode; mountBuilder(app, view); }));
  const cc = view.querySelector('#customCount');
  if (cc) cc.addEventListener('change', () => {
    b.count = Math.max(5, Math.min(1000, Number(cc.value) || 50));
    paintSummary();
  });
  const ns = view.querySelector('#noteSelect');
  if (ns) ns.addEventListener('change', () => { b.noteId = ns.value; });

  view.querySelector('#startBuilt').addEventListener('click', () => buildAndStart(app, view));

  paintExams(); paintSubjects(); paintSummary();
}

async function buildAndStart(app, view) {
  const b = app.ui.builder;
  const plan = E.planSeries(b.count);
  const ai = AI.aiStatus();
  const btn = view.querySelector('#startBuilt');

  if (b.mode === 'notes' && !b.noteId) return toast('Choose a note first.');

  if (plan.length > 1) {
    const series = {
      id: 'sr-' + Date.now().toString(36),
      createdAt: Date.now(),
      title: (b.subjects.length ? b.subjects.slice(0, 2).join(' + ') : 'Mixed') + ' series',
      examIds: b.exams, subjects: b.subjects, streams: b.streams,
      difficulty: b.difficulty, mode: b.mode, noteId: b.noteId,
      papers: plan.map((n, i) => ({ index: i + 1, count: n, done: false, seed: Date.now() + i * 7919 }))
    };
    S.saveSeries(series);
    toast('Series created — ' + plan.length + ' papers of ' + plan.join(' + ') + ' questions.');
    location.hash = '#/series';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Preparing…';
  try {
    const questions = await collectQuestions(app, b, b.count);
    if (!questions.length) throw new Error('No questions could be prepared with those filters.');
    beginTest(app, {
      questions,
      title: (b.exams.length ? b.exams.map(id => E.examName(app.catalogue, id)).join(' + ') : 'Custom') + ' — ' + questions.length + ' questions',
      subtitle: (b.subjects.join(', ') || 'Mixed subjects') + ' · ' + (b.difficulty === 'any' ? 'mixed difficulty' : b.difficulty),
      kind: 'custom'
    });
  } catch (err) {
    toast(err.message === 'NO_KEY' ? 'No AI key set — using your bank instead.' : err.message, 4500);
    const paper = E.buildPaper({ bank: app.bank, exams: b.exams, subjects: b.subjects, streams: b.streams, difficulty: b.difficulty, count: b.count });
    if (paper.questions.length) {
      beginTest(app, { questions: paper.questions, title: 'Custom paper', subtitle: 'From your bank', kind: 'custom' });
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Start test';
  }
}

async function collectQuestions(app, b, count) {
  const ai = AI.aiStatus();
  const fromBank = E.filterBank(app.bank, { exams: b.exams, subjects: b.subjects, streams: b.streams, difficulty: b.difficulty });

  if (b.mode === 'bank') {
    return E.seededShuffle(fromBank, E.rngFromSeed(Date.now())).slice(0, Math.min(count, fromBank.length));
  }

  if (b.mode === 'notes') {
    const note = S.notes().find(n => n.id === b.noteId);
    if (!note) throw new Error('That note was not found.');
    if (ai.ready) {
      const chunks = Math.ceil(count / 15);
      let all = [];
      for (let i = 0; i < chunks && all.length < count; i++) {
        toast(`Generating from notes… ${all.length}/${count}`);
        const part = await AI.generateQuestions({
          count: Math.min(15, count - all.length),
          exam: b.exams.map(id => E.examName(app.catalogue, id)).join(', '),
          subject: b.subjects.join(', ') || 'From notes',
          difficulty: b.difficulty,
          context: note.text
        });
        all = all.concat(part);
      }
      return all.slice(0, count);
    }
    const drafts = AI.draftFromNotes(note.text, { count: Math.min(count, 40), subject: b.subjects[0] || 'Notes' });
    if (!drafts.length) throw new Error('Could not draft questions from that note — it may be too short.');
    toast('Draft questions created from your notes. Add an AI key for full exam-style analysis.', 5000);
    return drafts;
  }

  // AI mode
  if (!ai.ready) {
    return E.seededShuffle(fromBank, E.rngFromSeed(Date.now())).slice(0, Math.min(count, fromBank.length));
  }
  const chunk = 15;
  let all = [];
  for (let i = 0; i < Math.ceil(count / chunk) && all.length < count; i++) {
    toast(`Generating with AI… ${all.length}/${count}`);
    const part = await AI.generateQuestions({
      count: Math.min(chunk, count - all.length),
      exams: b.exams,
      exam: b.exams.map(id => E.examName(app.catalogue, id)).join(', ') || 'general competitive exam',
      subject: b.subjects.join(', ') || 'Mixed',
      difficulty: b.difficulty
    });
    all = all.concat(part);
  }
  return all.slice(0, count);
}

/* ================= SERIES ================= */
export function mountSeries(app, view) {
  const list = S.seriesList();
  view.innerHTML = `
    <span class="eyebrow">Test series</span>
    <h1 style="font-size:2rem">Your bound papers</h1>
    <p class="muted" style="max-width:70ch">A large request becomes a series — 500 questions become 150 + 150 + 150 + 50. Each paper is a separate timed attempt, and this page tracks what is done.</p>
    ${list.length ? list.map(s => {
      const done = s.papers.filter(p => p.done).length;
      const total = s.papers.reduce((a, p) => a + p.count, 0);
      return `<div class="card pad" style="margin-top:1rem">
        <div class="row between">
          <div>
            <h3 style="margin:0 0 .2rem">${esc(s.title)}</h3>
            <div class="muted" style="font-size:.84rem">${total} questions · ${s.papers.length} papers · ${done}/${s.papers.length} done · created ${esc(new Date(s.createdAt).toLocaleDateString('en-IN'))}</div>
          </div>
          <button class="btn small ghost" data-del="${esc(s.id)}">Delete</button>
        </div>
        <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(180px,1fr));margin-top:.9rem">
          ${s.papers.map(p => `<div class="examcard" style="padding:.75rem">
            <div class="row between"><strong>Paper ${p.index}</strong><span class="pill ${p.done ? 'easy' : ''}">${p.done ? 'done' : p.count + ' Q'}</span></div>
            <button class="btn small ${p.done ? 'ghost' : ''}" data-series="${esc(s.id)}" data-paper="${p.index}">${p.done ? 'Re-attempt' : 'Start'}</button>
          </div>`).join('')}
        </div>
      </div>`;
    }).join('') : `<div class="empty">No series yet. <a href="#/builder">Build one</a> — ask for 300 or 500 questions.</div>`}
  `;

  view.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
    const all = S.seriesList().filter(x => x.id !== b.dataset.del);
    localStorage.setItem('ea.v1.series', JSON.stringify(all));
    mountSeries(app, view);
  }));

  view.querySelectorAll('[data-series]').forEach(b => b.addEventListener('click', async () => {
    const s = S.getSeries(b.dataset.series);
    const p = s && s.papers.find(x => x.index === Number(b.dataset.paper));
    if (!p) return;
    b.disabled = true; b.textContent = 'Preparing…';
    try {
      const questions = await collectQuestions(app, {
        exams: s.examIds, subjects: s.subjects, streams: s.streams,
        difficulty: s.difficulty, mode: s.mode, noteId: s.noteId
      }, p.count);
      if (!questions.length) throw new Error('No questions available for this paper.');
      p.done = true;
      S.saveSeries(s);
      beginTest(app, {
        questions,
        title: `${s.title} — Paper ${p.index}`,
        subtitle: `${questions.length} questions · paper ${p.index} of ${s.papers.length}`,
        kind: 'series'
      });
    } catch (e) {
      toast(e.message, 4200);
    } finally {
      b.disabled = false; b.textContent = 'Start';
    }
  }));
}

/* ================= TEST PLAYER ================= */
function beginTest(app, { questions, title, subtitle, kind }) {
  const duration = Math.max(600, questions.length * 60);
  runtime.paper = { questions, title, subtitle, kind };
  runtime.live = {
    title, subtitle, kind,
    index: 0,
    answers: {},
    marked: {},
    startedAt: Date.now(),
    duration,
    endsAt: Date.now() + duration * 1000
  };
  S.saveLivePaper(runtime.paper);
  S.saveLive(runtime.live);
  location.hash = '#/test';
}

export function mountTest(app, view) {
  if (!runtime.live || !runtime.paper) {
    const live = S.liveState(), paper = S.livePaper();
    if (live && paper) { runtime.live = live; runtime.paper = paper; }
  }
  if (!runtime.live || !runtime.paper) {
    view.innerHTML = `<div class="empty">No test in progress. <a href="#/">Start one</a>.</div>`;
    return;
  }
  const live = runtime.live, paper = runtime.paper;

  view.innerHTML = `
    <div class="testhead">
      <div>
        <div style="font-weight:700">${esc(paper.title)}</div>
        <div class="muted" style="font-size:.8rem">${esc(paper.subtitle || '')} · ${paper.questions.length} questions</div>
      </div>
      <div class="row">
        <div class="timer" id="timer">--:--</div>
        <button class="btn small" id="submitBtn">Submit test</button>
      </div>
    </div>
    <div class="testgrid">
      <div>
        <div class="qcard" id="qcard"></div>
        <div class="navrow" style="margin-top:.9rem">
          <div class="row">
            <button class="btn small ghost" id="prevBtn">← Previous</button>
            <button class="btn small ghost" id="nextBtn">Next →</button>
          </div>
          <div class="row">
            <button class="btn small soft" id="clearBtn">Clear</button>
            <button class="btn small soft" id="markBtn">Mark for review</button>
          </div>
        </div>
      </div>
      <aside class="palette">
        <strong style="font-size:.82rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)">Question palette</strong>
        <div class="palgrid" id="palGrid"></div>
        <div class="legend">
          <span><i style="background:rgba(52,211,153,.5)"></i>Answered</span>
          <span><i style="background:rgba(251,191,36,.5)"></i>Marked</span>
          <span><i style="background:var(--bg2);border:1px solid var(--line2)"></i>Not visited</span>
        </div>
      </aside>
    </div>
  `;

  const qcard = view.querySelector('#qcard');
  const palGrid = view.querySelector('#palGrid');
  const timerEl = view.querySelector('#timer');

  const paintQ = () => {
    const q = paper.questions[live.index];
    const sel = live.answers[q.id];
    qcard.innerHTML = `
      <div class="row between">
        <span class="muted" style="font-size:.8rem">Question ${live.index + 1} of ${paper.questions.length}</span>
        <div class="row">
          <span class="pill">${esc(q.subject)}</span>
          <span class="pill ${esc(q.difficulty)}">${esc(q.difficulty)}</span>
          ${q.origin === 'ai' ? '<span class="pill" style="color:var(--violet);border-color:rgba(139,139,245,.4)">AI</span>' : ''}
        </div>
      </div>
      <div class="qtext">${esc(q.q)}</div>
      <div class="optlist">
        ${q.options.map((o, i) => `
          <button class="opt ${sel === i ? 'on' : ''}" data-opt="${i}">
            <span class="key">${P(i)}</span><span>${esc(o)}</span>
          </button>`).join('')}
      </div>
      <div class="row between">
        <span class="dim" style="font-size:.76rem">${esc(q.topic || '')}</span>
        <span class="dim" style="font-size:.76rem">${live.marked[q.id] ? 'Marked for review' : ''}</span>
      </div>
    `;
    qcard.querySelectorAll('[data-opt]').forEach(b => b.addEventListener('click', () => {
      live.answers[q.id] = Number(b.dataset.opt);
      persist(); paintQ(); paintPal();
    }));
    paintPal();
  };

  const paintPal = () => {
    palGrid.innerHTML = paper.questions.map((q, i) => {
      const cls = ['palbtn'];
      if (live.answers[q.id] !== undefined) cls.push('answered');
      if (live.marked[q.id]) cls.push('review');
      if (i === live.index) cls.push('current');
      return `<button class="${cls.join(' ')}" data-goto="${i}">${i + 1}</button>`;
    }).join('');
    palGrid.querySelectorAll('[data-goto]').forEach(b => b.addEventListener('click', () => {
      live.index = Number(b.dataset.goto);
      persist(); paintQ();
    }));
  };

  const persist = () => S.saveLive(live);

  view.querySelector('#prevBtn').addEventListener('click', () => {
    if (live.index > 0) { live.index--; persist(); paintQ(); }
  });
  view.querySelector('#nextBtn').addEventListener('click', () => {
    if (live.index < paper.questions.length - 1) { live.index++; persist(); paintQ(); }
    else toast('That was the last question. Review marked ones or submit.');
  });
  view.querySelector('#clearBtn').addEventListener('click', () => {
    delete live.answers[paper.questions[live.index].id];
    persist(); paintQ();
  });
  view.querySelector('#markBtn').addEventListener('click', () => {
    const id = paper.questions[live.index].id;
    live.marked[id] = !live.marked[id];
    persist(); paintQ();
  });
  view.querySelector('#submitBtn').addEventListener('click', () => {
    const answered = Object.keys(live.answers).length;
    if (answered < paper.questions.length && !confirm(`You have answered ${answered} of ${paper.questions.length}. Submit anyway?`)) return;
    finishTest(app);
  });

  const tick = () => {
    const left = Math.round((live.endsAt - Date.now()) / 1000);
    timerEl.textContent = E.fmtClock(left);
    timerEl.classList.toggle('low', left < 120);
    if (left <= 0) { clearInterval(runtime.timer); runtime.timer = null; toast('Time is up — submitting your paper.'); finishTest(app); }
  };
  teardown();
  tick();
  runtime.timer = setInterval(tick, 1000);
  paintQ();
}

function finishTest(app) {
  teardown();
  const live = runtime.live, paper = runtime.paper;
  if (!live || !paper) return;
  const result = E.evaluate(paper.questions, live.answers);
  const timeSec = Math.max(1, Math.round((Date.now() - live.startedAt) / 1000));
  const attempt = {
    id: 'at-' + Date.now().toString(36),
    ts: Date.now(),
    title: paper.title,
    subtitle: paper.subtitle || '',
    kind: paper.kind || 'custom',
    total: result.total,
    correct: result.correct,
    wrong: result.wrong,
    skipped: result.skipped,
    attempted: result.attempted,
    accuracy: result.accuracy,
    score: result.score,
    timeSec,
    bySubject: result.bySubject,
    rows: paper.questions.map((q, i) => ({
      id: q.id, sel: result.rows[i].sel, ok: result.rows[i].ok, skipped: result.rows[i].skipped,
      q: q.q, options: q.options, answer: q.answer, subject: q.subject, topic: q.topic || ''
    }))
  };
  S.saveAttempt(attempt);
  S.clearLive();
  runtime.live = null; runtime.paper = null;
  runtime.result = attempt;
  location.hash = '#/result/' + attempt.id;
}

/* ================= RESULT ================= */
export function mountResult(app, view, attemptId) {
  let a = runtime.result && runtime.result.id === attemptId ? runtime.result : S.attempts().find(x => x.id === attemptId);
  if (!a) {
    view.innerHTML = `<div class="empty">That attempt was not found on this device. <a href="#/progress">See your progress</a>.</div>`;
    return;
  }
  const bankById = new Map(app.bank.map(q => [q.id, q]));
  const weak = E.weakTopics({ bySubject: a.bySubject }, 3);
  const bands = [
    [90, 'Excellent. This is selection-level accuracy — now work on speed, because a 90 per cent score in double time is still a risk.'],
    [75, 'Strong. You are close to a comfortable margin. The remaining marks are almost always in two or three specific topics, not across the syllabus.'],
    [55, 'Solid base. You know the material but lose marks on elimination and elimination of look-alike options. Slow down on those, not on everything.'],
    [35, 'Early stage, and that is fine. Pick the two weakest subjects below and revise only those for three days. Accuracy moves fast when the base is narrow.'],
    [0, 'Start small. One subject, twenty questions, and read every explanation. The score is not the point yet; the reading is.']
  ];
  const message = (bands.find(b => a.score >= b[0]) || bands[bands.length - 1])[1];

  view.innerHTML = `
    <span class="eyebrow">Result · ${esc(new Date(a.ts).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }))}</span>
    <h1 style="font-size:1.9rem">${esc(a.title)}</h1>
    <p class="muted">${esc(a.subtitle)} · ${a.total} questions · ${E.fmtClock(a.timeSec)} taken</p>

    <div class="scorewrap">
      <div class="scorebox"><div class="n" style="color:var(--gold2)">${a.score}%</div><div class="t">Score</div></div>
      <div class="scorebox"><div class="n" style="color:var(--ok)">${a.correct}</div><div class="t">Correct</div></div>
      <div class="scorebox"><div class="n" style="color:var(--bad)">${a.wrong}</div><div class="t">Wrong</div></div>
      <div class="scorebox"><div class="n" style="color:var(--muted)">${a.skipped}</div><div class="t">Skipped</div></div>
      <div class="scorebox"><div class="n" style="color:var(--teal)">${a.accuracy}%</div><div class="t">Accuracy</div></div>
    </div>

    <div class="coach">
      <h4>Where you stand</h4>
      <p style="margin:0">${esc(message)}</p>
      ${weak.length ? `<p style="margin:.7rem 0 0;font-size:.9rem">Fix these first: ${weak.map(w => `<strong>${esc(w.subject)}</strong> (${w.correct}/${w.attempted})`).join(', ')}.</p>` : ''}
    </div>

    <h3 style="margin-top:1.8rem">Section breakdown</h3>
    <table class="table">
      <thead><tr><th>Subject</th><th>Attempted</th><th>Correct</th><th>Wrong</th><th>Skipped</th><th>Accuracy</th></tr></thead>
      <tbody>
        ${Object.entries(a.bySubject).sort((x, y) => y[1].attempted - x[1].attempted).map(([s, v]) => `<tr>
          <td>${esc(s)}</td><td>${v.attempted}</td><td>${v.correct}</td><td>${v.wrong}</td><td>${v.skipped}</td>
          <td>${v.attempted ? Math.round((v.correct / v.attempted) * 100) : 0}%</td>
        </tr>`).join('')}
      </tbody>
    </table>

    <h3 style="margin-top:1.8rem">Question-by-question analysis</h3>
    <p class="muted" style="font-size:.86rem">Every question opens with the correct answer, background, discussion, a WH breakdown, current status, why each other option fails, a confidence tip and what to improve.</p>
    ${a.rows.map((row, i) => reviewBlock(row, i, bankById.get(row.id))).join('')}

    <div class="row" style="margin-top:1.4rem">
      <a class="btn" href="#/daily">Take tomorrow's paper</a>
      <a class="btn ghost" href="#/builder">Build a focused paper on weak topics</a>
      <a class="btn ghost" href="#/progress">See progress</a>
    </div>
  `;

  view.querySelectorAll('[data-retry]').forEach(b => b.addEventListener('click', () => {
    const subj = b.dataset.retry;
    app.ui.builder = { streams: [], exams: [], subjects: [subj], difficulty: 'any', count: 25, mode: 'bank', noteId: '' };
    location.hash = '#/builder';
  }));
}

function reviewBlock(row, i, full) {
  const tag = row.skipped ? '<span class="rvtag skip">Skipped</span>' : row.ok ? '<span class="rvtag right">Correct</span>' : '<span class="rvtag wrong">Wrong</span>';
  const src = full || row;
  const wh = (full && full.wh) || {};
  const whyWrong = (full && full.why_wrong) || [];
  const myAns = row.skipped ? 'Not answered' : `${P(row.sel)}. ${row.options[row.sel]}`;
  return `<details class="review">
    <summary>
      <span class="rvnum">${i + 1}.</span>
      <span style="flex:1">${esc(row.q)}</span>
      ${tag}
    </summary>
    <div class="rvbody">
      <div class="ansgrid">
        <div class="ansbox right"><b>Correct answer</b>${P(row.answer)}. ${esc(row.options[row.answer])}</div>
        <div class="ansbox ${row.skipped ? '' : row.ok ? 'right' : 'wrong'}"><b>Your answer</b>${esc(myAns)}</div>
      </div>

      ${full && full.history ? `<div class="blocktitle">Background</div><p style="margin:0">${esc(full.history)}</p>` : ''}
      ${full && full.discussion ? `<div class="blocktitle">Discussion</div><p style="margin:0">${esc(full.discussion)}</p>` : ''}
      ${Object.keys(wh).length ? `<div class="blocktitle">WH analysis</div>
        <div class="whgrid">
          ${['what', 'why', 'when', 'where', 'who', 'how'].filter(k => wh[k]).map(k => `<div class="whbox"><b>${k}</b>${esc(wh[k])}</div>`).join('')}
        </div>` : ''}
      ${full && full.status ? `<div class="blocktitle">Current status</div><p style="margin:0">${esc(full.status)}</p>` : ''}
      ${whyWrong.filter(Boolean).length ? `<div class="blocktitle">Why the other options are wrong</div>
        <ul class="whywrong">
          ${whyWrong.map((w, k) => w ? `<li data-k="${P(k)}">${esc(w)}</li>` : '').join('')}
        </ul>` : ''}
      ${full && full.tip ? `<div class="blocktitle">Confidence tip</div><p style="margin:0">${esc(full.tip)}</p>` : ''}
      ${full && full.improve ? `<div class="blocktitle">What to improve</div><p style="margin:0">${esc(full.improve)}</p>` : ''}
      <div class="row between" style="margin-top:.9rem">
        <span class="dim" style="font-size:.76rem">${esc(row.subject)}${row.topic ? ' · ' + esc(row.topic) : ''}${full && full.source ? ' · ' + esc(full.source) : ''}</span>
        <button class="btn small ghost" data-retry="${esc(row.subject)}">Practise ${esc(row.subject)}</button>
      </div>
    </div>
  </details>`;
}

/* ================= PROGRESS ================= */
export function mountProgress(app, view) {
  const all = S.attempts();
  const st = S.stats();
  const last = all.slice(0, 12).reverse();
  const maxScore = Math.max(10, ...last.map(a => a.score));

  view.innerHTML = `
    <span class="eyebrow">Your device · ${esc(app.identity.id)}</span>
    <h1 style="font-size:2rem">Progress</h1>
    <div class="scorewrap">
      <div class="scorebox"><div class="n">${st.count}</div><div class="t">Tests taken</div></div>
      <div class="scorebox"><div class="n">${st.totalQ}</div><div class="t">Questions attempted</div></div>
      <div class="scorebox"><div class="n" style="color:var(--teal)">${st.accuracy}%</div><div class="t">Overall accuracy</div></div>
      <div class="scorebox"><div class="n" style="color:var(--gold2)">${st.best}%</div><div class="t">Best score</div></div>
      <div class="scorebox"><div class="n">${st.streak}</div><div class="t">Day streak</div></div>
    </div>

    ${last.length ? `<div class="card pad">
      <h3 style="margin:0 0 .2rem">Last ${last.length} scores</h3>
      <div class="bars">${last.map(a => `<i style="height:${Math.max(4, (a.score / maxScore) * 100)}%" title="${a.score}%"></i>`).join('')}</div>
    </div>` : ''}

    ${Object.keys(st.bySubject).length ? `<h3 style="margin-top:1.8rem">Subject accuracy</h3>
      <table class="table">
        <thead><tr><th>Subject</th><th>Correct</th><th>Attempted</th><th>Accuracy</th><th></th></tr></thead>
        <tbody>${Object.entries(st.bySubject).map(([s, v]) => {
          const pct = v.attempted ? Math.round((v.correct / v.attempted) * 100) : 0;
          return `<tr><td>${esc(s)}</td><td>${v.correct}</td><td>${v.attempted}</td>
            <td style="color:${pct >= 70 ? 'var(--ok)' : pct >= 45 ? 'var(--warn)' : 'var(--bad)'}">${pct}%</td>
            <td><a href="#/builder" data-focus="${esc(s)}" class="dim">focus →</a></td></tr>`;
        }).join('')}</tbody>
      </table>` : ''}

    <h3 style="margin-top:1.8rem">Attempt history</h3>
    ${all.length ? `<table class="table">
      <thead><tr><th>Date</th><th>Test</th><th>Score</th><th>Accuracy</th><th>Time</th><th></th></tr></thead>
      <tbody>${all.map(a => `<tr>
        <td class="dim">${esc(new Date(a.ts).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }))}</td>
        <td>${esc(a.title)}</td>
        <td>${a.score}%</td><td>${a.accuracy}%</td><td>${E.fmtClock(a.timeSec)}</td>
        <td><a href="#/result/${esc(a.id)}">review</a></td>
      </tr>`).join('')}</tbody>
    </table>` : `<div class="empty">No attempts yet. <a href="#/daily">Take today's test</a>.</div>`}

    <div class="card" style="margin-top:2rem">
      <h3 style="margin-top:0">Device identity</h3>
      <p class="muted" style="font-size:.88rem">Your ID is derived from this device's fingerprint plus your network hash, saved in storage and in a cookie, so it survives cache clears and stays fixed to this device. No account, no password.</p>
      <div class="kv"><span>Device ID</span><span>${esc(app.identity.id)}</span></div>
      <div class="kv"><span>Fingerprint</span><span>${esc(app.identity.fingerprint)}</span></div>
      <div class="kv"><span>Network tag</span><span>${esc(app.identity.ipHash || 'not available offline')}</span></div>
      <div class="kv"><span>First seen</span><span>${esc(new Date(S.attempts().length ? Math.min(...S.attempts().map(a => a.ts)) : Date.now()).toLocaleDateString('en-IN'))}</span></div>
      <div class="row" style="margin-top:1rem">
        <button class="btn small soft" id="copyId">Copy my ID</button>
        <button class="btn small ghost" id="wipe">Clear all my data</button>
      </div>
    </div>
  `;

  view.querySelectorAll('[data-focus]').forEach(a => a.addEventListener('click', () => {
    app.ui.builder = { streams: [], exams: [], subjects: [a.dataset.focus], difficulty: 'any', count: 25, mode: 'bank', noteId: '' };
  }));
  const copy = view.querySelector('#copyId');
  if (copy) copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(app.identity.id); toast('Device ID copied.'); }
    catch { toast('Copy failed — your ID is ' + app.identity.id, 5000); }
  });
  const wipe = view.querySelector('#wipe');
  if (wipe) wipe.addEventListener('click', () => {
    if (!confirm('This deletes your attempts, custom bank, notes and settings on this device. Your permanent ID stays. Continue?')) return;
    Object.keys(localStorage).filter(k => k.startsWith('ea.v1.') && k !== 'ea.v1.device').forEach(k => localStorage.removeItem(k));
    toast('Local data cleared.');
    location.hash = '#/';
  });
}

/* ================= UPLOAD ================= */
export function mountUpload(app, view) {
  const custom = S.customBank();
  const notes = S.notes();
  view.innerHTML = `
    <span class="eyebrow">Your own material</span>
    <h1 style="font-size:2rem">Upload a question bank or notes</h1>
    <p class="muted" style="max-width:72ch">Banks go straight into your filters. Notes become a source for AI-generated questions — or clearly-labelled draft questions if no key is set. Everything stays on this device.</p>

    <div class="buildgrid" style="margin-top:1.2rem">
      <div class="card pad">
        <h3 style="margin-top:0">Question bank</h3>
        <p class="muted" style="font-size:.86rem">JSON, CSV or TXT. Fields: question, options A–D, answer, plus optional explanation, subject and topic.</p>
        <div class="drop" id="bankDrop">
          <strong>Drop a file here</strong><br><span style="font-size:.84rem">or click to choose — .json, .csv, .txt</span>
          <input type="file" id="bankFile" accept=".json,.csv,.txt,.md" hidden />
        </div>
        <label class="field" style="margin-top:1rem">Or paste JSON / CSV / TXT</label>
        <textarea id="bankPaste" rows="5" placeholder='[{"q":"The SI unit of force is","options":["Joule","Newton","Watt","Pascal"],"answer":1,"subject":"Physics"}]'></textarea>
        <div class="row" style="margin-top:.7rem">
          <button class="btn" id="addBank">Add to my bank</button>
          ${custom.length ? `<button class="btn ghost small" id="clearBank">Remove all ${custom.length} uploaded</button>` : ''}
        </div>
        <div id="bankPreview" style="margin-top:.8rem"></div>
      </div>

      <div class="card pad">
        <h3 style="margin-top:0">Notes for AI</h3>
        <p class="muted" style="font-size:.86rem">PDF, image (OCR) or text. Stored locally and used only when you generate from notes.</p>
        <div class="drop" id="noteDrop">
          <strong>Drop notes here</strong><br><span style="font-size:.84rem">.pdf, .png, .jpg, .txt</span>
          <input type="file" id="noteFile" accept=".pdf,.png,.jpg,.jpeg,.webp,.txt,.md" hidden />
        </div>
        <div id="noteProgress" class="muted" style="font-size:.82rem;margin-top:.5rem"></div>
        <div style="margin-top:1rem">
          ${notes.length ? notes.map(n => `<div class="kv"><span>${esc(n.name)}<br><span class="dim" style="font-size:.74rem">${n.chars} chars · ${esc(new Date(n.addedAt).toLocaleDateString('en-IN'))}</span></span>
            <button class="btn small ghost" data-delnote="${esc(n.id)}">Remove</button></div>`).join('') : `<p class="dim" style="font-size:.84rem">No notes yet.</p>`}
        </div>
      </div>
    </div>

    <div class="card pad" style="margin-top:1rem">
      <h3 style="margin-top:0">Formats that work</h3>
      <p class="muted" style="font-size:.86rem;margin-bottom:.4rem"><strong>TXT</strong> — one question per block, blank line between blocks:</p>
      <pre style="background:var(--bg2);border:1px solid var(--line);border-radius:9px;padding:.8rem;overflow:auto;font-size:.78rem;color:var(--muted)">Q: Which Article defines a Money Bill?
A) Article 108
B) Article 110
C) Article 112
D) Article 117
Answer: B
Explanation: Article 110 defines a Money Bill.</pre>
      <p class="muted" style="font-size:.86rem;margin:.8rem 0 .4rem"><strong>CSV</strong> — header row required:</p>
      <pre style="background:var(--bg2);border:1px solid var(--line);border-radius:9px;padding:.8rem;overflow:auto;font-size:.78rem;color:var(--muted)">question,optionA,optionB,optionC,optionD,answer,subject,explanation
The SI unit of force is,Joule,Newton,Watt,Pascal,B,Physics,Force is mass times acceleration</pre>
    </div>
  `;

  const drop = view.querySelector('#bankDrop');
  const fileInput = view.querySelector('#bankFile');
  let pending = [];

  const handleBankText = (name, text) => {
    try {
      const parsed = U.parseQuestionFile(name, text);
      if (parsed && parsed.notes && !parsed.questions) {
        view.querySelector('#bankPreview').innerHTML = `<p style="color:var(--warn);font-size:.84rem">${esc(parsed.error || 'No questions found — this looks like notes. Use the notes panel.')}</p>`;
        return;
      }
      pending = parsed;
      view.querySelector('#bankPreview').innerHTML = `
        <p style="color:var(--ok);font-size:.86rem">Read ${pending.length} questions from ${esc(name)}.</p>
        <div class="card" style="background:var(--bg2)">
          <div style="font-size:.88rem"><strong>1.</strong> ${esc(pending[0].q)}</div>
          <div class="dim" style="font-size:.8rem;margin-top:.3rem">Answer: ${P(pending[0].answer)}. ${esc(pending[0].options[pending[0].answer])}</div>
        </div>`;
    } catch (e) {
      pending = [];
      view.querySelector('#bankPreview').innerHTML = `<p style="color:var(--bad);font-size:.84rem">${esc(e.message)}</p>`;
    }
  };

  const readFile = async (file) => {
    const text = await U.readTextFile(file);
    handleBankText(file.name, text);
  };

  drop.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => { if (fileInput.files[0]) readFile(fileInput.files[0]); });
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => {
    const f = e.dataTransfer.files[0];
    if (f) readFile(f);
  });

  view.querySelector('#addBank').addEventListener('click', () => {
    const paste = view.querySelector('#bankPaste').value.trim();
    if (!pending.length && paste) handleBankText('pasted.txt', paste);
    if (!pending.length) return toast('Add a file or paste some questions first.');
    const n = S.addCustomQuestions(pending);
    E.invalidateBank();
    toast(`${pending.length} questions added. Bank now holds ${n} custom questions.`);
    pending = [];
    app.bank = null;
    location.hash = '#/';
  });

  const clearBank = view.querySelector('#clearBank');
  if (clearBank) clearBank.addEventListener('click', () => {
    if (!confirm('Remove all uploaded questions from this device?')) return;
    S.removeCustomBank(); E.invalidateBank(); toast('Uploaded bank removed.'); mountUpload(app, view);
  });

  /* notes */
  const noteDrop = view.querySelector('#noteDrop');
  const noteInput = view.querySelector('#noteFile');
  const prog = view.querySelector('#noteProgress');
  noteDrop.addEventListener('click', () => noteInput.click());
  noteInput.addEventListener('change', async () => {
    const f = noteInput.files[0];
    if (!f) return;
    prog.textContent = 'Reading ' + f.name + '…';
    try {
      let text = '';
      if (/\.pdf$/i.test(f.name)) {
        const out = await U.extractPDF(f, p => { prog.textContent = `Extracting text… ${p}%`; });
        text = out.text;
      } else if (/\.(png|jpe?g|webp)$/i.test(f.name)) {
        const out = await U.extractImage(f, p => { prog.textContent = `Running OCR… ${p}%`; });
        text = out.text;
      } else {
        text = await U.readTextFile(f);
      }
      text = (text || '').trim();
      if (text.length < 80) throw new Error('Almost no text was found in that file. Try a clearer scan or a text file.');
      S.addNote({ id: 'nt-' + Date.now().toString(36), name: f.name, chars: text.length, text: text.slice(0, 180000), addedAt: Date.now() });
      prog.textContent = 'Saved ' + f.name + ' (' + text.length + ' characters).';
      toast('Note saved. Build a test from it in the builder.');
      mountUpload(app, view);
    } catch (e) {
      prog.textContent = '';
      toast(e.message, 5000);
    }
  });

  view.querySelectorAll('[data-delnote]').forEach(b => b.addEventListener('click', () => {
    S.removeNote(b.dataset.delnote);
    mountUpload(app, view);
  }));
}

/* ================= MODALS ================= */
export function openPulse() {
  const url = 'https://merry8989-uk.github.io/pulse-feed/#/feed';
  const root = modal(`
    <div class="modalhead">
      <h3><span class="live-dot" style="display:inline-block;margin-right:.4rem"></span>Pulse Feed — anonymous chat</h3>
      <div class="row">
        <a class="btn small ghost" href="${url}" target="_blank" rel="noopener">Open in new tab</a>
        <button class="xbtn" data-dismiss="1" aria-label="Close">✕</button>
      </div>
    </div>
    <div class="modalbody">
      <iframe id="pulseFrame" src="${url}" title="Pulse Feed anonymous chat" loading="lazy" referrerpolicy="no-referrer"></iframe>
      <p class="dim" style="font-size:.76rem;margin:.6rem 0 0">If the feed stays blank, the host is blocking embedding — use "Open in new tab". Chat there is anonymous: no account, no name.</p>
    </div>
  `);
  return root;
}

export function openProfile(app) {
  const p = S.profile();
  const root = modal(`
    <div class="modalhead"><h3>My profile</h3><button class="xbtn" data-dismiss="1">✕</button></div>
    <div class="modalbody">
      <div class="kv"><span>Permanent device ID</span><span><strong>${esc(app.identity.id)}</strong></span></div>
      <p class="dim" style="font-size:.78rem">Derived from this device and your network, stored in a cookie as backup. It does not change when you clear your cache.</p>
      <label class="field">Your name (optional)</label>
      <input type="text" id="pfName" value="${esc(p.name)}" placeholder="Amit" />
      <label class="field" style="margin-top:.8rem">Target exam</label>
      <select id="pfExam">
        <option value="">Choose…</option>
        ${app.catalogue.exams.map(e => `<option value="${esc(e.short || e.name)}" ${p.goalExam === (e.short || e.name) ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}
      </select>
      <label class="field" style="margin-top:.8rem">Exam date</label>
      <input type="text" id="pfDate" value="${esc(p.goalDate)}" placeholder="e.g. 26 May 2027" />
      <label class="field" style="margin-top:.8rem">Daily question goal</label>
      <input type="number" id="pfGoal" value="${p.dailyGoal}" min="10" max="500" />
      <button class="btn" id="pfSave" style="width:100%;margin-top:1rem">Save profile</button>
    </div>
  `, { slim: true });
  root.querySelector('#pfSave').addEventListener('click', () => {
    S.setProfile({
      name: root.querySelector('#pfName').value.trim(),
      goalExam: root.querySelector('#pfExam').value,
      goalDate: root.querySelector('#pfDate').value.trim(),
      dailyGoal: Number(root.querySelector('#pfGoal').value) || 50
    });
    closeModal();
    toast('Profile saved on this device.');
  });
}

export function openAI(app) {
  const s = S.settings();
  const status = AI.aiStatus();
  const root = modal(`
    <div class="modalhead"><h3>AI settings</h3><button class="xbtn" data-dismiss="1">✕</button></div>
    <div class="modalbody">
      <p class="muted" style="font-size:.86rem">The site is static, so your key is stored only in this browser and sent directly to the provider. Nothing passes through us. ${status.ready ? '<strong style="color:var(--ok)">AI is on.</strong>' : 'Without a key the bank still works fully.'}</p>
      <label class="field">Provider</label>
      <select id="aiProvider">
        ${Object.entries(AI.PROVIDERS).map(([k, v]) => `<option value="${k}" ${s.provider === k ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}
      </select>
      <label class="field" style="margin-top:.8rem">API key</label>
      <input type="password" id="aiKey" value="${esc(s.key)}" placeholder="paste your key" autocomplete="off" />
      <label class="field" style="margin-top:.8rem">Model</label>
      <input type="text" id="aiModel" value="${esc(s.model)}" placeholder="leave blank for the default" />
      <label class="field" style="margin-top:.8rem">Custom endpoint (optional)</label>
      <input type="text" id="aiEndpoint" value="${esc(s.endpoint)}" placeholder="https://your-proxy.example.com/v1/chat/completions" />
      <p class="dim" style="font-size:.78rem;margin-top:.5rem">Browser calls need CORS on the provider. If a provider blocks browser requests, point the endpoint field at your own proxy or a Cloudflare Worker.</p>
      <div class="row" style="margin-top:1rem">
        <button class="btn" id="aiSave">Save</button>
        <button class="btn ghost" id="aiTest">Test connection</button>
      </div>
      <div id="aiOut" style="margin-top:.8rem;font-size:.84rem"></div>
    </div>
  `, { slim: true });

  root.querySelector('#aiSave').addEventListener('click', () => {
    S.setSettings({
      provider: root.querySelector('#aiProvider').value,
      key: root.querySelector('#aiKey').value.trim(),
      model: root.querySelector('#aiModel').value.trim(),
      endpoint: root.querySelector('#aiEndpoint').value.trim()
    });
    closeModal();
    toast('AI settings saved on this device.');
  });

  root.querySelector('#aiTest').addEventListener('click', async () => {
    const out = root.querySelector('#aiOut');
    S.setSettings({
      provider: root.querySelector('#aiProvider').value,
      key: root.querySelector('#aiKey').value.trim(),
      model: root.querySelector('#aiModel').value.trim(),
      endpoint: root.querySelector('#aiEndpoint').value.trim()
    });
    out.innerHTML = '<span class="muted">Testing…</span>';
    try {
      const qs = await AI.generateQuestions({ count: 1, exam: 'UPSC', subject: 'Polity', difficulty: 'easy' });
      out.innerHTML = `<span style="color:var(--ok)">Working — received a valid question: "${esc(qs[0].q)}"</span>`;
    } catch (e) {
      out.innerHTML = `<span style="color:var(--bad)">${esc(e.message === 'NO_KEY' ? 'Add a key first.' : e.message)}</span>`;
    }
  });
}

export function openAbout() {
  modal(`
    <div class="modalhead"><h3>How ExamArena works</h3><button class="xbtn" data-dismiss="1">✕</button></div>
    <div class="modalbody">
      <p><strong>Daily paper.</strong> A deterministic seed built from today's date selects the paper, so every visitor gets the same 50 questions today and a different set tomorrow. No server, no cron job — the paper exists even when nobody has visited.</p>
      <p><strong>Daily job and archive.</strong> A scheduled GitHub Action generates the day's paper at midnight IST, writes it to its own file and commits it. Every past day stays in the repository, listed on the Archive page by date.</p>
      <p><strong>Series builder.</strong> Ask for 500 questions and it is bound into 150 + 150 + 150 + 50: separate timed papers, each tracked on the series page.</p>
      <p><strong>Answer analysis.</strong> Every question carries background, discussion, a WH breakdown, current status, why each wrong option fails, a confidence tip, a practice pointer and a source.</p>
      <p><strong>Your ID.</strong> A hash of this device's fingerprint plus your network, stored in storage and a cookie. Fixed permanently, no login.</p>
      <p><strong>AI.</strong> Bring your own key. Without one, the built-in bank of 132 curated questions and anything you upload still runs everything.</p>
      <p><strong>Pulse Feed.</strong> The three-dot menu in the top right opens the anonymous chat feed.</p>
      <p class="dim" style="font-size:.82rem">Questions are written and reviewed for factual accuracy, but always cross-check against your official syllabus and sources before an exam.</p>
    </div>
  `, { slim: true });
}
