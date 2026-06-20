# WNNR. Crawler — Free Nexlev Alternative

Uses the **free YouTube Data API v3** to find new faceless channels, score them, and automatically update the dashboard. No Nexlev subscription needed.

---

## How It Works

```
Search YouTube → Filter by age & views → Score channels → Update index.html → Push to Render
```

It mimics what Nexlev does under the hood — the same underlying data source (YouTube's API), just built yourself.

---

## Step 1 — Get Your Free API Key (5 minutes)

1. Go to **[console.cloud.google.com](https://console.cloud.google.com)**
2. Click **"New Project"** → name it anything (e.g. `faceless-crawler`)
3. In the top search bar, type **"YouTube Data API v3"** → click it → click **Enable**
4. In the left menu: **APIs & Services → Credentials → Create Credentials → API Key**
5. Copy the key (starts with `AIza...`)

> **Quota:** Free tier gives **10,000 units/day**. Each crawler run uses ~5,000 units, so you can run it twice daily for free.

---

## Step 2 — Setup

```bash
cd crawler
npm install
cp .env.example .env
```

Open `.env` and paste your API key:
```
YOUTUBE_API_KEY=AIzaSy...your-key-here
```

---

## Step 3 — Run

```bash
# Full crawl + update index.html
npm run crawl

# Preview results without changing any files
npm run crawl:dry

# Re-generate index.html from last crawl (no API calls)
npm run generate
```

---

## Step 4 — Publish to Your Live Site

After a successful crawl, push the updated `index.html` to trigger a Render auto-deploy:

```bash
cd ..
git add index.html
git commit -m "Update: crawler run $(date +%Y-%m-%d)"
git push
```

Render deploys automatically within ~30 seconds.

**Or set `AUTO_PUSH=true` in your `.env`** to have the crawler do this automatically.

---

## Run on a Schedule (Mac)

To run the crawler automatically every day at 7am:

```bash
# Open crontab
crontab -e

# Add this line (update the path to match yours):
0 7 * * * cd "/Users/admin/Downloads/CHANNEL MODELS/faceless-dashboard/crawler" && npm run crawl >> crawler.log 2>&1
```

Save and exit. The crawler will now run every morning and update the live site automatically.

---

## Configuration (`.env`)

| Variable | Default | Description |
|---|---|---|
| `YOUTUBE_API_KEY` | *(required)* | Your Google API key |
| `MAX_CHANNEL_AGE_DAYS` | `120` | Only surface channels created in this window |
| `MIN_MONTHLY_VIEWS` | `50000` | Minimum estimated 30d views to appear in dashboard |
| `AUTO_PUSH` | `false` | Auto git push after each run |

---

## Adding / Changing Niches

Edit `niches.js`. Each niche has:

```js
{
  id: 'my_niche',
  label: 'My Niche Display Name',
  section: 'vidrush',       // 'vidrush', 'military', or 'sleep'
  keywords: [
    'search query 1',       // YouTube search terms to find channels
    'search query 2',
  ],
  rpm: { min: 8, max: 14, median: 10 },  // estimated RPM in USD
  minLenMin: 18,            // minimum video length in minutes
  maxLenMin: 45,            // maximum video length in minutes
}
```

---

## How It Differs from Nexlev

| Feature | Nexlev | This Crawler |
|---|---|---|
| Data source | YouTube API (same) | YouTube API (same) |
| Subscriber counts | Real, live | Real, live ✅ |
| View counts | Real, live | Real, live ✅ |
| Video thumbnails | Real | Real ✅ |
| RPM estimates | Their proprietary model | Research-based estimate (same methodology) |
| Monetisation status | Estimated | Estimated (not in YouTube API) |
| Faceless detection | ML classifier | Keyword heuristic (good approximation) |
| Outlier score | Proprietary formula | `topVideoViews ÷ avgVideoViews` |
| Pre-built database | Yes (search is instant) | No (you run on demand) |
| Cost | ~$97/month | **Free** |

---

## Output Files

| File | Description |
|---|---|
| `../index.html` | Updated with real channel data |
| `last_run.json` | Raw crawl results (not committed to git) |
| `crawler.log` | Log output (if running via cron) |
