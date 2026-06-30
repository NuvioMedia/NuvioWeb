const KEEP_AWAKE_REFRESH_MS = 60000;

const keepAwakeBindings = new WeakMap();

function setScreenSaverBlocked(blocked) {
  const webOSSystem = globalThis.webOSSystem || globalThis.PalmSystem || null;
  if (!webOSSystem || typeof webOSSystem.setWindowProperty !== "function") {
    return false;
  }
  try {
    webOSSystem.setWindowProperty("blockScreenSaver", blocked ? "true" : "false");
    return true;
  } catch (_) {
    return false;
  }
}

function isVideoActivelyPlaying(videoElement) {
  return Boolean(
    videoElement
    && !videoElement.paused
    && !videoElement.ended
    && Number(videoElement.readyState || 0) > 0
  );
}

function bindWebOsPlaybackKeepAwake(videoElement) {
  if (!videoElement || keepAwakeBindings.has(videoElement)) {
    return;
  }

  let blocked = false;
  let refreshTimer = null;
  let wakeLock = null;

  const releaseWakeLock = () => {
    const lock = wakeLock;
    wakeLock = null;
    if (lock && typeof lock.release === "function") {
      lock.release().catch(() => null);
    }
  };

  const requestWakeLock = () => {
    if (wakeLock || !globalThis.navigator?.wakeLock?.request) {
      return;
    }
    globalThis.navigator.wakeLock.request("screen")
      .then((lock) => {
        wakeLock = lock;
        lock.addEventListener?.("release", () => {
          if (wakeLock === lock) {
            wakeLock = null;
          }
        });
      })
      .catch(() => {
        wakeLock = null;
      });
  };

  const refresh = () => {
    if (!isVideoActivelyPlaying(videoElement)) {
      stop();
      return;
    }
    setScreenSaverBlocked(true);
    requestWakeLock();
  };

  const start = () => {
    if (!isVideoActivelyPlaying(videoElement)) {
      stop();
      return;
    }
    if (!blocked) {
      blocked = true;
      setScreenSaverBlocked(true);
      requestWakeLock();
    }
    if (!refreshTimer) {
      refreshTimer = setInterval(refresh, KEEP_AWAKE_REFRESH_MS);
    }
  };

  function stop() {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
    if (blocked) {
      blocked = false;
      setScreenSaverBlocked(false);
    }
    releaseWakeLock();
  }

  const sync = () => {
    if (isVideoActivelyPlaying(videoElement)) {
      start();
    } else {
      stop();
    }
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") {
      sync();
    } else {
      stop();
    }
  };

  ["playing", "play", "timeupdate", "seeked", "ratechange"].forEach((eventName) => {
    videoElement.addEventListener(eventName, sync);
  });
  ["pause", "ended", "emptied", "abort", "error"].forEach((eventName) => {
    videoElement.addEventListener(eventName, stop);
  });
  document.addEventListener("visibilitychange", onVisibilityChange);

  keepAwakeBindings.set(videoElement, { stop });
}

export const WebOSPlayerExtensions = {
  apply(videoElement) {
    if (!videoElement) {
      return;
    }

    videoElement.setAttribute("playsinline", "");
    videoElement.setAttribute("webkit-playsinline", "");
    videoElement.setAttribute("preload", "auto");
    bindWebOsPlaybackKeepAwake(videoElement);
  }
};
