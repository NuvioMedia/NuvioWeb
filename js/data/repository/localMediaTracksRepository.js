import { Platform } from "../../platform/index.js";
import { WebOsLunaService } from "../../platform/webos/webosLunaService.js";

const LOCAL_MEDIA_SERVER_PORT_CANDIDATES = [2710, 2711, 2712, 2713, 2714];
const REQUEST_TIMEOUT_MS = 4000;

let cachedLocalMediaServerPort = LOCAL_MEDIA_SERVER_PORT_CANDIDATES[0];

function getCandidatePorts() {
  const ordered = [cachedLocalMediaServerPort, ...LOCAL_MEDIA_SERVER_PORT_CANDIDATES];
  return Array.from(new Set(ordered.filter((port) => Number.isFinite(Number(port)))));
}

function buildTracksUrl(port, mediaUrl) {
  return `http://127.0.0.1:${port}/tracks/${encodeURIComponent(String(mediaUrl || "").trim())}`;
}

async function requestTracksViaLuna(mediaUrl) {
  const payload = await WebOsLunaService.request("luna://com.nuvio.lg.service", {
    method: "tracks",
    parameters: {
      url: String(mediaUrl || "").trim()
    }
  });

  return Array.isArray(payload?.tracks) ? payload.tracks : [];
}

async function waitForTizenMediaService() {
  if (!Platform.isTizen()) {
    return;
  }

  const readiness = globalThis.__NUVIO_TIZEN_MEDIA_SERVICE_READY__;
  if (!readiness || typeof readiness.then !== "function") {
    return;
  }

  try {
    await Promise.race([
      readiness,
      new Promise((resolve) => setTimeout(resolve, REQUEST_TIMEOUT_MS))
    ]);
  } catch (_) {
    // Fall back to direct probing even if the readiness promise rejects.
  }
}

async function fetchJson(url) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timeoutId = controller
    ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    : 0;

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller?.signal
    });
    if (!response.ok) {
      throw new Error(`Track request failed with HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export const localMediaTracksRepository = {

  async getTracks(mediaUrl) {
    const targetUrl = String(mediaUrl || "").trim();
    if (!targetUrl) {
      return [];
    }

    if (Platform.isWebOS() && WebOsLunaService.isAvailable()) {
      try {
        return await requestTracksViaLuna(targetUrl);
      } catch (_) {
        // Fall back to direct localhost probing below.
      }
    }

    if (Platform.isTizen()) {
      await waitForTizenMediaService();
    }

    for (const port of getCandidatePorts()) {
      try {
        const payload = await fetchJson(buildTracksUrl(port, targetUrl));
        cachedLocalMediaServerPort = port;
        return Array.isArray(payload) ? payload : [];
      } catch (_) {
        // Try the next local media server port.
      }
    }

    return [];
  }

};
