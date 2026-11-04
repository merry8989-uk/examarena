#!/usr/bin/env node
/**
 * ExamArena — archive compaction.
 *
 * Keeps the last KEEP_DAYS of daily papers as individual files. When the daily
 * folder crosses SIZE_LIMIT_MB (default 700 MB), every paper older than the keep
 * window is rolled into one gzipped month file under data/archive/ and the
 * per-day files are deleted. archive.json keeps one entry per day, with a
 * "bundle" pointer, so the site can still open any date.
 *
 *   node tools/compact-archive.mjs           # only acts if over the limit
 *   FORCE=1 node tools/compact-archive.mjs   # compact regardless
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const DATA = path.join(process.cwd(), 'data');
const DAILY = path.join(DATA, 'daily');
const BUNDLES = path.join(DATA, 'archive');
const SIZE_LIMIT_MB = Number(process.env.SIZE_LIMIT_MB || 700);
const KEEP_DAYS = Number(process.env.KEEP_DAYS || 183); // ~6 months
const FORCE = process.env.FORCE === '1';

const log = (...a) => console.log(...a);

function dirSize(dir) {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).reduce((sum, f) => {
    const p = path.join(dir, f);
    const st = fs.statSync(p);
    return sum + (st.isFile() ? st.size : dirSize(p));
  }, 0);
}

const mb = bytes => Math.round((bytes / 1048576) * 10) / 10;

function main() {
  if (!fs.existsSync(DAILY)) return log('no data/daily yet — nothing to compact');

  const total = dirSize(DAILY);
  log(`data/daily: ${mb(total)} MB · limit ${SIZE_LIMIT_MB} MB · keep ${KEEP_DAYS} days`);

  if (total < SIZE_LIMIT_MB * 1048576 && !FORCE) {
    log('under the limit — no compaction needed');
    return;
  }

  const cutoff = new Date(Date.now() - KEEP_DAYS * 864e5).toISOString().slice(0, 10);
  const files = fs.readdirSync(DAILY).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  const old = files.filter(f => f.slice(0, 10) < cutoff);

  if (!old.length) {
    log(`nothing older than ${cutoff} — nothing to compact`);
    return;
  }

  fs.mkdirSync(BUNDLES, { recursive: true });
  const archivePath = path.join(DATA, 'archive.json');
  let archive = [];
  try { archive = JSON.parse(fs.readFileSync(archivePath, 'utf8')); } catch { archive = []; }
  const byDate = new Map(archive.map(a => [a.date, a]));

  const months = {};
  old.forEach(f => {
    const date = f.slice(0, 10);
    (months[date.slice(0, 7)] = months[date.slice(0, 7)] || []).push(f);
  });

  let moved = 0;
  for (const [month, list] of Object.entries(months)) {
    const bundleRel = `data/archive/${month}.json.gz`;
    const bundleAbs = path.join(BUNDLES, `${month}.json.gz`);

    // merge with an existing bundle for this month, if one is already there
    let papers = {};
    if (fs.existsSync(bundleAbs)) {
      try { papers = JSON.parse(zlib.gunzipSync(fs.readFileSync(bundleAbs)).toString()).papers || {}; } catch {}
    }

    for (const f of list) {
      const date = f.slice(0, 10);
      try {
        papers[date] = JSON.parse(fs.readFileSync(path.join(DAILY, f), 'utf8'));
        moved++;
      } catch (err) {
        log(`  skip ${f}: ${err.message}`);
      }
    }

    const payload = JSON.stringify({ month, papers });
    fs.writeFileSync(bundleAbs, zlib.gzipSync(Buffer.from(payload), { level: 9 }));
    log(`  ${month}: ${list.length} papers → ${bundleRel} (${mb(fs.statSync(bundleAbs).size)} MB)`);

    list.forEach(f => {
      const date = f.slice(0, 10);
      const entry = byDate.get(date) || { date, count: papers[date]?.count || 0, topic: papers[date]?.topic || '', source: papers[date]?.source || 'bank' };
      entry.bundle = bundleRel;
      byDate.set(date, entry);
      fs.unlinkSync(path.join(DAILY, f));
    });
  }

  archive = [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
  fs.writeFileSync(archivePath, JSON.stringify(archive, null, 1));

  log(`compacted ${moved} papers into ${Object.keys(months).length} bundle(s); data/daily is now ${mb(dirSize(DAILY))} MB`);
}

main();
