/* ExamArena — bootstrap, router, header */
import * as S from './store.js';
import * as E from './engine.js';
import * as UI from './ui.js';

const app = { catalogue: null, bank: null, identity: null, ui: {} };
const view = document.getElementById('view');

async function boot() {
  app.identity = await S.initDevice();
  document.getElementById('deviceChip').textContent = app.identity.id;
  document.getElementById('deviceChip').title = 'Your permanent device ID: ' + app.identity.id;
  document.getElementById('footDevice').textContent = app.identity.id;

  wireHeader();

  try {
    app.catalogue = await E.loadCatalogue();
    app.bank = await E.loadBank();
  } catch (err) {
    view.innerHTML = `<div class="card pad" style="margin-top:2rem">
      <h2>Could not load the question bank</h2>
      <p class="muted">${UI.esc(err.message)}</p>
      <p class="muted" style="font-size:.86rem">If you opened <code>index.html</code> directly from disk, the browser blocks reading the JSON data files. Serve the folder over HTTP instead — for example <code>python3 -m http.server</code> — or use the published GitHub Pages link.</p>
      <button class="btn" onclick="location.reload()">Try again</button>
    </div>`;
    return;
  }

  window.addEventListener('hashchange', route);
  route();
}

function wireHeader() {
  const btn = document.getElementById('dotsBtn');
  const menu = document.getElementById('dotsMenu');

  const close = () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
  btn.addEventListener('click', e => {
    e.stopPropagation();
    const open = menu.hidden;
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', e => {
    if (!menu.hidden && !menu.contains(e.target) && e.target !== btn) close();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { close(); UI.closeModal(); } });

  menu.querySelectorAll('[data-act]').forEach(item => item.addEventListener('click', () => {
    close();
    const act = item.dataset.act;
    if (act === 'pulse') UI.openPulse();
    else if (act === 'profile') UI.openProfile(app);
    else if (act === 'ai') UI.openAI(app);
    else if (act === 'upload') location.hash = '#/upload';
    else if (act === 'about') UI.openAbout();
  }));

  document.getElementById('deviceChip').addEventListener('click', () => UI.openProfile(app));
}

async function route() {
  UI.teardown();
  if (!app.bank) {
    try { app.bank = await E.loadBank(); } catch {}
  }

  const hash = location.hash.replace(/^#\/?/, '');
  const [seg, param] = hash.split('/');

  document.querySelectorAll('.mainnav a').forEach(a => {
    const key = a.dataset.nav;
    a.classList.toggle('active',
      (key === 'home' && (!seg || seg === '')) ||
      key === seg);
  });

  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });

  switch (seg) {
    case '':
    case 'home':
      UI.mountHome(app, view);
      injectResumeBanner();
      break;
    case 'daily': UI.mountDaily(app, view); break;
    case 'builder': UI.mountBuilder(app, view); break;
    case 'series': UI.mountSeries(app, view); break;
    case 'upload': UI.mountUpload(app, view); break;
    case 'progress': UI.mountProgress(app, view); break;
    case 'test': UI.mountTest(app, view); break;
    case 'result': UI.mountResult(app, view, param); break;
    default:
      view.innerHTML = `<div class="empty">That page does not exist. <a href="#/">Go home</a>.</div>`;
  }
}

function injectResumeBanner() {
  const live = S.liveState();
  const paper = S.livePaper();
  if (!live || !paper) return;
  const left = Math.max(0, Math.round((live.endsAt - Date.now()) / 1000));
  if (left <= 0) { S.clearLive(); return; }
  const banner = document.createElement('div');
  banner.className = 'card';
  banner.style.cssText = 'border-color:var(--gold);margin-bottom:1.2rem;display:flex;gap:1rem;align-items:center;justify-content:space-between;flex-wrap:wrap';
  banner.innerHTML = `<div><strong>You have a test in progress.</strong>
    <div class="muted" style="font-size:.84rem">${UI.esc(paper.title)} · ${E.fmtClock(left)} left</div></div>
    <div class="row"><a class="btn small" href="#/test">Resume</a>
    <button class="btn small ghost" id="dropLive">Discard</button></div>`;
  view.prepend(banner);
  banner.querySelector('#dropLive').addEventListener('click', () => {
    if (!confirm('Discard this in-progress test? Your answers will be lost.')) return;
    S.clearLive();
    banner.remove();
  });
}

boot();
