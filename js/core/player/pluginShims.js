// Runtime shims for the CommonJS modules scraper providers `require()`. They run
// inside the packaged TV app (Chromium 47), so they only use APIs available there
// (fetch is polyfilled by whatwg-fetch; URL exists). The plugin engine maps
// require(name) to these.
import CryptoJS from "crypto-js";

export { CryptoJS };

// --- node "url" -------------------------------------------------------------
// Minimal subset backed by the WHATWG URL (and a regex fallback). Covers the
// parse/resolve/format calls the providers actually make.
function parseQuery(search) {
  const out = {};
  const q = String(search || "").replace(/^\?/, "");
  if (!q) return out;
  const parts = q.split("&");
  for (let i = 0; i < parts.length; i += 1) {
    if (!parts[i]) continue;
    const eq = parts[i].indexOf("=");
    const key = eq >= 0 ? parts[i].slice(0, eq) : parts[i];
    const val = eq >= 0 ? parts[i].slice(eq + 1) : "";
    try {
      out[decodeURIComponent(key)] = decodeURIComponent(val);
    } catch (_) {
      out[key] = val;
    }
  }
  return out;
}

export const UrlShim = {
  URL: globalThis.URL,
  URLSearchParams: globalThis.URLSearchParams,
  parse(input, parseQueryString) {
    try {
      const u = new URL(String(input));
      return {
        href: u.href,
        protocol: u.protocol,
        host: u.host,
        hostname: u.hostname,
        port: u.port,
        pathname: u.pathname,
        search: u.search,
        hash: u.hash,
        query: parseQueryString ? parseQuery(u.search) : (u.search ? u.search.slice(1) : null),
        path: u.pathname + (u.search || ""),
        origin: u.origin
      };
    } catch (_) {
      return {
        href: String(input || ""), protocol: "", host: "", hostname: "", port: "",
        pathname: "", search: "", hash: "", path: "",
        query: parseQueryString ? {} : null
      };
    }
  },
  resolve(from, to) {
    try {
      return new URL(String(to), String(from)).href;
    } catch (_) {
      return String(to || "");
    }
  },
  format(obj) {
    if (!obj || typeof obj !== "object") return String(obj || "");
    if (obj.href) return obj.href;
    const protocol = obj.protocol ? (/:$/.test(obj.protocol) ? obj.protocol : obj.protocol + ":") : "";
    const host = obj.host || (obj.hostname ? obj.hostname + (obj.port ? ":" + obj.port : "") : "");
    const pathname = obj.pathname || "";
    let search = obj.search || "";
    if (!search && obj.query && typeof obj.query === "object") {
      const pairs = [];
      for (const k in obj.query) {
        if (Object.prototype.hasOwnProperty.call(obj.query, k)) {
          pairs.push(encodeURIComponent(k) + "=" + encodeURIComponent(obj.query[k]));
        }
      }
      if (pairs.length) search = "?" + pairs.join("&");
    } else if (!search && typeof obj.query === "string" && obj.query) {
      search = "?" + obj.query;
    }
    const hash = obj.hash || "";
    return (protocol ? protocol + "//" : "") + host + pathname + search + hash;
  }
};
UrlShim.default = UrlShim;

// --- "axios" ----------------------------------------------------------------
// fetch-backed subset: axios(config) / axios.get / axios.post / axios.head, with
// headers, params, data (json or string), timeout and responseType.
function buildUrl(url, params) {
  if (!params || typeof params !== "object") return url;
  const pairs = [];
  for (const k in params) {
    if (Object.prototype.hasOwnProperty.call(params, k) && params[k] != null) {
      pairs.push(encodeURIComponent(k) + "=" + encodeURIComponent(params[k]));
    }
  }
  if (!pairs.length) return url;
  return url + (url.indexOf("?") >= 0 ? "&" : "?") + pairs.join("&");
}

async function axiosRequest(config) {
  const cfg = config || {};
  const method = String(cfg.method || "get").toUpperCase();
  const url = buildUrl(String(cfg.url || ""), cfg.params);
  const headers = Object.assign({}, cfg.headers || {});
  let body;
  if (cfg.data != null && method !== "GET" && method !== "HEAD") {
    if (typeof cfg.data === "object" && !(cfg.data instanceof ArrayBuffer)) {
      body = JSON.stringify(cfg.data);
      if (!headers["Content-Type"] && !headers["content-type"]) {
        headers["Content-Type"] = "application/json";
      }
    } else {
      body = cfg.data;
    }
  }
  const init = { method, headers };
  if (body != null) init.body = body;
  if (cfg.signal) init.signal = cfg.signal;

  let timer = null;
  if (cfg.timeout && !cfg.signal && typeof AbortController === "function") {
    const controller = new AbortController();
    init.signal = controller.signal;
    timer = setTimeout(() => controller.abort(), Number(cfg.timeout));
  }

  const res = await fetch(url, init);
  if (timer) clearTimeout(timer);

  const resHeaders = {};
  if (res.headers && typeof res.headers.forEach === "function") {
    res.headers.forEach((v, k) => { resHeaders[k] = v; });
  }

  let data;
  const responseType = cfg.responseType;
  if (responseType === "arraybuffer") {
    data = await res.arrayBuffer();
  } else if (responseType === "blob") {
    data = await res.blob();
  } else {
    const text = await res.text();
    if (responseType === "text") {
      data = text;
    } else {
      try {
        data = text ? JSON.parse(text) : text;
      } catch (_) {
        data = text;
      }
    }
  }

  const response = {
    data,
    status: res.status,
    statusText: res.statusText,
    headers: resHeaders,
    config: cfg
  };

  const validate = typeof cfg.validateStatus === "function"
    ? cfg.validateStatus
    : (s) => s >= 200 && s < 300;
  if (!validate(res.status)) {
    const err = new Error("Request failed with status code " + res.status);
    err.response = response;
    err.config = cfg;
    throw err;
  }
  return response;
}

function makeAxios(defaults) {
  const instance = function (config) {
    if (typeof config === "string") {
      return axiosRequest(Object.assign({}, defaults, { url: config }));
    }
    return axiosRequest(Object.assign({}, defaults, config));
  };
  instance.request = (config) => axiosRequest(Object.assign({}, defaults, config));
  ["get", "delete", "head", "options"].forEach((m) => {
    instance[m] = (url, config) => axiosRequest(Object.assign({}, defaults, config, { method: m, url }));
  });
  ["post", "put", "patch"].forEach((m) => {
    instance[m] = (url, data, config) => axiosRequest(Object.assign({}, defaults, config, { method: m, url, data }));
  });
  instance.create = (createDefaults) => makeAxios(Object.assign({}, defaults, createDefaults));
  instance.defaults = defaults;
  return instance;
}

export const AxiosShim = makeAxios({});
AxiosShim.default = AxiosShim;

// --- "ws" -------------------------------------------------------------------
// Best-effort: wrap the native WebSocket and add the `ws` .on(event, cb) API.
export function WsShim(url, protocols) {
  const sock = protocols ? new WebSocket(url, protocols) : new WebSocket(url);
  sock.on = function (event, cb) {
    sock.addEventListener(event, function (e) {
      if (event === "message") cb(e && e.data);
      else if (event === "error") cb(e);
      else cb(e);
    });
    return sock;
  };
  sock.removeAllListeners = function () { return sock; };
  return sock;
}
WsShim.default = WsShim;
