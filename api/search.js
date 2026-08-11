/**
 * Smart Search Engine - /api/search
 *
 * Vercel Serverless Function.
 *
 * Required environment variables:
 *   SEARCH_PROVIDER=brave        # or bing
 *   SEARCH_API_KEY=...
 *
 * Optional:
 *   SEARCH_ENDPOINT=...
 *   YOUTUBE_API_KEY=...
 *   MAX_RESULTS=50
 *
 * The endpoint accepts:
 *   /api/search?q=...
 *   /api/search?q=...&minDuration=5&maxDuration=60
 *   /api/search?q=...&fromDate=2025-01-01&toDate=2026-12-31
 *
 * It returns a normalized array under { results: [...] }.
 *
 * Important:
 * This is a web-search aggregation layer, not a crawler of the entire
 * internet. It searches sources that permit access through their APIs.
 */

const DEFAULT_MAX_RESULTS = 50;

function json(res, status, body) {
  res.status(status).setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json(body);
}

function clean(value, max = 5000) {
  return String(value ?? "").trim().slice(0, max);
}

function durationToMinutes(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;

  const s = String(value).trim();

  const iso = s.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
  if (iso) {
    return (Number(iso[1] || 0) * 60) +
           Number(iso[2] || 0) +
           Number(iso[3] || 0) / 60;
  }

  const clock = s.match(/^(\d+):(\d+)(?::(\d+))?$/);
  if (clock) {
    if (clock[3] !== undefined) {
      return Number(clock[1]) * 60 + Number(clock[2]) + Number(clock[3]) / 60;
    }
    return Number(clock[1]) + Number(clock[2]) / 60;
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function extractDate(value) {
  const s = clean(value, 100);
  if (!s) return "";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

function normalizeResult(item, fallbackSource = "Web Search") {
  return {
    title: clean(item.title || item.name || "بدون عنوان", 500),
    url: clean(item.url || item.link || "", 2000),
    thumbnail: clean(
      item.thumbnail ||
      item.thumbnailUrl ||
      item.image ||
      item.image_url ||
      "",
      2000
    ),
    source: clean(item.source || item.site_name || fallbackSource, 200),
    date: extractDate(item.date || item.publishedAt || item.uploadDate || item.upload_date),
    duration: durationToMinutes(item.duration),
    description: clean(item.description || item.snippet || item.text || "", 2000)
  };
}

function uniqueByUrl(results) {
  const seen = new Set();
  return results.filter(r => {
    if (!r.url) return true;
    const key = r.url.toLowerCase().replace(/\/+$/, "");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function applyFilters(results, query) {
  const min = query.minDuration !== "" ? Number(query.minDuration) : null;
  const max = query.maxDuration !== "" ? Number(query.maxDuration) : null;
  const from = query.fromDate ? new Date(query.fromDate + "T00:00:00") : null;
  const to = query.toDate ? new Date(query.toDate + "T23:59:59") : null;

  return results.filter(r => {
    if (min !== null && Number.isFinite(min) && r.duration > 0 && r.duration < min) return false;
    if (max !== null && Number.isFinite(max) && r.duration > max) return false;

    if (from && r.date) {
      const d = new Date(r.date);
      if (!Number.isNaN(d.getTime()) && d < from) return false;
    }

    if (to && r.date) {
      const d = new Date(r.date);
      if (!Number.isNaN(d.getTime()) && d > to) return false;
    }

    return true;
  });
}

function buildSearchQuery(q) {
  // The user is looking for videos. This improves discovery while still
  // allowing the web search provider to return results from many domains.
  return `${q} (video OR فيديو)`;
}

async function searchBrave(q, maxResults) {
  const key = process.env.SEARCH_API_KEY;
  if (!key) throw new Error("SEARCH_API_KEY is not configured.");

  const endpoint = process.env.SEARCH_ENDPOINT || "https://api.search.brave.com/res/v1/web/search";

  const url = new URL(endpoint);
  url.searchParams.set("q", buildSearchQuery(q));
  url.searchParams.set("count", String(Math.min(maxResults, 20)));
  url.searchParams.set("safesearch", "moderate");

  const response = await fetch(url, {
    headers: {
      "Accept": "application/json",
      "X-Subscription-Token": key
    }
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.message || `Brave Search HTTP ${response.status}`);
  }

  const items = data?.web?.results || [];

  return items.map(item => normalizeResult({
    title: item.title,
    url: item.url,
    description: item.description,
    source: (() => {
      try { return new URL(item.url).hostname; }
      catch { return "Web Search"; }
    })()
  }, "Web Search"));
}

async function searchBing(q, maxResults) {
  const key = process.env.SEARCH_API_KEY;
  if (!key) throw new Error("SEARCH_API_KEY is not configured.");

  const endpoint = process.env.SEARCH_ENDPOINT ||
    "https://api.bing.microsoft.com/v7.0/search";

  const url = new URL(endpoint);
  url.searchParams.set("q", buildSearchQuery(q));
  url.searchParams.set("count", String(Math.min(maxResults, 50)));
  url.searchParams.set("responseFilter", "Webpages");

  const response = await fetch(url, {
    headers: {
      "Accept": "application/json",
      "Ocp-Apim-Subscription-Key": key
    }
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error?.message || `Bing Search HTTP ${response.status}`);
  }

  const items = data?.webPages?.value || [];

  return items.map(item => normalizeResult({
    title: item.name,
    url: item.url,
    description: item.snippet,
    source: (() => {
      try { return new URL(item.url).hostname; }
      catch { return "Web Search"; }
    })()
  }, "Web Search"));
}

async function searchYouTube(q, maxResults) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return [];

  const searchUrl = new URL("https://www.googleapis.com/youtube/v3/search");
  searchUrl.searchParams.set("part", "snippet");
  searchUrl.searchParams.set("q", q);
  searchUrl.searchParams.set("type", "video");
  searchUrl.searchParams.set("maxResults", String(Math.min(maxResults, 50)));
  searchUrl.searchParams.set("key", key);

  const response = await fetch(searchUrl);
  const data = await response.json();

  if (!response.ok || data.error) {
    throw new Error(data?.error?.message || `YouTube HTTP ${response.status}`);
  }

  const ids = (data.items || [])
    .map(x => x.id?.videoId)
    .filter(Boolean);

  if (!ids.length) return [];

  const detailsUrl = new URL("https://www.googleapis.com/youtube/v3/videos");
  detailsUrl.searchParams.set("part", "snippet,contentDetails");
  detailsUrl.searchParams.set("id", ids.join(","));
  detailsUrl.searchParams.set("key", key);

  const detailsResponse = await fetch(detailsUrl);
  const details = await detailsResponse.json();

  if (!detailsResponse.ok || details.error) {
    throw new Error(details?.error?.message || `YouTube details HTTP ${detailsResponse.status}`);
  }

  return (details.items || []).map(item => normalizeResult({
    title: item.snippet?.title,
    url: `https://www.youtube.com/watch?v=${item.id}`,
    thumbnail:
      item.snippet?.thumbnails?.high?.url ||
      item.snippet?.thumbnails?.medium?.url ||
      item.snippet?.thumbnails?.default?.url ||
      "",
    source: "YouTube",
    date: item.snippet?.publishedAt,
    duration: item.contentDetails?.duration,
    description: item.snippet?.description
  }, "YouTube"));
}

async function handler(req, res) {
  if (req.method !== "GET") {
    return json(res, 405, {
      error: "Method not allowed",
      message: "Use GET /api/search?q=..."
    });
  }

  const q = clean(req.query?.q, 500);

  if (!q) {
    return json(res, 400, {
      error: "Missing query",
      message: "أرسل كلمة البحث في المعامل q."
    });
  }

  const maxResults = Math.max(
    1,
    Math.min(
      Number(req.query?.maxResults || process.env.MAX_RESULTS || DEFAULT_MAX_RESULTS),
      100
    )
  );

  const provider = clean(
    process.env.SEARCH_PROVIDER || "brave",
    30
  ).toLowerCase();

  const errors = [];
  let results = [];

  try {
    if (provider === "bing") {
      results.push(...await searchBing(q, maxResults));
    } else {
      results.push(...await searchBrave(q, maxResults));
    }
  } catch (error) {
    errors.push(`web:${error.message}`);
  }

  // YouTube is optional. If its key is absent, it is simply skipped.
  try {
    results.push(...await searchYouTube(q, maxResults));
  } catch (error) {
    errors.push(`youtube:${error.message}`);
  }

  results = uniqueByUrl(results);
  results = applyFilters(results, req.query || {});

  return json(res, 200, {
    query: q,
    provider,
    total: results.length,
    warnings: errors,
    results
  });
}

module.exports = handler;
