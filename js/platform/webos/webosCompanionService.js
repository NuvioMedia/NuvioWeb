import { WebOsLunaService } from "./webosLunaService.js";

const DEFAULT_SERVICE_IDS = [
  "space.nuvio.webos.service",
  "com.nuvio.lg.service"
];

function normalizeServiceId(value) {
  return String(value || "").trim().replace(/^luna:\/\//, "").replace(/\/+$/, "");
}

function normalizeServiceIds(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeServiceId).filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split(",").map(normalizeServiceId).filter(Boolean);
  }
  return [];
}

function uniqueServiceIds(values) {
  const seen = new Set();
  const ids = [];
  values.forEach((value) => {
    const id = normalizeServiceId(value);
    if (!id || seen.has(id)) {
      return;
    }
    seen.add(id);
    ids.push(id);
  });
  return ids;
}

export function isWebOsCompanionServiceAvailable() {
  return WebOsLunaService.isAvailable();
}

export function getWebOsCompanionServiceIds() {
  const env = globalThis.__NUVIO_ENV__ || {};
  return uniqueServiceIds([
    ...normalizeServiceIds(env.WEBOS_SERVICE_ID),
    ...normalizeServiceIds(env.WEBOS_SERVICE_IDS),
    ...DEFAULT_SERVICE_IDS
  ]);
}

export async function requestWebOsCompanionService({ method = "", parameters = {}, subscribe = false } = {}) {
  if (!isWebOsCompanionServiceAvailable()) {
    throw {
      returnValue: false,
      errorCode: -1,
      errorText: "Luna service bridge unavailable"
    };
  }

  let lastError = null;
  for (const serviceId of getWebOsCompanionServiceIds()) {
    try {
      const payload = await WebOsLunaService.request(`luna://${serviceId}`, {
        method,
        parameters,
        subscribe
      });
      return {
        serviceId,
        payload
      };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || {
    returnValue: false,
    errorCode: -1,
    errorText: "No webOS companion service responded"
  };
}
