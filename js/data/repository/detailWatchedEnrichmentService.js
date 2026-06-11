import { watchedItemsRepository } from "./watchedItemsRepository.js";
import { watchProgressRepository } from "./watchProgressRepository.js";
import { TraktAuthService } from "./traktAuthService.js";
import { ProfileManager } from "../../core/profile/profileManager.js";

const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE = new Map();

function buildCacheKey(contentId, traktId) {
  const profileId = ProfileManager.getActiveProfileId() || "default";
  return `${profileId}:${contentId}:${traktId}`;
}

function getCachedEntry(cacheKey) {
  const entry = CACHE.get(cacheKey);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    CACHE.delete(cacheKey);
    return null;
  }
  return entry.value;
}

function setCachedEntry(cacheKey, value) {
  CACHE.set(cacheKey, {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS
  });
}

function buildEpisodeKey(season, episode) {
  return `${season}:${episode}`;
}

function parseWatchedAt(watchedAtValue) {
  if (!watchedAtValue) return null;
  if (typeof watchedAtValue === "number") return watchedAtValue;
  const parsed = Date.parse(watchedAtValue);
  return Number.isNaN(parsed) ? null : parsed;
}

async function fetchLocalWatchedMap(contentId) {
  const allWatched = await watchedItemsRepository.getAll();
  const watchedMap = new Map();
  
  for (const item of allWatched) {
    if (item.contentId !== contentId) continue;
    if (item.contentType === "series" && item.season != null && item.episode != null) {
      const key = buildEpisodeKey(item.season, item.episode);
      watchedMap.set(key, {
        isWatched: true,
        watchedAt: item.watchedAt || null,
        source: "local"
      });
    } else if (item.contentType === "movie") {
      watchedMap.set("movie", {
        isWatched: true,
        watchedAt: item.watchedAt || null,
        source: "local"
      });
    }
  }
  
  return watchedMap;
}

async function fetchProgressWatchedMap(contentId) {
  const allProgress = await watchProgressRepository.getAll();
  const progressMap = new Map();
  
  for (const progress of allProgress) {
    if (progress.contentId !== contentId) continue;
    const fraction = Number(progress.durationMs || 0) > 0
      ? Number(progress.positionMs || 0) / Number(progress.durationMs || 0)
      : 0;
    
    if (fraction >= 1.0 && progress.videoId) {
      const videoIdParts = progress.videoId.split(":");
      if (videoIdParts.length >= 3) {
        const season = parseInt(videoIdParts[1], 10);
        const episode = parseInt(videoIdParts[2], 10);
        if (!Number.isNaN(season) && !Number.isNaN(episode)) {
          const key = buildEpisodeKey(season, episode);
          progressMap.set(key, {
            isWatched: true,
            watchedAt: progress.updatedAt || null,
            source: "progress"
          });
        }
      }
    } else if (fraction >= 1.0 && progress.contentType === "movie") {
      progressMap.set("movie", {
        isWatched: true,
        watchedAt: progress.updatedAt || null,
        source: "progress"
      });
    }
  }
  
  return progressMap;
}

async function fetchTraktSeriesWatchedMap(showTraktId) {
  if (!showTraktId) return new Map();
  
  const isAuthenticated = await TraktAuthService.isAuthenticated();
  if (!isAuthenticated) return new Map();
  
  try {
    const watchedMap = await TraktAuthService.fetchWatchedProgress(showTraktId);
    return watchedMap || new Map();
  } catch (error) {
    console.warn("[detailWatchedEnrichmentService] Failed to fetch Trakt series progress", error);
    return new Map();
  }
}

async function fetchTraktMovieWatchedState(movieTraktId) {
  if (!movieTraktId) return null;
  
  const isAuthenticated = await TraktAuthService.isAuthenticated();
  if (!isAuthenticated) return null;
  
  try {
    const watchedMovies = await TraktAuthService.fetchWatchedMovies();
    const watchedMovie = watchedMovies.find(movie => movie.traktId === movieTraktId);
    
    if (watchedMovie) {
      return {
        isWatched: true,
        watchedAt: watchedMovie.watchedAt || null,
        source: "trakt"
      };
    }
    
    return null;
  } catch (error) {
    console.warn("[detailWatchedEnrichmentService] Failed to fetch Trakt movie watched state", error);
    return null;
  }
}

function mergeWatchedStates(localMap, progressMap, traktMap) {
  const mergedMap = new Map();
  const allKeys = new Set([...localMap.keys(), ...progressMap.keys(), ...traktMap.keys()]);
  
  for (const key of allKeys) {
    const localState = localMap.get(key);
    const progressState = progressMap.get(key);
    const traktState = traktMap.get(key);
    
    if (localState) {
      mergedMap.set(key, localState);
    } else if (progressState) {
      mergedMap.set(key, progressState);
    } else if (traktState) {
      mergedMap.set(key, traktState);
    }
  }
  
  return mergedMap;
}

export const detailWatchedEnrichmentService = {
  async enrichSeriesWatchedState(episodes, contentId, showTraktId) {
    if (!contentId) return new Map();
    
    const cacheKey = buildCacheKey(contentId, showTraktId || "none");
    const cached = getCachedEntry(cacheKey);
    if (cached) return cached;
    
    const [localMap, progressMap, traktMap] = await Promise.all([
      fetchLocalWatchedMap(contentId),
      fetchProgressWatchedMap(contentId),
      fetchTraktSeriesWatchedMap(showTraktId)
    ]);
    
    const mergedMap = mergeWatchedStates(localMap, progressMap, traktMap);
    setCachedEntry(cacheKey, mergedMap);
    
    return mergedMap;
  },

  async enrichMovieWatchedState(contentId, movieTraktId) {
    if (!contentId) return null;
    
    const cacheKey = buildCacheKey(contentId, movieTraktId || "none");
    const cached = getCachedEntry(cacheKey);
    if (cached) return cached;
    
    const [localMap, progressMap] = await Promise.all([
      fetchLocalWatchedMap(contentId),
      fetchProgressWatchedMap(contentId)
    ]);
    
    const localState = localMap.get("movie");
    const progressState = progressMap.get("movie");
    
    if (localState) {
      setCachedEntry(cacheKey, localState);
      return localState;
    }
    
    if (progressState) {
      setCachedEntry(cacheKey, progressState);
      return progressState;
    }
    
    const traktState = await fetchTraktMovieWatchedState(movieTraktId);
    if (traktState) {
      setCachedEntry(cacheKey, traktState);
      return traktState;
    }
    
    const unwatchedState = {
      isWatched: false,
      watchedAt: null,
      source: "local"
    };
    setCachedEntry(cacheKey, unwatchedState);
    return unwatchedState;
  },

  invalidateCache(contentId) {
    if (!contentId) return;
    const profileId = ProfileManager.getActiveProfileId() || "default";
    for (const [key] of CACHE) {
      if (key.startsWith(`${profileId}:${contentId}:`)) {
        CACHE.delete(key);
      }
    }
  },

  invalidateAllCache() {
    CACHE.clear();
  }
};
