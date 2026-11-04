/**
 * ExamArena — Sarvam proxy (Cloudflare Worker).
 *
 * Why this exists: the site is a public static page. Any API key shipped in the
 * JavaScript is public the moment it is deployed. This worker holds the key as
 * an encrypted Worker secret and forwards requests, so the browser never sees it.
 *
 * Deploy (2 minutes, free tier):
 *   1. dash.cloudflare.com → Workers & Pages → Create → Worker → name it examarena-ai → Deploy
 *   2. Edit code → paste this whole file → Deploy
 *   3. Settings → Variables and secrets → Add secret
 *        SARVAM_API_KEY = <your key>            (type: Secret)
 *        ALLOW_ORIGIN   = https://merry8989-uk.github.io   (type: Text, optional but recommended)
 *   4. Copy the worker URL (https://examarena-ai.<you>.workers.dev)
 *   5. Put it in data/config.json of the site: { "proxyUrl": "<worker url>" }
 *
 * Routes:
 *   POST /chat  { model, messages, max_tokens }      → /v1/chat/completions
 *   POST /stt   multipart audio                      → /speech-to-text
 *   POST /tts   { text, language_code, speaker }     → /text-to-speech
 *   GET  /health                                     → { ok: true }
 */

const SARVAM = 'https://api.sarvam.ai';
const RATE_LIMIT = 40;          // requests
const RATE_WINDOW_MS = 60000;   // per minute, per IP (best effort, per isolate)

const hits = new Map();

function corsHeaders(origin, allow) {
  const ok = !allow || allow === '*' || origin === allow;
  return {
    'Access-Control-Allow-Origin': ok ? (allow === '*' || !allow ? '*' : origin) : 'null',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
}

const json = (obj, status, cors) =>
  new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

function rateLimited(ip) {
  const now = Date.now();
  const entry = hits.get(ip) || { count: 0, reset: now + RATE_WINDOW_MS };
  if (now > entry.reset) { entry.count = 0; entry.reset = now + RATE_WINDOW_MS; }
  entry.count++;
  hits.set(ip, entry);
  if (hits.size > 5000) hits.clear();
  return entry.count > RATE_LIMIT;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin, env.ALLOW_ORIGIN);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (cors['Access-Control-Allow-Origin'] === 'null') return json({ error: 'Origin not allowed' }, 403, cors);

    const url = new URL(request.url);
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

    if (url.pathname === '/health') return json({ ok: true, service: 'examarena-sarvam-proxy' }, 200, cors);
    if (request.method !== 'POST') return json({ error: 'POST only' }, 405, cors);
    if (rateLimited(ip)) return json({ error: 'Too many requests — try again in a minute.' }, 429, cors);

    const key = env.SARVAM_API_KEY;
    if (!key) return json({ error: 'SARVAM_API_KEY is not set on this worker' }, 500, cors);

    try {
      if (url.pathname === '/chat') {
        const body = await request.text();
        let parsed;
        try { parsed = JSON.parse(body); } catch { return json({ error: 'Invalid JSON' }, 400, cors); }

        const upstream = await fetch(`${SARVAM}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'api-subscription-key': key, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: parsed.model || 'sarvam-105b',
            messages: (parsed.messages || []).slice(-24),
            temperature: typeof parsed.temperature === 'number' ? parsed.temperature : 0.6,
            max_tokens: Math.min(Number(parsed.max_tokens) || 2500, 4000)
          })
        });
        return new Response(upstream.body, {
          status: upstream.status,
          headers: { ...cors, 'Content-Type': 'application/json' }
        });
      }

      if (url.pathname === '/stt') {
        const form = await request.formData();
        const out = new FormData();
        const file = form.get('file');
        if (!file) return json({ error: 'file is required' }, 400, cors);
        out.append('file', file);
        out.append('model', form.get('model') || 'saaras:v4');
        out.append('mode', form.get('mode') || 'transcribe');
        if (form.get('language_code')) out.append('language_code', form.get('language_code'));

        const upstream = await fetch(`${SARVAM}/speech-to-text`, {
          method: 'POST',
          headers: { 'api-subscription-key': key },
          body: out
        });
        return new Response(upstream.body, {
          status: upstream.status,
          headers: { ...cors, 'Content-Type': 'application/json' }
        });
      }

      if (url.pathname === '/tts') {
        const body = await request.json().catch(() => ({}));
        if (!body.text) return json({ error: 'text is required' }, 400, cors);

        const upstream = await fetch(`${SARVAM}/text-to-speech`, {
          method: 'POST',
          headers: { 'api-subscription-key': key, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: String(body.text).slice(0, 480),
            language_code: body.language_code || 'en-IN',
            model: body.model || 'bulbul:v4-flash',
            speaker: body.speaker || 'simran_en_customer'
          })
        });
        return new Response(upstream.body, {
          status: upstream.status,
          headers: { ...cors, 'Content-Type': 'application/json' }
        });
      }

      return json({ error: 'Unknown route. Use /chat, /stt, /tts or /health.' }, 404, cors);
    } catch (err) {
      return json({ error: 'Upstream failed: ' + err.message }, 502, cors);
    }
  }
};
