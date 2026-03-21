import { TRAILER_API_URL } from "../../config.js";

const CACHE = new Map();

function normalizeBaseUrl(value = "") {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }
  return normalized.endsWith("/") ? normalized : `${normalized}/`;
}

function resolveYoutubeId(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  const directMatch = raw.match(/^[A-Za-z0-9_-]{11}$/);
  if (directMatch) {
    return directMatch[0];
  }
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtube\.com\/embed\/|youtu\.be\/)([A-Za-z0-9_-]{11})/i,
    /(?:youtube\.com\/shorts\/)([A-Za-z0-9_-]{11})/i
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }
  return "";
}

function scoreTrailerStream(entry = {}) {
  const text = [
    entry?.quality,
    entry?.label,
    entry?.name,
    entry?.title,
    entry?.description,
    entry?.resolution
  ].map((value) => String(value || "")).join(" ").toLowerCase();
  const width = Number(entry?.width || 0);
  const height = Number(entry?.height || entry?.resolutionHeight || 0);
  const bitrate = Number(entry?.bitrate || 0);
  let score = 0;

  if (width >= 3840 || height >= 2160 || /2160|4k|uhd/.test(text)) score += 120;
  else if (width >= 2560 || height >= 1440 || /1440|2k|qhd/.test(text)) score += 90;
  else if (width >= 1920 || height >= 1080 || /1080|full\s*hd|fhd/.test(text)) score += 70;
  else if (width >= 1280 || height >= 720 || /720|hd\b/.test(text)) score += 45;
  else if (width > 0 || height > 0) score += 20;

  score += Math.max(0, Math.min(20, Math.round(bitrate / 500000)));

  if (/hdr|dolby/.test(text)) score += 8;
  if (/hevc|h265|av1/.test(text)) score += 6;

  return score;
}

function extractDirectTrailerSource(meta = {}) {
  const trailerStreams = Array.isArray(meta?.trailerStreams) ? meta.trailerStreams : [];
  const directVideo = trailerStreams
    .filter((entry) => {
      const url = String(entry?.url || entry?.videoUrl || entry?.stream || "").trim();
      return /^https?:\/\//i.test(url);
    })
    .sort((left, right) => scoreTrailerStream(right) - scoreTrailerStream(left))[0];
  if (!directVideo) {
    return null;
  }
  const audioUrl = String(directVideo.audioUrl || directVideo.audio_url || "").trim();
  return {
    kind: "video",
    url: String(directVideo.url || directVideo.videoUrl || directVideo.stream || "").trim(),
    audioUrl: audioUrl || null
  };
}

function extractYoutubeCandidates(meta = {}) {
  const candidates = [];
  const pushCandidate = (value) => {
    const ytId = resolveYoutubeId(value);
    if (!ytId || candidates.includes(ytId)) {
      return;
    }
    candidates.push(ytId);
  };

  const trailerCandidates = [
    ...(Array.isArray(meta?.trailers) ? meta.trailers : []),
    ...(Array.isArray(meta?.videos) ? meta.videos : [])
  ];
  trailerCandidates.forEach((entry) => {
    pushCandidate(entry?.ytId || entry?.youtubeId || entry?.source || entry?.url || entry?.link || "");
  });
  (Array.isArray(meta?.trailerYtIds) ? meta.trailerYtIds : []).forEach(pushCandidate);
  return candidates;
}

async function fetchTrailerSourceFromApi(youtubeUrl, title, year, timeoutMs = 5000) {
  const baseUrl = normalizeBaseUrl(TRAILER_API_URL);
  if (!baseUrl || !youtubeUrl) {
    return null;
  }

  const url = new URL("trailer", baseUrl);
  url.searchParams.set("youtube_url", youtubeUrl);
  if (title) {
    url.searchParams.set("title", String(title));
  }
  if (year) {
    url.searchParams.set("year", String(year));
  }

  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      signal: controller?.signal
    });
    if (!response.ok) {
      return null;
    }
    const payload = await response.json();
    const videoUrl = String(payload?.url || payload?.videoUrl || payload?.video_url || "").trim();
    const audioUrl = String(payload?.audioUrl || payload?.audio_url || "").trim();
    if (!/^https?:\/\//i.test(videoUrl)) {
      return null;
    }
    return {
      kind: "video",
      url: videoUrl,
      audioUrl: /^https?:\/\//i.test(audioUrl) ? audioUrl : null
    };
  } catch (_) {
    return null;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export const TrailerService = {

  async getPlaybackSource(meta = {}, { title = "", year = "" } = {}) {
    const directSource = extractDirectTrailerSource(meta);
    if (directSource) {
      return directSource;
    }

    const youtubeCandidates = extractYoutubeCandidates(meta);
    for (const ytId of youtubeCandidates) {
      const cacheKey = `${ytId}::${String(title || "").trim()}::${String(year || "").trim()}`;
      if (CACHE.has(cacheKey)) {
        const cached = CACHE.get(cacheKey);
        if (cached) {
          return cached;
        }
        continue;
      }
      const youtubeUrl = `https://www.youtube.com/watch?v=${ytId}`;
      const source = await fetchTrailerSourceFromApi(youtubeUrl, title, year);
      CACHE.set(cacheKey, source || null);
      if (source) {
        return source;
      }
    }

    return null;
  }

};
