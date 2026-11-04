/* ExamArena — Ask AI: chat, vision-by-OCR, PDF, voice in, audio out, exports.
 * The key never lives in this file. It is either held by the proxy worker
 * (worker/sarvam-proxy.js) or entered by the user in this browser. */
import * as S from './store.js';
import { extractPDF, extractImage } from './upload.js';

export const state = { messages: [], busy: false, config: null, attachments: [], speaking: null };

const SYSTEM = `You are ExamArena's study assistant for Indian exams — UPSC, BPSC, SSC, Banking, Railway, Defence, CA, CS, B.Com, BBA, BCA, BA, B.Sc and school boards.
Answer in the same language the student used (Hindi, English or Hinglish), in clear, plain wording.
For a concept question: give the direct answer first, then the reasoning, then one exam angle.
For a current-affairs or policy question: state the position as of your knowledge and say plainly that the student should verify the latest update.
For a mock-test question: give the correct option, then why each other option fails.
For "make notes": return tight, revision-ready bullet points with headings.
Use short paragraphs and bold key terms. Never invent citations, dates or article numbers — if unsure, say so.`;

/* ---------- config + backend ---------- */
export async function loadConfig() {
  if (state.config) return state.config;
  try {
    const res = await fetch('data/config.json', { cache: 'no-store' });
    state.config = res.ok ? await res.json() : {};
  } catch { state.config = {}; }
  return state.config;
}

export function backend() {
  const cfg = state.config || {};
  const s = S.settings();
  if (cfg.proxyUrl) return { mode: 'proxy', base: String(cfg.proxyUrl).replace(/\/$/, ''), model: cfg.model || 'sarvam-105b', label: 'Sarvam via secure proxy' };
  if (s.key && s.provider === 'sarvam') return { mode: 'key', base: 'https://api.sarvam.ai', model: 'sarvam-105b', key: s.key, label: 'your key, this browser only' };
  if (s.key && s.provider === 'openai') return { mode: 'key', base: 'https://api.openai.com', model: s.model || 'gpt-4o-mini', key: s.key, label: 'your OpenAI key' };
  return { mode: 'none', label: 'not configured' };
}

/* ---------- chat ---------- */
export async function send(userText, attachments = []) {
  const be = backend();
  if (be.mode === 'none') throw new Error('NO_BACKEND');

  let content = userText || '';
  attachments.forEach(a => {
    content += `\n\n[Attached ${a.type === 'pdf' ? 'PDF' : 'image'}: ${a.name}]\n${a.text.slice(0, 12000)}`;
  });
  if (!content.trim()) throw new Error('Nothing to send.');

  state.messages.push({ role: 'user', content, ts: Date.now() });
  const history = state.messages.slice(-12).map(m => ({ role: m.role, content: m.content }));

  const reply = await callChat(be, [{ role: 'system', content: SYSTEM }, ...history]);
  state.messages.push({ role: 'assistant', content: reply, ts: Date.now() });
  return reply;
}

