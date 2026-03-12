function getServiceRequest() {
  const request = globalThis.webOS?.service?.request;
  if (typeof request === "function") {
    return request.bind(globalThis.webOS.service);
  }
  return null;
}

function getPalmServiceBridge() {
  return typeof globalThis.PalmServiceBridge === "function"
    ? globalThis.PalmServiceBridge
    : null;
}

function buildPalmServiceUrl(service, method) {
  const normalizedService = String(service || "").trim().replace(/\/+$/, "");
  const normalizedMethod = String(method || "").trim().replace(/^\/+/, "");
  if (!normalizedService || !normalizedMethod) {
    return "";
  }
  return `${normalizedService}/${normalizedMethod}`;
}

function parseBridgePayload(payload) {
  if (payload && typeof payload === "object") {
    return payload;
  }
  try {
    return JSON.parse(String(payload || ""));
  } catch (_) {
    return {
      returnValue: false,
      errorCode: -1,
      errorText: String(payload || "Invalid Luna payload")
    };
  }
}

export const WebOsLunaService = {

  isAvailable() {
    return Boolean(getServiceRequest() || getPalmServiceBridge());
  },

  request(service, { method = "", parameters = {}, subscribe = false } = {}) {
    return new Promise((resolve, reject) => {
      const request = getServiceRequest();
      if (request) {
        request(String(service || "").trim(), {
          method: String(method || "").trim(),
          parameters: parameters && typeof parameters === "object" ? { ...parameters } : {},
          subscribe: Boolean(subscribe),
          onSuccess: (result) => resolve(result || {}),
          onFailure: (result) => reject(result || {
            returnValue: false,
            errorCode: -1,
            errorText: "Luna request failed"
          })
        });
        return;
      }

      const PalmServiceBridge = getPalmServiceBridge();
      const targetUrl = buildPalmServiceUrl(service, method);
      if (!PalmServiceBridge || !targetUrl) {
        reject({
          returnValue: false,
          errorCode: -1,
          errorText: "Luna service bridge unavailable"
        });
        return;
      }

      const bridge = new PalmServiceBridge();
      const payload = parameters && typeof parameters === "object" ? { ...parameters } : {};
      if (subscribe) {
        payload.subscribe = true;
      }

      bridge.onservicecallback = (rawResponse) => {
        const parsed = parseBridgePayload(rawResponse);
        if (parsed?.returnValue === false || parsed?.errorCode) {
          reject(parsed);
        } else {
          resolve(parsed || {});
        }
        try {
          bridge.cancel?.();
        } catch (_) {
          // Ignore bridge cleanup failures.
        }
      };

      try {
        bridge.call(targetUrl, JSON.stringify(payload));
      } catch (error) {
        reject({
          returnValue: false,
          errorCode: -1,
          errorText: String(error?.message || error || "Luna bridge call failed")
        });
      }
    });
  }

};
