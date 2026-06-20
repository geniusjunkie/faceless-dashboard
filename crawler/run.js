/**
 * run.js — Main crawler entry point
 *
 * Usage:
 *   node run.js              → full crawl + update index.html
 *   node run.js --dry-run    → crawl but don't write index.html
 *   node run.js --generate-only → skip crawl, regenerate HTML from last_run.json
 *
 * What this does (the free Nexlev alternative):
 *   1. For each configured niche, search YouTube for recently-posted videos
 *   2. Extract unique channel IDs from those video results
 *   3. Fetch full channel statistics (subscriber count, total views, age)
 *   4. Filter: only channels created in the last MAX_CHANNEL_AGE_DAYS days
 *   5. Fetch top 5 videos per surviving channel
 *   6. Score each channel: outlier score, faceless heuristic, monthly views
 *   7. Assign to dashboard sections (1A, 1B, MA, MB, 2A, 2B, Overflow)
 *   8. Deduplicate (each channel appears in exactly one section)
 *   9. Save raw results to crawler/last_run.json
 *  10. Patch index.html with fresh data
 *  11. (Optional) git push to trigger Render auto-deploy
 */

require('dotenv').config();

const { execSync } = require('child_process');
const path = require('path');

const YouTubeAPI = require('./youtube');
const NICHES = require('./niches');
const {
  parseDurationToMinutes,
  getAgeInDays,
  estimateMonthlyViews,
  calculateOutlierScore,
  scoreFaceless,
  assignSection,
  estimateRevenue,
  formatViews,
  formatSubs,
} = require('./scorer');
const { updateIndexHTML, saveLastRun, loadLastRun } = require('./generate');

// ─────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────

const API_KEY = process.env.YOUTUBE_API_KEY;
const MAX_CHANNEL_AGE_DAYS = parseInt(process.env.MAX_CHANNEL_AGE_DAYS || '120');
const MIN_MONTHLY_VIEWS = parseInt(process.env.MIN_MONTHLY_VIEWS || '50000');
const AUTO_PUSH = process.env.AUTO_PUSH === 'true';

const DRY_RUN = process.argv.includes('--dry-run');
const GENERATE_ONLY = process.argv.includes('--generate-only');

// How many channels per section to keep in the dashboard
const SECTION_LIMITS = { '1a': 9, '1b': 6, 'ma': 4, 'mb': 3, '2a': 7, '2b': 5, '3': 9 };

// Today's date string for filenames / run IDs
const TODAY = new Date().toISOString().slice(0, 10);

// ─────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function publishedAfterDate(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
}

