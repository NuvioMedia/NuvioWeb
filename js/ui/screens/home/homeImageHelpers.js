import { uniqueNonEmptyValues } from "./homeUtils.js";

/**
 * Builds the ordered list of image candidates used by hero, poster and continue-watching cards.
 * @param {import("./homeTypes.js").HomeMediaSourceLike | null | undefined} item
 * @returns {string[]}
 */
export function buildHeroBackdropSources(item = null) {
  return uniqueNonEmptyValues([
    item?.background,
    item?.backdrop,
    item?.backdropUrl,
    item?.landscapePoster,
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
