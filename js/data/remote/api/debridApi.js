const TORBOX_BASE_URL = "https://api.torbox.app/";
const PREMIUMIZE_BASE_URL = "https://www.premiumize.me/";
const REAL_DEBRID_BASE_URL = "https://api.real-debrid.com/rest/1.0/";

function joinUrl(baseUrl, path) {
  return `${String(baseUrl || "").replace(/\/+$/, "")}/${String(path || "").replace(/^\/+/, "")}`;
}

async function requestJson(baseUrl, path, options = {}) {
  const response = await fetch(joinUrl(baseUrl, path), {
    ...options,
    headers: {
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data = null;
  if (text.trim()) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return {
    ok: response.ok,
    status: response.status,
    data,
    text
  };
}

function authHeaders(apiKey) {
  return {
    Authorization: `Bearer ${String(apiKey || "").trim()}`
  };
}

function formBody(values = {}) {
  const body = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((entry) => body.append(key, String(entry)));
    } else if (value != null) {
      body.set(key, String(value));
    }
  });
  return body;
}

export const DebridApi = {

  async validateTorboxApiKey(apiKey) {
    const response = await requestJson(TORBOX_BASE_URL, "v1/api/user/me", {
      headers: authHeaders(apiKey)
    });
    return response.ok;
  },

  async validatePremiumizeApiKey(apiKey) {
    const response = await requestJson(PREMIUMIZE_BASE_URL, "api/account/info", {
      headers: authHeaders(apiKey)
    });
    return response.ok && String(response.data?.status || "").toLowerCase() !== "error";
  },

  async validateRealDebridApiKey(apiKey) {
    const response = await requestJson(REAL_DEBRID_BASE_URL, "user", {
      headers: authHeaders(apiKey)
    });
    return response.ok;
  },

  async torboxCreateTorrent(apiKey, magnet) {
    const body = new FormData();
    body.set("magnet", magnet);
    body.set("add_only_if_cached", "true");
    body.set("allow_zip", "false");
    return requestJson(TORBOX_BASE_URL, "v1/api/torrents/createtorrent", {
      method: "POST",
      headers: authHeaders(apiKey),
      body
    });
  },

  async torboxCheckCached(apiKey, hashes = []) {
    return requestJson(TORBOX_BASE_URL, "v1/api/torrents/checkcached?format=object", {
      method: "POST",
      headers: {
        ...authHeaders(apiKey),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        hashes: (hashes || []).map((hash) => String(hash || "").trim().toLowerCase()).filter(Boolean)
      })
    });
  },

  async torboxGetTorrent(apiKey, torrentId) {
    const query = new URLSearchParams({
      id: String(torrentId),
      bypass_cache: "true"
    });
    return requestJson(TORBOX_BASE_URL, `v1/api/torrents/mylist?${query.toString()}`, {
      headers: authHeaders(apiKey)
    });
  },

  async torboxRequestDownloadLink(apiKey, torrentId, fileId) {
    const query = new URLSearchParams({
      token: String(apiKey || "").trim(),
      torrent_id: String(torrentId),
      zip_link: "false",
      redirect: "false",
      append_name: "false"
    });
    if (fileId != null) {
      query.set("file_id", String(fileId));
    }
    return requestJson(TORBOX_BASE_URL, `v1/api/torrents/requestdl?${query.toString()}`, {
      headers: authHeaders(apiKey)
    });
  },

  async premiumizeDirectDownload(apiKey, source) {
    return requestJson(PREMIUMIZE_BASE_URL, "api/transfer/directdl", {
      method: "POST",
      headers: authHeaders(apiKey),
      body: formBody({ src: source })
    });
  },

  async premiumizeCheckCache(apiKey, hashes = []) {
    const body = new URLSearchParams();
    (hashes || [])
      .map((hash) => String(hash || "").trim().toLowerCase())
      .filter(Boolean)
      .forEach((hash) => body.append("items[]", `magnet:?xt=urn:btih:${hash}`));
    return requestJson(PREMIUMIZE_BASE_URL, "api/cache/check", {
      method: "POST",
      headers: authHeaders(apiKey),
      body
    });
  },

  async realDebridAddMagnet(apiKey, magnet) {
    return requestJson(REAL_DEBRID_BASE_URL, "torrents/addMagnet", {
      method: "POST",
      headers: authHeaders(apiKey),
      body: formBody({ magnet })
    });
  },

  async realDebridTorrentInfo(apiKey, torrentId) {
    return requestJson(REAL_DEBRID_BASE_URL, `torrents/info/${encodeURIComponent(torrentId)}`, {
      headers: authHeaders(apiKey)
    });
  },

  async realDebridSelectFiles(apiKey, torrentId, files) {
    return requestJson(REAL_DEBRID_BASE_URL, `torrents/selectFiles/${encodeURIComponent(torrentId)}`, {
      method: "POST",
      headers: authHeaders(apiKey),
      body: formBody({ files })
    });
  },

  async realDebridUnrestrictLink(apiKey, link) {
    return requestJson(REAL_DEBRID_BASE_URL, "unrestrict/link", {
      method: "POST",
      headers: authHeaders(apiKey),
      body: formBody({ link })
    });
  },

  async realDebridDeleteTorrent(apiKey, torrentId) {
    return requestJson(REAL_DEBRID_BASE_URL, `torrents/delete/${encodeURIComponent(torrentId)}`, {
      method: "DELETE",
      headers: authHeaders(apiKey)
    });
  }

};