function chunk(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

// ─────────────────────────────────────────────────
// PHASE 1: SEARCH FOR CHANNELS VIA VIDEO RESULTS
// ─────────────────────────────────────────────────

async function searchChannels(yt) {
  console.log('\n📡 Phase 1: Searching YouTube for new channels…');

  const channelNicheMap = new Map(); // channelId → niche config

  for (const niche of NICHES) {
    for (const keyword of niche.keywords) {
      console.log(`  🔍 "${keyword}" (${niche.label})`);

      try {
        const data = await yt.searchVideos(keyword, publishedAfterDate(MAX_CHANNEL_AGE_DAYS));
        await sleep(500); // be polite to the API

        if (!data.items) continue;

        for (const item of data.items) {
          const channelId = item.snippet?.channelId;
          if (!channelId) continue;

          // Each channel gets the first niche that found it (priority = order in niches.js)
          if (!channelNicheMap.has(channelId)) {
            channelNicheMap.set(channelId, niche);
          }
        }
      } catch (err) {
        console.warn(`  ⚠️  Search failed for "${keyword}": ${err.message}`);
      }
    }
  }

  console.log(`\n  Found ${channelNicheMap.size} unique channels to evaluate`);
  return channelNicheMap;
}

// ─────────────────────────────────────────────────
// PHASE 2: FETCH & FILTER CHANNEL STATS
// ─────────────────────────────────────────────────

async function fetchAndFilterChannels(yt, channelNicheMap) {
  console.log('\n📊 Phase 2: Fetching channel stats and filtering…');

  const channelIds = [...channelNicheMap.keys()];
  const batches = chunk(channelIds, 50);
  const surviving = [];

  for (const batch of batches) {
    try {
      const data = await yt.getChannels(batch);
      await sleep(300);

      if (!data.items) continue;

      for (const ch of data.items) {
        const ageDays = getAgeInDays(ch.snippet.publishedAt);
        const totalViews = parseInt(ch.statistics?.viewCount || 0);
        const subs = parseInt(ch.statistics?.subscriberCount || 0);
        const videoCount = parseInt(ch.statistics?.videoCount || 0);

        // Filter: must be new enough and have content
        if (ageDays > MAX_CHANNEL_AGE_DAYS) continue;
        if (videoCount < 2) continue; // needs some content
        if (totalViews < 10000) continue; // needs some traction

        const niche = channelNicheMap.get(ch.id);
        surviving.push({ channel: ch, niche, ageDays, totalViews, subs });
      }
    } catch (err) {
      console.warn(`  ⚠️  Channel stats batch failed: ${err.message}`);
    }
  }

  console.log(`  ${surviving.length} channels passed age + view filters`);
  return surviving;
}

// ─────────────────────────────────────────────────
// PHASE 3: FETCH VIDEOS PER CHANNEL
// ─────────────────────────────────────────────────

async function fetchChannelVideos(yt, candidates, niche) {
  // Only fetch videos for channels that passed stats filter
  // Limit to top 40 candidates to stay within quota
  const toFetch = candidates.slice(0, 40);

  console.log(`\n🎬 Phase 3: Fetching top videos for ${toFetch.length} channels…`);

  const enriched = [];

  for (const candidate of toFetch) {
    const { channel, niche: channelNiche, ageDays, totalViews, subs } = candidate;

    try {
      const videoSearchData = await yt.getChannelTopVideos(channel.id, 5);
      await sleep(400);

      const videoIds = (videoSearchData.items || []).map(v => v.id?.videoId).filter(Boolean);
      if (videoIds.length === 0) continue;

      // Get stats + duration for these video IDs
      const statsData = await yt.getVideoStats(videoIds);
      await sleep(200);

      const videos = (statsData.items || []).map(v => {
        const durationMin = parseDurationToMinutes(v.contentDetails?.duration);
        return {
          id: v.id,
          title: v.snippet?.title || '',
          publishedAt: v.snippet?.publishedAt || '',
          viewCount: parseInt(v.statistics?.viewCount || 0),
          likeCount: parseInt(v.statistics?.likeCount || 0),
          durationMin,
        };
      }).filter(v => v.durationMin > 0);

      // Sort videos by view count descending
      videos.sort((a, b) => b.viewCount - a.viewCount);

      // Apply length filter for this niche
      const lengthFiltered = videos.filter(v =>
        v.durationMin >= channelNiche.minLenMin && v.durationMin <= channelNiche.maxLenMin
      );

      // Need at least one video that matches the niche length requirement
      if (lengthFiltered.length === 0) continue;

      const monthlyViews = estimateMonthlyViews(videos, ageDays, totalViews);

      // Apply minimum monthly views filter
      if (monthlyViews < MIN_MONTHLY_VIEWS) continue;

      const avgLenMin = videos.reduce((s, v) => s + v.durationMin, 0) / videos.length;
      const outlierScore = calculateOutlierScore(videos);
      const facelessScore = scoreFaceless(channel, videos);
      const section = assignSection(channelNiche.section, ageDays, monthlyViews);
      const rpm = channelNiche.rpm.median;
      const estRevenue = estimateRevenue(monthlyViews, rpm);

      enriched.push({
        id: channel.id,
        name: channel.snippet.title,
        handle: channel.snippet.customUrl || `@${channel.snippet.title.replace(/\s+/g, '')}`,
        niche: channelNiche.label,
        nicheId: channelNiche.id,
        subs,
        monthlyViews,
        avgLenMin,
        created: channel.snippet.publishedAt.slice(0, 10),
        ageDays,
        rpm,
        estRevenue,
        outlierScore,
        facelessScore,
        section,
        videos: videos.slice(0, 3), // keep top 3 for the dashboard
        // Thumbnail URL (YouTube CDN — always free and public)
        avatarUrl: channel.snippet.thumbnails?.default?.url || '',
      });

    } catch (err) {
      console.warn(`  ⚠️  Videos fetch failed for ${channel.snippet.title}: ${err.message}`);
    }
  }

  console.log(`  ${enriched.length} channels scored and ready`);
  return enriched;
}

// ─────────────────────────────────────────────────
// PHASE 4: DEDUPLICATE + ASSIGN SECTIONS
// ─────────────────────────────────────────────────

function assignFinalSections(channels) {
  console.log('\n📋 Phase 4: Assigning sections and deduplicating…');

  // Sort by monthly views descending within each section (best first)
  channels.sort((a, b) => b.monthlyViews - a.monthlyViews);

  const seen = new Set();
  const sectionBuckets = {};
  const overflow = [];

  for (const [key, limit] of Object.entries(SECTION_LIMITS)) {
    sectionBuckets[key] = [];
  }

  for (const ch of channels) {
    if (seen.has(ch.id)) continue;
    seen.add(ch.id);

    const section = ch.section;
    const bucket = sectionBuckets[section];
    const limit = SECTION_LIMITS[section] || 9;

    if (bucket && bucket.length < limit) {
      bucket.push({ ...ch, section });
    } else if (sectionBuckets['3'] && sectionBuckets['3'].length < SECTION_LIMITS['3']) {
      // Overflow: keep section assignment for context but display in section 3
      sectionBuckets['3'].push({ ...ch, section: '3' });
    }
  }

  const result = Object.values(sectionBuckets).flat();

  const counts = {};
  result.forEach(ch => { counts[ch.section] = (counts[ch.section] || 0) + 1; });
  console.log('  Section counts:', counts);

  return result;
}

// ─────────────────────────────────────────────────
// PRINT SUMMARY TABLE
// ─────────────────────────────────────────────────

function printSummary(channels) {
  console.log('\n' + '─'.repeat(80));
  console.log('CRAWL RESULTS SUMMARY');
  console.log('─'.repeat(80));
  console.log(
    'Section'.padEnd(8) +
    'Channel'.padEnd(30) +
    'Niche'.padEnd(22) +
    'Views/mo'.padEnd(10) +
    'Age'.padEnd(6) +
    'Outlier'.padEnd(8) +
    'Faceless'
  );
  console.log('─'.repeat(80));

  const sorted = [...channels].sort((a, b) => {
    const order = ['1a','1b','ma','mb','2a','2b','3'];
    return order.indexOf(a.section) - order.indexOf(b.section);
  });

  for (const ch of sorted) {
    console.log(
      ch.section.padEnd(8) +
      ch.name.slice(0, 28).padEnd(30) +
      ch.niche.slice(0, 20).padEnd(22) +
      formatViews(ch.monthlyViews).padEnd(10) +
      `${ch.ageDays}d`.padEnd(6) +
      `${ch.outlierScore}×`.padEnd(8) +
      `${ch.facelessScore}/10`
    );
  }

  console.log('─'.repeat(80));
  console.log(`Total: ${channels.length} channels`);
}

// ─────────────────────────────────────────────────
// GIT PUSH (optional)
// ─────────────────────────────────────────────────

function gitPush(channelCount) {
  const repoRoot = path.join(__dirname, '..');
  console.log('\n🚀 Auto-pushing to GitHub (Render will auto-deploy)…');
  try {
    execSync(`git -C "${repoRoot}" add index.html`, { stdio: 'inherit' });
    execSync(
      `git -C "${repoRoot}" commit -m "Auto: crawler run ${TODAY} — ${channelCount} channels"`,
      { stdio: 'inherit' }
    );
    execSync(`git -C "${repoRoot}" push`, { stdio: 'inherit' });
    console.log('✅ Pushed — Render will deploy in ~30 seconds');
  } catch (err) {
    console.warn('⚠️  Git push failed:', err.message);
    console.log('   Run manually: cd .. && git add index.html && git commit -m "Update" && git push');
  }
}

// ─────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  WNNR. Crawler — Free Nexlev Alternative         ║');
  console.log(`║  ${TODAY}${DRY_RUN ? ' [DRY RUN]' : ''}${GENERATE_ONLY ? ' [GENERATE ONLY]' : ''}`.padEnd(51) + '║');
  console.log('╚══════════════════════════════════════════════════╝');

  // ── Generate-only mode: skip crawl, use last_run.json ──
  if (GENERATE_ONLY) {
    const lastRun = loadLastRun();
    if (!lastRun) {
      console.error('❌ No last_run.json found. Run without --generate-only first.');
      process.exit(1);
    }
    console.log(`\n♻️  Regenerating from last_run.json (${lastRun.channels.length} channels, run: ${lastRun.meta.date})`);
    updateIndexHTML(lastRun.channels, TODAY, DRY_RUN);
    if (AUTO_PUSH && !DRY_RUN) gitPush(lastRun.channels.length);
    return;
  }

  // ── Validate API key ──
  if (!API_KEY || API_KEY === 'YOUR_API_KEY_HERE') {
    console.error('\n❌ No YouTube API key found.');
    console.error('   1. Copy crawler/.env.example to crawler/.env');
    console.error('   2. Add your key: YOUTUBE_API_KEY=AIza...');
    console.error('   3. Get a free key at: https://console.cloud.google.com');
    console.error('      → New Project → Enable YouTube Data API v3 → Credentials → Create API Key');
    process.exit(1);
  }

  const yt = new YouTubeAPI(API_KEY);

  try {
    // Phase 1: Search
    const channelNicheMap = await searchChannels(yt);

    // Phase 2: Filter by stats
    const candidates = await fetchAndFilterChannels(yt, channelNicheMap);

    // Phase 3: Fetch videos + score
    const scored = await fetchChannelVideos(yt, candidates);

    // Phase 4: Assign sections + deduplicate
    const final = assignFinalSections(scored);

    // Print summary
    printSummary(final);

    // Save raw results
    if (!DRY_RUN) {
      saveLastRun(final, { date: TODAY, quotaUsed: yt.quotaUsed, totalFound: channelNicheMap.size });
    }

    // Update index.html
    updateIndexHTML(final, TODAY, DRY_RUN);

    // Auto-push
    if (AUTO_PUSH && !DRY_RUN) gitPush(final.length);

    console.log(`\n✨ Done! Quota used: ${yt.quotaSummary}`);

    if (!AUTO_PUSH && !DRY_RUN) {
      console.log('\n📤 To publish to your live site:');
      console.log('   cd .. && git add index.html && git commit -m "Update: crawler" && git push');
    }

  } catch (err) {
    console.error('\n❌ Crawler failed:', err.message);
    process.exit(1);
  }
}

main();
