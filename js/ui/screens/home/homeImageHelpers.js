import { uniqueNonEmptyValues } from "./homeUtils.js";

function normalizeHeroBackdropSource(source) {
  const value = String(source || "").trim();
  if (!value) {
    return "";
  }
  // Continue Watching artwork is cached for up to 14 days. Upgrade only the
  // old TMDB backdrop size so existing installs benefit without flushing the
  // rest of the cache or increasing poster/episode-thumbnail payloads.
  return value.replace(/(\/t\/p\/)w780\//i, "$1w1280/");
}

/**
 * Builds the ordered list of image candidates used by hero, poster and continue-watching cards.
 * @param {import("./homeTypes.js").HomeMediaSourceLike | null | undefined} item
 * @returns {string[]}
 */
export function buildHeroBackdropSources(item = null) {
  return uniqueNonEmptyValues([
    normalizeHeroBackdropSource(item?.background),
    normalizeHeroBackdropSource(item?.backdrop),
    normalizeHeroBackdropSource(item?.backdropUrl),
    normalizeHeroBackdropSource(item?.landscapePoster),
    item?.poster,
    item?.thumbnail,
    item?.episodeThumbnail
  ]);
}

export function encodeHeroBackdropFallbacks(sources = []) {
  return sources.map((source) => encodeURIComponent(source)).join("|");
}

export function buildImageFallbackErrorHandler() {
  return "var q=(this.dataset.fallbackSrcs||'').split('|').filter(Boolean);var next=q.shift();if(next){this.dataset.fallbackSrcs=q.join('|');this.src=decodeURIComponent(next);return;}this.removeAttribute('src');this.classList.add('placeholder');";
}