async function callChat(be, messages) {
  const url = be.mode === 'proxy' ? `${be.base}/chat` : `${be.base}/v1/chat/completions`;
  const headers = { 'Content-Type': 'application/json' };
  if (be.mode === 'key') {
    if (be.base.includes('sarvam')) headers['api-subscription-key'] = be.key;
    else headers.Authorization = 'Bearer ' + be.key;
  }
  const body = { model: be.model, messages, max_tokens: 2500, temperature: 0.6 };

  let res;
  try {
    res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  } catch {
    throw new Error(be.mode === 'proxy'
      ? 'Could not reach the proxy. Check the worker URL in data/config.json.'
      : 'The browser could not reach the provider (likely CORS). Deploy the proxy worker — see worker/sarvam-proxy.js.');
  }
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`AI request failed (${res.status}). ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  const msg = data?.choices?.[0]?.message || {};
  const text = (msg.content || '').trim();
  if (!text) throw new Error('The model returned an empty reply — try rephrasing.');
  return text;
}

/* ---------- attachments ---------- */
export async function attachFile(file) {
  const name = file.name || 'file';
  if (/^image\//.test(file.type) || /\.(png|jpe?g|webp)$/i.test(name)) {
    const { text, confidence } = await extractImage(file);
    return { type: 'image', name, text: text || '', note: confidence ? `OCR ${Math.round(confidence)}%` : '' };
  }
  if (/\.pdf$/i.test(name)) {
    const { text, pages } = await extractPDF(file);
    return { type: 'pdf', name, text: text || '', note: pages + ' pages' };
  }
  const text = await file.text();
  return { type: 'pdf', name, text: text.slice(0, 20000), note: 'text file' };
}

/* ---------- speech to text ---------- */
export function createRecorder() {
  let ctx, stream, proc, src, chunks = [], rate = 44100;

  return {
    async start() {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser cannot record audio.');
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      rate = ctx.sampleRate;
      src = ctx.createMediaStreamSource(stream);
      proc = ctx.createScriptProcessor(4096, 1, 1);
      chunks = [];
      proc.onaudioprocess = e => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      src.connect(proc);
      proc.connect(ctx.destination);
    },
    async stop() {
      try { proc.disconnect(); src.disconnect(); stream.getTracks().forEach(t => t.stop()); await ctx.close(); } catch {}
      const total = chunks.reduce((n, c) => n + c.length, 0);
      if (!total) throw new Error('Nothing was recorded.');
      return encodeWav(chunks, total, rate);
    },
    cancel() {
      try { proc?.disconnect(); src?.disconnect(); stream?.getTracks().forEach(t => t.stop()); ctx?.close(); } catch {}
      chunks = [];
    }
  };
}

function encodeWav(chunks, total, rate) {
  const buffer = new ArrayBuffer(44 + total * 2);
  const view = new DataView(buffer);
  const str = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); view.setUint32(4, 36 + total * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
  view.setUint16(22, 1, true); view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  str(36, 'data'); view.setUint32(40, total * 2, true);
  let off = 44;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++) {
      const s = Math.max(-1, Math.min(1, chunk[i]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

export async function transcribe(blob) {
  const be = backend();
  if (be.mode === 'none') throw new Error('NO_BACKEND');
  const form = new FormData();
  form.append('file', blob, 'speech.wav');
  form.append('model', 'saaras:v4');
  form.append('mode', 'transcribe');

  const url = be.mode === 'proxy' ? `${be.base}/stt` : 'https://api.sarvam.ai/speech-to-text';
  const headers = {};
  if (be.mode === 'key') headers['api-subscription-key'] = be.key;

  const res = await fetch(url, { method: 'POST', headers, body: form });
  if (!res.ok) throw new Error('Speech to text failed (' + res.status + ').');
  const data = await res.json();
  const text = data.transcript || data.text || '';
  if (!text) throw new Error('No speech detected.');
  return text;
}

/* ---------- text to speech ---------- */
export async function speak(text, lang = 'en-IN') {
  const be = backend();
  if (be.mode === 'none') throw new Error('NO_BACKEND');

  const url = be.mode === 'proxy' ? `${be.base}/tts` : 'https://api.sarvam.ai/text-to-speech';
  const headers = { 'Content-Type': 'application/json' };
  if (be.mode === 'key') headers['api-subscription-key'] = be.key;

  const res = await fetch(url, {
    method: 'POST', headers,
    body: JSON.stringify({
      text: text.slice(0, 480),
      language_code: lang,
      model: 'bulbul:v4-flash',
      speaker: 'simran_en_customer'
    })
  });
  if (!res.ok) throw new Error('Text to speech failed (' + res.status + ').');
  const data = await res.json();
  const b64 = data.audios?.[0] || data.audio;
  if (!b64) throw new Error('No audio returned.');
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
}

/* ---------- exports ---------- */
function transcriptHTML(messages) {
  return messages.filter(m => m.role !== 'system').map(m => {
    const who = m.role === 'user' ? 'You' : 'ExamArena AI';
    return `<div class="msg ${m.role}"><div class="who">${who}</div><div class="body">${escapeHTML(m.content).replace(/\n/g, '<br>')}</div></div>`;
  }).join('');
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const DOC_CSS = `
  body{font-family:Georgia,'Times New Roman',serif;line-height:1.55;color:#111;margin:32px;max-width:760px}
  h1{font-family:Arial,Helvetica,sans-serif;font-size:20px;margin:0 0 4px}
  .meta{font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#666;margin-bottom:20px}
  .msg{margin:0 0 14px}
  .who{font-family:Arial,Helvetica,sans-serif;font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#b8860b;margin-bottom:2px}
  .msg.user .who{color:#2b6cb0}
  .body{font-size:13px}
  hr{border:0;border-top:1px solid #ddd;margin:18px 0}
`;

export function exportPDF(messages, title = 'ExamArena — AI answer') {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHTML(title)}</title>
    <style>${DOC_CSS} @page{margin:18mm}</style></head><body>
    <h1>${escapeHTML(title)}</h1>
    <div class="meta">ExamArena · ${new Date().toLocaleString('en-IN')} · examarena</div>
    ${transcriptHTML(messages)}
    </body></html>`;

  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(frame);
  frame.srcdoc = html;
  frame.onload = () => {
    try { frame.contentWindow.focus(); frame.contentWindow.print(); }
    catch { window.open('', '_blank'); }
    setTimeout(() => frame.remove(), 60000);
  };
}

export function exportDOC(messages, title = 'ExamArena — AI answer') {
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word">
    <head><meta charset="utf-8"><title>${escapeHTML(title)}</title><style>${DOC_CSS}</style></head><body>
    <h1>${escapeHTML(title)}</h1>
    <div class="meta">ExamArena · ${new Date().toLocaleString('en-IN')}</div>
    ${transcriptHTML(messages)}
    </body></html>`;
  const blob = new Blob(['\ufeff', html], { type: 'application/msword' });
  download(blob, `${slug(title)}.doc`);
}

export function exportMarkdown(messages, title = 'ExamArena — AI answer') {
  const text = messages.filter(m => m.role !== 'system')
    .map(m => `## ${m.role === 'user' ? 'You' : 'ExamArena AI'}\n\n${m.content}`).join('\n\n---\n\n');
  download(new Blob([`# ${title}\n\n_${new Date().toLocaleString('en-IN')}_\n\n${text}`], { type: 'text/markdown' }), `${slug(title)}.md`);
}

export function saveAsNote(messages, title = 'AI answer') {
  const text = messages.filter(m => m.role !== 'system')
    .map(m => `${m.role === 'user' ? 'Q' : 'A'}: ${m.content}`).join('\n\n');
  S.addNote({
    id: 'nt-' + Date.now().toString(36),
    name: title.slice(0, 60),
    chars: text.length,
    text: text.slice(0, 180000),
    addedAt: Date.now()
  });
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'examarena';
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ---------- light markdown for the chat bubbles ---------- */
export function renderMD(text) {
  return escapeHTML(text)
    .replace(/^### (.+)$/gm, '<strong>$1</strong>')
    .replace(/^## (.+)$/gm, '<strong>$1</strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/^\s*[-*] (.+)$/gm, '• $1')
    .replace(/\n{2,}/g, '</p><p>')
    .replace(/\n/g, '<br>')
    .replace(/^/, '<p>').replace(/$/, '</p>');
}
