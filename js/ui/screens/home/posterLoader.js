const MAX_CONCURRENT = 6;
const TMDB_POSTER_RE = /\/image\.tmdb\.org\/t\/p\/(?:original|w\d+)\//;
const MARGIN_X = 600;
const MARGIN_Y = 200;

let activeLoads = 0;
let loadGeneration = 0;
const queue = [];
let observer = null;

function isConnected(img) {
  // Node.isConnected not available before Chrome 51 (webOS 3 = Chrome 38)
  return typeof img.isConnected === "boolean" ? img.isConnected : document.body.contains(img);
}

function processQueue() {
  while (activeLoads < MAX_CONCURRENT && queue.length > 0) {
    const img = queue.shift();
    if (!isConnected(img)) continue;
    const src = img.dataset.posterSrc;
    if (!src) continue;
    activeLoads++;
    const gen = loadGeneration;
    const done = () => {
      if (loadGeneration === gen && activeLoads > 0) activeLoads--;
      processQueue();
    };
    img.onload = done;
    img.onerror = done;
    img.src = src;
  }
}

function isNearViewport(img) {
  const rect = img.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return true; // layout not ready — load eagerly
  const vw = window.innerWidth || 1920;
  const vh = window.innerHeight || 1080;
  return rect.bottom >= -MARGIN_Y && rect.top <= vh + MARGIN_Y &&
         rect.right >= -MARGIN_X && rect.left <= vw + MARGIN_X;
}

function getObserver() {
  if (!observer && typeof IntersectionObserver !== "undefined") {
    observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        observer.unobserve(entry.target);
        queue.push(entry.target);
      });
      processQueue();
    }, {
      rootMargin: `${MARGIN_Y}px ${MARGIN_X}px ${MARGIN_Y}px ${MARGIN_X}px`,
      threshold: 0
    });
  }
  return observer;
}

// Call before a full-page render to discard stale load state. Do NOT call
// from track pagination — that would break in-flight loads for other rows.
export function resetPosterLoader() {
  loadGeneration++;
  queue.length = 0;
  activeLoads = 0;
  if (observer) {
    observer.disconnect();
    observer = null;
  }
}

export function observePosterImages(container) {
  const obs = getObserver();
  container.querySelectorAll("img[data-poster-src]").forEach((img) => {
    if (!obs || isNearViewport(img)) {
      queue.push(img);
    } else {
      obs.observe(img);
    }
  });
  processQueue();
}

export function unobservePosterImages(container) {
  if (!observer) return;
  container.querySelectorAll("img[data-poster-src]").forEach((img) => observer.unobserve(img));
}

export function optimizePosterUrl(url) {
  if (!url) return url;
  if (TMDB_POSTER_RE.test(url)) {
    return url.replace(TMDB_POSTER_RE, "/image.tmdb.org/t/p/w342/");
  }
  return url;
}
