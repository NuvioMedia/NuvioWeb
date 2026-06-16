/*
 * Nuvio service worker.
 *
 * Goals:
 *   - Make the app installable and launchable offline (cached app shell).
 *   - Keep the SPA fresh: HTML is fetched network-first so a new release's
 *     bundle/CSS query strings are picked up as soon as the device is online.
 *   - Never get in the way of playback or runtime config: media/range requests
 *     and the generated env script are always passed straight to the network.
 *
 * This worker is only registered in the browser build. TV builds (Tizen/webOS)
 * run from a packaged container and never reach this file.
 */

var CACHE_VERSION = "nuvio-pwa-v1";
var SHELL_CACHE = CACHE_VERSION + "-shell";
var RUNTIME_CACHE = CACHE_VERSION + "-runtime";

// Stable, low-churn resources worth having before the first offline launch.
// Hashed/queried assets (the JS bundle, CSS) are picked up at runtime instead,
// so a precache miss here never blocks installation.
var SHELL_ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./assets/brand/app_logo_wordmark.png",
  "./assets/brand/app_logo_mark.png",
  "./assets/pwa/icon-192.png",
  "./assets/pwa/icon-512.png",
  "./assets/pwa/apple-touch-icon.png"
];

// Paths that must always hit the network — runtime config and media transport.
var NETWORK_ONLY_PATHS = ["/nuvio.env.js", "/settings", "/tracks/"];

var FONT_ORIGINS = ["https://fonts.googleapis.com", "https://fonts.gstatic.com"];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(function (cache) {
      // Add assets individually so one 404 doesn't abort the whole install.
      return Promise.all(
        SHELL_ASSETS.map(function (asset) {
          return cache.add(asset).catch(function () {
            return null;
          });
        })
      );
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (keys) {
        return Promise.all(
          keys.map(function (key) {
            if (key !== SHELL_CACHE && key !== RUNTIME_CACHE) {
              return caches.delete(key);
            }
            return null;
          })
        );
      })
      .then(function () {
        return self.clients.claim();
      })
  );
});

// Allow the page to trigger an immediate update once a new worker is waiting.
self.addEventListener("message", function (event) {
  if (event.data === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

function isNetworkOnly(url) {
  for (var i = 0; i < NETWORK_ONLY_PATHS.length; i += 1) {
    if (url.pathname === NETWORK_ONLY_PATHS[i] || url.pathname.indexOf(NETWORK_ONLY_PATHS[i]) === 0) {
      return true;
    }
  }
  return false;
}

function isFontRequest(url) {
  return FONT_ORIGINS.indexOf(url.origin) !== -1;
}

function networkFirstHTML(request) {
  return fetch(request)
    .then(function (response) {
      if (response && response.ok) {
        var copy = response.clone();
        caches.open(SHELL_CACHE).then(function (cache) {
          cache.put("./index.html", copy);
        });
      }
      return response;
    })
    .catch(function () {
      return caches.match("./index.html").then(function (cached) {
        return cached || caches.match("./");
      });
    });
}

function staleWhileRevalidate(request, cacheName) {
  return caches.open(cacheName).then(function (cache) {
    return cache.match(request).then(function (cached) {
      var network = fetch(request)
        .then(function (response) {
          if (response && (response.ok || response.type === "opaque")) {
            cache.put(request, response.clone());
          }
          return response;
        })
        .catch(function () {
          return cached;
        });
      return cached || network;
    });
  });
}

self.addEventListener("fetch", function (event) {
  var request = event.request;

  if (request.method !== "GET") {
    return;
  }

  // Range requests (video seeking) must never be served from the cache.
  if (request.headers.has("range")) {
    return;
  }

  var url;
  try {
    url = new URL(request.url);
  } catch (error) {
    return;
  }

  if (isFontRequest(url)) {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
    return;
  }

  // Leave all other cross-origin traffic (addons, TMDB, Supabase, streams) alone.
  if (url.origin !== self.location.origin) {
    return;
  }

  if (isNetworkOnly(url)) {
    return;
  }

  var isNavigation =
    request.mode === "navigate" ||
    (request.headers.get("accept") || "").indexOf("text/html") !== -1;

  if (isNavigation) {
    event.respondWith(networkFirstHTML(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
});
