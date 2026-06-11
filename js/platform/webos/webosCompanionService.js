import { WebOsLunaService } from "./webosLunaService.js";

const WEBOS_COMPANION_SERVICE_ID = "space.nuvio.webos.service";

export function isWebOsCompanionServiceAvailable() {
  return WebOsLunaService.isAvailable();
}

export function getWebOsCompanionServiceIds() {
  return [WEBOS_COMPANION_SERVICE_ID];
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

export function subscribeWebOsCompanionService({ method = "", parameters = {}, onSuccess = null, onFailure = null } = {}) {
  if (!isWebOsCompanionServiceAvailable()) {
    throw {
      returnValue: false,
      errorCode: -1,
      errorText: "Luna service bridge unavailable"
    };
  }

  const serviceId = getWebOsCompanionServiceIds()[0];
  if (!serviceId) {
    throw {
      returnValue: false,
      errorCode: -1,
      errorText: "No webOS companion service id configured"
    };
  }

  return WebOsLunaService.subscribe(`luna://${serviceId}`, {
    method,
    parameters,
    onSuccess,
    onFailure
  });
}
