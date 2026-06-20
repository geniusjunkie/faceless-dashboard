/**
 * generate.js — Writes scored channel data back into index.html
 *
 * Finds the CHANNELS array and window.VID object in index.html
 * and replaces them with fresh data from the crawler run.
 * Everything else in index.html (CSS, layout, JS logic) is untouched.
 */

const fs = require('fs');
const path = require('path');
const { formatDuration } = require('./scorer');

const INDEX_HTML = path.join(__dirname, '..', 'index.html');

// ─────────────────────────────────────────────────
// BUILD CHANNELS ARRAY (for window code)
// ─────────────────────────────────────────────────

function buildChannelsJS(channels) {
  const lines = channels.map(ch => {
    const base = {
      id: ch.id,
      name: ch.name,
      handle: ch.handle,
      niche: ch.niche,
      subs: ch.subs,
      monthlyViews: ch.monthlyViews,
      avgLenSec: Math.round(ch.avgLenMin * 60),
      created: ch.created,
      rpm: ch.rpm,
      bestVideoTitle: ch.videos[0]?.title || '',
      bestVideoViews: ch.videos[0]?.viewCount || 0,
      section: ch.section,
    };

    // Add bend cards for Bend Pool channels (1b, mb, 2b)
    if (['1b', 'mb', '2b'].includes(ch.section) && ch.bends?.length) {
      base.bends = ch.bends;
    }

    return `  ${JSON.stringify(base)}`;
  });

  return `const CHANNELS = [\n${lines.join(',\n')}\n];`;
}

// ─────────────────────────────────────────────────
// BUILD window.VID OBJECT
// ─────────────────────────────────────────────────

function buildVIDJS(channels) {
  const entries = channels.map(ch => {
    const videos = (ch.videos || []).slice(0, 3).map(v => ({
      id: v.id,
      t: v.title,
      l: formatDuration(v.durationMin),
      v: v.viewCount,
      d: v.publishedAt.slice(0, 10),
    }));
    return `  ${JSON.stringify(ch.id)}: ${JSON.stringify(videos)}`;
  });

  return `window.VID = {\n${entries.join(',\n')}\n};`;
}

// ─────────────────────────────────────────────────
// PATCH index.html
// ─────────────────────────────────────────────────

function updateIndexHTML(channels, runDate, dryRun = false) {
  if (!fs.existsSync(INDEX_HTML)) {
    throw new Error(`index.html not found at ${INDEX_HTML}`);
  }

  let html = fs.readFileSync(INDEX_HTML, 'utf8');

  // ── Replace CHANNELS array ──
  const channelsJS = buildChannelsJS(channels);
  // Matches from "const CHANNELS = [" to the closing "];"
  const channelsRegex = /const CHANNELS = \[[\s\S]*?\];/;
  if (!channelsRegex.test(html)) {
    throw new Error('Could not find "const CHANNELS = [..." in index.html. Has the file been modified?');
  }
  html = html.replace(channelsRegex, channelsJS);

  // ── Replace window.VID object ──
  const vidJS = buildVIDJS(channels);
  // Matches from "window.VID = {" to the closing "};"
  const vidRegex = /window\.VID = \{[\s\S]*?\};/;
  if (!vidRegex.test(html)) {
    throw new Error('Could not find "window.VID = {..." in index.html. Has the file been modified?');
  }
  html = html.replace(vidRegex, vidJS);

  // ── Update the run date in the header meta line ──
  html = html.replace(
    /run_id: wnnr_\d{8}_\d{3}/g,
    `run_id: wnnr_${runDate.replace(/-/g, '')}_${String(new Date().getHours()).padStart(3,'0')}`
  );

  // ── Update the generated timestamp in footer ──
  html = html.replace(
    /Generated: [^·]+·/,
    `Generated: ${new Date().toISOString()} ·`
  );

  // ── Update KPI: total channels ──
  const total = channels.length;
  html = html.replace(
    /<div class="kpi-value mono" id="kpi-total">\d+<\/div>/,
    `<div class="kpi-value mono" id="kpi-total">${total}</div>`
  );

  if (dryRun) {
    console.log('\n── DRY RUN: HTML would be updated (not written) ──');
    console.log(`  Channels: ${channels.length}`);
    console.log(`  Sections: ${[...new Set(channels.map(c => c.section))].sort().join(', ')}`);
    return;
  }

  fs.writeFileSync(INDEX_HTML, html, 'utf8');
  console.log(`\n✅ index.html updated with ${channels.length} channels`);
}

// ─────────────────────────────────────────────────
// SAVE RAW RESULTS
// ─────────────────────────────────────────────────

function saveLastRun(channels, meta) {
  const outPath = path.join(__dirname, 'last_run.json');
  fs.writeFileSync(outPath, JSON.stringify({ meta, channels }, null, 2), 'utf8');
  console.log(`💾 Raw results saved → crawler/last_run.json`);
}

function loadLastRun() {
  const outPath = path.join(__dirname, 'last_run.json');
  if (!fs.existsSync(outPath)) return null;
  return JSON.parse(fs.readFileSync(outPath, 'utf8'));
}

module.exports = { updateIndexHTML, saveLastRun, loadLastRun };
