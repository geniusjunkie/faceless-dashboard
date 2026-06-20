/**
 * youtube.js — YouTube Data API v3 wrapper
 *
 * Wraps the four API endpoints we use.
 * Tracks quota usage so we never accidentally blow through the 10,000 unit/day limit.
 *
 * Quota costs (Google's official pricing):
 *   search.list   → 100 units per call
 *   channels.list →   1 unit per call (up to 50 IDs)
 *   videos.list   →   1 unit per call (up to 50 IDs)
 */

const axios = require('axios');

const BASE = 'https://www.googleapis.com/youtube/v3';
const QUOTA_LIMIT = 9500; // stay under 10,000 with a buffer

class YouTubeAPI {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.quotaUsed = 0;
  }

  _checkQuota(cost) {
    if (this.quotaUsed + cost > QUOTA_LIMIT) {
      throw new Error(`⚠️  Quota limit approached (${this.quotaUsed}/${QUOTA_LIMIT}). Stopping to protect your daily allowance.`);
    }
  }

  async _get(endpoint, params) {
    try {
      const res = await axios.get(`${BASE}/${endpoint}`, {
        params: { ...params, key: this.apiKey },
        timeout: 15000,
      });
      return res.data;
    } catch (err) {
      if (err.response) {
        const msg = err.response.data?.error?.message || 'Unknown API error';
        const code = err.response.status;
        if (code === 403) throw new Error(`API key error (403): ${msg}\nCheck your key is valid and YouTube Data API v3 is enabled.`);
        if (code === 400) throw new Error(`Bad request (400): ${msg}`);
        throw new Error(`YouTube API error ${code}: ${msg}`);
      }
      throw err;
    }
  }

  /**
   * Search for videos by keyword. Returns up to 50 results.
   * Cost: 100 units per call.
   *
   * @param {string} query       - search query
   * @param {string} publishedAfter - ISO 8601 date, e.g. "2026-01-01T00:00:00Z"
   */
  async searchVideos(query, publishedAfter) {
    this._checkQuota(100);
    this.quotaUsed += 100;
    return this._get('search', {
      part: 'snippet',
      type: 'video',
      q: query,
      maxResults: 50,
      order: 'viewCount',
      relevanceLanguage: 'en',
      publishedAfter,
      videoEmbeddable: true,
    });
  }

  /**
   * Get channel statistics + snippet for up to 50 channel IDs.
   * Cost: 1 unit per call.
   *
   * @param {string[]} channelIds
   */
  async getChannels(channelIds) {
    this._checkQuota(1);
    this.quotaUsed += 1;
    return this._get('channels', {
      part: 'snippet,statistics,brandingSettings',
      id: channelIds.join(','),
      maxResults: 50,
    });
  }

  /**
   * Get top videos for a single channel (by view count).
   * Cost: 100 units per call.
   *
   * @param {string} channelId
   * @param {number} maxResults  - how many videos to return (max 50)
   */
  async getChannelTopVideos(channelId, maxResults = 5) {
    this._checkQuota(100);
    this.quotaUsed += 100;
    return this._get('search', {
      part: 'snippet',
      channelId,
      type: 'video',
      order: 'viewCount',
      maxResults,
    });
  }

  /**
   * Get video statistics + duration for up to 50 video IDs.
   * Cost: 1 unit per call.
   *
   * @param {string[]} videoIds
   */
  async getVideoStats(videoIds) {
    this._checkQuota(1);
    this.quotaUsed += 1;
    return this._get('videos', {
      part: 'statistics,contentDetails',
      id: videoIds.join(','),
    });
  }

  get quotaSummary() {
    return `${this.quotaUsed} / ${QUOTA_LIMIT} units used`;
  }
}

module.exports = YouTubeAPI;
