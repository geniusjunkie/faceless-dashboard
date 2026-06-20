/**
 * scorer.js — Channel scoring, faceless heuristics, section assignment
 *
 * This is the "intelligence" layer — the equivalent of Nexlev's proprietary scoring.
 * All logic here is based on publicly available signals from the YouTube API.
 */

// ─────────────────────────────────────────────────
// DURATION PARSING
// ─────────────────────────────────────────────────

/**
 * Parse ISO 8601 duration (e.g. "PT28M14S", "PT2H8M33S") to total minutes.
 */
function parseDurationToMinutes(iso) {
  if (!iso) return 0;
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const h = parseInt(match[1] || 0);
  const m = parseInt(match[2] || 0);
  const s = parseInt(match[3] || 0);
  return h * 60 + m + s / 60;
}

/**
 * Format minutes back to "HH:MM:SS" or "MM:SS" string.
 */
function formatDuration(totalMinutes) {
  const h = Math.floor(totalMinutes / 60);
  const m = Math.floor(totalMinutes % 60);
  const s = Math.round((totalMinutes * 60) % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ─────────────────────────────────────────────────
// AGE CALCULATION
// ─────────────────────────────────────────────────

/**
 * Returns how many days ago a date string was.
 */
function getAgeInDays(isoDateString) {
  const created = new Date(isoDateString);
  const now = new Date();
  return Math.floor((now - created) / (1000 * 60 * 60 * 24));
}

/**
 * Format age in days to a human-readable badge string.
 */
function formatAge(days) {
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.round(days / 7)}w`;
  return `${(days / 365).toFixed(1)}y`;
}

// ─────────────────────────────────────────────────
// MONTHLY VIEWS ESTIMATE
// ─────────────────────────────────────────────────

/**
 * Estimate 30-day views from a channel's recent top videos.
 * Falls back to a monthly average from total views if no recent data.
 *
 * @param {Object[]} videos     - enriched video objects with { viewCount, publishedAt }
 * @param {number}   ageDays    - channel age in days
 * @param {number}   totalViews - channel's all-time total view count
 */
function estimateMonthlyViews(videos, ageDays, totalViews) {
  // Method 1: sum views from videos published in the last 30 days
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 30);

  const recentViews = videos
    .filter(v => new Date(v.publishedAt) >= cutoff)
    .reduce((sum, v) => sum + v.viewCount, 0);

  if (recentViews > 10000) return recentViews;

  // Method 2: total views divided by channel age in months
  const months = Math.max(1, ageDays / 30);
  return Math.floor(totalViews / months);
}

// ─────────────────────────────────────────────────
// OUTLIER SCORE
// ─────────────────────────────────────────────────

/**
 * Outlier score = top video views ÷ channel average video views.
 * Score > 3 = strong outlier (a breakout video far above channel average)
 * Score > 10 = viral outlier
 *
 * This is conceptually identical to Nexlev's "outlier score".
 */
function calculateOutlierScore(videos) {
  if (!videos || videos.length === 0) return 1.0;
  const viewCounts = videos.map(v => v.viewCount).filter(v => v > 0);
  if (viewCounts.length === 0) return 1.0;

  const topViews = Math.max(...viewCounts);
  const avgViews = viewCounts.reduce((a, b) => a + b, 0) / viewCounts.length;

  return avgViews > 0 ? Math.round((topViews / avgViews) * 10) / 10 : 1.0;
}

// ─────────────────────────────────────────────────
// FACELESS HEURISTIC
// ─────────────────────────────────────────────────

/**
 * Score how likely a channel is to be "faceless" (automation/documentary style).
 * Returns a confidence score 0–10. >= 4 = likely faceless.
 *
 * Note: YouTube's API doesn't expose a "faceless" flag.
 * This is a heuristic based on publicly visible signals.
 */
function scoreFaceless(channel, videos) {
  let score = 0;
  const title = (channel.snippet.title || '').toLowerCase();
  const description = (channel.snippet.description || '').toLowerCase();
  const combined = title + ' ' + description;

  // ── Positive signals (faceless documentary-style content) ──
  const facelessWords = [
    'history', 'documentary', 'story', 'explained', 'facts',
    'mystery', 'case', 'archive', 'vault', 'chronicle', 'digest',
    'narration', 'finance', 'psychology', 'military', 'crime',
    'ai explained', 'technology explained', 'science', 'analysis',
    'breakdown', 'revealed', 'untold', 'forgotten', 'declassified',
    'secrets', 'exposed', 'investigation', 'origins', 'files',
  ];

  for (const word of facelessWords) {
    if (combined.includes(word)) score += 1;
  }

  // ── Negative signals (personal/vlog/entertainment channels) ──
  const personalWords = [
    'vlog', 'my life', 'daily', 'reaction', 'unboxing', 'makeup',
    'hair', 'cooking', 'recipe', 'workout', 'gym', 'gaming',
    'let\'s play', 'girlfriend', 'boyfriend', 'kids', 'family',
    'prank', 'challenge', 'mukbang', 'asmr face', 'try on haul',
  ];

  for (const word of personalWords) {
    if (combined.includes(word)) score -= 3;
  }

  // ── Long-form content is a strong faceless signal ──
  const avgLenMin = videos.length > 0
    ? videos.reduce((sum, v) => sum + v.durationMin, 0) / videos.length
    : 0;

  if (avgLenMin > 20) score += 3;
  if (avgLenMin > 45) score += 2;
  if (avgLenMin > 120) score += 2; // sleep/ambient niche

  // ── Channel name patterns ──
  const namePatterns = [/files$/i, /vault$/i, /chronicle/i, /archive/i, /digest$/i,
    /decoded$/i, /exposed$/i, /untold$/i, /explained$/i, /documentary/i];
  for (const p of namePatterns) {
    if (p.test(title)) { score += 2; break; }
  }

  // ── Very few videos but high views = automation pattern ──
  const videoCount = parseInt(channel.statistics?.videoCount || 0);
  const totalViews = parseInt(channel.statistics?.viewCount || 0);
  if (videoCount > 0 && totalViews / videoCount > 500000) score += 2;

  return Math.max(0, Math.min(10, score));
}

// ─────────────────────────────────────────────────
// SECTION ASSIGNMENT
// ─────────────────────────────────────────────────

/**
 * Assign a channel to the correct dashboard section:
 *   1a  = Vidrush New & Proven
 *   1b  = Vidrush Bend Pool
 *   ma  = Military New & Proven
 *   mb  = Military Bend Pool
 *   2a  = Sleep New & Proven
 *   2b  = Sleep Bend Pool
 *    3  = Overflow
 *
 * Rules match the original WNNR. analyst spec.
 */
function assignSection(nicheSection, ageDays, monthlyViews) {
  if (nicheSection === 'sleep') {
    if (ageDays <= 90 && monthlyViews >= 200000) return '2a';
    if (ageDays <= 120) return '2b';
    return '3';
  }

  if (nicheSection === 'military') {
    if (ageDays <= 60 && monthlyViews >= 500000) return 'ma';
    if (ageDays <= 120) return 'mb';
    return '3';
  }

  // vidrush (finance, history, true crime, business, psychology, ai_tech)
  if (ageDays <= 60 && monthlyViews >= 500000) return '1a';
  if (ageDays <= 120) return '1b';
  return '3';
}

// ─────────────────────────────────────────────────
// RPM + REVENUE ESTIMATE
// ─────────────────────────────────────────────────

/**
 * Estimate monthly revenue from views + RPM.
 * Note: RPM is NOT available via any YouTube API.
 *       These are research-based estimates (same methodology as Nexlev).
 */
function estimateRevenue(monthlyViews, rpm) {
  return Math.round((monthlyViews / 1000) * rpm);
}

// ─────────────────────────────────────────────────
// FORMAT HELPERS
// ─────────────────────────────────────────────────

function formatViews(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

function formatSubs(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

function formatRevenue(n) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n}`;
}

module.exports = {
  parseDurationToMinutes,
  formatDuration,
  getAgeInDays,
  formatAge,
  estimateMonthlyViews,
  calculateOutlierScore,
  scoreFaceless,
  assignSection,
  estimateRevenue,
  formatViews,
  formatSubs,
  formatRevenue,
};
