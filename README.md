# ExamArena

A static, device-first mock-test platform for Indian exams — competition (UPSC, BPSC, SSC, Banking, Railway, Defence), professional (CA, CS), graduation (B.Com, BBA, BCA, BA, B.Sc) and school boards. No backend, no login, no build step: plain HTML, CSS and ES modules, ready for GitHub Pages.

## What it does

| Feature | How it works |
|---|---|
| **Daily 50-question test** | A deterministic seed built from today's date picks the paper from the bank. Same paper for everyone today, a different one tomorrow, generated with no server and no cron job. Rotates through a 20-topic calendar, weighted to the day's theme. |
| **Exam / stream / subject / difficulty filters** | Every question carries `exams`, `stream`, `subject`, `topic` and `difficulty`. |
| **Any-size paper + series** | Ask for 500 and it is bound into `150 + 150 + 150 + 50` separate timed papers. A tiny tail is split evenly instead of becoming a 10-question stub. |
| **Full answer analysis** | Each question carries background, discussion, a WH breakdown (what / why / when / where / who / how), current status, why every other option is wrong, a confidence tip, a practice pointer and a source. |
| **AI question generation** | Bring your own key: Sarvam, OpenAI, Gemini or any OpenAI-compatible endpoint. Key lives in this browser only. Without a key the bank still runs everything. |
| **Upload question banks** | JSON, CSV or TXT, parsed in the browser and merged into your filters. |
| **Upload notes** | PDF text extraction (pdf.js) and image OCR (Tesseract) → notes corpus → AI-generated questions from your own material, or clearly-labelled draft questions with no key. |
| **Permanent device ID** | Hash of device fingerprint + network tag, stored in `localStorage` **and** a 10-year cookie, so it survives a cache clear. Shown in the header, profile and progress page. |
| **Pulse Feed** | The three-dot menu, top right, opens the anonymous chat feed in an overlay. |
| **Progress** | Attempt history, per-subject accuracy, score bars, streaks, resume-in-progress-test banner. |

## Daily automation (500 questions a day, archived)

`.github/workflows/daily.yml` runs at **18:30 UTC = 00:00 IST** every day and:

1. generates the day's questions with your AI key, distributed across every subject in the catalogue,
2. validates and de-duplicates them,
3. writes `data/daily/YYYY-MM-DD.json` and updates `data/archive.json`,
4. commits and pushes — the site serves the new paper immediately, and the file stays in the repo forever.

The site's **Archive** page lists every generated day, grouped by month, and each day is attemptable in parts of 150.

**One manual step, once:** add your key as a repository secret.

> Settings → Secrets and variables → Actions → **New repository secret** → name `AI_API_KEY`, value your key.

Optional repository *variables* (Settings → Variables → Actions): `AI_PROVIDER` (`openai` | `sarvam` | `gemini` | `custom`), `AI_MODEL`, `AI_ENDPOINT`, `QUESTIONS_PER_DAY` (default `500`).

Without `AI_API_KEY` the job still runs, but it publishes a paper assembled from the curated bank and marks it `source: "bank"` — the archive keeps growing, the questions just are not new. The site never pretends otherwise.

Run it by hand any time:

```bash
AI_PROVIDER=openai AI_API_KEY=sk-... QUESTIONS_PER_DAY=500 node tools/generate-daily.mjs
# or: Actions tab → Daily question generation → Run workflow
```

Cost note: 500 questions is roughly 25 model calls of 20 questions each. On a small model (gpt-4o-mini, gemini-flash, sarvam-105b) that is a few rupees to a few tens of rupees a day. Want 500 **per subject** instead of 500 total? Set `QUESTIONS_PER_DAY` to `subject count × 500` — around 13,500, and the cost scales with it.

## Run locally

```bash
cd site
python3 -m http.server 8080
# open http://localhost:8080
```

Opening `index.html` straight from disk will not work: browsers block `fetch()` of the JSON data files over `file://`. Serve over HTTP.

## Add an AI key

Three-dot menu → **AI settings** → choose provider → paste key → **Test connection**.

- **Sarvam** — `sarvam-105b`, endpoint `https://api.sarvam.ai/v1/chat/completions`
- **OpenAI** — `gpt-4o-mini`
- **Gemini** — `gemini-2.0-flash`

Browser calls need CORS on the provider side. If a provider blocks browser requests, put your own proxy or Cloudflare Worker URL in the **Custom endpoint** field — the site never proxies your key through anyone else.

## Add questions

Drop a file in the **Upload** page. Formats:

```json
[{ "q": "The SI unit of force is", "options": ["Joule","Newton","Watt","Pascal"],
   "answer": 1, "subject": "Physics", "topic": "Units",
   "history": "…", "discussion": "…", "wh": {"what":"…"},
   "status": "…", "why_wrong": ["…","","…","…"], "tip": "…",
   "improve": "…", "source": "…" }]
```

`answer` is the 0-based index. `why_wrong` has four entries with an empty string at the correct index.

```csv
question,optionA,optionB,optionC,optionD,answer,subject,explanation
The SI unit of force is,Joule,Newton,Watt,Pascal,B,Physics,Force is mass times acceleration
```

```text
Q: Which Article defines a Money Bill?
A) Article 108
B) Article 110
C) Article 112
D) Article 117
Answer: B
Explanation: Article 110 defines a Money Bill.
```

To add questions permanently to the shipped bank, put a JSON file in `site/data/bank/` and add its name to `BANK_FILES` in `site/assets/js/engine.js`.

## Structure

```
site/
  index.html
  assets/css/style.css
  assets/js/
    app.js       router, header, resume banner
    store.js     device identity, settings, attempts, custom bank, notes
    engine.js    bank loading, filters, daily seed, series planning, scoring
    ai.js        provider adapters, prompt, JSON normalisation, note drafting
    upload.js    JSON/CSV/TXT parsers, PDF extraction, OCR
    ui.js        all views, test player, result analysis, modals
  data/
    exams.json   streams, exams, daily topic calendar
    bank/*.json  140 curated questions across 27 subjects
```

## Deploy

Any static host works — GitHub Pages, Cloudflare Pages, Netlify. All paths are relative, so a project page at `/<repo>/` works without changes.

```bash
git add -A && git commit -m "ExamArena" && git push
```

Then in the repository: **Settings → Pages → Source: Deploy from a branch → main / (root)**.

## Honest notes

- The shipped bank is 140 curated questions, not thousands. Volume comes from AI generation or your uploads; the app tells you when a filter matches fewer questions than you asked for rather than silently padding.
- AI-generated questions are checked for schema validity, not for factual truth. Treat them as a study aid and verify against your official syllabus.
- Without a key, "AI mode" falls back to the bank, and notes mode produces cloze-style draft questions from your own text, labelled as drafts.
