import { Environment } from "../environment.js";
import {
  isWebOsCompanionServiceAvailable,
  requestWebOsCompanionService
} from "./webosCompanionService.js";

const WEBOS_SUPABASE_PROXY_REQUEST_TIMEOUT_MS = 22000;
const NULL_BODY_RESPONSE_STATUSES = new Set([204, 205, 304]);

function withTimeout(promise, timeoutMs) {
  let timeoutId = 0;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error("webOS Supabase proxy status timed out")),
      timeoutMs
    );
  });
  return Promise.race([promise, timeoutPromise]).then(
    (value) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      return value;
    },
    (error) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      throw error;
    }
  );
}

function isProxyableSupabaseUrl(value = "") {
  try {
    const parsed = new URL(String(value || "").trim());
    const host = parsed.hostname.toLowerCase();
    return (
      parsed.protocol === "https:" &&
      parsed.pathname.startsWith("/rest/v1/") &&
      (host === "api.nuvio.tv" || host.endsWith(".supabase.co"))
    );
  } catch (_) {
    return false;
  }
}

function serializeBody(body) {
  if (body == null) {
    return null;
  }
  if (typeof body === "string") {
    return body;
  }
  return null;
}

function buildResponseFromServicePayload(payload) {
  const status = Number(payload?.statusCode || 0);
  if (!status) {
    return null;
  }
  const headers = payload?.headers && typeof payload.headers === "object" ? payload.headers : {};
  const body = NULL_BODY_RESPONSE_STATUSES.has(status)
    ? null
    : typeof payload?.body === "string"
      ? payload.body
      : "";
  if (typeof Response === "function") {
    return new Response(body, {
      status,
      headers
    });
  }
  return {
    status,
    ok: status >= 200 && status < 300,
    async text() {
      return body || "";
    }
  };
}

export async function fetchViaWebOsSupabaseProxy(url, fetchOptions = {}) {
  if (!isProxyableSupabaseUrl(url)) {
    return null;
  }
  const body = serializeBody(fetchOptions.body);
  if (fetchOptions.body != null && body == null) {
    return null;
  }
  if (!Environment.isWebOS() || !isWebOsCompanionServiceAvailable()) {
    return null;
  }

  const serviceResult = await withTimeout(
    requestWebOsCompanionService({
      method: "supabaseProxy",
      parameters: {
        url: String(url || ""),
        method: fetchOptions.method || "GET",
        headers: fetchOptions.headers || {},
        body
      }
    }),
    WEBOS_SUPABASE_PROXY_REQUEST_TIMEOUT_MS
  ).catch(() => null);
  const serviceResponse = buildResponseFromServicePayload(serviceResult?.payload);
  if (serviceResponse) {
    return serviceResponse;
  }
  return null;
}
