(() => {
  // js/runtime/polyfills.js
  if (typeof globalThis === "undefined") {
    Object.defineProperty(Object.prototype, "__nuvio_global__", {
      get: function getGlobal() {
        return this;
      },
      configurable: true
    });
    __nuvio_global__.globalThis = __nuvio_global__;
    delete Object.prototype.__nuvio_global__;
  }
  if (!Object.fromEntries) {
    Object.fromEntries = function fromEntries(entries) {
      var result = {};
      if (!entries || typeof entries[Symbol.iterator] !== "function") {
        return result;
      }
      for (const entry of entries) {
        if (!entry || entry.length < 2) {
          continue;
        }
        result[entry[0]] = entry[1];
      }
      return result;
    };
  }
  if (!Array.prototype.flatMap) {
    Object.defineProperty(Array.prototype, "flatMap", {
      value: function flatMap(callback, thisArg) {
        var mapped = [];
        for (var index = 0; index < this.length; index += 1) {
          if (!(index in this)) {
            continue;
          }
          var item = callback.call(thisArg, this[index], index, this);
          if (Array.isArray(item)) {
            mapped.push.apply(mapped, item);
          } else {
            mapped.push(item);
          }
        }
        return mapped;
      },
      configurable: true,
      writable: true
    });
  }
  if (!String.prototype.replaceAll) {
    Object.defineProperty(String.prototype, "replaceAll", {
      value: function replaceAll(searchValue, replaceValue) {
        var source = String(this);
        if (searchValue instanceof RegExp) {
          return source.replace(new RegExp(searchValue.source, searchValue.flags.includes("g") ? searchValue.flags : searchValue.flags + "g"), replaceValue);
        }
        return source.split(String(searchValue)).join(String(replaceValue));
      },
      configurable: true,
      writable: true
    });
  }

  // js/core/auth/authState.js
  var AuthState = {
    LOADING: "loading",
    SIGNED_OUT: "signedOut",
    AUTHENTICATED: "authenticated"
  };

  // js/core/storage/sessionStore.js
  var SessionStore = {
    normalizeToken(value) {
      const text = String(value != null ? value : "").trim();
      if (!text || text === "null" || text === "undefined") {
        return null;
      }
      return text;
    },
    get isAnonymousSession() {
      return localStorage.getItem("is_anonymous_session") === "1";
    },
    set isAnonymousSession(value) {
      if (value) {
        localStorage.setItem("is_anonymous_session", "1");
      } else {
        localStorage.removeItem("is_anonymous_session");
      }
    },
    get accessToken() {
      return this.normalizeToken(localStorage.getItem("access_token"));
    },
    set accessToken(value) {
      const normalized = this.normalizeToken(value);
      if (!normalized) {
        localStorage.removeItem("access_token");
        return;
      }
      localStorage.setItem("access_token", normalized);
    },
    get refreshToken() {
      return this.normalizeToken(localStorage.getItem("refresh_token"));
    },
    set refreshToken(value) {
      const normalized = this.normalizeToken(value);
      if (!normalized) {
        localStorage.removeItem("refresh_token");
        return;
      }
      localStorage.setItem("refresh_token", normalized);
    },
    clear() {
      localStorage.removeItem("access_token");
      localStorage.removeItem("refresh_token");
      localStorage.removeItem("is_anonymous_session");
    }
  };

  // js/config.js
  var runtimeEnv = globalThis.__NUVIO_ENV__ || {};
  function normalizePlaybackOrder(value) {
    if (Array.isArray(value)) {
      return value.map((entry) => String(entry).trim()).filter(Boolean);
    }
    if (typeof value === "string") {
      return value.split(",").map((entry) => entry.trim()).filter(Boolean);
    }
    return [];
  }
  var SUPABASE_URL = String(runtimeEnv.SUPABASE_URL || "").trim();
  var SUPABASE_ANON_KEY = String(runtimeEnv.SUPABASE_ANON_KEY || "").trim();
  var TV_LOGIN_REDIRECT_BASE_URL = String(runtimeEnv.TV_LOGIN_REDIRECT_BASE_URL || "").trim();
  var PUBLIC_APP_URL = String(runtimeEnv.PUBLIC_APP_URL || "").trim();
  var ENABLE_REMOTE_WRAPPER_MODE = Boolean(runtimeEnv.ENABLE_REMOTE_WRAPPER_MODE);
  var PREFERRED_PLAYBACK_ORDER = normalizePlaybackOrder(runtimeEnv.PREFERRED_PLAYBACK_ORDER);

  // js/core/auth/authManager.js
  var AuthManagerClass = class {
    constructor() {
      this.state = AuthState.LOADING;
      this.listeners = [];
      this.cachedEffectiveUserId = null;
      this.cachedEffectiveUserSourceUserId = null;
      this.refreshPromise = null;
    }
    // ------------------------------------
    // SUBSCRIBE (equivalente StateFlow)
    // ------------------------------------
    subscribe(listener) {
      this.listeners.push(listener);
      listener(this.state);
      return () => {
        this.listeners = this.listeners.filter((l) => l !== listener);
      };
    }
    setState(newState) {
      this.state = newState;
      this.listeners.forEach((l) => l(newState));
    }
    // ------------------------------------
    // BOOTSTRAP (equivalente observeSessionStatus)
    // ------------------------------------
    async bootstrap() {
      const token = SessionStore.accessToken;
      if (!token) {
        this.setState(AuthState.SIGNED_OUT);
        return;
      }
      if (SessionStore.isAnonymousSession) {
        this.setState(AuthState.SIGNED_OUT);
        return;
      }
      const refreshed = await this.refreshSessionIfNeeded();
      if (!refreshed) {
        this.setState(AuthState.SIGNED_OUT);
        return;
      }
      this.setState(AuthState.AUTHENTICATED);
    }
    getAuthState() {
      return this.state;
    }
    get isAuthenticated() {
      return this.state === AuthState.AUTHENTICATED;
    }
    // ------------------------------------
    // EMAIL LOGIN
    // ------------------------------------
    async signInWithEmail(email, password) {
      const res = await fetch(
        `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": SUPABASE_ANON_KEY
          },
          body: JSON.stringify({ email, password })
        }
      );
      if (!res.ok) throw new Error("Login failed");
      const data = await res.json();
      SessionStore.accessToken = data.access_token;
      SessionStore.refreshToken = data.refresh_token;
      SessionStore.isAnonymousSession = false;
      this.setState(AuthState.AUTHENTICATED);
    }
    async signOut() {
      SessionStore.clear();
      this.cachedEffectiveUserId = null;
      this.cachedEffectiveUserSourceUserId = null;
      this.setState(AuthState.SIGNED_OUT);
    }
    async refreshSessionIfNeeded() {
      if (this.refreshPromise) {
        return this.refreshPromise;
      }
      const refreshToken = SessionStore.refreshToken;
      if (!refreshToken) {
        return Boolean(SessionStore.accessToken);
      }
      this.refreshPromise = (async () => {
        try {
          const res = await fetch(
            `${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "apikey": SUPABASE_ANON_KEY
              },
              body: JSON.stringify({ refresh_token: refreshToken })
            }
          );
          if (!res.ok) {
            return false;
          }
          const data = await res.json();
          if (!(data == null ? void 0 : data.access_token)) {
            return false;
          }
          SessionStore.accessToken = data.access_token;
          if (data.refresh_token) {
            SessionStore.refreshToken = data.refresh_token;
          }
          return true;
        } catch (error) {
          console.warn("Session refresh failed", error);
          return false;
        } finally {
          this.refreshPromise = null;
        }
      })();
      return this.refreshPromise;
    }
    // ------------------------------------
    // QR LOGIN FLOW
    // ------------------------------------
    async startTvLoginSession(deviceNonce, deviceName, redirectBaseUrl) {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/rpc/start_tv_login_session`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": SUPABASE_ANON_KEY,
            "Authorization": `Bearer ${SessionStore.accessToken}`
          },
          body: JSON.stringify({
            p_device_nonce: deviceNonce,
            p_redirect_base_url: redirectBaseUrl,
            ...deviceName && { p_device_name: deviceName }
          })
        }
      );
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      return data[0];
    }
    async pollTvLoginSession(code, deviceNonce) {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/rpc/poll_tv_login_session`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": SUPABASE_ANON_KEY,
            "Authorization": `Bearer ${SessionStore.accessToken}`
          },
          body: JSON.stringify({
            p_code: code,
            p_device_nonce: deviceNonce
          })
        }
      );
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      return data[0];
    }
    async exchangeTvLoginSession(code, deviceNonce) {
      const res = await fetch(
        `${SUPABASE_URL}/functions/v1/tv-logins-exchange`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": SUPABASE_ANON_KEY,
            "Authorization": `Bearer ${SessionStore.accessToken}`
          },
          body: JSON.stringify({
            code,
            device_nonce: deviceNonce
          })
        }
      );
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      SessionStore.accessToken = data.accessToken;
      SessionStore.refreshToken = data.refreshToken;
      this.setState(AuthState.AUTHENTICATED);
    }
    // ------------------------------------
    // EFFECTIVE USER ID (PORTING CACHE LOGIC)
    // ------------------------------------
    async getEffectiveUserId() {
      if (this.cachedEffectiveUserId)
        return this.cachedEffectiveUserId;
      if (!SessionStore.accessToken) {
        const refreshed = await this.refreshSessionIfNeeded();
        if (!refreshed || !SessionStore.accessToken) {
          await this.signOut();
          throw new Error("Missing valid session token");
        }
      }
      const authHeaders = {
        "Content-Type": "application/json",
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": `Bearer ${SessionStore.accessToken}`
      };
      let res = await fetch(
        `${SUPABASE_URL}/rest/v1/rpc/get_sync_owner`,
        {
          method: "POST",
          headers: authHeaders
        }
      );
      if (res.status === 401) {
        const refreshed = await this.refreshSessionIfNeeded();
        if (refreshed) {
          res = await fetch(
            `${SUPABASE_URL}/rest/v1/rpc/get_sync_owner`,
            {
              method: "POST",
              headers: {
                ...authHeaders,
                "Authorization": `Bearer ${SessionStore.accessToken}`
              }
            }
          );
        }
      }
      if (!res.ok) {
        if (res.status === 401) {
          await this.signOut();
        }
        throw new Error(await res.text());
      }
      const data = await res.json();
      const id = data;
      this.cachedEffectiveUserId = id;
      return id;
    }
  };
  var AuthManager = new AuthManagerClass();

  // js/core/storage/localStore.js
  var LocalStore = {
    get(key, defaultValue = null) {
      try {
        const value = localStorage.getItem(key);
        return value !== null ? JSON.parse(value) : defaultValue;
      } catch (e) {
        console.error("LocalStore get error:", e);
        return defaultValue;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch (e) {
        console.error("LocalStore set error:", e);
      }
    },
    remove(key) {
      localStorage.removeItem(key);
    },
    clear() {
      localStorage.clear();
    }
  };

  // js/ui/screens/splash/splashScreen.js
  var SplashScreen = {
    async mount() {
      const container = document.getElementById("splash");
      container.style.display = "block";
      container.innerHTML = `
      <div class="splash-container">
        <img src="assets/brand/app_logo_wordmark.png" class="splash-logo" />
      </div>
    `;
      await this.bootstrap();
    },
    async bootstrap() {
      await new Promise((resolve) => setTimeout(resolve, 800));
      const authState = AuthManager.getAuthState();
      const hasSeenQr = LocalStore.get("hasSeenAuthQrOnFirstLaunch");
      if (!hasSeenQr && authState !== AuthState.AUTHENTICATED) {
        Router.navigate("authQrSignIn");
        return;
      }
      if (authState === AuthState.AUTHENTICATED) {
        Router.navigate("profileSelection");
      } else {
        Router.navigate("authQrSignIn");
      }
    },
    cleanup() {
      const container = document.getElementById("splash");
      if (!container) {
        return;
      }
      container.style.display = "none";
      container.innerHTML = "";
    }
  };

  // js/ui/navigation/screen.js
  var STRICT_DPAD_GRID_KEY = "strictDpadGridNavigation";
  function shouldUseStrictDpadGrid() {
    return Boolean(LocalStore.get(STRICT_DPAD_GRID_KEY, true));
  }
  var ScreenUtils = {
    show(container) {
      if (!container) {
        return;
      }
      container.style.display = "block";
    },
    hide(container) {
      if (!container) {
        return;
      }
      container.style.display = "none";
      container.innerHTML = "";
    },
    setInitialFocus(container, selector = ".focusable") {
      const first = container == null ? void 0 : container.querySelector(selector);
      if (!first) {
        return;
      }
      first.classList.add("focused");
      first.focus();
    },
    moveFocus(container, direction, selector = ".focusable") {
      const list = Array.from((container == null ? void 0 : container.querySelectorAll(selector)) || []);
      const current = container == null ? void 0 : container.querySelector(`${selector}.focused`);
      if (!list.length || !current) {
        return;
      }
      const index = Number(current.dataset.index || 0);
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= list.length) {
        return;
      }
      current.classList.remove("focused");
      list[nextIndex].classList.add("focused");
      list[nextIndex].focus();
    },
    moveFocusDirectional(container, direction, selector = ".focusable") {
      var _a, _b, _c, _d, _e, _f, _g, _h;
      const list = Array.from((container == null ? void 0 : container.querySelectorAll(selector)) || []).filter((node) => {
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      if (!list.length) {
        return;
      }
      const current = (container == null ? void 0 : container.querySelector(`${selector}.focused`)) || list[0];
      if (!current.classList.contains("focused")) {
        list.forEach((node) => node.classList.remove("focused"));
        current.classList.add("focused");
        current.focus();
        return;
      }
      const currentRect = current.getBoundingClientRect();
      const cx = currentRect.left + currentRect.width / 2;
      const cy = currentRect.top + currentRect.height / 2;
      const strictDpadGrid = shouldUseStrictDpadGrid();
      const candidates = list.filter((node) => node !== current).map((node) => {
        const rect = node.getBoundingClientRect();
        const nx = rect.left + rect.width / 2;
        const ny = rect.top + rect.height / 2;
        const dx = nx - cx;
        const dy = ny - cy;
        return { node, rect, dx, dy };
      }).filter(({ dx, dy }) => {
        if (direction === "up") return dy < -2;
        if (direction === "down") return dy > 2;
        if (direction === "left") return dx < -2;
        if (direction === "right") return dx > 2;
        return false;
      }).map((entry) => {
        const primary = direction === "up" || direction === "down" ? Math.abs(entry.dy) : Math.abs(entry.dx);
        const secondary = direction === "up" || direction === "down" ? Math.abs(entry.dx) : Math.abs(entry.dy);
        const axisTolerance = direction === "up" || direction === "down" ? Math.max(currentRect.width * 0.7, entry.rect.width * 0.7, 48) : Math.max(currentRect.height * 0.7, entry.rect.height * 0.7, 48);
        const aligned = direction === "up" || direction === "down" ? secondary <= axisTolerance : secondary <= axisTolerance;
        return {
          ...entry,
          aligned,
          score: primary * 1e3 + secondary
        };
      });
      let target = null;
      if (direction === "up" || direction === "down") {
        if (strictDpadGrid) {
          const nearestPrimary = candidates.reduce((min, entry) => {
            const primary = Math.abs(entry.dy);
            return Math.min(min, primary);
          }, Number.POSITIVE_INFINITY);
          const rowTolerance = Math.max(currentRect.height * 0.9, 42);
          const nearestRow = candidates.filter((entry) => {
            const primary = Math.abs(entry.dy);
            return primary <= nearestPrimary + rowTolerance;
          });
          const alignedInRow = nearestRow.filter((entry) => entry.aligned).sort((left, right) => Math.abs(left.dx) - Math.abs(right.dx));
          const rowSorted = nearestRow.sort((left, right) => {
            const sec = Math.abs(left.dx) - Math.abs(right.dx);
            if (sec !== 0) {
              return sec;
            }
            return Math.abs(left.dy) - Math.abs(right.dy);
          });
          target = ((_a = alignedInRow[0]) == null ? void 0 : _a.node) || ((_b = rowSorted[0]) == null ? void 0 : _b.node) || null;
        } else {
          const alignedCandidates = candidates.filter((entry) => entry.aligned).sort((left, right) => left.score - right.score);
          const sortedCandidates = candidates.sort((left, right) => left.score - right.score);
          target = ((_c = alignedCandidates[0]) == null ? void 0 : _c.node) || ((_d = sortedCandidates[0]) == null ? void 0 : _d.node) || null;
        }
      } else {
        if (strictDpadGrid) {
          const nearestPrimary = candidates.reduce((min, entry) => {
            const primary = Math.abs(entry.dx);
            return Math.min(min, primary);
          }, Number.POSITIVE_INFINITY);
          const columnTolerance = Math.max(currentRect.width * 0.9, 42);
          const nearestColumn = candidates.filter((entry) => {
            const primary = Math.abs(entry.dx);
            return primary <= nearestPrimary + columnTolerance;
          });
          const alignedInColumn = nearestColumn.filter((entry) => entry.aligned).sort((left, right) => Math.abs(left.dy) - Math.abs(right.dy));
          const columnSorted = nearestColumn.sort((left, right) => {
            const sec = Math.abs(left.dy) - Math.abs(right.dy);
            if (sec !== 0) {
              return sec;
            }
            return Math.abs(left.dx) - Math.abs(right.dx);
          });
          target = ((_e = alignedInColumn[0]) == null ? void 0 : _e.node) || ((_f = columnSorted[0]) == null ? void 0 : _f.node) || null;
        } else {
          const alignedCandidates = candidates.filter((entry) => entry.aligned).sort((left, right) => left.score - right.score);
          const sortedCandidates = candidates.sort((left, right) => left.score - right.score);
          target = ((_g = alignedCandidates[0]) == null ? void 0 : _g.node) || ((_h = sortedCandidates[0]) == null ? void 0 : _h.node) || null;
        }
      }
      if (!target) {
        return;
      }
      current.classList.remove("focused");
      target.classList.add("focused");
      target.focus();
    },
    handleDpadNavigation(event, container, selector = ".focusable") {
      const code = Number((event == null ? void 0 : event.keyCode) || 0);
      const direction = code === 38 ? "up" : code === 40 ? "down" : code === 37 ? "left" : code === 39 ? "right" : null;
      if (!direction) {
        return false;
      }
      if (typeof (event == null ? void 0 : event.preventDefault) === "function") {
        event.preventDefault();
      }
      this.moveFocusDirectional(container, direction, selector);
      return true;
    },
    indexFocusables(container, selector = ".focusable") {
      const list = Array.from((container == null ? void 0 : container.querySelectorAll(selector)) || []);
      list.forEach((node, index) => {
        node.dataset.index = String(index);
        node.tabIndex = 0;
      });
    }
  };

  // js/core/network/networkResult.js
  var NetworkResult = {
    loading() {
      return { status: "loading" };
    },
    success(data) {
      return { status: "success", data };
    },
    error(message, code = null) {
      return {
        status: "error",
        message: message || "Unknown error",
        code
      };
    }
  };

  // js/core/network/safeApiCall.js
  async function safeApiCall(apiCall) {
    try {
      const response = await apiCall();
      return NetworkResult.success(response);
    } catch (error) {
      if (error instanceof Response) {
        return NetworkResult.error(
          error.statusText || "HTTP error",
          error.status
        );
      }
      return NetworkResult.error(
        error.message || "Unknown error occurred"
      );
    }
  }

  // js/core/network/httpClient.js
  function toHeaderObject(headers) {
    if (!headers) {
      return {};
    }
    if (typeof Headers !== "undefined" && headers instanceof Headers) {
      return Object.fromEntries(headers.entries());
    }
    return { ...headers };
  }
  function hasHeader(headers, name) {
    const target = String(name || "").toLowerCase();
    return Object.keys(headers || {}).some((key) => String(key).toLowerCase() === target);
  }
  async function httpRequest(url, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    const includeSessionAuth = options.includeSessionAuth !== false;
    const headers = toHeaderObject(options.headers);
    if (includeSessionAuth && SessionStore.accessToken && !hasHeader(headers, "Authorization")) {
      headers["Authorization"] = `Bearer ${SessionStore.accessToken}`;
    }
    const body = options.body;
    const hasBody = body != null && method !== "GET" && method !== "HEAD";
    const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
    const isBlob = typeof Blob !== "undefined" && body instanceof Blob;
    const isSearchParams = typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams;
    if (hasBody && !hasHeader(headers, "Content-Type") && !isFormData && !isBlob && !isSearchParams) {
      headers["Content-Type"] = "application/json";
    }
    const {
      includeSessionAuth: _ignoredIncludeSessionAuth,
      ...fetchOptions
    } = options;
    const response = await fetch(url, {
      ...fetchOptions,
      method,
      headers
    });
    if (!response.ok) {
      const text2 = await response.text();
      const error = new Error(text2);
      error.status = response.status;
      try {
        const parsed = JSON.parse(text2);
        if (parsed && typeof parsed === "object") {
          if (typeof parsed.code === "string") {
            error.code = parsed.code;
          }
          if (typeof parsed.message === "string") {
            error.detail = parsed.message;
          }
        }
      } catch (parseError) {
      }
      throw error;
    }
    if (response.status === 204) {
      return null;
    }
    const text = await response.text();
    const normalized = typeof text === "string" ? text.trim() : "";
    if (!normalized) {
      return null;
    }
    return JSON.parse(normalized);
  }

  // js/data/remote/api/addonApi.js
  function trimSlash(url) {
    return String(url || "").replace(/\/+$/, "");
  }
  var AddonApi = {
    async getManifest(baseUrl) {
      return httpRequest(`${trimSlash(baseUrl)}/manifest.json`, {
        includeSessionAuth: false
      });
    },
    async getMeta(url) {
      return httpRequest(url, {
        includeSessionAuth: false
      });
    },
    async getStreams(url) {
      return httpRequest(url, {
        includeSessionAuth: false
      });
    },
    async getSubtitles(url) {
      return httpRequest(url, {
        includeSessionAuth: false
      });
    }
  };

  // js/data/repository/addonRepository.js
  var ADDON_URLS_KEY = "installedAddonUrls";
  var DEFAULT_ADDON_URLS = [
    "https://v3-cinemeta.strem.io",
    "https://opensubtitles-v3.strem.io"
  ];
  var AddonRepository = class {
    constructor() {
      this.manifestCache = /* @__PURE__ */ new Map();
      this.changeListeners = /* @__PURE__ */ new Set();
    }
    canonicalizeUrl(url) {
      const trimmed = String(url || "").trim().replace(/\/+$/, "");
      if (trimmed.endsWith("/manifest.json")) {
        return trimmed.slice(0, -"/manifest.json".length);
      }
      return trimmed;
    }
    getInstalledAddonUrls() {
      const fromStorage = LocalStore.get(ADDON_URLS_KEY, null);
      if (Array.isArray(fromStorage)) {
        const normalized = Array.from(new Set(fromStorage.map((url) => this.canonicalizeUrl(url)).filter(Boolean)));
        if (JSON.stringify(normalized) !== JSON.stringify(fromStorage)) {
          LocalStore.set(ADDON_URLS_KEY, normalized);
        }
        return normalized;
      }
      LocalStore.set(ADDON_URLS_KEY, DEFAULT_ADDON_URLS);
      return [...DEFAULT_ADDON_URLS];
    }
    async fetchAddon(baseUrl) {
      const cleanBaseUrl = this.canonicalizeUrl(baseUrl);
      const result = await safeApiCall(() => AddonApi.getManifest(cleanBaseUrl));
      if (result.status === "success") {
        const addon = this.mapManifest(result.data, cleanBaseUrl);
        this.manifestCache.set(cleanBaseUrl, addon);
        return { status: "success", data: addon };
      }
      const cached = this.manifestCache.get(cleanBaseUrl);
      if (cached) {
        return { status: "success", data: cached };
      }
      const fallback = this.getBuiltinFallbackManifest(cleanBaseUrl);
      if (fallback) {
        this.manifestCache.set(cleanBaseUrl, fallback);
        return { status: "success", data: fallback };
      }
      return result;
    }
    async getInstalledAddons() {
      const urls = this.getInstalledAddonUrls();
      const fetched = await Promise.all(urls.map((url) => this.fetchAddon(url)));
      const addons = fetched.filter((result) => result.status === "success").map((result) => result.data);
      return this.applyDisplayNames(addons);
    }
    async addAddon(url) {
      const clean = this.canonicalizeUrl(url);
      if (!clean) {
        return;
      }
      const current = this.getInstalledAddonUrls();
      if (current.includes(clean)) {
        return false;
      }
      LocalStore.set(ADDON_URLS_KEY, [...current, clean]);
      this.notifyAddonsChanged("add");
      return true;
    }
    async removeAddon(url) {
      const clean = this.canonicalizeUrl(url);
      const current = this.getInstalledAddonUrls();
      const next = current.filter((value) => this.canonicalizeUrl(value) !== clean);
      if (next.length === current.length) {
        return false;
      }
      LocalStore.set(ADDON_URLS_KEY, next);
      this.manifestCache.delete(clean);
      this.notifyAddonsChanged("remove");
      return true;
    }
    async setAddonOrder(urls, options = {}) {
      const silent = Boolean(options == null ? void 0 : options.silent);
      const normalized = (urls || []).map((url) => this.canonicalizeUrl(url)).filter(Boolean);
      const current = this.getInstalledAddonUrls();
      const changed = JSON.stringify(current) !== JSON.stringify(normalized);
      LocalStore.set(ADDON_URLS_KEY, normalized);
      if (changed && !silent) {
        this.notifyAddonsChanged("reorder");
      }
      return changed;
    }
    onInstalledAddonsChanged(listener) {
      if (typeof listener !== "function") {
        return () => {
        };
      }
      this.changeListeners.add(listener);
      return () => {
        this.changeListeners.delete(listener);
      };
    }
    notifyAddonsChanged(reason = "unknown") {
      this.changeListeners.forEach((listener) => {
        try {
          listener(reason);
        } catch (error) {
          console.warn("Addon change listener failed", error);
        }
      });
    }
    applyDisplayNames(addons) {
      const nameCount = {};
      addons.forEach((addon) => {
        nameCount[addon.name] = (nameCount[addon.name] || 0) + 1;
      });
      const counters = {};
      return addons.map((addon) => {
        if ((nameCount[addon.name] || 0) <= 1) {
          return addon;
        }
        counters[addon.name] = (counters[addon.name] || 0) + 1;
        const occurrence = counters[addon.name];
        return {
          ...addon,
          displayName: occurrence === 1 ? addon.name : `${addon.name} (${occurrence})`
        };
      });
    }
    mapManifest(manifest = {}, baseUrl) {
      const types = (manifest.types || []).map((value) => String(value).trim()).filter(Boolean);
      const catalogs = (manifest.catalogs || []).map((catalog) => ({
        id: catalog.id,
        name: catalog.name || catalog.id,
        apiType: (catalog.type || "").trim(),
        extra: Array.isArray(catalog.extra) ? catalog.extra.map((entry) => ({
          name: entry.name,
          isRequired: Boolean(entry.isRequired),
          options: Array.isArray(entry.options) ? entry.options : null
        })) : []
      }));
      return {
        id: manifest.id || baseUrl,
        name: manifest.name || "Unknown Addon",
        displayName: manifest.name || "Unknown Addon",
        version: manifest.version || "0.0.0",
        description: manifest.description || null,
        logo: manifest.logo || null,
        baseUrl,
        types,
        rawTypes: types,
        catalogs,
        resources: this.parseResources(manifest.resources || [], types)
      };
    }
    parseResources(resources, defaultTypes) {
      return resources.map((resource) => {
        if (typeof resource === "string") {
          return {
            name: resource,
            types: [...defaultTypes],
            idPrefixes: null
          };
        }
        if (resource && typeof resource === "object") {
          return {
            name: resource.name || "",
            types: Array.isArray(resource.types) ? resource.types : [...defaultTypes],
            idPrefixes: Array.isArray(resource.idPrefixes) ? resource.idPrefixes : null
          };
        }
        return null;
      }).filter(Boolean);
    }
    getBuiltinFallbackManifest(baseUrl) {
      if (this.canonicalizeUrl(baseUrl) !== "https://v3-cinemeta.strem.io") {
        return null;
      }
      return {
        id: "org.cinemeta",
        name: "Cinemeta",
        displayName: "Cinemeta",
        version: "fallback",
        description: "Fallback Cinemeta manifest",
        logo: null,
        baseUrl: "https://v3-cinemeta.strem.io",
        types: ["movie", "series"],
        rawTypes: ["movie", "series"],
        resources: [
          { name: "catalog", types: ["movie", "series"], idPrefixes: null },
          { name: "meta", types: ["movie", "series"], idPrefixes: null }
        ],
        catalogs: [
          { id: "top", name: "Top Movies", apiType: "movie", extra: [] },
          { id: "top", name: "Top Series", apiType: "series", extra: [] }
        ]
      };
    }
  };
  var addonRepository = new AddonRepository();

  // js/data/remote/api/catalogApi.js
  var CatalogApi = {
    async getCatalog(url) {
      return httpRequest(url, {
        includeSessionAuth: false
      });
    }
  };

  // js/data/repository/catalogRepository.js
  var CatalogRepository = class {
    constructor() {
      this.catalogCache = /* @__PURE__ */ new Map();
    }
    async getCatalog({
      addonBaseUrl,
      addonId,
      addonName,
      catalogId,
      catalogName,
      type,
      skip = 0,
      extraArgs = {},
      supportsSkip = true
    }) {
      const cacheKey = this.buildCacheKey({
        addonId,
        type,
        catalogId,
        skip,
        extraArgs
      });
      const cached = this.catalogCache.get(cacheKey);
      if (cached) {
        return {
          status: "success",
          data: cached
        };
      }
      const url = this.buildCatalogUrl({
        baseUrl: addonBaseUrl,
        type,
        catalogId,
        skip,
        extraArgs
      });
      return safeApiCall(
        () => CatalogApi.getCatalog(url).then((dto) => {
          const items = ((dto == null ? void 0 : dto.metas) || []).map((meta) => this.mapMeta(meta));
          const row = {
            addonId,
            addonName,
            addonBaseUrl,
            catalogId,
            catalogName,
            apiType: type,
            items,
            isLoading: false,
            hasMore: Boolean(supportsSkip && items.length > 0),
            currentPage: Math.floor(skip / 100),
            supportsSkip
          };
          this.catalogCache.set(cacheKey, row);
          return row;
        })
      );
    }
    buildCatalogUrl({ baseUrl, type, catalogId, skip = 0, extraArgs = {} }) {
      const cleanBaseUrl = String(baseUrl || "").replace(/\/+$/, "");
      const args = { ...extraArgs };
      if (Object.keys(args).length === 0) {
        return skip > 0 ? `${cleanBaseUrl}/catalog/${type}/${catalogId}/skip=${skip}.json` : `${cleanBaseUrl}/catalog/${type}/${catalogId}.json`;
      }
      if (skip > 0 && !Object.prototype.hasOwnProperty.call(args, "skip")) {
        args.skip = String(skip);
      }
      const query = Object.entries(args).map(([key, value]) => `${this.encodeArg(key)}=${this.encodeArg(String(value))}`).join("&");
      return `${cleanBaseUrl}/catalog/${type}/${catalogId}/${query}.json`;
    }
    buildCacheKey({ addonId, type, catalogId, skip = 0, extraArgs = {} }) {
      const normalizedArgs = Object.entries(extraArgs).sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => `${key}=${value}`).join("&");
      return `${addonId}_${type}_${catalogId}_${skip}_${normalizedArgs}`;
    }
    encodeArg(value) {
      return encodeURIComponent(value).replace(/\+/g, "%20");
    }
    mapMeta(meta = {}) {
      return {
        id: meta.id || "",
        name: meta.name || "Untitled",
        type: meta.type || "",
        poster: meta.poster || null,
        background: meta.background || null,
        logo: meta.logo || null,
        description: meta.description || "",
        releaseInfo: meta.releaseInfo || "",
        genres: Array.isArray(meta.genres) ? meta.genres : []
      };
    }
  };
  var catalogRepository = new CatalogRepository();

  // js/data/local/watchProgressStore.js
  var WATCH_PROGRESS_KEY = "watchProgressItems";
  function normalizeProgress(progress = {}, profileId = 1) {
    const updatedAt = Number(progress.updatedAt || Date.now());
    const season = progress.season == null ? null : Number(progress.season);
    const episode = progress.episode == null ? null : Number(progress.episode);
    const normalizedProfileId = String(progress.profileId || profileId || "1");
    return {
      ...progress,
      profileId: normalizedProfileId,
      contentId: String(progress.contentId || "").trim(),
      contentType: String(progress.contentType || "movie").trim() || "movie",
      videoId: progress.videoId == null ? null : String(progress.videoId),
      season: Number.isFinite(season) ? season : null,
      episode: Number.isFinite(episode) ? episode : null,
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now()
    };
  }
  function progressKey(progress = {}) {
    const profileId = String(progress.profileId || "1").trim() || "1";
    const contentId = String(progress.contentId || "").trim();
    const videoId = progress.videoId == null ? "main" : String(progress.videoId).trim();
    const season = progress.season == null ? "" : String(Number(progress.season));
    const episode = progress.episode == null ? "" : String(Number(progress.episode));
    return `${profileId}::${contentId}::${videoId}::${season}::${episode}`;
  }
  function dedupeAndSort(items = []) {
    const byKey = /* @__PURE__ */ new Map();
    (items || []).forEach((raw) => {
      const item = normalizeProgress(raw);
      if (!item.contentId) {
        return;
      }
      const key = progressKey(item);
      const existing = byKey.get(key);
      if (!existing || Number(item.updatedAt || 0) > Number(existing.updatedAt || 0)) {
        byKey.set(key, item);
      }
    });
    return Array.from(byKey.values()).sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0));
  }
  var WatchProgressStore = {
    listAll() {
      return dedupeAndSort(LocalStore.get(WATCH_PROGRESS_KEY, []));
    },
    listForProfile(profileId) {
      const pid = String(profileId || "1");
      return this.listAll().filter((item) => String(item.profileId || "1") === pid);
    },
    upsert(progress, profileId) {
      const pid = String(profileId || "1");
      const normalized = normalizeProgress(progress, pid);
      if (!normalized.contentId) {
        return;
      }
      const items = this.listAll();
      const key = progressKey(normalized);
      const next = dedupeAndSort([
        normalized,
        ...items.filter((item) => progressKey(item) !== key)
      ]).slice(0, 5e3);
      LocalStore.set(WATCH_PROGRESS_KEY, next);
    },
    findByContentId(contentId, profileId) {
      const wanted = String(contentId || "").trim();
      return this.listForProfile(profileId).find((item) => item.contentId === wanted) || null;
    },
    remove(contentId, videoId = null, profileId) {
      const wantedContentId = String(contentId || "").trim();
      const wantedVideoId = videoId == null ? null : String(videoId);
      const pid = String(profileId || "1");
      const next = this.listAll().filter((item) => {
        if (String(item.profileId || "1") !== pid) {
          return true;
        }
        if (item.contentId !== wantedContentId) {
          return true;
        }
        if (wantedVideoId == null) {
          return false;
        }
        return String(item.videoId || "") !== wantedVideoId;
      });
      LocalStore.set(WATCH_PROGRESS_KEY, next);
    },
    replaceForProfile(profileId, items = []) {
      const pid = String(profileId || "1");
      const keepOtherProfiles = this.listAll().filter((item) => String(item.profileId || "1") !== pid);
      const normalized = (Array.isArray(items) ? items : []).map((item) => normalizeProgress(item, pid)).filter((item) => Boolean(item.contentId));
      const next = dedupeAndSort([...normalized, ...keepOtherProfiles]).slice(0, 5e3);
      LocalStore.set(WATCH_PROGRESS_KEY, next);
    }
  };

  // js/core/profile/profileManager.js
  var PROFILES_KEY = "profiles";
  var ACTIVE_PROFILE_ID_KEY = "activeProfileId";
  var DEFAULT_PROFILES = [
    { id: "1", profileIndex: 1, name: "Profile 1", avatarColorHex: "#1E88E5", isPrimary: true }
  ];
  function normalizeProfile(profile, index = 0) {
    const fallbackIndex = index + 1;
    const profileIndex = Number((profile == null ? void 0 : profile.profileIndex) || (profile == null ? void 0 : profile.profile_index) || (profile == null ? void 0 : profile.id) || fallbackIndex);
    const normalizedIndex = Number.isFinite(profileIndex) && profileIndex > 0 ? Math.trunc(profileIndex) : fallbackIndex;
    return {
      ...profile,
      id: String(normalizedIndex),
      profileIndex: normalizedIndex
    };
  }
  var ProfileManager = {
    async getProfiles() {
      const stored = LocalStore.get(PROFILES_KEY, null);
      if (Array.isArray(stored) && stored.length) {
        const normalized = stored.map((profile, index) => normalizeProfile(profile, index));
        LocalStore.set(PROFILES_KEY, normalized);
        return normalized;
      }
      LocalStore.set(PROFILES_KEY, DEFAULT_PROFILES);
      return DEFAULT_PROFILES;
    },
    async replaceProfiles(profiles) {
      const normalized = (Array.isArray(profiles) ? profiles : []).map((profile, index) => normalizeProfile(profile, index));
      LocalStore.set(PROFILES_KEY, normalized);
    },
    async setActiveProfile(id) {
      LocalStore.set(ACTIVE_PROFILE_ID_KEY, String(id));
    },
    getActiveProfileId() {
      const raw = LocalStore.get(ACTIVE_PROFILE_ID_KEY, null);
      if (raw == null) {
        return "1";
      }
      return String(raw);
    }
  };

  // js/data/repository/watchProgressRepository.js
  function activeProfileId() {
    return String(ProfileManager.getActiveProfileId() || "1");
  }
  var WatchProgressRepository = class {
    async saveProgress(progress) {
      WatchProgressStore.upsert({
        ...progress,
        updatedAt: progress.updatedAt || Date.now()
      }, activeProfileId());
    }
    async getProgressByContentId(contentId) {
      return WatchProgressStore.findByContentId(contentId, activeProfileId());
    }
    async removeProgress(contentId, videoId = null) {
      WatchProgressStore.remove(contentId, videoId, activeProfileId());
    }
    async getRecent(limit = 30) {
      const byContent = /* @__PURE__ */ new Map();
      WatchProgressStore.listForProfile(activeProfileId()).forEach((item) => {
        if (!(item == null ? void 0 : item.contentId)) {
          return;
        }
        const existing = byContent.get(item.contentId);
        if (!existing || Number(item.updatedAt || 0) > Number(existing.updatedAt || 0)) {
          byContent.set(item.contentId, item);
        }
      });
      return Array.from(byContent.values()).sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0)).slice(0, limit);
    }
    async getAll() {
      return WatchProgressStore.listForProfile(activeProfileId());
    }
    async replaceAll(items) {
      WatchProgressStore.replaceForProfile(activeProfileId(), items || []);
    }
  };
  var watchProgressRepository = new WatchProgressRepository();

  // js/data/local/layoutPreferences.js
  var KEY = "layoutPreferences";
  var DEFAULTS = {
    homeLayout: "classic",
    heroSectionEnabled: true,
    posterLabelsEnabled: true
  };
  var LayoutPreferences = {
    get() {
      return {
        ...DEFAULTS,
        ...LocalStore.get(KEY, {}) || {}
      };
    },
    set(partial) {
      LocalStore.set(KEY, { ...this.get(), ...partial || {} });
    }
  };

  // js/data/local/homeCatalogStore.js
  var KEY2 = "homeCatalogPrefs";
  var DEFAULTS2 = {
    order: [],
    disabled: []
  };
  function unique(array) {
    return Array.from(new Set(array || []));
  }
  var HomeCatalogStore = {
    get() {
      const stored = LocalStore.get(KEY2, {}) || {};
      return {
        order: unique(Array.isArray(stored.order) ? stored.order : []),
        disabled: unique(Array.isArray(stored.disabled) ? stored.disabled : [])
      };
    },
    set(partial) {
      LocalStore.set(KEY2, { ...this.get(), ...partial || {} });
    },
    isDisabled(key) {
      return this.get().disabled.includes(key);
    },
    toggleDisabled(key) {
      const current = this.get();
      const disabled = current.disabled.includes(key) ? current.disabled.filter((item) => item !== key) : [...current.disabled, key];
      this.set({ disabled });
    },
    setOrder(order) {
      this.set({ order: unique(order || []) });
    },
    ensureOrderKeys(keys) {
      const current = this.get();
      const valid = current.order.filter((key) => keys.includes(key));
      const missing = keys.filter((key) => !valid.includes(key));
      const next = [...valid, ...missing];
      this.set({ order: next });
      return next;
    },
    reset() {
      LocalStore.set(KEY2, DEFAULTS2);
    }
  };

  // js/data/local/tmdbSettingsStore.js
  var KEY3 = "tmdbSettings";
  var ANDROID_TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
  var DEFAULTS3 = {
    enabled: true,
    apiKey: ANDROID_TMDB_API_KEY,
    language: "it-IT",
    useArtwork: true,
    useBasicInfo: true,
    useDetails: true
  };
  var TmdbSettingsStore = {
    get() {
      return {
        ...DEFAULTS3,
        ...LocalStore.get(KEY3, {}) || {}
      };
    },
    set(partial) {
      LocalStore.set(KEY3, { ...this.get(), ...partial || {} });
    }
  };

  // js/core/tmdb/tmdbService.js
  var TMDB_BASE_URL = "https://api.themoviedb.org/3";
  var DEFAULT_TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
  function getContentType(type) {
    const normalized = String(type || "").toLowerCase();
    if (normalized === "series" || normalized === "tv" || normalized === "show") {
      return "tv";
    }
    return "movie";
  }
  var TmdbService = {
    async ensureTmdbId(id, type = "movie") {
      var _a, _b;
      const settings = TmdbSettingsStore.get();
      const apiKey = String(settings.apiKey || DEFAULT_TMDB_API_KEY || "").trim();
      if (!settings.enabled || !apiKey) {
        return null;
      }
      const rawId = String(id || "").trim();
      if (!rawId) {
        return null;
      }
      const idPart = rawId.replace(/^tmdb:/i, "").replace(/^movie:/i, "").replace(/^series:/i, "").trim();
      const normalizedIdPart = ((_b = (_a = idPart.split(":")[0]) == null ? void 0 : _a.split("/")[0]) == null ? void 0 : _b.trim()) || "";
      if (/^\d+$/.test(normalizedIdPart)) {
        return normalizedIdPart;
      }
      if (!normalizedIdPart.startsWith("tt")) {
        return null;
      }
      const contentType = getContentType(type);
      const url = `${TMDB_BASE_URL}/find/${encodeURIComponent(normalizedIdPart)}?external_source=imdb_id&api_key=${encodeURIComponent(apiKey)}`;
      const response = await fetch(url);
      if (!response.ok) {
        return null;
      }
      const data = await response.json();
      const list = contentType === "tv" ? data.tv_results : data.movie_results;
      const first = Array.isArray(list) ? list[0] : null;
      if (!(first == null ? void 0 : first.id)) {
        return null;
      }
      return String(first.id);
    }
  };

  // js/core/tmdb/tmdbMetadataService.js
  var TMDB_BASE_URL2 = "https://api.themoviedb.org/3";
  var IMAGE_BASE_URL = "https://image.tmdb.org/t/p/original";
  var DEFAULT_TMDB_API_KEY2 = "439c478a771f35c05022f9feabcca01c";
  function resolveType(contentType) {
    const normalized = String(contentType || "").toLowerCase();
    if (normalized === "series" || normalized === "tv" || normalized === "show") {
      return "tv";
    }
    return "movie";
  }
  function toImageUrl(path) {
    if (!path) {
      return null;
    }
    return `${IMAGE_BASE_URL}${path}`;
  }
  var TmdbMetadataService = {
    async fetchEnrichment({ tmdbId, contentType, language = null } = {}) {
      var _a, _b;
      const settings = TmdbSettingsStore.get();
      const apiKey = String(settings.apiKey || DEFAULT_TMDB_API_KEY2 || "").trim();
      if (!settings.enabled || !apiKey || !tmdbId) {
        return null;
      }
      const type = resolveType(contentType);
      const lang = language || settings.language || "en-US";
      const params = `api_key=${encodeURIComponent(apiKey)}&language=${encodeURIComponent(lang)}&append_to_response=images,credits&include_image_language=${encodeURIComponent(lang)},null`;
      const url = `${TMDB_BASE_URL2}/${type}/${encodeURIComponent(String(tmdbId))}?${params}`;
      const response = await fetch(url);
      if (!response.ok) {
        return null;
      }
      const data = await response.json();
      const logoPath = Array.isArray((_a = data == null ? void 0 : data.images) == null ? void 0 : _a.logos) ? (_b = data.images.logos[0]) == null ? void 0 : _b.file_path : null;
      const releaseYear = type === "tv" ? String(data.first_air_date || "").slice(0, 4) : String(data.release_date || "").slice(0, 4);
      const companies = Array.isArray(data == null ? void 0 : data.production_companies) ? data.production_companies.map((company) => ({
        name: (company == null ? void 0 : company.name) || "",
        logo: toImageUrl((company == null ? void 0 : company.logo_path) || null)
      })).filter((company) => company.name || company.logo) : [];
      return {
        localizedTitle: data.title || data.name || null,
        description: data.overview || null,
        backdrop: toImageUrl(data.backdrop_path),
        poster: toImageUrl(data.poster_path),
        logo: toImageUrl(logoPath),
        genres: Array.isArray(data.genres) ? data.genres.map((genre) => genre.name).filter(Boolean) : [],
        rating: typeof data.vote_average === "number" ? data.vote_average : null,
        releaseInfo: releaseYear || null,
        credits: data.credits || null,
        companies
      };
    },
    async fetchSeasonRatings({ tmdbId, seasonNumber, language = null } = {}) {
      const settings = TmdbSettingsStore.get();
      const apiKey = String(settings.apiKey || DEFAULT_TMDB_API_KEY2 || "").trim();
      if (!settings.enabled || !apiKey || !tmdbId || !Number.isFinite(Number(seasonNumber))) {
        return [];
      }
      const lang = language || settings.language || "en-US";
      const url = `${TMDB_BASE_URL2}/tv/${encodeURIComponent(String(tmdbId))}/season/${encodeURIComponent(String(seasonNumber))}?api_key=${encodeURIComponent(apiKey)}&language=${encodeURIComponent(lang)}`;
      const response = await fetch(url);
      if (!response.ok) {
        return [];
      }
      const data = await response.json();
      const episodes = Array.isArray(data == null ? void 0 : data.episodes) ? data.episodes : [];
      return episodes.map((episode) => ({
        episode: Number((episode == null ? void 0 : episode.episode_number) || 0),
        rating: typeof (episode == null ? void 0 : episode.vote_average) === "number" ? Number(episode.vote_average.toFixed(1)) : null
      })).filter((item) => item.episode > 0);
    }
  };

  // js/data/remote/api/metaApi.js
  var MetaApi = {
    async getMeta(url) {
      return httpRequest(url, {
        includeSessionAuth: false
      });
    }
  };

  // js/data/repository/metaRepository.js
  var MetaRepository = class {
    constructor() {
      this.metaCache = /* @__PURE__ */ new Map();
    }
    async getMeta(addonBaseUrl, type, id) {
      var _a;
      const cacheKey = `${addonBaseUrl}:${type}:${id}`;
      if (this.metaCache.has(cacheKey)) {
        return { status: "success", data: this.metaCache.get(cacheKey) };
      }
      const url = this.buildMetaUrl(addonBaseUrl, type, id);
      const result = await safeApiCall(() => MetaApi.getMeta(url));
      if (result.status !== "success") {
        return result;
      }
      const meta = this.mapMeta(((_a = result.data) == null ? void 0 : _a.meta) || null);
      if (!meta) {
        return { status: "error", message: "Meta not found", code: 404 };
      }
      this.metaCache.set(cacheKey, meta);
      return { status: "success", data: meta };
    }
    async getMetaFromAllAddons(type, id) {
      const addons = await addonRepository.getInstalledAddons();
      for (const addon of addons) {
        const supportsMeta = addon.resources.some((resource) => {
          if (resource.name !== "meta") {
            return false;
          }
          if (!resource.types || resource.types.length === 0) {
            return true;
          }
          return resource.types.some((resourceType) => resourceType === type);
        });
        if (!supportsMeta) {
          continue;
        }
        const result = await this.getMeta(addon.baseUrl, type, id);
        if (result.status === "success") {
          return result;
        }
      }
      return { status: "error", message: "Meta not found in installed addons", code: 404 };
    }
    buildMetaUrl(baseUrl, type, id) {
      const cleanBaseUrl = String(baseUrl || "").replace(/\/+$/, "");
      return `${cleanBaseUrl}/meta/${this.encode(type)}/${this.encode(id)}.json`;
    }
    encode(value) {
      return encodeURIComponent(String(value || "")).replace(/\+/g, "%20");
    }
    mapMeta(meta) {
      if (!meta) {
        return null;
      }
      return {
        ...meta,
        id: meta.id || "",
        type: meta.type || "",
        name: meta.name || "Untitled",
        poster: meta.poster || null,
        background: meta.background || null,
        logo: meta.logo || null,
        description: meta.description || "",
        genres: Array.isArray(meta.genres) ? meta.genres : [],
        videos: Array.isArray(meta.videos) ? meta.videos : [],
        releaseInfo: meta.releaseInfo || ""
      };
    }
    clearCache() {
      this.metaCache.clear();
    }
  };
  var metaRepository = new MetaRepository();

  // js/ui/screens/home/homeScreen.js
  function isSearchOnlyCatalog(catalog) {
    return (catalog.extra || []).some((extra) => extra.name === "search" && extra.isRequired);
  }
  function catalogKey(catalog) {
    return `${catalog.addonId}|${catalog.type}|${catalog.catalogId}|${catalog.catalogName}`;
  }
  function toTitleCase(value) {
    const raw = String(value || "").trim();
    if (!raw) {
      return "";
    }
    return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
  }
  function escapeRegExp(value) {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  function formatCatalogRowTitle(catalogName, addonName, type) {
    const typeLabel = toTitleCase(type || "movie") || "Movie";
    let base = String(catalogName || "").trim();
    if (!base) {
      return typeLabel;
    }
    const addon = String(addonName || "").trim();
    const cleanedAddon = addon.replace(/\baddon\b/i, "").trim();
    const cleanupTerms = [
      addon,
      cleanedAddon,
      "The Movie Database Addon",
      "TMDB Addon",
      "Addon"
    ].filter(Boolean);
    cleanupTerms.forEach((term) => {
      const regex = new RegExp(`\\s*-?\\s*${escapeRegExp(term)}\\s*`, "ig");
      base = base.replace(regex, " ");
    });
    base = base.replace(/\s{2,}/g, " ").trim();
    if (!base) {
      return typeLabel;
    }
    const endsWithType = new RegExp(`\\b${escapeRegExp(typeLabel)}$`, "i").test(base);
    if (endsWithType) {
      return base;
    }
    return `${base} - ${typeLabel}`;
  }
  function prettyId(value) {
    const raw = String(value || "").trim();
    if (!raw) {
      return "Untitled";
    }
    if (raw.includes(":")) {
      return raw.split(":").pop() || raw;
    }
    return raw;
  }
  function profileInitial(name) {
    const raw = String(name || "").trim();
    const first = raw.charAt(0);
    return first ? first.toUpperCase() : "P";
  }
  async function withTimeout(promise, ms, fallbackValue) {
    let timer = null;
    try {
      return await Promise.race([
        promise,
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(fallbackValue), ms);
        })
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
  function navIconSvg(action) {
    const iconByAction = {
      gotoHome: "M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z",
      gotoSearch: "M15.5 14h-.8l-.3-.3A6.5 6.5 0 1 0 14 15.5l.3.3v.8L20 22l2-2-6.5-6.5zM6.5 11A4.5 4.5 0 1 1 11 15.5 4.5 4.5 0 0 1 6.5 11z",
      gotoLibrary: "M5 4h14a2 2 0 0 1 2 2v14l-4-2-4 2-4-2-4 2V6a2 2 0 0 1 2-2z",
      gotoPlugin: "M19 11h-1V9a2 2 0 0 0-2-2h-2V5a2 2 0 0 0-4 0v2H8a2 2 0 0 0-2 2v2H5a2 2 0 0 0 0 4h1v2a2 2 0 0 0 2 2h2v1a2 2 0 0 0 4 0v-1h2a2 2 0 0 0 2-2v-2h1a2 2 0 0 0 0-4z",
      gotoSettings: "M19.1 12.9c.1-.3.1-.6.1-.9s0-.6-.1-.9l2.1-1.6a.5.5 0 0 0 .1-.6l-2-3.5a.5.5 0 0 0-.6-.2l-2.5 1a7 7 0 0 0-1.6-.9l-.4-2.6a.5.5 0 0 0-.5-.4h-4a.5.5 0 0 0-.5.4l-.4 2.6a7 7 0 0 0-1.6.9l-2.5-1a.5.5 0 0 0-.6.2l-2 3.5a.5.5 0 0 0 .1.6l2.1 1.6c-.1.3-.1.6-.1.9s0 .6.1.9L2.3 14.5a.5.5 0 0 0-.1.6l2 3.5a.5.5 0 0 0 .6.2l2.5-1c.5.4 1 .7 1.6.9l.4 2.6a.5.5 0 0 0 .5.4h4a.5.5 0 0 0 .5-.4l.4-2.6c.6-.2 1.1-.5 1.6-.9l2.5 1a.5.5 0 0 0 .6-.2l2-3.5a.5.5 0 0 0-.1-.6l-2.1-1.6zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z",
      gotoAccount: "M12 12a4 4 0 1 0-4-4 4 4 0 0 0 4 4zm0 2c-4.4 0-8 2-8 4.5V21h16v-2.5C20 16 16.4 14 12 14z",
      toggleLayout: "M3 5h8v6H3zm10 0h8v6h-8zM3 13h8v6H3zm10 0h8v6h-8z"
    };
    const path = iconByAction[action] || iconByAction.gotoHome;
    return `
    <svg viewBox="0 0 24 24" class="home-nav-icon" aria-hidden="true" focusable="false">
      <path d="${path}" fill="currentColor"></path>
    </svg>
  `;
  }
  var HomeScreen = {
    stopHeroRotation() {
      if (this.heroRotateTimer) {
        clearInterval(this.heroRotateTimer);
        this.heroRotateTimer = null;
      }
    },
    startHeroRotation() {
      this.stopHeroRotation();
      if (!Array.isArray(this.heroCandidates) || this.heroCandidates.length <= 1) {
        return;
      }
      this.heroRotateTimer = setInterval(() => {
        this.rotateHero();
      }, 9e3);
    },
    rotateHero() {
      if (!Array.isArray(this.heroCandidates) || this.heroCandidates.length <= 1) {
        return;
      }
      this.heroIndex = (Number(this.heroIndex) + 1) % this.heroCandidates.length;
      this.heroItem = this.heroCandidates[this.heroIndex];
      this.applyHeroToDom();
    },
    applyHeroToDom() {
      var _a, _b;
      const heroNode = (_a = this.container) == null ? void 0 : _a.querySelector(".home-hero-card");
      if (!heroNode) {
        return;
      }
      const hero = this.heroItem || ((_b = this.heroCandidates) == null ? void 0 : _b[0]) || null;
      heroNode.dataset.itemId = (hero == null ? void 0 : hero.id) || "";
      heroNode.dataset.itemType = (hero == null ? void 0 : hero.type) || "movie";
      heroNode.dataset.itemTitle = (hero == null ? void 0 : hero.name) || "Untitled";
      const title = heroNode.querySelector(".home-hero-title");
      if (title) {
        title.textContent = (hero == null ? void 0 : hero.name) || "No featured item";
      }
      const description = heroNode.querySelector(".home-hero-description");
      if (description) {
        description.textContent = (hero == null ? void 0 : hero.description) || "";
      }
      const desiredImage = (hero == null ? void 0 : hero.background) || (hero == null ? void 0 : hero.poster) || "";
      let backdrop = heroNode.querySelector(".featured-backdrop");
      if (desiredImage) {
        if (!backdrop) {
          backdrop = document.createElement("img");
          backdrop.className = "featured-backdrop";
          backdrop.alt = (hero == null ? void 0 : hero.name) || "featured";
          heroNode.insertBefore(backdrop, heroNode.firstChild);
        }
        backdrop.src = desiredImage;
        backdrop.alt = (hero == null ? void 0 : hero.name) || "featured";
      } else {
        backdrop == null ? void 0 : backdrop.remove();
      }
    },
    setSidebarExpanded(expanded) {
      var _a;
      const sidebar = (_a = this.container) == null ? void 0 : _a.querySelector(".home-sidebar");
      if (!sidebar) {
        return;
      }
      sidebar.classList.toggle("expanded", Boolean(expanded));
    },
    isSidebarNode(node) {
      var _a;
      return String(((_a = node == null ? void 0 : node.dataset) == null ? void 0 : _a.navZone) || "") === "sidebar";
    },
    isMainNode(node) {
      var _a;
      return String(((_a = node == null ? void 0 : node.dataset) == null ? void 0 : _a.navZone) || "") === "main";
    },
    focusWithoutAutoScroll(target) {
      if (!target || typeof target.focus !== "function") {
        return;
      }
      try {
        target.focus({ preventScroll: true });
      } catch (_) {
        target.focus();
      }
    },
    ensureMainVerticalVisibility(target) {
      var _a;
      const main = (_a = this.container) == null ? void 0 : _a.querySelector(".home-main");
      if (!main || !target || !main.contains(target)) {
        return;
      }
      const rect = target.getBoundingClientRect();
      const mainRect = main.getBoundingClientRect();
      const pad = 14;
      if (rect.bottom > mainRect.bottom - pad) {
        main.scrollTop += Math.ceil(rect.bottom - mainRect.bottom + pad);
      } else if (rect.top < mainRect.top + pad) {
        main.scrollTop -= Math.ceil(mainRect.top + pad - rect.top);
      }
    },
    ensureTrackHorizontalVisibility(target, direction = null) {
      var _a;
      const track = (_a = target == null ? void 0 : target.closest) == null ? void 0 : _a.call(target, ".home-track");
      if (!track) {
        return;
      }
      const targetLeft = target.offsetLeft;
      const targetRight = targetLeft + target.offsetWidth;
      const viewLeft = track.scrollLeft;
      const viewRight = viewLeft + track.clientWidth;
      const step = target.offsetWidth + 18;
      if (targetRight > viewRight) {
        const overshoot = targetRight - viewRight;
        const delta = direction === "right" ? Math.max(step, overshoot) : overshoot;
        track.scrollLeft = Math.min(track.scrollWidth - track.clientWidth, viewLeft + delta);
        return;
      }
      if (targetLeft < viewLeft) {
        const overshoot = viewLeft - targetLeft;
        const delta = direction === "left" ? Math.max(step, overshoot) : overshoot;
        track.scrollLeft = Math.max(0, viewLeft - delta);
      }
    },
    focusNode(current, target, direction = null) {
      if (!current || !target || current === target) {
        return false;
      }
      current.classList.remove("focused");
      target.classList.add("focused");
      this.focusWithoutAutoScroll(target);
      this.setSidebarExpanded(this.isSidebarNode(target));
      if (this.isMainNode(target)) {
        this.lastMainFocus = target;
        this.ensureTrackHorizontalVisibility(target, direction);
        this.ensureMainVerticalVisibility(target);
      }
      return true;
    },
    buildNavigationModel() {
      var _a, _b, _c, _d;
      const sidebar = Array.from(((_a = this.container) == null ? void 0 : _a.querySelectorAll(".home-sidebar .focusable")) || []);
      const rows = [];
      const hero = (_b = this.container) == null ? void 0 : _b.querySelector(".home-hero-card.focusable");
      if (hero) {
        rows.push([hero]);
      }
      const trackSections = Array.from(((_c = this.container) == null ? void 0 : _c.querySelectorAll(".home-main .home-row")) || []);
      trackSections.forEach((section) => {
        const track = section.querySelector(".home-track");
        if (!track) {
          return;
        }
        const cards = Array.from(track.querySelectorAll(".home-content-card.focusable"));
        if (cards.length) {
          rows.push(cards);
        }
      });
      sidebar.forEach((node, index) => {
        node.dataset.navZone = "sidebar";
        node.dataset.navIndex = String(index);
      });
      rows.forEach((rowNodes, rowIndex) => {
        rowNodes.forEach((node, colIndex) => {
          node.dataset.navZone = "main";
          node.dataset.navRow = String(rowIndex);
          node.dataset.navCol = String(colIndex);
        });
      });
      this.navModel = { sidebar, rows };
      this.lastMainFocus = ((_d = rows[0]) == null ? void 0 : _d[0]) || null;
    },
    handleHomeDpad(event) {
      var _a, _b;
      const keyCode = Number((event == null ? void 0 : event.keyCode) || 0);
      const direction = keyCode === 38 ? "up" : keyCode === 40 ? "down" : keyCode === 37 ? "left" : keyCode === 39 ? "right" : null;
      if (!direction) {
        return false;
      }
      const nav = this.navModel;
      if (!nav) {
        return false;
      }
      const all = Array.from(((_a = this.container) == null ? void 0 : _a.querySelectorAll(".focusable")) || []);
      const current = this.container.querySelector(".focusable.focused") || all[0];
      if (!current) {
        return false;
      }
      const isSidebar = this.isSidebarNode(current);
      if (typeof (event == null ? void 0 : event.preventDefault) === "function") {
        event.preventDefault();
      }
      if (isSidebar) {
        const sidebarIndex = Number(current.dataset.navIndex || 0);
        if (direction === "up") {
          const target = nav.sidebar[Math.max(0, sidebarIndex - 1)] || current;
          return this.focusNode(current, target, direction) || true;
        }
        if (direction === "down") {
          const target = nav.sidebar[Math.min(nav.sidebar.length - 1, sidebarIndex + 1)] || current;
          return this.focusNode(current, target, direction) || true;
        }
        if (direction === "right") {
          const target = this.lastMainFocus && this.isMainNode(this.lastMainFocus) ? this.lastMainFocus : ((_b = nav.rows[0]) == null ? void 0 : _b[0]) || null;
          return this.focusNode(current, target, direction) || true;
        }
        return true;
      }
      const row = Number(current.dataset.navRow || 0);
      const col = Number(current.dataset.navCol || 0);
      const rowNodes = nav.rows[row] || [];
      if (direction === "left") {
        const targetInRow = rowNodes[col - 1] || null;
        if (this.focusNode(current, targetInRow, direction)) {
          return true;
        }
        const sidebarFallback = nav.sidebar[Math.min(row, nav.sidebar.length - 1)] || nav.sidebar[0] || null;
        return this.focusNode(current, sidebarFallback, direction) || true;
      }
      if (direction === "right") {
        const target = rowNodes[col + 1] || null;
        return this.focusNode(current, target, direction) || true;
      }
      if (direction === "up" || direction === "down") {
        const delta = direction === "up" ? -1 : 1;
        const targetRow = row + delta;
        const targetRowNodes = nav.rows[targetRow] || null;
        if (!targetRowNodes || !targetRowNodes.length) {
          return true;
        }
        const target = targetRowNodes[Math.min(col, targetRowNodes.length - 1)] || targetRowNodes[0];
        return this.focusNode(current, target, direction) || true;
      }
      return false;
    },
    async mount() {
      this.container = document.getElementById("home");
      ScreenUtils.show(this.container);
      const activeProfileId3 = String(ProfileManager.getActiveProfileId() || "");
      const profileChanged = activeProfileId3 !== String(this.loadedProfileId || "");
      if (profileChanged) {
        this.hasLoadedOnce = false;
      }
      if (this.hasLoadedOnce && Array.isArray(this.rows) && this.rows.length) {
        this.homeLoadToken = (this.homeLoadToken || 0) + 1;
        this.render();
        this.loadData({ background: true }).catch((error) => {
          console.warn("Home background refresh failed", error);
        });
        return;
      }
      this.homeLoadToken = (this.homeLoadToken || 0) + 1;
      this.container.innerHTML = `
      <div class="home-boot">
        <img src="assets/brand/app_logo_wordmark.png" class="home-boot-logo" alt="Nuvio" />
        <div class="home-boot-shimmer"></div>
      </div>
    `;
      await this.loadData({ background: false });
    },
    async loadData(options = {}) {
      const background = Boolean(options == null ? void 0 : options.background);
      const token = this.homeLoadToken;
      const prefs = LayoutPreferences.get();
      this.layoutMode = prefs.homeLayout || "classic";
      const addons = await addonRepository.getInstalledAddons();
      const catalogDescriptors = [];
      addons.forEach((addon) => {
        addon.catalogs.filter((catalog) => !isSearchOnlyCatalog(catalog)).slice(0, 8).forEach((catalog) => {
          catalogDescriptors.push({
            addonBaseUrl: addon.baseUrl,
            addonId: addon.id,
            addonName: addon.displayName,
            catalogId: catalog.id,
            catalogName: catalog.name,
            type: catalog.apiType
          });
        });
      });
      const initialDescriptors = catalogDescriptors.slice(0, 8);
      const deferredDescriptors = catalogDescriptors.slice(8);
      const initialRows = await this.fetchCatalogRows(initialDescriptors);
      if (token !== this.homeLoadToken) {
        return;
      }
      this.rows = this.sortAndFilterRows(initialRows);
      this.continueWatching = await watchProgressRepository.getRecent(10);
      if (token !== this.homeLoadToken) {
        return;
      }
      this.continueWatchingDisplay = this.continueWatching.map((item) => ({
        ...item,
        title: prettyId(item.contentId),
        poster: null
      }));
      this.heroCandidates = this.collectHeroCandidates(this.rows);
      this.heroIndex = 0;
      this.heroItem = this.heroCandidates[0] || this.pickHeroItem(this.rows);
      this.loadedProfileId = String(ProfileManager.getActiveProfileId() || "");
      const profiles = await ProfileManager.getProfiles();
      const activeProfile = profiles.find((profile) => String(profile.id || profile.profileIndex || "1") === this.loadedProfileId) || profiles[0] || null;
      this.activeProfileName = String((activeProfile == null ? void 0 : activeProfile.name) || "Profile").trim() || "Profile";
      this.activeProfileInitial = profileInitial(this.activeProfileName);
      this.hasLoadedOnce = true;
      this.render();
      if (deferredDescriptors.length) {
        this.fetchCatalogRows(deferredDescriptors).then((extraRows) => {
          if (token !== this.homeLoadToken || Router.getCurrent() !== "home") {
            return;
          }
          const combinedByKey = /* @__PURE__ */ new Map();
          [...this.rows, ...extraRows].forEach((row) => {
            combinedByKey.set(row.homeCatalogKey, row);
          });
          this.rows = this.sortAndFilterRows(Array.from(combinedByKey.values()));
          this.heroCandidates = this.collectHeroCandidates(this.rows);
          this.render();
        }).catch((error) => {
          console.warn("Deferred home rows load failed", error);
        });
      }
      this.enrichHero(this.heroCandidates[0] || null).then(() => {
        if (token !== this.homeLoadToken || Router.getCurrent() !== "home") {
          return;
        }
        this.applyHeroToDom();
      }).catch((error) => {
        console.warn("Hero async enrichment failed", error);
      });
      this.enrichContinueWatching(this.continueWatching).then((enriched) => {
        if (token !== this.homeLoadToken || Router.getCurrent() !== "home") {
          return;
        }
        this.continueWatchingDisplay = enriched;
        this.render();
      }).catch((error) => {
        console.warn("Continue watching async enrichment failed", error);
      });
    },
    async fetchCatalogRows(descriptors = []) {
      const rowResults = await Promise.all((descriptors || []).map(async (catalog) => {
        const result = await withTimeout(catalogRepository.getCatalog({
          addonBaseUrl: catalog.addonBaseUrl,
          addonId: catalog.addonId,
          addonName: catalog.addonName,
          catalogId: catalog.catalogId,
          catalogName: catalog.catalogName,
          type: catalog.type,
          skip: 0,
          supportsSkip: true
        }), 3500, { status: "error", message: "timeout" });
        return { ...catalog, result };
      }));
      return rowResults.filter((row) => row.result.status === "success").map((row) => ({
        ...row,
        homeCatalogKey: catalogKey(row)
      }));
    },
    sortAndFilterRows(rows = []) {
      const allKeys = rows.map((row) => row.homeCatalogKey);
      const orderedKeys = HomeCatalogStore.ensureOrderKeys(allKeys);
      const enabledRows = rows.filter((row) => !HomeCatalogStore.isDisabled(row.homeCatalogKey));
      const orderIndex = new Map(orderedKeys.map((key, index) => [key, index]));
      enabledRows.sort((left, right) => {
        const l = orderIndex.has(left.homeCatalogKey) ? orderIndex.get(left.homeCatalogKey) : Number.MAX_SAFE_INTEGER;
        const r = orderIndex.has(right.homeCatalogKey) ? orderIndex.get(right.homeCatalogKey) : Number.MAX_SAFE_INTEGER;
        return l - r;
      });
      return enabledRows;
    },
    render() {
      var _a;
      const heroItem = this.heroItem || ((_a = this.heroCandidates) == null ? void 0 : _a[this.heroIndex]) || this.pickHeroItem(this.rows);
      const progressHtml = this.renderContinueWatching(this.continueWatchingDisplay || []);
      this.container.innerHTML = `
      <div class="home-shell home-enter">
        <aside class="home-sidebar">
          <div class="home-brand-wrap">
            <img src="assets/brand/app_logo_wordmark.png" class="home-brand-logo-main" alt="Nuvio" />
          </div>
          <div class="home-nav-list">
            <button class="home-nav-item focusable" data-action="gotoHome" aria-label="Home"><span class="home-nav-icon-wrap">${navIconSvg("gotoHome")}</span><span class="home-nav-label">Home</span></button>
            <button class="home-nav-item focusable" data-action="gotoSearch" aria-label="Search"><span class="home-nav-icon-wrap">${navIconSvg("gotoSearch")}</span><span class="home-nav-label">Search</span></button>
            <button class="home-nav-item focusable" data-action="gotoLibrary" aria-label="Library"><span class="home-nav-icon-wrap">${navIconSvg("gotoLibrary")}</span><span class="home-nav-label">Library</span></button>
            <button class="home-nav-item focusable" data-action="gotoPlugin" aria-label="Addons"><span class="home-nav-icon-wrap">${navIconSvg("gotoPlugin")}</span><span class="home-nav-label">Addons</span></button>
            <button class="home-nav-item focusable" data-action="gotoSettings" aria-label="Settings"><span class="home-nav-icon-wrap">${navIconSvg("gotoSettings")}</span><span class="home-nav-label">Settings</span></button>
          </div>
          <button class="home-profile-pill focusable" data-action="gotoAccount" aria-label="Account">
            <span class="home-profile-avatar">${this.activeProfileInitial || "P"}</span>
            <span class="home-profile-name">${this.activeProfileName || "Profile"}</span>
          </button>
        </aside>

        <main class="home-main">
          <section class="home-hero">
            <div class="home-hero-card focusable"
                data-action="openDetail"
                data-item-id="${(heroItem == null ? void 0 : heroItem.id) || ""}"
                data-item-type="${(heroItem == null ? void 0 : heroItem.type) || "movie"}"
                data-item-title="${(heroItem == null ? void 0 : heroItem.name) || "Untitled"}">
              ${(heroItem == null ? void 0 : heroItem.background) ? `<img class="featured-backdrop" src="${heroItem.background}" alt="${(heroItem == null ? void 0 : heroItem.name) || "featured"}" />` : ""}
              <div class="home-hero-title">${(heroItem == null ? void 0 : heroItem.name) || "No featured item"}</div>
              <div class="home-hero-description">${(heroItem == null ? void 0 : heroItem.description) || ""}</div>
            </div>
          </section>

          ${progressHtml}

          <section class="home-catalogs" id="homeCatalogRows"></section>
        </main>
      </div>
    `;
      const rowsContainer = this.container.querySelector("#homeCatalogRows");
      if (rowsContainer) {
        this.catalogSeeAllMap = /* @__PURE__ */ new Map();
        this.rows.forEach((rowData) => {
          var _a2, _b;
          const seeAllId = `${rowData.addonId || "addon"}_${rowData.catalogId || "catalog"}_${rowData.type || "movie"}`;
          this.catalogSeeAllMap.set(seeAllId, {
            addonBaseUrl: rowData.addonBaseUrl || "",
            addonId: rowData.addonId || "",
            addonName: rowData.addonName || "",
            catalogId: rowData.catalogId || "",
            catalogName: rowData.catalogName || "",
            type: rowData.type || "movie",
            initialItems: Array.isArray((_b = (_a2 = rowData == null ? void 0 : rowData.result) == null ? void 0 : _a2.data) == null ? void 0 : _b.items) ? rowData.result.data.items : []
          });
          const section = document.createElement("section");
          section.className = "home-row home-row-enter";
          section.style.animationDelay = `${Math.min(460, (rowsContainer.children.length + 1) * 42)}ms`;
          section.innerHTML = `
          <div class="home-row-head">
            <h3 class="home-row-title">${formatCatalogRowTitle(rowData.catalogName, rowData.addonName, rowData.type)}</h3>
          </div>
        `;
          const track = document.createElement("div");
          track.className = "home-track";
          rowData.result.data.items.slice(0, this.layoutMode === "grid" ? 12 : 16).forEach((item) => {
            const card = document.createElement("article");
            card.className = "home-content-card focusable";
            card.dataset.action = "openDetail";
            card.dataset.itemId = item.id;
            card.dataset.itemType = rowData.type;
            card.dataset.itemTitle = item.name;
            card.innerHTML = `
            ${item.poster ? `<img class="content-poster" src="${item.poster}" alt="${item.name || "content"}" />` : `<div class="content-poster placeholder"></div>`}
          `;
            card.addEventListener("click", () => {
              this.openDetailFromNode(card);
            });
            track.appendChild(card);
          });
          const seeAllCard = document.createElement("article");
          seeAllCard.className = "home-content-card home-seeall-card focusable";
          seeAllCard.dataset.action = "openCatalogSeeAll";
          seeAllCard.dataset.seeAllId = seeAllId;
          seeAllCard.dataset.addonBaseUrl = rowData.addonBaseUrl || "";
          seeAllCard.dataset.addonId = rowData.addonId || "";
          seeAllCard.dataset.addonName = rowData.addonName || "";
          seeAllCard.dataset.catalogId = rowData.catalogId || "";
          seeAllCard.dataset.catalogName = rowData.catalogName || "";
          seeAllCard.dataset.catalogType = rowData.type || "";
          seeAllCard.innerHTML = `
          <div class="home-seeall-card-inner">
            <div class="home-seeall-arrow" aria-hidden="true">&#8594;</div>
            <div class="home-seeall-label">See All</div>
          </div>
        `;
          seeAllCard.addEventListener("click", () => {
            this.openCatalogSeeAllFromNode(seeAllCard);
          });
          track.appendChild(seeAllCard);
          section.appendChild(track);
          rowsContainer.appendChild(section);
        });
      }
      this.container.querySelectorAll(".home-sidebar .focusable").forEach((item) => {
        item.addEventListener("focus", () => {
          this.setSidebarExpanded(true);
        });
        item.addEventListener("click", () => {
          const action = item.dataset.action;
          if (action === "gotoHome") return;
          if (action === "gotoLibrary") Router.navigate("library");
          if (action === "gotoSearch") Router.navigate("search");
          if (action === "gotoPlugin") Router.navigate("plugin");
          if (action === "gotoSettings") Router.navigate("settings");
          if (action === "gotoAccount") Router.navigate("profileSelection");
        });
      });
      ScreenUtils.indexFocusables(this.container);
      this.buildNavigationModel();
      ScreenUtils.setInitialFocus(this.container, ".home-main .focusable");
      const current = this.container.querySelector(".home-main .focusable.focused");
      if (current && this.isMainNode(current)) {
        this.lastMainFocus = current;
      }
      this.setSidebarExpanded(false);
      this.startHeroRotation();
    },
    renderContinueWatching(items) {
      if (!items.length) {
        return `
        <section class="home-row">
          <h3 class="home-row-title">Continue Watching</h3>
          <p class="home-empty">No saved progress yet.</p>
        </section>
      `;
      }
      const cards = items.map((item) => {
        const positionMs = Number(item.positionMs || 0);
        const durationMs = Number(item.durationMs || 0);
        const positionMin = Math.floor(positionMs / 6e4);
        const durationMin = Math.floor(durationMs / 6e4);
        const remaining = Math.max(0, durationMin - positionMin);
        const hasDuration = durationMs > 0;
        const progress = hasDuration ? Math.max(0, Math.min(1, positionMs / durationMs)) : 0;
        const leftText = hasDuration ? `${remaining}m left` : "Continue";
        const progressText = hasDuration ? `${positionMin}m / ${durationMin || "?"}m` : `${positionMin}m watched`;
        return `
        <article class="home-content-card home-progress-card focusable" data-action="resumeProgress"
             data-item-id="${item.contentId}"
             data-item-type="${item.contentType || "movie"}"
             data-item-title="${item.title || prettyId(item.contentId)}">
          <div class="home-progress-poster"${item.poster ? ` style="background-image:url('${item.poster}')"` : ""}>
            <span class="home-progress-left">${leftText}</span>
          </div>
          <div class="home-progress-meta">
            <div class="home-content-title">${item.title || prettyId(item.contentId)}</div>
            <div class="home-content-type">${progressText}</div>
            <div class="home-progress-track">
              <div class="home-progress-fill" style="width:${Math.round(progress * 100)}%"></div>
            </div>
          </div>
        </article>
      `;
      }).join("");
      return `
      <section class="home-row">
        <h3 class="home-row-title">Continue Watching</h3>
        <div class="home-track">${cards}</div>
      </section>
    `;
    },
    async enrichContinueWatching(items = []) {
      const enriched = await Promise.all((items || []).map(async (item) => {
        try {
          const result = await withTimeout(
            metaRepository.getMetaFromAllAddons(item.contentType || "movie", item.contentId),
            1800,
            { status: "error", message: "timeout" }
          );
          if ((result == null ? void 0 : result.status) === "success" && (result == null ? void 0 : result.data)) {
            return {
              ...item,
              title: result.data.name || prettyId(item.contentId),
              poster: result.data.poster || result.data.background || null
            };
          }
        } catch (error) {
          console.warn("Continue watching enrichment failed", error);
        }
        return {
          ...item,
          title: prettyId(item.contentId),
          poster: null
        };
      }));
      return enriched;
    },
    pickHeroItem(rows) {
      var _a, _b, _c;
      for (const row of rows) {
        const first = (_c = (_b = (_a = row.result) == null ? void 0 : _a.data) == null ? void 0 : _b.items) == null ? void 0 : _c[0];
        if (first) {
          return first;
        }
      }
      return null;
    },
    collectHeroCandidates(rows) {
      const flat = [];
      rows.forEach((row) => {
        var _a, _b;
        (((_b = (_a = row == null ? void 0 : row.result) == null ? void 0 : _a.data) == null ? void 0 : _b.items) || []).slice(0, 4).forEach((item) => {
          if (!(item == null ? void 0 : item.id) || flat.some((entry) => entry.id === item.id)) {
            return;
          }
          flat.push(item);
        });
      });
      return flat.slice(0, 10);
    },
    async enrichHero(baseHero = null) {
      const hero = baseHero || this.pickHeroItem(this.rows);
      if (!hero) {
        this.heroItem = null;
        return;
      }
      const settings = TmdbSettingsStore.get();
      if (!settings.enabled || !settings.apiKey) {
        this.heroItem = hero;
        return;
      }
      try {
        const tmdbId = await withTimeout(TmdbService.ensureTmdbId(hero.id, hero.type), 2200, null);
        if (!tmdbId) {
          this.heroItem = hero;
          return;
        }
        const enriched = await withTimeout(TmdbMetadataService.fetchEnrichment({
          tmdbId,
          contentType: hero.type,
          language: settings.language
        }), 2400, null);
        if (!enriched) {
          this.heroItem = hero;
          return;
        }
        this.heroItem = {
          ...hero,
          name: settings.useBasicInfo ? enriched.localizedTitle || hero.name : hero.name,
          description: settings.useBasicInfo ? enriched.description || hero.description : hero.description,
          background: settings.useArtwork ? enriched.backdrop || hero.background : hero.background,
          poster: settings.useArtwork ? enriched.poster || hero.poster : hero.poster,
          logo: settings.useArtwork ? enriched.logo || hero.logo : hero.logo
        };
      } catch (error) {
        console.warn("Hero TMDB enrichment failed", error);
        this.heroItem = hero;
      }
    },
    openDetailFromNode(node) {
      const itemId = node.dataset.itemId;
      if (!itemId) {
        return;
      }
      Router.navigate("detail", {
        itemId,
        itemType: node.dataset.itemType || "movie",
        fallbackTitle: node.dataset.itemTitle || "Untitled"
      });
    },
    openCatalogSeeAllFromNode(node) {
      var _a, _b;
      if (!node) {
        return;
      }
      const seeAllId = String(node.dataset.seeAllId || "");
      const mapped = ((_b = (_a = this.catalogSeeAllMap) == null ? void 0 : _a.get) == null ? void 0 : _b.call(_a, seeAllId)) || null;
      if (mapped) {
        Router.navigate("catalogSeeAll", mapped);
        return;
      }
      Router.navigate("catalogSeeAll", {
        addonBaseUrl: node.dataset.addonBaseUrl || "",
        addonId: node.dataset.addonId || "",
        addonName: node.dataset.addonName || "",
        catalogId: node.dataset.catalogId || "",
        catalogName: node.dataset.catalogName || "",
        type: node.dataset.catalogType || "movie",
        initialItems: []
      });
    },
    onKeyDown(event) {
      if (this.handleHomeDpad(event)) {
        return;
      }
      if (event.keyCode === 76) {
        this.layoutMode = this.layoutMode === "grid" ? "classic" : "grid";
        LayoutPreferences.set({ homeLayout: this.layoutMode });
        this.render();
        return;
      }
      if (event.keyCode !== 13) {
        return;
      }
      const current = this.container.querySelector(".focusable.focused");
      if (!current) {
        return;
      }
      const action = current.dataset.action;
      if (action === "gotoHome") return;
      if (action === "gotoLibrary") Router.navigate("library");
      if (action === "gotoSearch") Router.navigate("search");
      if (action === "gotoPlugin") Router.navigate("plugin");
      if (action === "gotoSettings") Router.navigate("settings");
      if (action === "gotoAccount") Router.navigate("profileSelection");
      if (action === "openDetail") this.openDetailFromNode(current);
      if (action === "openCatalogSeeAll") this.openCatalogSeeAllFromNode(current);
      if (action === "resumeProgress") {
        Router.navigate("detail", {
          itemId: current.dataset.itemId,
          itemType: current.dataset.itemType || "movie",
          fallbackTitle: current.dataset.itemTitle || current.dataset.itemId || "Untitled"
        });
      }
    },
    cleanup() {
      this.homeLoadToken = (this.homeLoadToken || 0) + 1;
      this.stopHeroRotation();
      ScreenUtils.hide(this.container);
    }
  };

  // js/platform/sharedKeys.js
  var ROTATED_DPAD_KEY = "rotatedDpadMapping";
  function getArrowCodeFromKey(key) {
    if (key === "ArrowUp" || key === "Up") return 38;
    if (key === "ArrowDown" || key === "Down") return 40;
    if (key === "ArrowLeft" || key === "Left") return 37;
    if (key === "ArrowRight" || key === "Right") return 39;
    return null;
  }
  function isEditableTarget(target) {
    const tagName = String((target == null ? void 0 : target.tagName) || "").toUpperCase();
    return Boolean(
      (target == null ? void 0 : target.isContentEditable) || tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT"
    );
  }
  function isSimulator() {
    var _a;
    const ua = String(((_a = globalThis.navigator) == null ? void 0 : _a.userAgent) || "").toLowerCase();
    return ua.includes("simulator");
  }
  function shouldUseRotatedMapping() {
    const stored = LocalStore.get(ROTATED_DPAD_KEY, null);
    if (typeof stored === "boolean") {
      return stored;
    }
    return isSimulator();
  }
  function normalizeDirectionalKeyCode(code) {
    const rotatedMap = {
      37: 38,
      38: 37,
      39: 40,
      40: 39
    };
    if (shouldUseRotatedMapping() && rotatedMap[code]) {
      return rotatedMap[code];
    }
    return code;
  }
  function normalizeKeyEvent(event, backCodes = []) {
    const key = String((event == null ? void 0 : event.key) || "");
    const code = String((event == null ? void 0 : event.code) || "");
    const rawCode = Number(getArrowCodeFromKey(key) || (event == null ? void 0 : event.keyCode) || 0);
    const normalizedCode = normalizeDirectionalKeyCode(rawCode);
    const isBack = isBackEvent(event, backCodes, normalizedCode);
    return {
      key,
      code,
      keyCode: normalizedCode,
      originalKeyCode: rawCode,
      isArrow: normalizedCode >= 37 && normalizedCode <= 40,
      isEnter: normalizedCode === 13 || key === "Enter",
      isBack
    };
  }
  function isBackEvent(event, backCodes = [], normalizedCode = null) {
    const target = (event == null ? void 0 : event.target) || null;
    const key = String((event == null ? void 0 : event.key) || "");
    const keyLower = key.toLowerCase();
    const code = String((event == null ? void 0 : event.code) || "");
    const rawCode = Number((event == null ? void 0 : event.keyCode) || 0);
    const effectiveCode = Number(normalizedCode || rawCode || 0);
    if (isEditableTarget(target) && (key === "Backspace" || rawCode === 8 || key === "Delete" || rawCode === 46)) {
      return false;
    }
    if (backCodes.includes(effectiveCode) || backCodes.includes(rawCode)) {
      return true;
    }
    if (key === "Escape" || key === "Esc" || key === "Backspace" || key === "GoBack" || key === "XF86Back" || code === "BrowserBack" || code === "GoBack") {
      return true;
    }
    return keyLower.includes("back");
  }

  // js/platform/adapters/browserAdapter.js
  var browserAdapter = {
    name: "browser",
    init() {
    },
    exitApp() {
      var _a;
      try {
        (_a = globalThis.close) == null ? void 0 : _a.call(globalThis);
      } catch (_) {
      }
    },
    isBackEvent(event) {
      return isBackEvent(event, [27, 8]);
    },
    normalizeKey(event) {
      return normalizeKeyEvent(event, [27, 8]);
    },
    getDeviceLabel() {
      return "Web Browser";
    },
    getCapabilities() {
      var _a, _b, _c;
      return {
        hlsJs: Boolean((_b = (_a = globalThis.Hls) == null ? void 0 : _a.isSupported) == null ? void 0 : _b.call(_a)),
        dashJs: Boolean((_c = globalThis.dashjs) == null ? void 0 : _c.MediaPlayer),
        nativeVideo: true,
        webosAvplay: false,
        tizenAvplay: false
      };
    },
    prepareVideoElement() {
    }
  };

  // js/platform/webos/webosPlayerExtensions.js
  var WebOSPlayerExtensions = {
    apply(videoElement) {
      if (!videoElement) {
        return;
      }
      videoElement.setAttribute("playsinline", "");
      videoElement.setAttribute("webkit-playsinline", "");
      videoElement.setAttribute("preload", "auto");
    }
  };

  // js/platform/adapters/webosAdapter.js
  function getAvplayApi() {
    const webapis = globalThis.webapis;
    const avplay = (webapis == null ? void 0 : webapis.avplay) || (webapis == null ? void 0 : webapis.avPlay) || globalThis.avplay || null;
    if (!avplay || typeof avplay.open !== "function") {
      return null;
    }
    return avplay;
  }
  var webosAdapter = {
    name: "webos",
    init() {
    },
    exitApp() {
      if (globalThis.webOSSystem && typeof globalThis.webOSSystem.close === "function") {
        globalThis.webOSSystem.close();
      }
    },
    isBackEvent(event) {
      return isBackEvent(event, [461, 27, 8]);
    },
    normalizeKey(event) {
      return normalizeKeyEvent(event, [461, 27, 8]);
    },
    getDeviceLabel() {
      return "webOS TV";
    },
    getCapabilities() {
      var _a, _b, _c;
      return {
        hlsJs: Boolean((_b = (_a = globalThis.Hls) == null ? void 0 : _a.isSupported) == null ? void 0 : _b.call(_a)),
        dashJs: Boolean((_c = globalThis.dashjs) == null ? void 0 : _c.MediaPlayer),
        nativeVideo: true,
        webosAvplay: Boolean(getAvplayApi()),
        tizenAvplay: false
      };
    },
    prepareVideoElement(videoElement) {
      WebOSPlayerExtensions.apply(videoElement);
    }
  };

  // js/platform/adapters/tizenAdapter.js
  function getAvplayApi2() {
    const webapis = globalThis.webapis;
    const avplay = (webapis == null ? void 0 : webapis.avplay) || (webapis == null ? void 0 : webapis.avPlay) || globalThis.avplay || null;
    if (!avplay || typeof avplay.open !== "function") {
      return null;
    }
    return avplay;
  }
  var tizenAdapter = {
    name: "tizen",
    init() {
    },
    exitApp() {
      var _a, _b, _c, _d, _e, _f;
      try {
        (_e = (_c = (_b = (_a = globalThis.tizen) == null ? void 0 : _a.application) == null ? void 0 : _b.getCurrentApplication) == null ? void 0 : (_d = _c.call(_b)).exit) == null ? void 0 : _e.call(_d);
      } catch (_) {
        try {
          (_f = globalThis.close) == null ? void 0 : _f.call(globalThis);
        } catch (_2) {
        }
      }
    },
    isBackEvent(event) {
      return isBackEvent(event, [10009, 27, 8]);
    },
    normalizeKey(event) {
      return normalizeKeyEvent(event, [10009, 27, 8]);
    },
    getDeviceLabel() {
      return "Tizen TV";
    },
    getCapabilities() {
      var _a, _b, _c;
      return {
        hlsJs: Boolean((_b = (_a = globalThis.Hls) == null ? void 0 : _a.isSupported) == null ? void 0 : _b.call(_a)),
        dashJs: Boolean((_c = globalThis.dashjs) == null ? void 0 : _c.MediaPlayer),
        nativeVideo: true,
        webosAvplay: false,
        tizenAvplay: Boolean(getAvplayApi2())
      };
    },
    prepareVideoElement() {
    }
  };

  // js/platform/index.js
  var ADAPTERS = {
    browser: browserAdapter,
    webos: webosAdapter,
    tizen: tizenAdapter
  };
  function detectPlatformName() {
    var _a;
    const override = String(globalThis.__NUVIO_PLATFORM__ || "").trim().toLowerCase();
    if (override && ADAPTERS[override]) {
      return override;
    }
    if (globalThis.webOS || globalThis.PalmSystem || globalThis.webOSSystem) {
      return "webos";
    }
    if (globalThis.tizen || String(((_a = globalThis.navigator) == null ? void 0 : _a.userAgent) || "").toLowerCase().includes("tizen")) {
      return "tizen";
    }
    return "browser";
  }
  function getAdapter() {
    if (!Platform.current) {
      Platform.current = ADAPTERS[detectPlatformName()];
    }
    return Platform.current;
  }
  var Platform = {
    current: null,
    init() {
      var _a;
      const adapter = getAdapter();
      (_a = adapter.init) == null ? void 0 : _a.call(adapter);
      return adapter;
    },
    getName() {
      return getAdapter().name;
    },
    isWebOS() {
      return this.getName() === "webos";
    },
    isTizen() {
      return this.getName() === "tizen";
    },
    isBrowser() {
      return this.getName() === "browser";
    },
    exitApp() {
      return getAdapter().exitApp();
    },
    isBackEvent(event) {
      return getAdapter().isBackEvent(event);
    },
    normalizeKey(event) {
      return getAdapter().normalizeKey(event);
    },
    getDeviceLabel() {
      return getAdapter().getDeviceLabel();
    },
    getCapabilities() {
      return getAdapter().getCapabilities();
    },
    prepareVideoElement(videoElement) {
      var _a, _b;
      return (_b = (_a = getAdapter()).prepareVideoElement) == null ? void 0 : _b.call(_a, videoElement);
    }
  };

  // js/data/remote/supabase/supabaseApi.js
  function buildHeaders(extra = {}, useSession = true) {
    const headers = {
      apikey: SUPABASE_ANON_KEY,
      ...extra
    };
    if (useSession && SessionStore.accessToken) {
      headers.Authorization = `Bearer ${SessionStore.accessToken}`;
    } else if (headers.Authorization == null) {
      headers.Authorization = `Bearer ${SUPABASE_ANON_KEY}`;
    }
    return headers;
  }
  var SupabaseApi = {
    rpc(functionName, body = {}, useSession = true) {
      return httpRequest(`${SUPABASE_URL}/rest/v1/rpc/${functionName}`, {
        method: "POST",
        headers: buildHeaders({ "Content-Type": "application/json" }, useSession),
        body: JSON.stringify(body)
      });
    },
    select(table, query = "", useSession = true) {
      const suffix = query ? `?${query}` : "";
      return httpRequest(`${SUPABASE_URL}/rest/v1/${table}${suffix}`, {
        method: "GET",
        headers: buildHeaders({}, useSession)
      });
    },
    upsert(table, rows, onConflict = null, useSession = true) {
      const query = onConflict ? `?on_conflict=${encodeURIComponent(onConflict)}` : "";
      return httpRequest(`${SUPABASE_URL}/rest/v1/${table}${query}`, {
        method: "POST",
        headers: buildHeaders({
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=representation"
        }, useSession),
        body: JSON.stringify(rows)
      });
    },
    delete(table, query, useSession = true) {
      return httpRequest(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
        method: "DELETE",
        headers: buildHeaders({ Prefer: "return=representation" }, useSession)
      });
    }
  };

  // js/core/profile/watchProgressSyncService.js
  var TABLE = "tv_watch_progress";
  var FALLBACK_TABLE = "watch_progress";
  var PULL_RPC = "sync_pull_watch_progress";
  var PUSH_RPC = "sync_push_watch_progress";
  function progressKey2(item = {}) {
    const contentId = String(item.contentId || "").trim();
    const videoId = String(item.videoId || "main").trim();
    const season = item.season == null ? "" : String(Number(item.season));
    const episode = item.episode == null ? "" : String(Number(item.episode));
    return `${contentId}::${videoId}::${season}::${episode}`;
  }
  function mergeProgressItems(localItems = [], remoteItems = []) {
    const byKey = /* @__PURE__ */ new Map();
    const upsert = (item) => {
      if (!(item == null ? void 0 : item.contentId)) {
        return;
      }
      const key = progressKey2(item);
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, item);
        return;
      }
      const existingUpdated = Number(existing.updatedAt || 0);
      const incomingUpdated = Number(item.updatedAt || 0);
      if (incomingUpdated > existingUpdated) {
        byKey.set(key, item);
        return;
      }
      if (incomingUpdated === existingUpdated) {
        const existingPos = Number(existing.positionMs || 0);
        const incomingPos = Number(item.positionMs || 0);
        if (incomingPos > existingPos) {
          byKey.set(key, item);
        }
      }
    };
    localItems.forEach(upsert);
    remoteItems.forEach(upsert);
    return Array.from(byKey.values()).sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
  }
  function shouldTryLegacyTable(error) {
    if (!error) {
      return false;
    }
    if (error.status === 404) {
      return true;
    }
    if (typeof error.code === "string" && error.code === "PGRST205") {
      return true;
    }
    const message = String(error.message || "");
    return message.includes("PGRST205") || message.includes("Could not find the table");
  }
  function mapProgressRow(row = {}) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k;
    const contentId = row.content_id || row.contentId || "";
    const contentType = row.content_type || row.contentType || "movie";
    const updatedAtRaw = (_c = (_b = (_a = row.updated_at) != null ? _a : row.last_watched) != null ? _b : row.lastWatched) != null ? _c : null;
    const updatedAt = (() => {
      if (updatedAtRaw == null) {
        return Date.now();
      }
      const numeric = Number(updatedAtRaw);
      if (Number.isFinite(numeric)) {
        return numeric > 1e12 ? numeric : Math.trunc(numeric * 1e3);
      }
      const parsed = new Date(updatedAtRaw).getTime();
      return Number.isFinite(parsed) ? parsed : Date.now();
    })();
    const positionMsRaw = (_e = (_d = row.position_ms) != null ? _d : row.position) != null ? _e : 0;
    const durationMsRaw = (_g = (_f = row.duration_ms) != null ? _f : row.duration) != null ? _g : 0;
    const seasonRaw = (_i = (_h = row.season) != null ? _h : row.season_number) != null ? _i : null;
    const episodeRaw = (_k = (_j = row.episode) != null ? _j : row.episode_number) != null ? _k : null;
    const seasonNum = Number(seasonRaw);
    const episodeNum = Number(episodeRaw);
    const toMs = (value) => {
      const n = Number(value || 0);
      if (!Number.isFinite(n) || n <= 0) {
        return 0;
      }
      if (n > 1e12) {
        return n;
      }
      return n < 1e6 ? Math.trunc(n * 1e3) : Math.trunc(n);
    };
    return {
      contentId,
      contentType,
      videoId: row.video_id || row.videoId || null,
      season: Number.isFinite(seasonNum) && seasonNum > 0 ? seasonNum : null,
      episode: Number.isFinite(episodeNum) && episodeNum > 0 ? episodeNum : null,
      positionMs: toMs(positionMsRaw),
      durationMs: toMs(durationMsRaw),
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now()
    };
  }
  function resolveProfileId() {
    const raw = Number(ProfileManager.getActiveProfileId() || 1);
    if (Number.isFinite(raw) && raw > 0) {
      return Math.trunc(raw);
    }
    return 1;
  }
  function toSeconds(valueMs) {
    const n = Number(valueMs || 0);
    if (!Number.isFinite(n) || n <= 0) {
      return 0;
    }
    return Math.max(0, Math.trunc(n / 1e3));
  }
  function hasNoConflictConstraint(error) {
    if (!error) {
      return false;
    }
    if (String(error.code || "") === "42P10") {
      return true;
    }
    const message = String(error.message || "");
    return message.includes("no unique or exclusion constraint");
  }
  function toProgressKey(item = {}) {
    const contentId = String(item.contentId || "").trim();
    const videoId = String(item.videoId || "main").trim();
    const season = item.season == null ? "" : String(Number(item.season));
    const episode = item.episode == null ? "" : String(Number(item.episode));
    return `${contentId}:${videoId}:${season}:${episode}`;
  }
  var WatchProgressSyncService = {
    async pull() {
      try {
        if (!AuthManager.isAuthenticated) {
          return [];
        }
        const localItems = await watchProgressRepository.getAll();
        const profileId = resolveProfileId();
        let rows = [];
        try {
          rows = await SupabaseApi.rpc(PULL_RPC, { p_profile_id: profileId }, true);
        } catch (rpcError) {
          const ownerId = await AuthManager.getEffectiveUserId();
          try {
            rows = await SupabaseApi.select(
              FALLBACK_TABLE,
              `user_id=eq.${encodeURIComponent(ownerId)}&profile_id=eq.${profileId}&select=*&order=last_watched.desc`,
              true
            );
          } catch (_) {
            try {
              rows = await SupabaseApi.select(
                FALLBACK_TABLE,
                `user_id=eq.${encodeURIComponent(ownerId)}&select=*&order=last_watched.desc`,
                true
              );
            } catch (primaryError) {
              if (!shouldTryLegacyTable(primaryError)) {
                throw rpcError;
              }
              rows = await SupabaseApi.select(
                TABLE,
                `owner_id=eq.${encodeURIComponent(ownerId)}&select=*&order=updated_at.desc`,
                true
              );
            }
          }
        }
        const filteredRows = (Array.isArray(rows) ? rows : []).filter((row) => {
          var _a, _b;
          const rowProfile = (_b = (_a = row == null ? void 0 : row.profile_id) != null ? _a : row == null ? void 0 : row.profileId) != null ? _b : null;
          if (rowProfile == null || rowProfile === "") {
            return true;
          }
          return String(rowProfile) === String(profileId);
        });
        const remoteItems = filteredRows.map((row) => mapProgressRow(row)).filter((item) => Boolean(item.contentId));
        const mergedItems = mergeProgressItems(localItems, remoteItems);
        await watchProgressRepository.replaceAll(mergedItems);
        return mergedItems;
      } catch (error) {
        console.warn("Watch progress sync pull failed", error);
        return [];
      }
    },
    async push() {
      try {
        if (!AuthManager.isAuthenticated) {
          return false;
        }
        const items = await watchProgressRepository.getAll();
        if (!items.length) {
          return true;
        }
        const profileId = resolveProfileId();
        try {
          await SupabaseApi.rpc(PUSH_RPC, {
            p_profile_id: profileId,
            p_entries: items.map((item) => ({
              content_id: item.contentId,
              content_type: item.contentType || "movie",
              video_id: item.videoId || item.contentId || null,
              season: item.season == null ? null : Number(item.season),
              episode: item.episode == null ? null : Number(item.episode),
              position: toSeconds(item.positionMs),
              duration: toSeconds(item.durationMs),
              last_watched: Number(item.updatedAt || Date.now()),
              progress_key: toProgressKey(item)
            }))
          }, true);
          return true;
        } catch (rpcError) {
          console.warn("Watch progress sync push RPC failed, falling back to table sync", rpcError);
        }
        const ownerId = await AuthManager.getEffectiveUserId();
        const rows = items.map((item) => ({
          owner_id: ownerId,
          content_id: item.contentId,
          content_type: item.contentType,
          video_id: item.videoId || item.contentId || null,
          season: item.season == null ? null : Number(item.season),
          episode: item.episode == null ? null : Number(item.episode),
          position_ms: item.positionMs || 0,
          duration_ms: item.durationMs || 0,
          updated_at: new Date(item.updatedAt || Date.now()).toISOString()
        }));
        try {
          const fallbackRows = items.map((item) => ({
            user_id: ownerId,
            content_id: item.contentId,
            content_type: item.contentType,
            video_id: item.videoId || item.contentId,
            season: item.season == null ? null : Number(item.season),
            episode: item.episode == null ? null : Number(item.episode),
            position: Math.max(0, Math.trunc(Number(item.positionMs || 0) / 1e3)),
            duration: Math.max(0, Math.trunc(Number(item.durationMs || 0) / 1e3)),
            last_watched: Number(item.updatedAt || Date.now()),
            progress_key: toProgressKey(item),
            profile_id: profileId
          }));
          try {
            await SupabaseApi.upsert(FALLBACK_TABLE, fallbackRows, "user_id,progress_key", true);
          } catch (conflictError) {
            if (!hasNoConflictConstraint(conflictError)) {
              throw conflictError;
            }
            await SupabaseApi.upsert(FALLBACK_TABLE, fallbackRows, "user_id,content_id,video_id", true);
          }
        } catch (primaryError) {
          if (!shouldTryLegacyTable(primaryError)) {
            throw primaryError;
          }
          try {
            await SupabaseApi.upsert(TABLE, rows, "owner_id,content_id,video_id", true);
          } catch (conflictError) {
            if (!hasNoConflictConstraint(conflictError)) {
              throw conflictError;
            }
            await SupabaseApi.upsert(TABLE, rows, "owner_id,content_id", true);
          }
        }
        return true;
      } catch (error) {
        console.warn("Watch progress sync push failed", error);
        return false;
      }
    }
  };

  // js/core/player/engines/nativeVideoEngine.js
  var nativeVideoEngine = {
    name: "native",
    canPlay(videoElement, mimeType) {
      if (!videoElement || !mimeType) {
        return false;
      }
      try {
        const result = String(videoElement.canPlayType(String(mimeType))).toLowerCase();
        return result === "probably" || result === "maybe";
      } catch (_) {
        return false;
      }
    },
    load(videoElement, url, mimeType = null) {
      if (!videoElement) {
        return false;
      }
      videoElement.removeAttribute("src");
      Array.from(videoElement.querySelectorAll("source")).forEach((node) => node.remove());
      if (mimeType) {
        const sourceNode = document.createElement("source");
        sourceNode.src = url;
        sourceNode.type = mimeType;
        videoElement.appendChild(sourceNode);
      } else {
        videoElement.src = url;
      }
      videoElement.load();
      return true;
    }
  };

  // js/core/player/engines/hlsJsEngine.js
  function getHlsConstructor() {
    return globalThis.Hls || null;
  }
  var hlsJsEngine = {
    name: "hls.js",
    isSupported() {
      const Hls = getHlsConstructor();
      return Boolean(Hls && typeof Hls.isSupported === "function" && Hls.isSupported());
    },
    getConstructor() {
      return getHlsConstructor();
    },
    create(config) {
      const Hls = getHlsConstructor();
      if (!Hls) {
        return null;
      }
      return new Hls(config);
    },
    getAudioTracks(instance) {
      const trackList = instance == null ? void 0 : instance.audioTracks;
      if (!trackList) {
        return [];
      }
      try {
        return Array.from(trackList).filter(Boolean);
      } catch (_) {
        return [];
      }
    },
    getSelectedAudioTrackIndex(instance) {
      const selectedIndex = Number(instance == null ? void 0 : instance.audioTrack);
      if (!Number.isFinite(selectedIndex) || selectedIndex < 0) {
        return -1;
      }
      return selectedIndex;
    },
    setAudioTrack(instance, index) {
      const targetIndex = Number(index);
      const tracks = this.getAudioTracks(instance);
      if (!Number.isFinite(targetIndex) || targetIndex < 0 || targetIndex >= tracks.length) {
        return false;
      }
      try {
        instance.audioTrack = targetIndex;
        return true;
      } catch (_) {
        return false;
      }
    }
  };

  // js/core/player/engines/dashJsEngine.js
  function getDashGlobal() {
    return globalThis.dashjs || null;
  }
  var dashJsEngine = {
    name: "dash.js",
    isSupported() {
      const dashjs = getDashGlobal();
      if (!dashjs || typeof dashjs.MediaPlayer !== "function") {
        return false;
      }
      try {
        const player = dashjs.MediaPlayer();
        return Boolean(player && typeof player.create === "function");
      } catch (_) {
        return false;
      }
    },
    createPlayer() {
      var _a, _b, _c;
      const dashjs = getDashGlobal();
      return ((_c = (_a = dashjs == null ? void 0 : dashjs.MediaPlayer) == null ? void 0 : (_b = _a.call(dashjs)).create) == null ? void 0 : _c.call(_b)) || null;
    },
    getEvents() {
      var _a, _b;
      return ((_b = (_a = getDashGlobal()) == null ? void 0 : _a.MediaPlayer) == null ? void 0 : _b.events) || {};
    }
  };

  // js/core/player/engines/platformAvplayEngine.js
  function getAvplayApi3() {
    const webapis = globalThis.webapis;
    const avplay = (webapis == null ? void 0 : webapis.avplay) || (webapis == null ? void 0 : webapis.avPlay) || globalThis.avplay || null;
    if (!avplay || typeof avplay.open !== "function") {
      return null;
    }
    return avplay;
  }
  function createEngine(name) {
    return {
      name,
      isSupported() {
        return Boolean(getAvplayApi3());
      },
      getApi() {
        return getAvplayApi3();
      }
    };
  }
  var webosAvplayEngine = createEngine("webos-avplay");
  var tizenAvplayEngine = createEngine("tizen-avplay");
  function resolvePlatformAvplayEngine(platformName) {
    if (platformName === "tizen") {
      return tizenAvplayEngine;
    }
    return webosAvplayEngine;
  }

  // js/core/player/playerController.js
  var PlayerController = {
    video: null,
    isPlaying: false,
    currentItemId: null,
    currentItemType: null,
    currentVideoId: null,
    currentSeason: null,
    currentEpisode: null,
    progressSaveTimer: null,
    lastProgressPushAt: 0,
    lifecycleBound: false,
    lifecycleFlushHandler: null,
    visibilityFlushHandler: null,
    hlsInstance: null,
    dashInstance: null,
    playbackEngine: "none",
    avplayActive: false,
    avplayUrl: "",
    avplayAudioTracks: [],
    avplaySubtitleTracks: [],
    selectedAvPlayAudioTrackIndex: -1,
    selectedAvPlaySubtitleTrackIndex: -1,
    avplayTickTimer: null,
    avplayReady: false,
    avplayEnded: false,
    avplayCurrentTimeMs: 0,
    avplayDurationMs: 0,
    lastPlaybackErrorCode: 0,
    currentPlaybackUrl: "",
    currentPlaybackHeaders: {},
    currentPlaybackMediaSourceType: null,
    avplayFallbackAttempts: /* @__PURE__ */ new Set(),
    isExpectedPlayInterruption(error) {
      const message = String((error == null ? void 0 : error.message) || "").toLowerCase();
      const name = String((error == null ? void 0 : error.name) || "").toLowerCase();
      if (name === "aborterror") {
        return true;
      }
      return message.includes("interrupted by a new load request") || message.includes("the play() request was interrupted");
    },
    guessMediaMimeType(url) {
      const raw = String(url || "").trim();
      if (!raw) {
        return null;
      }
      const inferByPath = (pathname = "", search = null) => {
        const path = String(pathname || "").toLowerCase();
        if (path.endsWith(".m3u8")) {
          return "application/vnd.apple.mpegurl";
        }
        if (path.endsWith(".mpd")) {
          return "application/dash+xml";
        }
        if (path.includes("/playlist") && search && (search.has("type") || search.has("rendition"))) {
          return "application/vnd.apple.mpegurl";
        }
        return null;
      };
      try {
        const parsed = new URL(raw);
        return inferByPath(parsed.pathname, parsed.searchParams);
      } catch (_) {
        return inferByPath(raw, null);
      }
    },
    isLikelyHlsMimeType(mimeType) {
      return String(mimeType || "").toLowerCase() === "application/vnd.apple.mpegurl";
    },
    isLikelyDashMimeType(mimeType) {
      return String(mimeType || "").toLowerCase() === "application/dash+xml";
    },
    canUseHlsJs() {
      return hlsJsEngine.isSupported();
    },
    canUseDashJs() {
      return dashJsEngine.isSupported();
    },
    canPlayNatively(mimeType) {
      return nativeVideoEngine.canPlay(this.video, mimeType);
    },
    isUnsupportedSourceError(error) {
      const message = String((error == null ? void 0 : error.message) || "").toLowerCase();
      return message.includes("no supported source") || message.includes("no supported sources") || message.includes("not supported");
    },
    getPlatformAvplayEngine() {
      return resolvePlatformAvplayEngine(Platform.getName());
    },
    getPlatformAvplayEngineName() {
      return this.getPlatformAvplayEngine().name;
    },
    getAvPlay() {
      return this.getPlatformAvplayEngine().getApi();
    },
    canUseAvPlay() {
      return this.getPlatformAvplayEngine().isSupported();
    },
    isLikelyDirectFileUrl(url) {
      const raw = String(url || "").trim();
      if (!raw) {
        return false;
      }
      const probes = [raw];
      try {
        probes.push(decodeURIComponent(raw));
      } catch (_) {
      }
      return probes.some((value) => /\.(mkv|mp4|m4v|mov|webm|avi|ts|m2ts)(?=($|[/?#&]))/i.test(String(value || "")));
    },
    isUsingAvPlay() {
      return String(this.playbackEngine || "").endsWith("avplay") && this.avplayActive;
    },
    emitVideoEvent(eventName, detail = null) {
      if (!this.video || !eventName) {
        return;
      }
      try {
        const event = typeof CustomEvent === "function" ? new CustomEvent(eventName, { detail: detail || null }) : (() => {
          const legacyEvent = document.createEvent("CustomEvent");
          legacyEvent.initCustomEvent(eventName, false, false, detail || null);
          return legacyEvent;
        })();
        this.video.dispatchEvent(event);
      } catch (_) {
      }
    },
    stopAvPlayTickTimer() {
      if (this.avplayTickTimer) {
        clearInterval(this.avplayTickTimer);
        this.avplayTickTimer = null;
      }
    },
    startAvPlayTickTimer() {
      this.stopAvPlayTickTimer();
      this.avplayTickTimer = setInterval(() => {
        if (!this.isUsingAvPlay()) {
          return;
        }
        this.refreshAvPlayTimeline();
        this.emitVideoEvent("timeupdate", { playbackEngine: this.playbackEngine });
      }, 1e3);
    },
    refreshAvPlayTimeline() {
      var _a, _b;
      if (!this.isUsingAvPlay()) {
        return;
      }
      const avplay = this.getAvPlay();
      if (!avplay) {
        return;
      }
      try {
        const currentMs = Number(((_a = avplay.getCurrentTime) == null ? void 0 : _a.call(avplay)) || 0);
        if (Number.isFinite(currentMs) && currentMs >= 0) {
          this.avplayCurrentTimeMs = currentMs;
        }
      } catch (_) {
      }
      try {
        const durationMs = Number(((_b = avplay.getDuration) == null ? void 0 : _b.call(avplay)) || 0);
        if (Number.isFinite(durationMs) && durationMs >= 0) {
          this.avplayDurationMs = durationMs;
        }
      } catch (_) {
      }
    },
    parseAvPlayExtraInfo(extraInfoValue) {
      if (!extraInfoValue) {
        return null;
      }
      if (typeof extraInfoValue === "object") {
        return extraInfoValue;
      }
      try {
        return JSON.parse(String(extraInfoValue));
      } catch (_) {
        return null;
      }
    },
    normalizeAvPlayTrackType(typeValue) {
      const type = String(typeValue || "").trim().toUpperCase();
      if (type === "AUDIO" || type === "TEXT" || type === "SUBTITLE" || type === "VIDEO") {
        return type;
      }
      if (type.includes("AUDIO")) {
        return "AUDIO";
      }
      if (type.includes("TEXT") || type.includes("SUBTITLE")) {
        return "TEXT";
      }
      if (type.includes("VIDEO")) {
        return "VIDEO";
      }
      return type;
    },
    pickAvPlayTrackLabel(track = {}, trackIndex = 0, prefix = "Track") {
      const extraInfo = this.parseAvPlayExtraInfo(track.extra_info || track.extraInfo || null) || {};
      return String(
        track.name || track.label || extraInfo.name || extraInfo.label || extraInfo.track_lang || extraInfo.language || `${prefix} ${trackIndex + 1}`
      ).trim();
    },
    pickAvPlayTrackLanguage(track = {}) {
      const extraInfo = this.parseAvPlayExtraInfo(track.extra_info || track.extraInfo || null) || {};
      return String(
        track.language || track.lang || extraInfo.track_lang || extraInfo.language || ""
      ).trim();
    },
    syncAvPlayTrackInfo() {
      if (!this.isUsingAvPlay()) {
        this.avplayAudioTracks = [];
        this.avplaySubtitleTracks = [];
        this.selectedAvPlayAudioTrackIndex = -1;
        this.selectedAvPlaySubtitleTrackIndex = -1;
        return;
      }
      const avplay = this.getAvPlay();
      if (!avplay) {
        return;
      }
      const totalTracks = (() => {
        var _a;
        try {
          const value = (_a = avplay.getTotalTrackInfo) == null ? void 0 : _a.call(avplay);
          return Array.isArray(value) ? value : [];
        } catch (_) {
          return [];
        }
      })();
      const currentTracks = (() => {
        var _a;
        try {
          const value = (_a = avplay.getCurrentStreamInfo) == null ? void 0 : _a.call(avplay);
          return Array.isArray(value) ? value : [];
        } catch (_) {
          return [];
        }
      })();
      const currentAudio = currentTracks.find((track) => this.normalizeAvPlayTrackType(track == null ? void 0 : track.type) === "AUDIO");
      const currentText = currentTracks.find((track) => this.normalizeAvPlayTrackType(track == null ? void 0 : track.type) === "TEXT");
      const selectedAudioIndex = Number(currentAudio == null ? void 0 : currentAudio.index);
      const selectedTextIndex = Number(currentText == null ? void 0 : currentText.index);
      this.avplayAudioTracks = totalTracks.filter((track) => this.normalizeAvPlayTrackType(track == null ? void 0 : track.type) === "AUDIO").map((track, index) => {
        const trackIndex = Number(track == null ? void 0 : track.index);
        const normalizedTrackIndex = Number.isFinite(trackIndex) ? trackIndex : index;
        return {
          id: `avplay-audio-${normalizedTrackIndex}`,
          label: this.pickAvPlayTrackLabel(track, index, "Track"),
          language: this.pickAvPlayTrackLanguage(track),
          avplayTrackIndex: normalizedTrackIndex
        };
      });
      this.avplaySubtitleTracks = totalTracks.filter((track) => this.normalizeAvPlayTrackType(track == null ? void 0 : track.type) === "TEXT").map((track, index) => {
        const trackIndex = Number(track == null ? void 0 : track.index);
        const normalizedTrackIndex = Number.isFinite(trackIndex) ? trackIndex : index;
        return {
          id: `avplay-sub-${normalizedTrackIndex}`,
          label: this.pickAvPlayTrackLabel(track, index, "Subtitle"),
          language: this.pickAvPlayTrackLanguage(track),
          avplayTrackIndex: normalizedTrackIndex
        };
      });
      if (Number.isFinite(selectedAudioIndex)) {
        this.selectedAvPlayAudioTrackIndex = selectedAudioIndex;
      } else if (this.avplayAudioTracks.length && this.selectedAvPlayAudioTrackIndex < 0) {
        this.selectedAvPlayAudioTrackIndex = this.avplayAudioTracks[0].avplayTrackIndex;
      } else if (!this.avplayAudioTracks.length) {
        this.selectedAvPlayAudioTrackIndex = -1;
      }
      if (Number.isFinite(selectedTextIndex)) {
        this.selectedAvPlaySubtitleTrackIndex = selectedTextIndex;
      } else if (!this.avplaySubtitleTracks.length) {
        this.selectedAvPlaySubtitleTrackIndex = -1;
      }
    },
    getAvPlayAudioTracks() {
      return this.avplayAudioTracks.slice();
    },
    getAvPlaySubtitleTracks() {
      return this.avplaySubtitleTracks.slice();
    },
    getSelectedAvPlayAudioTrackIndex() {
      return Number.isFinite(this.selectedAvPlayAudioTrackIndex) ? this.selectedAvPlayAudioTrackIndex : -1;
    },
    getSelectedAvPlaySubtitleTrackIndex() {
      return Number.isFinite(this.selectedAvPlaySubtitleTrackIndex) ? this.selectedAvPlaySubtitleTrackIndex : -1;
    },
    setAvPlayAudioTrack(trackIndex) {
      if (!this.isUsingAvPlay()) {
        return false;
      }
      const targetIndex = Number(trackIndex);
      if (!Number.isFinite(targetIndex) || targetIndex < 0) {
        return false;
      }
      const available = this.getAvPlayAudioTracks();
      if (!available.some((track) => Number(track == null ? void 0 : track.avplayTrackIndex) === targetIndex)) {
        return false;
      }
      const avplay = this.getAvPlay();
      if (!avplay || typeof avplay.setSelectTrack !== "function") {
        return false;
      }
      try {
        avplay.setSelectTrack("AUDIO", targetIndex);
        this.selectedAvPlayAudioTrackIndex = targetIndex;
        this.syncAvPlayTrackInfo();
        this.emitVideoEvent("avplaytrackschanged", { playbackEngine: this.playbackEngine });
        return true;
      } catch (_) {
        return false;
      }
    },
    setAvPlaySubtitleTrack(trackIndex) {
      var _a, _b, _c, _d;
      if (!this.isUsingAvPlay()) {
        return false;
      }
      const avplay = this.getAvPlay();
      if (!avplay) {
        return false;
      }
      const targetIndex = Number(trackIndex);
      if (!Number.isFinite(targetIndex) || targetIndex < 0) {
        try {
          (_a = avplay.setSilentSubtitle) == null ? void 0 : _a.call(avplay, true);
        } catch (_) {
        }
        this.selectedAvPlaySubtitleTrackIndex = -1;
        this.emitVideoEvent("avplaytrackschanged", { playbackEngine: this.playbackEngine });
        return true;
      }
      const available = this.getAvPlaySubtitleTracks();
      if (!available.some((track) => Number(track == null ? void 0 : track.avplayTrackIndex) === targetIndex)) {
        return false;
      }
      try {
        (_b = avplay.setSilentSubtitle) == null ? void 0 : _b.call(avplay, false);
      } catch (_) {
      }
      try {
        (_c = avplay.setSelectTrack) == null ? void 0 : _c.call(avplay, "TEXT", targetIndex);
      } catch (_) {
        try {
          (_d = avplay.setSelectTrack) == null ? void 0 : _d.call(avplay, "SUBTITLE", targetIndex);
        } catch (_2) {
          return false;
        }
      }
      this.selectedAvPlaySubtitleTrackIndex = targetIndex;
      this.syncAvPlayTrackInfo();
      this.emitVideoEvent("avplaytrackschanged", { playbackEngine: this.playbackEngine });
      return true;
    },
    setAvPlayExternalSubtitle(subtitleUrl) {
      var _a;
      if (!this.isUsingAvPlay()) {
        return false;
      }
      const avplay = this.getAvPlay();
      if (!avplay || typeof avplay.setExternalSubtitlePath !== "function") {
        return false;
      }
      const path = String(subtitleUrl || "").trim();
      try {
        avplay.setExternalSubtitlePath(path);
        try {
          (_a = avplay.setSilentSubtitle) == null ? void 0 : _a.call(avplay, !path);
        } catch (_) {
        }
        this.selectedAvPlaySubtitleTrackIndex = -1;
        this.emitVideoEvent("avplaytrackschanged", { playbackEngine: this.playbackEngine });
        return true;
      } catch (_) {
        return false;
      }
    },
    mapAvPlayErrorToMediaCode(errorValue) {
      const errorText = String(errorValue || "").toLowerCase();
      if (!errorText) {
        return 4;
      }
      if (errorText.includes("network") || errorText.includes("connection") || errorText.includes("timeout")) {
        return 2;
      }
      if (errorText.includes("decode")) {
        return 3;
      }
      return 4;
    },
    setAvPlayDisplayRect() {
      var _a, _b;
      const avplay = this.getAvPlay();
      if (!avplay) {
        return;
      }
      const width = Math.max(1, Math.round(Number(window.innerWidth || 1920)));
      const height = Math.max(1, Math.round(Number(window.innerHeight || 1080)));
      try {
        (_a = avplay.setDisplayRect) == null ? void 0 : _a.call(avplay, 0, 0, width, height);
      } catch (_) {
      }
      try {
        (_b = avplay.setDisplayMethod) == null ? void 0 : _b.call(avplay, "PLAYER_DISPLAY_MODE_FULL_SCREEN");
      } catch (_) {
      }
    },
    teardownAvPlay() {
      var _a, _b, _c, _d;
      const avplay = this.getAvPlay();
      this.stopAvPlayTickTimer();
      if (avplay) {
        try {
          (_a = avplay.setListener) == null ? void 0 : _a.call(avplay, {});
        } catch (_) {
        }
        try {
          const state = String(((_b = avplay.getState) == null ? void 0 : _b.call(avplay)) || "").toUpperCase();
          if (state && state !== "NONE" && state !== "IDLE") {
            (_c = avplay.stop) == null ? void 0 : _c.call(avplay);
          }
        } catch (_) {
        }
        try {
          (_d = avplay.close) == null ? void 0 : _d.call(avplay);
        } catch (_) {
        }
      }
      this.avplayActive = false;
      this.avplayUrl = "";
      this.avplayAudioTracks = [];
      this.avplaySubtitleTracks = [];
      this.selectedAvPlayAudioTrackIndex = -1;
      this.selectedAvPlaySubtitleTrackIndex = -1;
      this.avplayReady = false;
      this.avplayEnded = false;
      this.avplayCurrentTimeMs = 0;
      this.avplayDurationMs = 0;
    },
    playWithAvPlay(url) {
      var _a;
      if (!this.canUseAvPlay()) {
        return false;
      }
      const avplay = this.getAvPlay();
      if (!avplay) {
        return false;
      }
      this.teardownAvPlay();
      this.avplayActive = true;
      this.avplayUrl = String(url || "");
      this.avplayReady = false;
      this.avplayEnded = false;
      this.avplayCurrentTimeMs = 0;
      this.avplayDurationMs = 0;
      this.lastPlaybackErrorCode = 0;
      this.playbackEngine = this.getPlatformAvplayEngineName();
      this.emitVideoEvent("waiting", { playbackEngine: this.playbackEngine });
      try {
        avplay.open(this.avplayUrl);
      } catch (error) {
        this.lastPlaybackErrorCode = this.mapAvPlayErrorToMediaCode((error == null ? void 0 : error.name) || (error == null ? void 0 : error.message) || error);
        this.teardownAvPlay();
        this.playbackEngine = "none";
        return false;
      }
      this.setAvPlayDisplayRect();
      try {
        (_a = avplay.setListener) == null ? void 0 : _a.call(avplay, {
          onbufferingstart: () => {
            this.avplayReady = false;
            this.emitVideoEvent("waiting", { playbackEngine: this.playbackEngine });
          },
          onbufferingcomplete: () => {
            this.avplayReady = true;
            this.emitVideoEvent("canplay", { playbackEngine: this.playbackEngine });
          },
          oncurrentplaytime: (currentTimeMs) => {
            const value = Number(currentTimeMs || 0);
            if (Number.isFinite(value) && value >= 0) {
              this.avplayCurrentTimeMs = value;
            }
          },
          onstreamcompleted: () => {
            var _a2;
            this.avplayEnded = true;
            this.isPlaying = false;
            this.stopAvPlayTickTimer();
            try {
              (_a2 = avplay.stop) == null ? void 0 : _a2.call(avplay);
            } catch (_) {
            }
            this.emitVideoEvent("ended", { playbackEngine: this.playbackEngine });
          },
          onerror: (errorValue) => {
            this.avplayReady = false;
            this.isPlaying = false;
            this.lastPlaybackErrorCode = this.mapAvPlayErrorToMediaCode(errorValue);
            this.stopAvPlayTickTimer();
            this.emitVideoEvent("error", {
              playbackEngine: this.playbackEngine,
              mediaErrorCode: this.lastPlaybackErrorCode,
              avplayError: String(errorValue || "")
            });
          }
        });
      } catch (_) {
      }
      const onPrepared = () => {
        var _a2, _b, _c;
        if (!this.isUsingAvPlay()) {
          return;
        }
        this.avplayReady = true;
        this.avplayEnded = false;
        this.refreshAvPlayTimeline();
        this.syncAvPlayTrackInfo();
        if (this.avplayAudioTracks.length && this.selectedAvPlayAudioTrackIndex < 0) {
          const fallbackAudioIndex = Number((_a2 = this.avplayAudioTracks[0]) == null ? void 0 : _a2.avplayTrackIndex);
          if (Number.isFinite(fallbackAudioIndex) && fallbackAudioIndex >= 0) {
            try {
              (_b = avplay.setSelectTrack) == null ? void 0 : _b.call(avplay, "AUDIO", fallbackAudioIndex);
              this.selectedAvPlayAudioTrackIndex = fallbackAudioIndex;
            } catch (_) {
            }
          }
        }
        this.emitVideoEvent("loadedmetadata", { playbackEngine: this.playbackEngine });
        this.emitVideoEvent("loadeddata", { playbackEngine: this.playbackEngine });
        this.emitVideoEvent("canplay", { playbackEngine: this.playbackEngine });
        this.emitVideoEvent("avplaytrackschanged", { playbackEngine: this.playbackEngine });
        try {
          (_c = avplay.play) == null ? void 0 : _c.call(avplay);
          this.isPlaying = true;
          this.startAvPlayTickTimer();
          this.emitVideoEvent("playing", { playbackEngine: this.playbackEngine });
        } catch (error) {
          this.lastPlaybackErrorCode = this.mapAvPlayErrorToMediaCode((error == null ? void 0 : error.name) || (error == null ? void 0 : error.message) || error);
          this.isPlaying = false;
          this.emitVideoEvent("error", {
            playbackEngine: this.playbackEngine,
            mediaErrorCode: this.lastPlaybackErrorCode
          });
        }
      };
      const onPrepareError = (errorValue) => {
        this.lastPlaybackErrorCode = this.mapAvPlayErrorToMediaCode(errorValue);
        this.isPlaying = false;
        this.teardownAvPlay();
        this.playbackEngine = "none";
        this.emitVideoEvent("error", {
          playbackEngine: this.getPlatformAvplayEngineName(),
          mediaErrorCode: this.lastPlaybackErrorCode,
          avplayError: String(errorValue || "")
        });
      };
      try {
        if (typeof avplay.prepareAsync === "function") {
          avplay.prepareAsync(onPrepared, onPrepareError);
        } else if (typeof avplay.prepare === "function") {
          avplay.prepare();
          onPrepared();
        } else {
          onPrepareError("prepare_not_supported");
        }
      } catch (error) {
        onPrepareError((error == null ? void 0 : error.name) || (error == null ? void 0 : error.message) || error);
      }
      return true;
    },
    getCurrentTimeSeconds() {
      var _a;
      if (this.isUsingAvPlay()) {
        this.refreshAvPlayTimeline();
        return Math.max(0, Number(this.avplayCurrentTimeMs || 0) / 1e3);
      }
      return Math.max(0, Number(((_a = this.video) == null ? void 0 : _a.currentTime) || 0));
    },
    getDurationSeconds() {
      var _a;
      if (this.isUsingAvPlay()) {
        this.refreshAvPlayTimeline();
        return Math.max(0, Number(this.avplayDurationMs || 0) / 1e3);
      }
      return Math.max(0, Number(((_a = this.video) == null ? void 0 : _a.duration) || 0));
    },
    seekToSeconds(targetSeconds) {
      var _a, _b, _c;
      const seconds = Number(targetSeconds || 0);
      if (!Number.isFinite(seconds) || seconds < 0) {
        return false;
      }
      if (!this.isUsingAvPlay()) {
        if (!this.video) {
          return false;
        }
        this.video.currentTime = seconds;
        return true;
      }
      const avplay = this.getAvPlay();
      if (!avplay) {
        return false;
      }
      const targetMs = Math.max(0, Math.floor(seconds * 1e3));
      try {
        if (typeof avplay.seekTo === "function") {
          avplay.seekTo(targetMs);
        } else {
          const currentMs = Number(((_a = avplay.getCurrentTime) == null ? void 0 : _a.call(avplay)) || 0);
          if (targetMs > currentMs) {
            (_b = avplay.jumpForward) == null ? void 0 : _b.call(avplay, targetMs - currentMs);
          } else if (targetMs < currentMs) {
            (_c = avplay.jumpBackward) == null ? void 0 : _c.call(avplay, currentMs - targetMs);
          }
        }
        this.avplayCurrentTimeMs = targetMs;
        this.emitVideoEvent("timeupdate", { playbackEngine: this.playbackEngine });
        return true;
      } catch (_) {
        return false;
      }
    },
    isPlaybackEnded() {
      var _a;
      if (this.isUsingAvPlay()) {
        return Boolean(this.avplayEnded);
      }
      return Boolean((_a = this.video) == null ? void 0 : _a.ended);
    },
    getPlaybackReadyState() {
      var _a;
      if (this.isUsingAvPlay()) {
        return this.avplayReady ? 4 : 1;
      }
      return Number(((_a = this.video) == null ? void 0 : _a.readyState) || 0);
    },
    getLastPlaybackErrorCode() {
      return Number(this.lastPlaybackErrorCode || 0);
    },
    forceAvPlayFallbackForCurrentSource(reason = "fallback") {
      var _a, _b;
      const url = String(this.currentPlaybackUrl || ((_a = this.video) == null ? void 0 : _a.currentSrc) || ((_b = this.video) == null ? void 0 : _b.src) || "").trim();
      if (!url || this.avplayFallbackAttempts.has(url) || !this.canUseAvPlay()) {
        return false;
      }
      this.avplayFallbackAttempts.add(url);
      console.warn("Forcing AVPlay fallback:", { reason, url });
      this.play(url, {
        itemId: this.currentItemId,
        itemType: this.currentItemType || "movie",
        videoId: this.currentVideoId,
        season: this.currentSeason,
        episode: this.currentEpisode,
        requestHeaders: { ...this.currentPlaybackHeaders || {} },
        mediaSourceType: this.currentPlaybackMediaSourceType || null,
        forceEngine: this.getPlatformAvplayEngineName()
      });
      return true;
    },
    getPlaybackCapabilities() {
      const supports = (mimeType) => this.canPlayNatively(mimeType);
      const capabilities = {
        avplay: this.canUseAvPlay(),
        hls: supports("application/vnd.apple.mpegurl"),
        dash: supports("application/dash+xml"),
        mp4H264: supports('video/mp4; codecs="avc1.4d401f,mp4a.40.2"'),
        mp4Hevc: supports('video/mp4; codecs="hvc1.1.6.L93.B0,mp4a.40.2"') || supports('video/mp4; codecs="hev1.1.6.L93.B0,mp4a.40.2"'),
        mp4HevcMain10: supports('video/mp4; codecs="hvc1.2.4.L153.B0,mp4a.40.2"') || supports('video/mp4; codecs="hev1.2.4.L153.B0,mp4a.40.2"'),
        mp4Av1: supports('video/mp4; codecs="av01.0.08M.08,mp4a.40.2"'),
        webmVp9: supports('video/webm; codecs="vp9,opus"'),
        mkvH264: supports('video/x-matroska; codecs="avc1.4d401f,mp4a.40.2"') || supports("video/x-matroska"),
        audioAac: supports('audio/mp4; codecs="mp4a.40.2"'),
        audioAc3: supports('audio/mp4; codecs="ac-3"') || supports('audio/mp4; codecs="dac3"'),
        audioEac3: supports('audio/mp4; codecs="ec-3"') || supports('audio/mp4; codecs="dec3"'),
        dolbyVision: supports('video/mp4; codecs="dvh1.05.06,ec-3"') || supports('video/mp4; codecs="dvhe.05.06,ec-3"')
      };
      capabilities.hdrLikely = capabilities.mp4HevcMain10 || capabilities.mp4Av1;
      capabilities.atmosLikely = capabilities.audioEac3;
      return capabilities;
    },
    teardownHlsInstance() {
      if (!this.hlsInstance) {
        return;
      }
      try {
        this.hlsInstance.destroy();
      } catch (_) {
      }
      this.hlsInstance = null;
    },
    teardownDashInstance() {
      var _a, _b;
      if (!this.dashInstance) {
        return;
      }
      try {
        (_b = (_a = this.dashInstance).reset) == null ? void 0 : _b.call(_a);
      } catch (_) {
      }
      this.dashInstance = null;
    },
    teardownAdaptiveInstances() {
      this.teardownHlsInstance();
      this.teardownDashInstance();
      if (!this.isUsingAvPlay()) {
        this.playbackEngine = "none";
      }
    },
    applyNativeSource(url, mimeType = null) {
      if (!nativeVideoEngine.load(this.video, url, mimeType)) {
        return false;
      }
      this.playbackEngine = "native";
      return true;
    },
    shouldForwardHeaderToHls(name) {
      const lower = String(name || "").trim().toLowerCase();
      if (!lower) {
        return false;
      }
      if (lower === "range") {
        return false;
      }
      if (lower.startsWith("sec-")) {
        return false;
      }
      const forbidden = /* @__PURE__ */ new Set([
        "host",
        "origin",
        "referer",
        "referrer",
        "user-agent",
        "content-length",
        "accept-encoding",
        "connection",
        "cookie"
      ]);
      return !forbidden.has(lower);
    },
    normalizePlaybackHeaders(headers) {
      if (!headers || typeof headers !== "object") {
        return {};
      }
      const entries = Object.entries(headers).map(([key, value]) => [String(key || "").trim(), String(value != null ? value : "").trim()]).filter(([key, value]) => key && value).filter(([key]) => this.shouldForwardHeaderToHls(key));
      return Object.fromEntries(entries);
    },
    buildHlsConfig(requestHeaders = {}) {
      const forwardedHeaders = this.normalizePlaybackHeaders(requestHeaders);
      return {
        enableWorker: true,
        lowLatencyMode: false,
        backBufferLength: 90,
        maxBufferLength: 30,
        xhrSetup: (xhr) => {
          Object.entries(forwardedHeaders).forEach(([headerName, headerValue]) => {
            try {
              xhr.setRequestHeader(headerName, headerValue);
            } catch (_) {
            }
          });
        },
        fetchSetup: (context, initParams = {}) => {
          const headers = new Headers(initParams.headers || {});
          Object.entries(forwardedHeaders).forEach(([headerName, headerValue]) => {
            try {
              headers.set(headerName, headerValue);
            } catch (_) {
            }
          });
          return new Request(context.url, {
            ...initParams,
            headers
          });
        }
      };
    },
    playWithHlsJs(url, requestHeaders = {}) {
      if (!this.video || !this.canUseHlsJs()) {
        return false;
      }
      const Hls = hlsJsEngine.getConstructor();
      if (!Hls) {
        return false;
      }
      this.teardownHlsInstance();
      this.teardownDashInstance();
      const hls = hlsJsEngine.create(this.buildHlsConfig(requestHeaders));
      if (!hls) {
        return false;
      }
      this.hlsInstance = hls;
      this.playbackEngine = "hls.js";
      hls.on(Hls.Events.ERROR, (_, data = {}) => {
        if (!(data == null ? void 0 : data.fatal)) {
          return;
        }
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          try {
            hls.startLoad();
            return;
          } catch (_2) {
          }
        }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          try {
            hls.recoverMediaError();
            return;
          } catch (_2) {
          }
        }
        this.teardownHlsInstance();
      });
      hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        try {
          hls.loadSource(url);
        } catch (error) {
          console.warn("HLS source attach failed", error);
        }
      });
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        const playPromise = this.video.play();
        if (playPromise && typeof playPromise.catch === "function") {
          playPromise.catch((error) => {
            if (this.isExpectedPlayInterruption(error)) {
              return;
            }
            console.warn("HLS playback start rejected", error);
          });
        }
      });
      this.video.removeAttribute("src");
      hls.attachMedia(this.video);
      return true;
    },
    playWithDashJs(url) {
      var _a, _b, _c, _d, _e, _f;
      if (!this.video || !this.canUseDashJs()) {
        return false;
      }
      this.teardownDashInstance();
      this.teardownHlsInstance();
      let player = null;
      try {
        player = dashJsEngine.createPlayer();
        if (!player) {
          return false;
        }
        (_a = player.updateSettings) == null ? void 0 : _a.call(player, {
          streaming: {
            fastSwitchEnabled: true
          }
        });
        player.initialize(this.video, url, true);
        const dashEvents = dashJsEngine.getEvents();
        const emitTracksChanged = () => {
          this.emitVideoEvent("dashtrackschanged", { playbackEngine: "dash.js" });
        };
        try {
          (_b = player.on) == null ? void 0 : _b.call(player, dashEvents.STREAM_INITIALIZED, emitTracksChanged);
          (_c = player.on) == null ? void 0 : _c.call(player, dashEvents.TRACK_CHANGE_RENDERED, emitTracksChanged);
          (_d = player.on) == null ? void 0 : _d.call(player, dashEvents.TEXT_TRACKS_ADDED, emitTracksChanged);
          (_e = player.on) == null ? void 0 : _e.call(player, dashEvents.PERIOD_SWITCH_COMPLETED, emitTracksChanged);
        } catch (_) {
        }
        this.dashInstance = player;
        this.playbackEngine = "dash.js";
        return true;
      } catch (error) {
        console.warn("DASH source attach failed", error);
        try {
          (_f = player == null ? void 0 : player.reset) == null ? void 0 : _f.call(player);
        } catch (_) {
        }
        this.dashInstance = null;
        return false;
      }
    },
    getDashAudioTracks() {
      var _a, _b;
      const tracks = (_b = (_a = this.dashInstance) == null ? void 0 : _a.getTracksFor) == null ? void 0 : _b.call(_a, "audio");
      if (!Array.isArray(tracks)) {
        return [];
      }
      return tracks.filter(Boolean).map((track, index) => {
        var _a2, _b2, _c;
        return {
          id: String((_a2 = track == null ? void 0 : track.id) != null ? _a2 : `dash-audio-${index}`),
          index,
          label: String(((_c = (_b2 = track == null ? void 0 : track.labels) == null ? void 0 : _b2[0]) == null ? void 0 : _c.text) || (track == null ? void 0 : track.lang) || `Track ${index + 1}`),
          language: String((track == null ? void 0 : track.lang) || ""),
          raw: track
        };
      });
    },
    getSelectedDashAudioTrackIndex() {
      var _a, _b, _c, _d;
      const current = (_b = (_a = this.dashInstance) == null ? void 0 : _a.getCurrentTrackFor) == null ? void 0 : _b.call(_a, "audio");
      const tracks = this.getDashAudioTracks();
      if (!current || !tracks.length) {
        return -1;
      }
      const exactMatch = tracks.findIndex((track) => track.raw === current);
      if (exactMatch >= 0) {
        return exactMatch;
      }
      const currentId = String((_c = current == null ? void 0 : current.id) != null ? _c : "");
      const currentLang = String((_d = current == null ? void 0 : current.lang) != null ? _d : "");
      return tracks.findIndex((track) => {
        var _a2, _b2;
        return String((_a2 = track == null ? void 0 : track.id) != null ? _a2 : "") === currentId && String((_b2 = track == null ? void 0 : track.language) != null ? _b2 : "") === currentLang;
      });
    },
    setDashAudioTrack(index) {
      var _a, _b;
      const targetIndex = Number(index);
      const tracks = this.getDashAudioTracks();
      if (!Number.isFinite(targetIndex) || targetIndex < 0 || targetIndex >= tracks.length) {
        return false;
      }
      const target = ((_a = tracks[targetIndex]) == null ? void 0 : _a.raw) || null;
      if (!target || typeof ((_b = this.dashInstance) == null ? void 0 : _b.setCurrentTrack) !== "function") {
        return false;
      }
      try {
        this.dashInstance.setCurrentTrack(target);
        this.emitVideoEvent("dashtrackschanged", { playbackEngine: "dash.js" });
        return true;
      } catch (_) {
        return false;
      }
    },
    getDashTextTracks() {
      var _a, _b;
      const tracks = (_b = (_a = this.dashInstance) == null ? void 0 : _a.getTracksFor) == null ? void 0 : _b.call(_a, "text");
      if (!Array.isArray(tracks)) {
        return [];
      }
      return tracks.filter(Boolean).map((track, index) => {
        var _a2, _b2, _c;
        return {
          id: String((_a2 = track == null ? void 0 : track.id) != null ? _a2 : `dash-text-${index}`),
          index,
          textTrackIndex: Number(track == null ? void 0 : track.index),
          label: String(((_c = (_b2 = track == null ? void 0 : track.labels) == null ? void 0 : _b2[0]) == null ? void 0 : _c.text) || (track == null ? void 0 : track.lang) || `Subtitle ${index + 1}`),
          language: String((track == null ? void 0 : track.lang) || ""),
          raw: track
        };
      });
    },
    getSelectedDashTextTrackIndex() {
      var _a, _b, _c, _d;
      const current = (_b = (_a = this.dashInstance) == null ? void 0 : _a.getCurrentTrackFor) == null ? void 0 : _b.call(_a, "text");
      const tracks = this.getDashTextTracks();
      if (!current || !tracks.length) {
        return -1;
      }
      const exactMatch = tracks.findIndex((track) => track.raw === current);
      if (exactMatch >= 0) {
        return exactMatch;
      }
      const currentId = String((_c = current == null ? void 0 : current.id) != null ? _c : "");
      const currentLang = String((_d = current == null ? void 0 : current.lang) != null ? _d : "");
      return tracks.findIndex((track) => {
        var _a2, _b2;
        return String((_a2 = track == null ? void 0 : track.id) != null ? _a2 : "") === currentId && String((_b2 = track == null ? void 0 : track.language) != null ? _b2 : "") === currentLang;
      });
    },
    setDashTextTrack(index) {
      var _a, _b, _c;
      const targetIndex = Number(index);
      const player = this.dashInstance;
      if (!player) {
        return false;
      }
      if (!Number.isFinite(targetIndex) || targetIndex < 0) {
        try {
          (_a = player.setTextTrack) == null ? void 0 : _a.call(player, -1);
        } catch (_) {
        }
        try {
          (_b = player.enableText) == null ? void 0 : _b.call(player, false);
        } catch (_) {
        }
        this.emitVideoEvent("dashtrackschanged", { playbackEngine: "dash.js" });
        return true;
      }
      const tracks = this.getDashTextTracks();
      if (targetIndex >= tracks.length) {
        return false;
      }
      const target = tracks[targetIndex] || null;
      try {
        (_c = player.enableText) == null ? void 0 : _c.call(player, true);
      } catch (_) {
      }
      try {
        if (Number.isFinite(target == null ? void 0 : target.textTrackIndex) && typeof player.setTextTrack === "function") {
          player.setTextTrack(target.textTrackIndex);
        } else if ((target == null ? void 0 : target.raw) && typeof player.setCurrentTrack === "function") {
          player.setCurrentTrack(target.raw);
        } else {
          return false;
        }
        this.emitVideoEvent("dashtrackschanged", { playbackEngine: "dash.js" });
        return true;
      } catch (_) {
        return false;
      }
    },
    getHlsAudioTracks() {
      return hlsJsEngine.getAudioTracks(this.hlsInstance);
    },
    getSelectedHlsAudioTrackIndex() {
      return hlsJsEngine.getSelectedAudioTrackIndex(this.hlsInstance);
    },
    setHlsAudioTrack(index) {
      return hlsJsEngine.setAudioTrack(this.hlsInstance, index);
    },
    attemptVideoPlay({ warningLabel = "Playback start rejected", onRejected = null } = {}) {
      if (!this.video) {
        return;
      }
      const playPromise = this.video.play();
      if (!playPromise || typeof playPromise.catch !== "function") {
        return;
      }
      playPromise.catch((error) => {
        if (this.isExpectedPlayInterruption(error)) {
          return;
        }
        if (typeof onRejected === "function") {
          try {
            const handled = onRejected(error);
            if (handled) {
              return;
            }
          } catch (_) {
          }
        }
        this.isPlaying = false;
        console.warn(warningLabel, error);
      });
    },
    choosePlaybackEngine(url, sourceType) {
      const mimeType = String(sourceType || "").toLowerCase();
      if (this.isLikelyHlsMimeType(mimeType)) {
        if (this.canPlayNatively("application/vnd.apple.mpegurl")) {
          return "native-hls";
        }
        if (this.canUseHlsJs()) {
          return "hls.js";
        }
        return "native-hls";
      }
      if (this.isLikelyDashMimeType(mimeType)) {
        if (this.canUseDashJs()) {
          return "dash.js";
        }
        if (this.canPlayNatively("application/dash+xml")) {
          return "native-dash";
        }
        return "native-dash";
      }
      if (this.canUseAvPlay()) {
        return this.getPlatformAvplayEngineName();
      }
      return "native-file";
    },
    init() {
      this.video = document.getElementById("videoPlayer");
      Platform.prepareVideoElement(this.video);
      this.video.muted = false;
      this.video.defaultMuted = false;
      this.video.volume = 1;
      console.log("Runtime probe:", {
        platform: Platform.getName(),
        deviceLabel: Platform.getDeviceLabel(),
        capabilities: Platform.getCapabilities(),
        canUseAvPlay: this.canUseAvPlay()
      });
      console.log("Playback capabilities:", this.getPlaybackCapabilities());
      this.video.addEventListener("ended", () => {
        console.log("Playback ended");
        this.isPlaying = false;
        const context = this.createProgressContext();
        this.flushProgress(0, 0, true, context);
      });
      this.video.addEventListener("error", (e) => {
        var _a, _b, _c, _d, _e, _f;
        const customErrorCode = Number(((_a = e == null ? void 0 : e.detail) == null ? void 0 : _a.mediaErrorCode) || 0);
        const nativeErrorCode = Number(((_c = (_b = this.video) == null ? void 0 : _b.error) == null ? void 0 : _c.code) || 0);
        const mediaErrorCode = customErrorCode || nativeErrorCode || this.getLastPlaybackErrorCode();
        console.error("Video error:", {
          event: (e == null ? void 0 : e.type) || "error",
          mediaErrorCode,
          avplayError: ((_d = e == null ? void 0 : e.detail) == null ? void 0 : _d.avplayError) || "",
          currentSrc: ((_e = this.video) == null ? void 0 : _e.currentSrc) || ((_f = this.video) == null ? void 0 : _f.src) || "",
          playbackEngine: this.playbackEngine
        });
      });
      this.video.addEventListener("waiting", () => {
        console.log("Buffering...");
      });
      this.video.addEventListener("playing", () => {
        var _a, _b, _c, _d, _e;
        console.log("Playing");
        const audioTrackList = ((_a = this.video) == null ? void 0 : _a.audioTracks) || ((_b = this.video) == null ? void 0 : _b.webkitAudioTracks) || ((_c = this.video) == null ? void 0 : _c.mozAudioTracks);
        const audioTrackCount = Number((audioTrackList == null ? void 0 : audioTrackList.length) || 0);
        const probeUrl = String(this.currentPlaybackUrl || ((_d = this.video) == null ? void 0 : _d.currentSrc) || ((_e = this.video) == null ? void 0 : _e.src) || "").trim();
        const isDirectFile = this.isLikelyDirectFileUrl(probeUrl);
        if (this.playbackEngine === "native" && isDirectFile && audioTrackCount <= 0 && this.canUseAvPlay()) {
          this.forceAvPlayFallbackForCurrentSource("native_playing_no_audio_tracks");
        }
      });
      this.video.addEventListener("loadedmetadata", () => {
        var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j;
        const audioTrackList = ((_a = this.video) == null ? void 0 : _a.audioTracks) || ((_b = this.video) == null ? void 0 : _b.webkitAudioTracks) || ((_c = this.video) == null ? void 0 : _c.mozAudioTracks);
        const textTrackList = ((_d = this.video) == null ? void 0 : _d.textTracks) || ((_e = this.video) == null ? void 0 : _e.webkitTextTracks) || ((_f = this.video) == null ? void 0 : _f.mozTextTracks);
        const audioTrackCount = Number((audioTrackList == null ? void 0 : audioTrackList.length) || 0);
        const textTrackCount = Number((textTrackList == null ? void 0 : textTrackList.length) || 0);
        const probeUrl = String(this.currentPlaybackUrl || ((_g = this.video) == null ? void 0 : _g.currentSrc) || ((_h = this.video) == null ? void 0 : _h.src) || "").trim();
        const isDirectFile = this.isLikelyDirectFileUrl(probeUrl);
        const fallbackTried = this.avplayFallbackAttempts.has(probeUrl);
        console.log("Playback metadata:", {
          playbackEngine: this.playbackEngine,
          duration: Number(this.getDurationSeconds() || 0),
          audioTrackCount,
          textTrackCount,
          currentSrc: ((_i = this.video) == null ? void 0 : _i.currentSrc) || ((_j = this.video) == null ? void 0 : _j.src) || "",
          canUseAvPlay: this.canUseAvPlay(),
          directFileHint: isDirectFile,
          avplayFallbackTried: fallbackTried
        });
        if (this.playbackEngine === "native" && isDirectFile && audioTrackCount <= 0 && this.canUseAvPlay()) {
          this.forceAvPlayFallbackForCurrentSource("native_no_audio_tracks");
        }
      });
      if (!this.lifecycleBound) {
        this.lifecycleBound = true;
        this.lifecycleFlushHandler = () => {
          const context = this.createProgressContext();
          if (!context.itemId) {
            return;
          }
          this.flushProgress(
            Math.floor(this.getCurrentTimeSeconds() * 1e3),
            Math.floor(this.getDurationSeconds() * 1e3),
            false,
            context
          ).finally(() => {
            this.pushProgressIfDue(true);
          });
        };
        this.visibilityFlushHandler = () => {
          var _a;
          if (document.visibilityState === "hidden") {
            (_a = this.lifecycleFlushHandler) == null ? void 0 : _a.call(this);
          }
        };
        window.addEventListener("pagehide", this.lifecycleFlushHandler);
        window.addEventListener("beforeunload", this.lifecycleFlushHandler);
        document.addEventListener("visibilitychange", this.visibilityFlushHandler);
      }
    },
    play(url, { itemId = null, itemType = "movie", videoId = null, season = null, episode = null, requestHeaders = {}, mediaSourceType = null, forceEngine = null } = {}) {
      if (!this.video) return;
      try {
        this.video.muted = false;
        this.video.defaultMuted = false;
        if (!Number.isFinite(Number(this.video.volume)) || Number(this.video.volume) <= 0) {
          this.video.volume = 1;
        }
      } catch (_) {
      }
      this.currentItemId = itemId;
      this.currentItemType = itemType;
      this.currentVideoId = videoId;
      this.currentSeason = season == null ? null : Number(season);
      this.currentEpisode = episode == null ? null : Number(episode);
      this.currentPlaybackUrl = String(url || "").trim();
      this.currentPlaybackHeaders = { ...requestHeaders || {} };
      this.currentPlaybackMediaSourceType = mediaSourceType || null;
      this.lastPlaybackErrorCode = 0;
      const sourceType = String(mediaSourceType || this.guessMediaMimeType(url) || "").trim() || null;
      const preferredEngine = forceEngine || this.choosePlaybackEngine(url, sourceType);
      console.log("Playback engine selected:", {
        engine: preferredEngine,
        sourceType,
        directFileHint: this.isLikelyDirectFileUrl(url),
        canUseAvPlay: this.canUseAvPlay(),
        forceEngine: forceEngine || "",
        url
      });
      this.teardownAdaptiveInstances();
      this.teardownAvPlay();
      Array.from(this.video.querySelectorAll("source")).forEach((node) => node.remove());
      this.video.pause();
      this.video.removeAttribute("src");
      this.video.load();
      if (preferredEngine === this.getPlatformAvplayEngineName()) {
        const avplayStarted = this.playWithAvPlay(url);
        console.log("AVPlay start:", avplayStarted ? "ok" : "failed");
        if (!avplayStarted) {
          this.applyNativeSource(url, null);
          this.attemptVideoPlay({
            warningLabel: "Playback start rejected",
            onRejected: (error) => {
              if (!this.isUnsupportedSourceError(error) || !this.canUseAvPlay()) {
                return false;
              }
              const fallbackStarted = this.playWithAvPlay(url);
              if (fallbackStarted) {
                this.isPlaying = true;
              }
              return fallbackStarted;
            }
          });
        }
      } else if (preferredEngine === "hls.js") {
        const hlsStarted = this.playWithHlsJs(url, requestHeaders);
        if (!hlsStarted) {
          this.applyNativeSource(url, sourceType || null);
          this.attemptVideoPlay({ warningLabel: "Playback start rejected" });
        }
      } else if (preferredEngine === "dash.js") {
        const dashStarted = this.playWithDashJs(url);
        if (!dashStarted) {
          this.applyNativeSource(url, sourceType || "application/dash+xml");
        }
        this.attemptVideoPlay({ warningLabel: "DASH playback start rejected" });
      } else if (preferredEngine === "native-hls") {
        this.applyNativeSource(url, sourceType || "application/vnd.apple.mpegurl");
        this.attemptVideoPlay({
          warningLabel: "Native HLS playback start rejected",
          onRejected: (error) => {
            if (!this.isUnsupportedSourceError(error)) {
              return false;
            }
            const fallbackStarted = this.playWithHlsJs(url, requestHeaders);
            if (fallbackStarted) {
              this.isPlaying = true;
            }
            return fallbackStarted;
          }
        });
      } else if (preferredEngine === "native-dash") {
        this.applyNativeSource(url, sourceType || "application/dash+xml");
        this.attemptVideoPlay({ warningLabel: "Native DASH playback start rejected" });
      } else {
        this.applyNativeSource(url, null);
        this.attemptVideoPlay({
          warningLabel: "Playback start rejected",
          onRejected: (error) => {
            if (!this.isUnsupportedSourceError(error) || !this.canUseAvPlay() || !this.isLikelyDirectFileUrl(url)) {
              return false;
            }
            const fallbackStarted = this.playWithAvPlay(url);
            if (fallbackStarted) {
              this.isPlaying = true;
            }
            return fallbackStarted;
          }
        });
      }
      this.isPlaying = true;
      if (this.progressSaveTimer) {
        clearInterval(this.progressSaveTimer);
      }
      this.progressSaveTimer = setInterval(() => {
        const context = this.createProgressContext();
        this.flushProgress(
          Math.floor(this.getCurrentTimeSeconds() * 1e3),
          Math.floor(this.getDurationSeconds() * 1e3),
          false,
          context
        );
      }, 5e3);
    },
    pause() {
      var _a;
      if (!this.video) return;
      if (this.isUsingAvPlay()) {
        const avplay = this.getAvPlay();
        if (!avplay) {
          return;
        }
        try {
          (_a = avplay.pause) == null ? void 0 : _a.call(avplay);
          this.isPlaying = false;
          this.stopAvPlayTickTimer();
          this.emitVideoEvent("pause", { playbackEngine: this.playbackEngine });
        } catch (_) {
        }
        return;
      }
      this.video.pause();
    },
    resume() {
      var _a;
      if (!this.video) return;
      if (this.isUsingAvPlay()) {
        const avplay = this.getAvPlay();
        if (!avplay) {
          return;
        }
        try {
          (_a = avplay.play) == null ? void 0 : _a.call(avplay);
          this.isPlaying = true;
          this.startAvPlayTickTimer();
          this.emitVideoEvent("playing", { playbackEngine: this.playbackEngine });
        } catch (error) {
          this.lastPlaybackErrorCode = this.mapAvPlayErrorToMediaCode((error == null ? void 0 : error.name) || (error == null ? void 0 : error.message) || error);
          console.warn("Playback resume rejected", error);
        }
        return;
      }
      const playPromise = this.video.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch((error) => {
          if (this.isExpectedPlayInterruption(error)) {
            return;
          }
          console.warn("Playback resume rejected", error);
        });
      }
    },
    stop() {
      if (!this.video) return;
      const context = this.createProgressContext();
      this.flushProgress(
        Math.floor(this.getCurrentTimeSeconds() * 1e3),
        Math.floor(this.getDurationSeconds() * 1e3),
        false,
        context
      ).finally(() => {
        this.pushProgressIfDue(true);
      });
      this.video.pause();
      this.teardownAdaptiveInstances();
      this.teardownAvPlay();
      this.video.removeAttribute("src");
      Array.from(this.video.querySelectorAll("source")).forEach((node) => node.remove());
      this.video.load();
      this.isPlaying = false;
      this.currentItemId = null;
      this.currentItemType = null;
      this.currentVideoId = null;
      this.currentSeason = null;
      this.currentEpisode = null;
      this.currentPlaybackUrl = "";
      this.currentPlaybackHeaders = {};
      this.currentPlaybackMediaSourceType = null;
      this.playbackEngine = "none";
      this.lastPlaybackErrorCode = 0;
      if (this.progressSaveTimer) {
        clearInterval(this.progressSaveTimer);
        this.progressSaveTimer = null;
      }
    },
    createProgressContext() {
      return {
        itemId: this.currentItemId,
        itemType: this.currentItemType || "movie",
        videoId: this.currentVideoId || null,
        season: Number.isFinite(this.currentSeason) ? this.currentSeason : null,
        episode: Number.isFinite(this.currentEpisode) ? this.currentEpisode : null
      };
    },
    async flushProgress(positionMs, durationMs, clear = false, context = null) {
      const active = context || this.createProgressContext();
      if (!(active == null ? void 0 : active.itemId)) {
        return;
      }
      const safePosition = Number(positionMs || 0);
      const safeDuration = Number(durationMs || 0);
      const hasFiniteDuration = Number.isFinite(safeDuration) && safeDuration > 0;
      if (clear || hasFiniteDuration && safePosition / safeDuration > 0.95) {
        await watchProgressRepository.removeProgress(active.itemId, active.videoId || null);
        this.pushProgressIfDue(true);
        return;
      }
      if (!Number.isFinite(safePosition) || safePosition <= 0) {
        return;
      }
      await watchProgressRepository.saveProgress({
        contentId: active.itemId,
        contentType: active.itemType || "movie",
        videoId: active.videoId || null,
        season: active.season,
        episode: active.episode,
        positionMs: Math.max(0, Math.trunc(safePosition)),
        durationMs: hasFiniteDuration ? Math.max(0, Math.trunc(safeDuration)) : 0
      });
      this.pushProgressIfDue(false);
    },
    pushProgressIfDue(force = false) {
      const now = Date.now();
      if (!force && now - Number(this.lastProgressPushAt || 0) < 3e4) {
        return;
      }
      this.lastProgressPushAt = now;
      WatchProgressSyncService.push().catch((error) => {
        console.warn("Watch progress auto push failed", error);
      });
    }
  };

  // js/data/remote/api/subtitleApi.js
  var SubtitleApi = {
    async getSubtitles(url) {
      return httpRequest(url, {
        includeSessionAuth: false
      });
    }
  };

  // js/data/repository/subtitleRepository.js
  var PER_ADDON_TIMEOUT_MS = 8e3;
  var SubtitleRepository = class {
    async getSubtitles(type, id, videoId = null) {
      const normalizedType = String(type || "").toLowerCase();
      const rawId = String(id || "").trim();
      const normalizedId = this.normalizeIdForLookup(rawId);
      const idCandidates = this.uniqueNonEmpty([normalizedId, rawId]);
      const addons = await addonRepository.getInstalledAddons();
      const subtitleAddons = addons.filter((addon) => (addon.resources || []).some((resource) => {
        if (!this.isSubtitleResource(resource == null ? void 0 : resource.name)) {
          return false;
        }
        return this.supportsType(resource, normalizedType, normalizedId);
      }));
      const allResults = await Promise.all(subtitleAddons.map(
        (addon) => this.fetchSubtitlesFromAddon(addon, normalizedType, idCandidates, videoId)
      ));
      return allResults.flat();
    }
    async fetchSubtitlesFromAddon(addon, type, idCandidates = [], videoId) {
      var _a;
      const candidateIds = this.buildActualIdCandidates(type, idCandidates, videoId);
      if (!candidateIds.length) {
        return [];
      }
      const merged = [];
      const seen = /* @__PURE__ */ new Set();
      for (const actualId of candidateIds) {
        const url = this.buildSubtitlesUrl(addon.baseUrl, type, actualId);
        const result = await this.withTimeout(
          safeApiCall(() => SubtitleApi.getSubtitles(url)),
          PER_ADDON_TIMEOUT_MS
        );
        if (!result || result.status !== "success") {
          continue;
        }
        const subtitles = (((_a = result.data) == null ? void 0 : _a.subtitles) || []).map((subtitle) => ({
          id: subtitle.id || `${subtitle.lang || "unk"}-${this.makeDeterministicId(subtitle.url || "")}`,
          url: subtitle.url,
          lang: subtitle.lang || "unknown",
          addonName: addon.displayName,
          addonLogo: addon.logo
        })).filter((subtitle) => Boolean(subtitle.url));
        subtitles.forEach((subtitle) => {
          const key = `${subtitle.url}::${String(subtitle.lang || "").toLowerCase()}`;
          if (seen.has(key)) {
            return;
          }
          seen.add(key);
          merged.push(subtitle);
        });
        if (merged.length) {
          break;
        }
      }
      return merged;
    }
    isSubtitleResource(name) {
      const resourceName = String(name || "").toLowerCase();
      return resourceName === "subtitles" || resourceName === "subtitle";
    }
    supportsType(resource, type, id) {
      const supportedTypes = Array.isArray(resource == null ? void 0 : resource.types) ? resource.types.map((value) => String(value || "").toLowerCase()).filter(Boolean) : [];
      const compatibleTypes = this.compatibleTypes(type);
      if (supportedTypes.length > 0 && !compatibleTypes.some((candidateType) => supportedTypes.includes(candidateType))) {
        return false;
      }
      const idPrefixes = Array.isArray(resource == null ? void 0 : resource.idPrefixes) ? resource.idPrefixes.map((value) => String(value || "")).filter(Boolean) : [];
      if (!idPrefixes.length) {
        return true;
      }
      return idPrefixes.some((prefix) => String(id || "").startsWith(prefix));
    }
    normalizeIdForLookup(id) {
      const raw = String(id || "").trim();
      if (!raw) {
        return "";
      }
      return String(raw.split(":")[0] || "").trim() || raw;
    }
    compatibleTypes(type) {
      const normalized = String(type || "").toLowerCase();
      if (normalized === "series" || normalized === "tv") {
        return ["series", "tv"];
      }
      return [normalized];
    }
    uniqueNonEmpty(values = []) {
      const unique2 = [];
      const seen = /* @__PURE__ */ new Set();
      (values || []).forEach((value) => {
        const normalized = String(value || "").trim();
        if (!normalized || seen.has(normalized)) {
          return;
        }
        seen.add(normalized);
        unique2.push(normalized);
      });
      return unique2;
    }
    buildActualIdCandidates(type, ids = [], videoId = null) {
      const candidates = [];
      const push = (value) => {
        const normalized = String(value || "").trim();
        if (!normalized || candidates.includes(normalized)) {
          return;
        }
        candidates.push(normalized);
      };
      if (String(type || "").toLowerCase() === "series") {
        push(videoId);
      }
      (ids || []).forEach(push);
      return candidates;
    }
    async withTimeout(promise, timeoutMs) {
      let timeoutId = null;
      try {
        const timeoutPromise = new Promise((resolve) => {
          timeoutId = setTimeout(() => {
            resolve({ status: "timeout" });
          }, Math.max(500, Number(timeoutMs || 0)));
        });
        return await Promise.race([promise, timeoutPromise]);
      } finally {
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
      }
    }
    buildSubtitlesUrl(baseUrl, type, id) {
      const cleanBaseUrl = String(baseUrl || "").replace(/\/+$/, "");
      return `${cleanBaseUrl}/subtitles/${this.encode(type)}/${this.encodeSubtitleId(id)}.json`;
    }
    encode(value) {
      return encodeURIComponent(String(value || "")).replace(/\+/g, "%20");
    }
    encodeSubtitleId(value) {
      return encodeURIComponent(String(value || "")).replace(/\+/g, "%20").replace(/%3A/gi, ":");
    }
    makeDeterministicId(value) {
      let hash = 0;
      const str = String(value || "");
      for (let index = 0; index < str.length; index += 1) {
        hash = (hash << 5) - hash + str.charCodeAt(index);
        hash |= 0;
      }
      return Math.abs(hash);
    }
  };
  var subtitleRepository = new SubtitleRepository();

  // js/data/remote/api/streamApi.js
  var StreamApi = {
    async getStreams(url) {
      return httpRequest(url, {
        includeSessionAuth: false
      });
    }
  };

  // js/core/player/pluginRuntime.js
  var KEY4 = "pluginSources";
  function normalizeSources(input) {
    if (!Array.isArray(input)) {
      return [];
    }
    return input.map((source) => ({
      id: source.id || `plugin_${Math.random().toString(36).slice(2, 10)}`,
      name: String(source.name || "Custom Source").trim(),
      urlTemplate: String(source.urlTemplate || "").trim(),
      enabled: source.enabled !== false
    })).filter((source) => Boolean(source.urlTemplate));
  }
  function applyTemplate(template, vars) {
    let output = template;
    Object.entries(vars).forEach(([key, value]) => {
      const token = `{${key}}`;
      output = output.split(token).join(String(value != null ? value : ""));
    });
    return output;
  }
  var PluginRuntime = {
    listSources() {
      return normalizeSources(LocalStore.get(KEY4, []));
    },
    saveSources(sources) {
      LocalStore.set(KEY4, normalizeSources(sources));
    },
    addSource(source) {
      const current = this.listSources();
      current.push(source);
      this.saveSources(current);
    },
    removeSource(sourceId) {
      const next = this.listSources().filter((source) => source.id !== sourceId);
      this.saveSources(next);
    },
    setSourceEnabled(sourceId, enabled) {
      const next = this.listSources().map((source) => {
        if (source.id !== sourceId) {
          return source;
        }
        return { ...source, enabled: Boolean(enabled) };
      });
      this.saveSources(next);
    },
    execute({ tmdbId, mediaType, season = null, episode = null } = {}) {
      const vars = {
        tmdbId: tmdbId || "",
        mediaType: mediaType || "",
        season: season != null ? season : "",
        episode: episode != null ? episode : ""
      };
      return this.listSources().filter((source) => source.enabled).map((source) => {
        const url = applyTemplate(source.urlTemplate, vars).trim();
        if (!url) {
          return null;
        }
        return {
          sourceId: source.id,
          sourceName: source.name,
          streams: [
            {
              name: `${source.name} Source`,
              title: `${source.name} Stream`,
              url,
              description: `Generated by template: ${source.urlTemplate}`
            }
          ]
        };
      }).filter(Boolean);
    }
  };

  // js/core/player/pluginManager.js
  var PLUGINS_ENABLED_KEY = "pluginsEnabled";
  var PluginManager = {
    get pluginsEnabled() {
      return Boolean(LocalStore.get(PLUGINS_ENABLED_KEY, false));
    },
    setPluginsEnabled(enabled) {
      LocalStore.set(PLUGINS_ENABLED_KEY, Boolean(enabled));
    },
    listPluginSources() {
      return PluginRuntime.listSources();
    },
    addPluginSource(source) {
      PluginRuntime.addSource(source);
    },
    removePluginSource(sourceId) {
      PluginRuntime.removeSource(sourceId);
    },
    setPluginSourceEnabled(sourceId, enabled) {
      PluginRuntime.setSourceEnabled(sourceId, enabled);
    },
    async executeScrapersStreaming({ tmdbId, mediaType, season = null, episode = null } = {}) {
      if (!this.pluginsEnabled) {
        return [];
      }
      return PluginRuntime.execute({ tmdbId, mediaType, season, episode });
    }
  };

  // js/data/repository/streamRepository.js
  var StreamRepository = class {
    async getStreamsFromAddon(baseUrl, type, videoId) {
      var _a;
      const url = this.buildStreamUrl(baseUrl, type, videoId);
      const result = await safeApiCall(() => StreamApi.getStreams(url));
      if (result.status !== "success") {
        return result;
      }
      const streams = (((_a = result.data) == null ? void 0 : _a.streams) || []).map((stream) => this.mapStream(stream));
      return { status: "success", data: streams };
    }
    async getStreamsFromAllAddons(type, videoId, options = {}) {
      const addons = await addonRepository.getInstalledAddons();
      const streamAddons = addons.filter((addon) => addon.resources.some((resource) => {
        if (resource.name !== "stream") {
          return false;
        }
        if (!resource.types || resource.types.length === 0) {
          return true;
        }
        return resource.types.some((resourceType) => resourceType === type);
      }));
      const onChunk = typeof (options == null ? void 0 : options.onChunk) === "function" ? options.onChunk : null;
      const notifyChunk = (group) => {
        var _a;
        if (!onChunk || !((_a = group == null ? void 0 : group.streams) == null ? void 0 : _a.length)) {
          return;
        }
        try {
          onChunk({
            status: "success",
            data: [group]
          });
        } catch (error) {
          console.warn("Stream chunk callback failed", error);
        }
      };
      const addonTasks = streamAddons.map(async (addon) => {
        try {
          const streamsResult = await this.getStreamsFromAddon(addon.baseUrl, type, videoId);
          if (streamsResult.status !== "success" || streamsResult.data.length === 0) {
            return null;
          }
          const group = {
            addonName: addon.displayName,
            addonLogo: addon.logo,
            streams: streamsResult.data.map((stream) => ({
              ...stream,
              addonName: addon.displayName,
              addonLogo: addon.logo
            }))
          };
          notifyChunk(group);
          return group;
        } catch (_) {
          return null;
        }
      });
      const pluginTask = (async () => {
        try {
          const pluginStreams2 = await this.getPluginStreams(type, videoId, options);
          pluginStreams2.forEach((group) => notifyChunk(group));
          return pluginStreams2;
        } catch (error) {
          console.warn("Plugin stream fetch failed", error);
          return [];
        }
      })();
      const results = await Promise.all(addonTasks);
      const addonsWithStreams = results.filter(Boolean);
      const pluginStreams = await pluginTask;
      return { status: "success", data: [...addonsWithStreams, ...pluginStreams] };
    }
    async getPluginStreams(type, videoId, options = {}) {
      var _a, _b;
      const mediaType = type === "series" ? "tv" : type;
      const tmdbLookupId = String((options == null ? void 0 : options.itemId) || videoId || "").trim();
      const tmdbId = await TmdbService.ensureTmdbId(tmdbLookupId, type);
      if (!tmdbId) {
        return [];
      }
      const pluginResults = await PluginManager.executeScrapersStreaming({
        tmdbId,
        mediaType,
        season: (_a = options == null ? void 0 : options.season) != null ? _a : null,
        episode: (_b = options == null ? void 0 : options.episode) != null ? _b : null
      });
      return pluginResults.map((result) => ({
        addonName: result.sourceName,
        addonLogo: null,
        streams: (result.streams || []).map((stream) => ({
          ...stream,
          addonName: result.sourceName,
          addonLogo: null
        }))
      }));
    }
    buildStreamUrl(baseUrl, type, videoId) {
      const cleanBaseUrl = String(baseUrl || "").replace(/\/+$/, "");
      return `${cleanBaseUrl}/stream/${this.encode(type)}/${this.encode(videoId)}.json`;
    }
    encode(value) {
      return encodeURIComponent(String(value || "")).replace(/\+/g, "%20");
    }
    mapStream(stream = {}) {
      const sidecarSubtitles = Array.isArray(stream.subtitles) ? stream.subtitles.filter((entry) => entry && entry.url).map((entry) => ({
        id: entry.id || null,
        url: entry.url,
        lang: entry.lang || "unknown"
      })) : [];
      return {
        name: stream.name || null,
        title: stream.title || null,
        description: stream.description || null,
        url: stream.url || null,
        ytId: stream.ytId || null,
        infoHash: stream.infoHash || null,
        fileIdx: stream.fileIdx || null,
        externalUrl: stream.externalUrl || null,
        behaviorHints: stream.behaviorHints || null,
        sources: Array.isArray(stream.sources) ? stream.sources : [],
        subtitles: sidecarSubtitles
      };
    }
  };
  var streamRepository = new StreamRepository();

  // js/platform/environment.js
  var Environment = {
    isWebOS() {
      return Platform.isWebOS();
    },
    isTizen() {
      return Platform.isTizen();
    },
    isBrowser() {
      return Platform.isBrowser();
    },
    isBackEvent(event) {
      return Platform.isBackEvent(event);
    },
    getDeviceLabel() {
      return Platform.getDeviceLabel();
    }
  };

  // js/ui/screens/player/playerScreen.js
  function formatTime(secondsValue) {
    const total = Math.max(0, Math.floor(Number(secondsValue || 0)));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor(total % 3600 / 60);
    const seconds = total % 60;
    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }
  function formatClock(date = /* @__PURE__ */ new Date()) {
    return date.toLocaleTimeString("it-IT", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
  }
  function formatEndsAt(currentSeconds, durationSeconds) {
    const current = Number(currentSeconds || 0);
    const duration = Number(durationSeconds || 0);
    if (!Number.isFinite(duration) || duration <= 0) {
      return "--:--";
    }
    const remainingMs = Math.max(0, (duration - current) * 1e3);
    const endDate = new Date(Date.now() + remainingMs);
    return formatClock(endDate);
  }
  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }
  function trackListToArray(trackList) {
    if (!trackList) {
      return [];
    }
    try {
      const iterableTracks = Array.from(trackList).filter(Boolean);
      if (iterableTracks.length) {
        return iterableTracks;
      }
    } catch (_) {
    }
    const length = Number(trackList.length || 0);
    if (Number.isFinite(length) && length > 0) {
      const indexedTracks = [];
      for (let index = 0; index < length; index += 1) {
        const track = trackList[index] || (typeof trackList.item === "function" ? trackList.item(index) : null);
        if (track) {
          indexedTracks.push(track);
        }
      }
      if (indexedTracks.length) {
        return indexedTracks;
      }
    }
    if (typeof trackList.item === "function") {
      const probedTracks = [];
      for (let index = 0; index < 32; index += 1) {
        const track = trackList.item(index);
        if (!track) {
          if (probedTracks.length) {
            break;
          }
          continue;
        }
        probedTracks.push(track);
      }
      if (probedTracks.length) {
        return probedTracks;
      }
    }
    const objectTracks = Object.keys(trackList).filter((key) => /^\d+$/.test(key)).map((key) => trackList[key]).filter(Boolean);
    return objectTracks;
  }
  function normalizeItemType(value) {
    const normalized = String(value || "movie").toLowerCase();
    return normalized === "tv" ? "series" : normalized;
  }
  function escapeHtml(value) {
    return String(value != null ? value : "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
  }
  function qualityLabelFromText(value) {
    const text = String(value || "").toLowerCase();
    if (text.includes("2160") || text.includes("4k")) return "2160p";
    if (text.includes("1080")) return "1080p";
    if (text.includes("720")) return "720p";
    if (text.includes("480")) return "480p";
    return "Auto";
  }
  function flattenStreamGroups(streamResult) {
    if (!streamResult || streamResult.status !== "success") {
      return [];
    }
    return (streamResult.data || []).flatMap((group) => {
      const addonName = group.addonName || "Addon";
      return (group.streams || []).map((stream, index) => ({
        id: `${addonName}-${index}-${stream.url || ""}`,
        label: stream.title || stream.name || `${addonName} stream`,
        description: stream.description || stream.name || "",
        addonName,
        addonLogo: group.addonLogo || stream.addonLogo || null,
        sourceType: stream.type || stream.source || "",
        url: stream.url,
        raw: stream
      })).filter((entry) => Boolean(entry.url));
    });
  }
  function mergeStreamItems(existing = [], incoming = []) {
    const byKey = /* @__PURE__ */ new Set();
    const merged = [];
    const push = (item) => {
      if (!(item == null ? void 0 : item.url)) {
        return;
      }
      const key = [
        String(item.addonName || "Addon"),
        String(item.url || ""),
        String(item.sourceType || ""),
        String(item.label || "")
      ].join("::");
      if (byKey.has(key)) {
        return;
      }
      byKey.add(key);
      merged.push(item);
    };
    (existing || []).forEach(push);
    (incoming || []).forEach(push);
    return merged;
  }
  function normalizeParentalWarnings(source) {
    const severityRank = {
      severe: 0,
      moderate: 1,
      mild: 2,
      none: 99
    };
    if (Array.isArray(source)) {
      return source.map((entry) => ({
        label: String((entry == null ? void 0 : entry.label) || "").trim(),
        severity: String((entry == null ? void 0 : entry.severity) || "").trim()
      })).filter((entry) => entry.label && entry.severity).filter((entry) => entry.severity.toLowerCase() !== "none").sort((left, right) => {
        var _a, _b;
        const leftRank = (_a = severityRank[left.severity.toLowerCase()]) != null ? _a : 50;
        const rightRank = (_b = severityRank[right.severity.toLowerCase()]) != null ? _b : 50;
        return leftRank - rightRank;
      }).slice(0, 5);
    }
    const guide = source && typeof source === "object" ? source : null;
    if (!guide) {
      return [];
    }
    const labels = {
      nudity: "Nudity",
      violence: "Violence",
      profanity: "Profanity",
      alcohol: "Alcohol/Drugs",
      frightening: "Frightening"
    };
    return Object.entries(labels).map(([key, label]) => {
      const severity = String(guide[key] || "").trim();
      if (!severity || severity.toLowerCase() === "none") {
        return null;
      }
      return { label, severity };
    }).filter(Boolean).sort((left, right) => {
      var _a, _b;
      const leftRank = (_a = severityRank[left.severity.toLowerCase()]) != null ? _a : 50;
      const rightRank = (_b = severityRank[right.severity.toLowerCase()]) != null ? _b : 50;
      return leftRank - rightRank;
    }).slice(0, 5);
  }
  function stripQuotes(value) {
    const text = String(value || "").trim();
    if (text.startsWith('"') && text.endsWith('"')) {
      return text.slice(1, -1);
    }
    return text;
  }
  function parseHlsAttributeList(value) {
    const raw = String(value || "");
    const attributes = {};
    const regex = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/gi;
    let match;
    while ((match = regex.exec(raw)) !== null) {
      const key = String(match[1] || "").toUpperCase();
      const attributeValue = stripQuotes(match[2] || "");
      if (!key) {
        continue;
      }
      attributes[key] = attributeValue;
    }
    return attributes;
  }
  function resolveUrl(baseUrl, maybeRelativeUrl) {
    try {
      return new URL(String(maybeRelativeUrl || ""), String(baseUrl || "")).toString();
    } catch (_) {
      return String(maybeRelativeUrl || "");
    }
  }
  function uniqueNonEmptyValues(values = []) {
    const seen = /* @__PURE__ */ new Set();
    const unique2 = [];
    (values || []).forEach((value) => {
      const normalized = String(value || "").trim();
      if (!normalized || seen.has(normalized)) {
        return;
      }
      seen.add(normalized);
      unique2.push(normalized);
    });
    return unique2;
  }
  var PlayerScreen = {
    async mount(params = {}) {
      var _a;
      this.container = document.getElementById("player");
      this.container.style.display = "block";
      this.params = params;
      this.aspectModes = [
        { objectFit: "contain", label: "Fit" },
        { objectFit: "cover", label: "Fill" },
        { objectFit: "fill", label: "Stretch" }
      ];
      this.streamCandidates = this.normalizeStreamCandidates(Array.isArray(params.streamCandidates) ? params.streamCandidates : []);
      const initialStreamUrl = params.streamUrl || this.selectBestStreamUrl(this.streamCandidates) || null;
      if (!this.streamCandidates.length && initialStreamUrl) {
        this.streamCandidates = this.normalizeStreamCandidates([
          {
            url: initialStreamUrl,
            title: "Current source",
            addonName: "Current"
          }
        ]);
      }
      this.currentStreamIndex = this.streamCandidates.findIndex((stream) => stream.url === initialStreamUrl);
      if (this.currentStreamIndex < 0) {
        this.currentStreamIndex = 0;
      }
      this.subtitles = [];
      this.subtitleDialogVisible = false;
      this.subtitleDialogTab = "builtIn";
      this.subtitleDialogIndex = 0;
      this.selectedSubtitleTrackIndex = -1;
      this.selectedAddonSubtitleId = null;
      this.builtInSubtitleCount = 0;
      this.externalTrackNodes = [];
      this.audioDialogVisible = false;
      this.audioDialogIndex = 0;
      this.selectedAudioTrackIndex = -1;
      this.sourcesPanelVisible = false;
      this.sourcesLoading = false;
      this.sourcesError = "";
      this.sourceFilter = "all";
      this.sourcesFocus = { zone: "filter", index: 0 };
      this.sourceLoadToken = 0;
      this.aspectModeIndex = 0;
      this.aspectToastTimer = null;
      this.episodes = Array.isArray(params.episodes) ? params.episodes : [];
      this.episodePanelVisible = false;
      this.episodePanelIndex = Math.max(0, this.episodes.findIndex((entry) => entry.id === params.videoId));
      this.switchingEpisode = false;
      this.seekOverlayVisible = false;
      this.seekPreviewSeconds = null;
      this.seekPreviewDirection = 0;
      this.seekRepeatCount = 0;
      this.seekCommitTimer = null;
      this.seekOverlayTimer = null;
      this.parentalWarnings = normalizeParentalWarnings(params.parentalWarnings || params.parentalGuide);
      this.parentalGuideVisible = false;
      this.parentalGuideShown = false;
      this.parentalGuideTimer = null;
      this.subtitleSelectionTimer = null;
      this.subtitleLoadToken = 0;
      this.subtitleLoading = false;
      this.manifestLoadToken = 0;
      this.manifestLoading = false;
      this.manifestAudioTracks = [];
      this.manifestSubtitleTracks = [];
      this.manifestVariants = [];
      this.manifestMasterUrl = "";
      this.selectedManifestAudioTrackId = null;
      this.selectedManifestSubtitleTrackId = null;
      this.activePlaybackUrl = initialStreamUrl || null;
      this.pendingPlaybackRestore = null;
      this.trackDiscoveryToken = 0;
      this.trackDiscoveryInProgress = false;
      this.trackDiscoveryTimer = null;
      this.trackDiscoveryStartedAt = 0;
      this.trackDiscoveryDeadline = 0;
      this.lastTrackWarmupAt = 0;
      this.failedStreamUrls = /* @__PURE__ */ new Set();
      this.silentAudioFallbackAttempts = /* @__PURE__ */ new Set();
      this.silentAudioFallbackCount = 0;
      this.maxSilentAudioFallbackCount = 1;
      this.lastPlaybackErrorAt = 0;
      this.playbackStallTimer = null;
      this.lastPlaybackProgressAt = Date.now();
      this.paused = false;
      this.controlsVisible = true;
      this.loadingVisible = true;
      this.moreActionsVisible = false;
      this.controlsHideTimer = null;
      this.tickTimer = null;
      this.videoListeners = [];
      this.renderPlayerUi();
      this.bindVideoEvents();
      this.renderEpisodePanel();
      this.applyAspectMode({ showToast: false });
      this.updateUiTick();
      if (initialStreamUrl) {
        const sourceCandidate = this.getStreamCandidateByUrl(initialStreamUrl) || this.getCurrentStreamCandidate();
        this.activePlaybackUrl = initialStreamUrl;
        PlayerController.play(this.activePlaybackUrl, this.buildPlaybackContext(sourceCandidate));
        this.loadManifestTrackDataForCurrentStream(this.activePlaybackUrl);
        this.startTrackDiscoveryWindow();
      }
      this.loadSubtitles();
      this.syncTrackState();
      this.tickTimer = setInterval(() => this.updateUiTick(), 1e3);
      this.endedHandler = () => {
        this.handlePlaybackEnded();
      };
      (_a = PlayerController.video) == null ? void 0 : _a.addEventListener("ended", this.endedHandler);
      this.setControlsVisible(true, { focus: true });
    },
    buildPlaybackContext(streamCandidate = this.getCurrentStreamCandidate()) {
      var _a, _b;
      const requestHeaders = this.getCurrentStreamRequestHeaders(streamCandidate);
      const mediaSourceType = String(
        (streamCandidate == null ? void 0 : streamCandidate.sourceType) || ((_a = streamCandidate == null ? void 0 : streamCandidate.raw) == null ? void 0 : _a.type) || ((_b = streamCandidate == null ? void 0 : streamCandidate.raw) == null ? void 0 : _b.mimeType) || ""
      ).trim();
      return {
        itemId: this.params.itemId || null,
        itemType: normalizeItemType(this.params.itemType || "movie"),
        videoId: this.params.videoId || null,
        season: this.params.season == null ? null : Number(this.params.season),
        episode: this.params.episode == null ? null : Number(this.params.episode),
        requestHeaders,
        mediaSourceType
      };
    },
    buildSubtitleLookupContext() {
      var _a, _b, _c, _d, _e;
      const type = normalizeItemType(((_a = this.params) == null ? void 0 : _a.itemType) || "movie");
      const rawItemId = String(((_b = this.params) == null ? void 0 : _b.itemId) || "").trim();
      const baseItemId = rawItemId ? String(rawItemId.split(":")[0] || "").trim() : "";
      const id = baseItemId || rawItemId || "";
      let videoId = null;
      if (type === "series") {
        const season = Number((_c = this.params) == null ? void 0 : _c.season);
        const episode = Number((_d = this.params) == null ? void 0 : _d.episode);
        if (id && Number.isFinite(season) && season > 0 && Number.isFinite(episode) && episode > 0) {
          videoId = `${id}:${season}:${episode}`;
        } else if ((_e = this.params) == null ? void 0 : _e.videoId) {
          videoId = String(this.params.videoId);
        }
      }
      return { type, id, videoId };
    },
    normalizeStreamCandidates(streams = []) {
      return (streams || []).map((stream, index) => {
        if (!(stream == null ? void 0 : stream.url)) {
          return null;
        }
        return {
          id: stream.id || `stream-${index}-${stream.url}`,
          label: stream.title || stream.name || stream.label || `Source ${index + 1}`,
          description: stream.description || stream.name || "",
          addonName: stream.addonName || stream.sourceName || "Addon",
          addonLogo: stream.addonLogo || null,
          sourceType: stream.type || stream.source || "",
          url: stream.url,
          raw: stream
        };
      }).filter(Boolean);
    },
    getCurrentStreamCandidate() {
      if (!this.streamCandidates.length) {
        return null;
      }
      const current = this.streamCandidates[this.currentStreamIndex] || null;
      if (current == null ? void 0 : current.url) {
        return current;
      }
      return this.streamCandidates.find((entry) => Boolean(entry == null ? void 0 : entry.url)) || null;
    },
    getStreamSearchText(streamCandidate) {
      const stream = (streamCandidate == null ? void 0 : streamCandidate.raw) || streamCandidate || {};
      return String([
        (streamCandidate == null ? void 0 : streamCandidate.label) || "",
        (streamCandidate == null ? void 0 : streamCandidate.description) || "",
        (streamCandidate == null ? void 0 : streamCandidate.sourceType) || "",
        (streamCandidate == null ? void 0 : streamCandidate.url) || "",
        (stream == null ? void 0 : stream.title) || "",
        (stream == null ? void 0 : stream.name) || "",
        (stream == null ? void 0 : stream.description) || "",
        (stream == null ? void 0 : stream.url) || ""
      ].join(" ")).toLowerCase();
    },
    getWebOsAudioCompatibilityScore(streamCandidate) {
      const text = this.getStreamSearchText(streamCandidate);
      let score = 0;
      if (/\b(aac|mp4a)\b/.test(text)) score += 22;
      if (/\b(ac3|dolby digital)\b/.test(text) && !/\b(eac3|ec-3|ddp|atmos)\b/.test(text)) score += 14;
      if (/\b(mp3|mpeg audio)\b/.test(text)) score += 8;
      if (/\b(stereo|2\.0|2ch)\b/.test(text)) score += 8;
      if (/\b(eac3|ec-3|ddp|atmos)\b/.test(text)) score -= 28;
      if (/\b(truehd|dts-hd|dts:x|dts)\b/.test(text)) score -= 45;
      if (/\b(7\.1|8ch)\b/.test(text)) score -= 12;
      if (/\b(flac|alac)\b/.test(text)) score -= 10;
      return score;
    },
    getStreamCandidateByUrl(streamUrl) {
      const normalized = String(streamUrl || "").trim();
      if (!normalized) {
        return null;
      }
      return this.streamCandidates.find((entry) => String((entry == null ? void 0 : entry.url) || "").trim() === normalized) || null;
    },
    getTrackProbeUrl() {
      var _a;
      const currentCandidate = this.getCurrentStreamCandidate();
      return String(
        this.activePlaybackUrl || (currentCandidate == null ? void 0 : currentCandidate.url) || ((_a = PlayerController.video) == null ? void 0 : _a.currentSrc) || ""
      ).trim();
    },
    isCurrentSourceAdaptiveManifest() {
      const probeUrl = this.getTrackProbeUrl();
      const probeMimeType = typeof PlayerController.guessMediaMimeType === "function" ? PlayerController.guessMediaMimeType(probeUrl) : null;
      return typeof PlayerController.isLikelyHlsMimeType === "function" && PlayerController.isLikelyHlsMimeType(probeMimeType) || typeof PlayerController.isLikelyDashMimeType === "function" && PlayerController.isLikelyDashMimeType(probeMimeType);
    },
    isCurrentSourceLikelyMkv() {
      const probeUrl = this.getTrackProbeUrl().toLowerCase();
      if (!probeUrl) {
        return false;
      }
      if (probeUrl.includes(".mkv")) {
        return true;
      }
      return false;
    },
    getUnavailableTrackMessage(kind = "audio") {
      const usingAvPlay = typeof PlayerController.isUsingAvPlay === "function" ? PlayerController.isUsingAvPlay() : false;
      if (!usingAvPlay && this.isCurrentSourceLikelyMkv()) {
        if (kind === "subtitle") {
          return "MKV internal subtitles are not exposed by the webOS web player.";
        }
        return "MKV internal audio tracks are not exposed by the webOS web player.";
      }
      return kind === "subtitle" ? "No subtitle tracks available." : "No audio tracks available.";
    },
    getVideoTextTrackList() {
      const video = PlayerController.video;
      if (!video) {
        return null;
      }
      return video.textTracks || video.webkitTextTracks || video.mozTextTracks || null;
    },
    getVideoAudioTrackList() {
      const video = PlayerController.video;
      if (!video) {
        return null;
      }
      return video.audioTracks || video.webkitAudioTracks || video.mozAudioTracks || null;
    },
    collectStreamSidecarSubtitles(streamCandidate = this.getCurrentStreamCandidate()) {
      const mapSubtitles = (candidate) => {
        const stream = (candidate == null ? void 0 : candidate.raw) || candidate || null;
        const rawSubtitles = Array.isArray(stream == null ? void 0 : stream.subtitles) ? stream.subtitles : [];
        return rawSubtitles.filter((subtitle) => Boolean(subtitle == null ? void 0 : subtitle.url)).map((subtitle, index) => ({
          id: subtitle.id || `${subtitle.lang || "unk"}-${index}-${subtitle.url}`,
          url: subtitle.url,
          lang: subtitle.lang || "unknown",
          addonName: (candidate == null ? void 0 : candidate.addonName) || "Stream",
          addonLogo: (candidate == null ? void 0 : candidate.addonLogo) || null
        }));
      };
      const current = mapSubtitles(streamCandidate);
      if (current.length) {
        return current;
      }
      return this.streamCandidates.flatMap((candidate) => mapSubtitles(candidate));
    },
    mergeSubtitleCandidates(primary = [], secondary = []) {
      const merged = [];
      const seen = /* @__PURE__ */ new Set();
      [...primary || [], ...secondary || []].forEach((subtitle) => {
        if (!(subtitle == null ? void 0 : subtitle.url)) {
          return;
        }
        const key = `${String(subtitle.url).trim()}::${String(subtitle.lang || "").trim().toLowerCase()}`;
        if (seen.has(key)) {
          return;
        }
        seen.add(key);
        merged.push(subtitle);
      });
      return merged;
    },
    getCurrentStreamRequestHeaders(streamCandidate = this.getCurrentStreamCandidate()) {
      var _a, _b;
      const stream = (streamCandidate == null ? void 0 : streamCandidate.raw) || streamCandidate || null;
      const requestHeaders = (_b = (_a = stream == null ? void 0 : stream.behaviorHints) == null ? void 0 : _a.proxyHeaders) == null ? void 0 : _b.request;
      if (!requestHeaders || typeof requestHeaders !== "object") {
        return {};
      }
      return { ...requestHeaders };
    },
    parseHlsManifestTracks(manifestText, manifestUrl) {
      const lines = String(manifestText || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const audioTracks = [];
      const subtitleTracks = [];
      const variants = [];
      let pendingVariantAttributes = null;
      lines.forEach((line) => {
        if (line.startsWith("#EXT-X-MEDIA:")) {
          const attributes = parseHlsAttributeList(line.slice("#EXT-X-MEDIA:".length));
          const mediaType = String(attributes.TYPE || "").toUpperCase();
          const groupId = String(attributes["GROUP-ID"] || "").trim();
          const name = String(attributes.NAME || attributes.LANGUAGE || "").trim();
          const language = String(attributes.LANGUAGE || "").trim();
          const uri = attributes.URI ? resolveUrl(manifestUrl, attributes.URI) : null;
          const isDefault = String(attributes.DEFAULT || "").toUpperCase() === "YES";
          const trackId = `${mediaType || "TRACK"}::${groupId || "main"}::${name || language || "default"}`;
          if (mediaType === "AUDIO") {
            audioTracks.push({
              id: trackId,
              groupId,
              name: name || `Audio ${audioTracks.length + 1}`,
              language,
              uri,
              isDefault
            });
            return;
          }
          if (mediaType === "SUBTITLES") {
            subtitleTracks.push({
              id: trackId,
              groupId,
              name: name || `Subtitle ${subtitleTracks.length + 1}`,
              language,
              uri,
              isDefault
            });
            return;
          }
          return;
        }
        if (line.startsWith("#EXT-X-STREAM-INF:")) {
          pendingVariantAttributes = parseHlsAttributeList(line.slice("#EXT-X-STREAM-INF:".length));
          return;
        }
        if (line.startsWith("#")) {
          return;
        }
        if (!pendingVariantAttributes) {
          return;
        }
        variants.push({
          uri: resolveUrl(manifestUrl, line),
          audioGroupId: String(pendingVariantAttributes.AUDIO || "").trim() || null,
          subtitleGroupId: String(pendingVariantAttributes.SUBTITLES || "").trim() || null,
          codecs: String(pendingVariantAttributes.CODECS || "").trim(),
          bandwidth: Number(pendingVariantAttributes.BANDWIDTH || 0),
          resolution: String(pendingVariantAttributes.RESOLUTION || "").trim()
        });
        pendingVariantAttributes = null;
      });
      return {
        audioTracks,
        subtitleTracks,
        variants
      };
    },
    parseDashManifestTracks(manifestText) {
      const parseErrorResult = {
        audioTracks: [],
        subtitleTracks: [],
        variants: []
      };
      const parser = typeof DOMParser === "function" ? new DOMParser() : null;
      if (!parser) {
        return parseErrorResult;
      }
      let xmlDocument = null;
      try {
        xmlDocument = parser.parseFromString(String(manifestText || ""), "application/xml");
      } catch (_) {
        return parseErrorResult;
      }
      if (!xmlDocument) {
        return parseErrorResult;
      }
      if (xmlDocument.getElementsByTagName("parsererror").length > 0) {
        return parseErrorResult;
      }
      const adaptationSets = Array.from(xmlDocument.getElementsByTagName("AdaptationSet"));
      if (!adaptationSets.length) {
        return parseErrorResult;
      }
      const audioTracks = [];
      const subtitleTracks = [];
      adaptationSets.forEach((adaptationSet, setIndex) => {
        const contentType = String(adaptationSet.getAttribute("contentType") || "").toLowerCase();
        const mimeType = String(adaptationSet.getAttribute("mimeType") || "").toLowerCase();
        const codecs = String(adaptationSet.getAttribute("codecs") || "").toLowerCase();
        const representation = adaptationSet.getElementsByTagName("Representation")[0] || null;
        const role = adaptationSet.getElementsByTagName("Role")[0] || null;
        const language = String(
          adaptationSet.getAttribute("lang") || (representation == null ? void 0 : representation.getAttribute("lang")) || ""
        ).trim();
        const label = String(
          adaptationSet.getAttribute("label") || (representation == null ? void 0 : representation.getAttribute("label")) || (role == null ? void 0 : role.getAttribute("value")) || ""
        ).trim();
        const setId = String(adaptationSet.getAttribute("id") || setIndex).trim();
        const isAudio = contentType === "audio" || mimeType.startsWith("audio/");
        const isSubtitle = contentType === "text" || mimeType.startsWith("text/") || mimeType.includes("ttml") || mimeType.includes("vtt") || codecs.includes("stpp") || codecs.includes("wvtt");
        if (isAudio) {
          audioTracks.push({
            id: `DASH::AUDIO::${setId}::${language || label || audioTracks.length + 1}`,
            groupId: setId,
            name: label || `Audio ${audioTracks.length + 1}`,
            language,
            uri: null,
            isDefault: audioTracks.length === 0
          });
        } else if (isSubtitle) {
          subtitleTracks.push({
            id: `DASH::SUBTITLES::${setId}::${language || label || subtitleTracks.length + 1}`,
            groupId: setId,
            name: label || `Subtitle ${subtitleTracks.length + 1}`,
            language,
            uri: null,
            isDefault: subtitleTracks.length === 0
          });
        }
      });
      return {
        audioTracks,
        subtitleTracks,
        variants: []
      };
    },
    parseManifestTracks(manifestText, manifestUrl) {
      const text = String(manifestText || "");
      if (!text) {
        return { audioTracks: [], subtitleTracks: [], variants: [] };
      }
      if (text.includes("#EXTM3U")) {
        return this.parseHlsManifestTracks(text, manifestUrl);
      }
      if (/<\s*MPD[\s>]/i.test(text)) {
        return this.parseDashManifestTracks(text);
      }
      return { audioTracks: [], subtitleTracks: [], variants: [] };
    },
    async loadManifestTrackDataForCurrentStream(playbackUrl = this.activePlaybackUrl) {
      var _a, _b, _c, _d;
      const currentCandidate = this.getCurrentStreamCandidate();
      const masterUrl = playbackUrl || (currentCandidate == null ? void 0 : currentCandidate.url) || "";
      const runtimeUrl = String(((_a = PlayerController.video) == null ? void 0 : _a.currentSrc) || "").trim();
      const loadToken = (this.manifestLoadToken || 0) + 1;
      this.manifestLoadToken = loadToken;
      this.manifestLoading = true;
      this.manifestAudioTracks = [];
      this.manifestSubtitleTracks = [];
      this.manifestVariants = [];
      this.manifestMasterUrl = masterUrl;
      this.selectedManifestAudioTrackId = null;
      this.selectedManifestSubtitleTrackId = null;
      this.refreshTrackDialogs();
      const probeUrl = masterUrl || runtimeUrl || playbackUrl || "";
      const probeMimeType = typeof PlayerController.guessMediaMimeType === "function" ? PlayerController.guessMediaMimeType(probeUrl) : null;
      const isAdaptiveManifest = typeof PlayerController.isLikelyHlsMimeType === "function" && PlayerController.isLikelyHlsMimeType(probeMimeType) || typeof PlayerController.isLikelyDashMimeType === "function" && PlayerController.isLikelyDashMimeType(probeMimeType);
      if (!isAdaptiveManifest) {
        if (loadToken === this.manifestLoadToken) {
          this.manifestLoading = false;
          this.refreshTrackDialogs();
        }
        return;
      }
      if (!masterUrl) {
        if (loadToken === this.manifestLoadToken) {
          this.manifestLoading = false;
          this.refreshTrackDialogs();
        }
        return;
      }
      try {
        const headers = this.getCurrentStreamRequestHeaders(currentCandidate);
        const manifestFetchTimeoutMs = 5e3;
        const fetchManifestText = async (url, requestHeaders = {}) => {
          const requestController = typeof AbortController === "function" ? new AbortController() : null;
          let requestTimeoutId = null;
          try {
            const timeoutPromise = new Promise((_, reject) => {
              requestTimeoutId = setTimeout(() => {
                var _a2;
                try {
                  (_a2 = requestController == null ? void 0 : requestController.abort) == null ? void 0 : _a2.call(requestController);
                } catch (_2) {
                }
                reject(new Error("Manifest fetch timeout"));
              }, manifestFetchTimeoutMs);
            });
            const response = await Promise.race([
              fetch(url, {
                method: "GET",
                headers: requestHeaders,
                signal: requestController == null ? void 0 : requestController.signal
              }),
              timeoutPromise
            ]);
            const text = await response.text();
            return {
              text,
              finalUrl: response.url || url
            };
          } finally {
            if (requestTimeoutId) {
              clearTimeout(requestTimeoutId);
            }
          }
        };
        const urlCandidates = uniqueNonEmptyValues([masterUrl, runtimeUrl, playbackUrl, this.activePlaybackUrl]);
        let selectedParsed = null;
        let selectedMasterUrl = masterUrl;
        for (const candidateUrl of urlCandidates) {
          let fetchedManifest = null;
          try {
            fetchedManifest = await fetchManifestText(candidateUrl, headers);
          } catch (_) {
            try {
              fetchedManifest = await fetchManifestText(candidateUrl, {});
            } catch (_2) {
              fetchedManifest = null;
            }
          }
          if (loadToken !== this.manifestLoadToken) {
            return;
          }
          if (!fetchedManifest) {
            continue;
          }
          const parsed = this.parseManifestTracks(fetchedManifest.text, fetchedManifest.finalUrl || candidateUrl);
          const hasTracks = parsed.audioTracks.length || parsed.subtitleTracks.length;
          if (hasTracks) {
            selectedParsed = parsed;
            selectedMasterUrl = fetchedManifest.finalUrl || candidateUrl;
            break;
          }
          if (!selectedParsed && parsed.variants.length > 0) {
            selectedParsed = parsed;
            selectedMasterUrl = fetchedManifest.finalUrl || candidateUrl;
          }
          if (parsed.variants.length > 0) {
            const variant = parsed.variants[0];
            if (!(variant == null ? void 0 : variant.uri)) {
              continue;
            }
            try {
              const variantFetched = await fetchManifestText(variant.uri, headers);
              if (loadToken !== this.manifestLoadToken) {
                return;
              }
              const nestedParsed = this.parseManifestTracks(variantFetched.text, variantFetched.finalUrl || variant.uri);
              if (nestedParsed.audioTracks.length || nestedParsed.subtitleTracks.length) {
                selectedParsed = nestedParsed;
                selectedMasterUrl = variantFetched.finalUrl || variant.uri;
                break;
              }
              if (!selectedParsed && nestedParsed.variants.length > 0) {
                selectedParsed = nestedParsed;
                selectedMasterUrl = variantFetched.finalUrl || variant.uri;
              }
            } catch (_) {
              try {
                const variantFetchedNoHeaders = await fetchManifestText(variant.uri, {});
                if (loadToken !== this.manifestLoadToken) {
                  return;
                }
                const nestedParsed = this.parseManifestTracks(variantFetchedNoHeaders.text, variantFetchedNoHeaders.finalUrl || variant.uri);
                if (nestedParsed.audioTracks.length || nestedParsed.subtitleTracks.length) {
                  selectedParsed = nestedParsed;
                  selectedMasterUrl = variantFetchedNoHeaders.finalUrl || variant.uri;
                  break;
                }
                if (!selectedParsed && nestedParsed.variants.length > 0) {
                  selectedParsed = nestedParsed;
                  selectedMasterUrl = variantFetchedNoHeaders.finalUrl || variant.uri;
                }
              } catch (_2) {
              }
            }
          }
        }
        if (!selectedParsed) {
          return;
        }
        this.manifestMasterUrl = selectedMasterUrl || masterUrl;
        this.manifestAudioTracks = selectedParsed.audioTracks;
        this.manifestSubtitleTracks = selectedParsed.subtitleTracks;
        this.manifestVariants = selectedParsed.variants;
        this.selectedManifestAudioTrackId = ((_b = selectedParsed.audioTracks.find((track) => track.isDefault)) == null ? void 0 : _b.id) || ((_c = selectedParsed.audioTracks[0]) == null ? void 0 : _c.id) || null;
        this.selectedManifestSubtitleTrackId = ((_d = selectedParsed.subtitleTracks.find((track) => track.isDefault)) == null ? void 0 : _d.id) || null;
        this.refreshTrackDialogs();
      } catch (error) {
      } finally {
        if (loadToken === this.manifestLoadToken) {
          this.manifestLoading = false;
          this.refreshTrackDialogs();
        }
      }
    },
    pickManifestVariant({ audioGroupId = null, subtitleGroupId = null } = {}) {
      if (!this.manifestVariants.length) {
        return null;
      }
      const byAudio = audioGroupId ? this.manifestVariants.filter((variant) => variant.audioGroupId === audioGroupId) : this.manifestVariants.slice();
      const candidatePool = byAudio.length ? byAudio : this.manifestVariants;
      let scopedCandidates = candidatePool;
      if (subtitleGroupId) {
        const bySubtitle = candidatePool.filter((variant) => variant.subtitleGroupId === subtitleGroupId);
        if (bySubtitle.length) {
          scopedCandidates = bySubtitle;
        }
      } else if (subtitleGroupId === null) {
        const withoutSubtitle = candidatePool.filter((variant) => !variant.subtitleGroupId);
        if (withoutSubtitle.length) {
          scopedCandidates = withoutSubtitle;
        }
      }
      const capabilityProbe = typeof PlayerController.getPlaybackCapabilities === "function" ? PlayerController.getPlaybackCapabilities() : null;
      const supports = (key, fallback = true) => {
        if (!capabilityProbe) {
          return fallback;
        }
        return Boolean(capabilityProbe[key]);
      };
      const scoreVariant = (variant) => {
        if (!variant) {
          return Number.NEGATIVE_INFINITY;
        }
        let score = 0;
        const codecs = String(variant.codecs || "").toLowerCase();
        const resolution = String(variant.resolution || "").toLowerCase();
        const bandwidth = Number(variant.bandwidth || 0);
        const resolutionMatch = resolution.match(/^(\d+)\s*x\s*(\d+)$/i);
        const width = Number((resolutionMatch == null ? void 0 : resolutionMatch[1]) || 0);
        const height = Number((resolutionMatch == null ? void 0 : resolutionMatch[2]) || 0);
        if (width >= 3840 || height >= 2160) score += 60;
        else if (width >= 1920 || height >= 1080) score += 40;
        else if (width >= 1280 || height >= 720) score += 20;
        else if (width > 0 || height > 0) score += 8;
        if (Number.isFinite(bandwidth) && bandwidth > 0) {
          score += Math.min(30, Math.round(bandwidth / 1e6 * 3));
        }
        if (codecs.includes("dvh1") || codecs.includes("dvhe")) {
          score += supports("dolbyVision", true) ? 18 : -100;
        }
        if (codecs.includes("hvc1") || codecs.includes("hev1")) {
          score += supports("mp4Hevc", true) || supports("mp4HevcMain10", true) ? 14 : -90;
        }
        if (codecs.includes("av01")) {
          score += supports("mp4Av1", true) ? 10 : -80;
        }
        if (codecs.includes("vp9")) {
          score += supports("webmVp9", true) ? 8 : -60;
        }
        if (codecs.includes("ec-3") || codecs.includes("eac3")) {
          score += supports("audioEac3", true) ? 10 : -50;
        }
        if (codecs.includes("ac-3") || codecs.includes("ac3")) {
          score += supports("audioAc3", true) ? 6 : -35;
        }
        return score;
      };
      return scopedCandidates.slice().sort((left, right) => scoreVariant(right) - scoreVariant(left))[0] || null;
    },
    applyManifestTrackSelection({ audioTrackId, subtitleTrackId } = {}) {
      if (audioTrackId !== void 0) {
        this.selectedManifestAudioTrackId = audioTrackId;
      }
      if (subtitleTrackId !== void 0) {
        this.selectedManifestSubtitleTrackId = subtitleTrackId;
      }
      const selectedAudio = this.manifestAudioTracks.find((track) => track.id === this.selectedManifestAudioTrackId) || null;
      const selectedSubtitle = this.manifestSubtitleTracks.find((track) => track.id === this.selectedManifestSubtitleTrackId) || null;
      const variant = this.pickManifestVariant({
        audioGroupId: (selectedAudio == null ? void 0 : selectedAudio.groupId) || null,
        subtitleGroupId: selectedSubtitle ? selectedSubtitle.groupId || null : null
      });
      if (!(variant == null ? void 0 : variant.uri)) {
        this.refreshTrackDialogs();
        return;
      }
      const targetUrl = variant.uri;
      if (targetUrl === this.activePlaybackUrl) {
        this.refreshTrackDialogs();
        return;
      }
      const video = PlayerController.video;
      const restoreTimeSeconds = this.getPlaybackCurrentSeconds();
      const usingAvPlay = typeof PlayerController.isUsingAvPlay === "function" ? PlayerController.isUsingAvPlay() : false;
      const restorePaused = Boolean(this.paused || !usingAvPlay && (video == null ? void 0 : video.paused));
      this.pendingPlaybackRestore = {
        timeSeconds: Number.isFinite(restoreTimeSeconds) ? restoreTimeSeconds : 0,
        paused: restorePaused
      };
      this.activePlaybackUrl = targetUrl;
      const currentStreamCandidate = this.getCurrentStreamCandidate();
      PlayerController.play(targetUrl, this.buildPlaybackContext(currentStreamCandidate));
      this.paused = false;
      this.loadingVisible = true;
      this.updateLoadingVisibility();
      this.setControlsVisible(true, { focus: false });
    },
    renderPlayerUi() {
      var _a;
      (_a = this.container.querySelector("#playerUiRoot")) == null ? void 0 : _a.remove();
      const root = document.createElement("div");
      root.id = "playerUiRoot";
      root.className = "player-ui-root";
      root.innerHTML = `
      <div id="playerLoadingOverlay" class="player-loading-overlay">
        <div class="player-loading-backdrop"${this.params.playerBackdropUrl ? ` style="background-image:url('${this.params.playerBackdropUrl}')"` : ""}></div>
        <div class="player-loading-gradient"></div>
        <div class="player-loading-center">
          ${this.params.playerLogoUrl ? `<img class="player-loading-logo" src="${this.params.playerLogoUrl}" alt="logo" />` : ""}
          <div class="player-loading-title">${escapeHtml(this.params.playerTitle || this.params.itemId || "Nuvio")}</div>
          ${this.params.playerSubtitle ? `<div class="player-loading-subtitle">${escapeHtml(this.params.playerSubtitle)}</div>` : ""}
        </div>
      </div>

      <div id="playerParentalGuide" class="player-parental-guide hidden"></div>

      <div id="playerAspectToast" class="player-aspect-toast hidden"></div>

      <div id="playerSeekOverlay" class="player-seek-overlay hidden">
        <div class="player-seek-overlay-top">
          <span id="playerSeekDirection" class="player-seek-direction"></span>
          <span id="playerSeekPreview" class="player-seek-preview">0:00</span>
        </div>
        <div class="player-seek-track"><div id="playerSeekFill" class="player-seek-fill"></div></div>
      </div>

      <div id="playerModalBackdrop" class="player-modal-backdrop hidden"></div>
      <div id="playerSubtitleDialog" class="player-modal player-subtitle-modal hidden"></div>
      <div id="playerAudioDialog" class="player-modal player-audio-modal hidden"></div>
      <div id="playerSourcesPanel" class="player-sources-panel hidden"></div>

      <div id="playerControlsOverlay" class="player-controls-overlay">
        <div class="player-controls-top">
          <div id="playerClock" class="player-clock">--:--</div>
          <div class="player-ends-at">Ends at: <span id="playerEndsAt">--:--</span></div>
        </div>

        <div class="player-controls-bottom">
          <div class="player-meta">
            <div class="player-title">${escapeHtml(this.params.playerTitle || this.params.itemId || "Untitled")}</div>
            <div class="player-subtitle">${escapeHtml(this.params.playerSubtitle || this.params.episodeLabel || this.params.itemType || "")}</div>
          </div>

          <div class="player-progress-track">
            <div id="playerProgressFill" class="player-progress-fill"></div>
          </div>

          <div class="player-controls-row">
            <div id="playerControlButtons" class="player-control-buttons"></div>
            <div id="playerTimeLabel" class="player-time-label">0:00 / 0:00</div>
          </div>
        </div>
      </div>
    `;
      this.container.appendChild(root);
      this.renderControlButtons();
      this.renderSubtitleDialog();
      this.renderAudioDialog();
      this.renderSourcesPanel();
      this.renderParentalGuideOverlay();
      this.renderSeekOverlay();
    },
    updateModalBackdrop() {
      const modalBackdrop = this.container.querySelector("#playerModalBackdrop");
      if (!modalBackdrop) {
        return;
      }
      const hasModal = this.subtitleDialogVisible || this.audioDialogVisible || this.sourcesPanelVisible;
      modalBackdrop.classList.toggle("hidden", !hasModal);
    },
    bindVideoEvents() {
      const video = PlayerController.video;
      if (!video) {
        return;
      }
      const onWaiting = () => {
        this.loadingVisible = true;
        this.updateLoadingVisibility();
        if (!this.sourcesPanelVisible) {
          this.setControlsVisible(true, { focus: false });
        }
        this.schedulePlaybackStallGuard();
      };
      const onPlaying = () => {
        this.failedStreamUrls.clear();
        this.lastPlaybackErrorAt = 0;
        this.sourcesError = "";
        this.markPlaybackProgress();
        this.clearPlaybackStallGuard();
        this.loadingVisible = false;
        this.paused = false;
        this.updateLoadingVisibility();
        this.refreshTrackDialogs();
        this.updateUiTick();
        this.resetControlsAutoHide();
        if (!this.parentalGuideShown && this.parentalWarnings.length) {
          this.showParentalGuideOverlay();
        }
        setTimeout(() => {
          this.attemptSilentAudioRecovery("playing");
        }, 700);
      };
      const onPause = () => {
        const ended = typeof PlayerController.isPlaybackEnded === "function" ? PlayerController.isPlaybackEnded() : Boolean(video.ended);
        if (ended) {
          return;
        }
        this.clearPlaybackStallGuard();
        this.paused = true;
        this.setControlsVisible(true, { focus: false });
        this.updateUiTick();
        this.renderControlButtons();
      };
      const onTimeUpdate = () => {
        this.markPlaybackProgress();
        this.updateUiTick();
      };
      const onLoadedMetadata = () => {
        if (this.pendingPlaybackRestore) {
          const restore = this.pendingPlaybackRestore;
          this.pendingPlaybackRestore = null;
          if (Number.isFinite(restore.timeSeconds) && restore.timeSeconds > 0) {
            try {
              this.seekPlaybackSeconds(restore.timeSeconds);
            } catch (_) {
            }
          }
          if (restore.paused) {
            PlayerController.pause();
            this.paused = true;
          } else {
            this.paused = false;
          }
        }
        this.refreshTrackDialogs();
        this.updateUiTick();
        this.loadingVisible = false;
        this.updateLoadingVisibility();
        this.markPlaybackProgress();
        this.ensureTrackDataWarmup();
        this.startTrackDiscoveryWindow({ durationMs: 5e3, intervalMs: 300 });
        setTimeout(() => {
          this.attemptSilentAudioRecovery("metadata");
        }, 500);
      };
      const onPlayable = () => {
        this.refreshTrackDialogs();
        this.updateUiTick();
      };
      const onTrackListChanged = () => {
        this.refreshTrackDialogs();
        if (this.trackDiscoveryInProgress && this.hasAudioTracksAvailable() && this.hasSubtitleTracksAvailable()) {
          this.trackDiscoveryInProgress = false;
          this.clearTrackDiscoveryTimer();
          this.refreshTrackDialogs();
        }
      };
      const onError = (event) => {
        var _a, _b;
        const now = Date.now();
        if (now - Number(this.lastPlaybackErrorAt || 0) < 120) {
          return;
        }
        this.lastPlaybackErrorAt = now;
        const detailErrorCode = Number(((_a = event == null ? void 0 : event.detail) == null ? void 0 : _a.mediaErrorCode) || 0);
        const controllerErrorCode = typeof PlayerController.getLastPlaybackErrorCode === "function" ? Number(PlayerController.getLastPlaybackErrorCode() || 0) : 0;
        const mediaErrorCode = detailErrorCode || Number(((_b = video == null ? void 0 : video.error) == null ? void 0 : _b.code) || 0) || controllerErrorCode;
        if (this.recoverFromPlaybackError(mediaErrorCode)) {
          return;
        }
        this.clearPlaybackStallGuard();
        this.loadingVisible = false;
        this.paused = true;
        this.updateLoadingVisibility();
        this.setControlsVisible(true, { focus: false });
        this.sourcesError = `${this.mediaErrorMessage(mediaErrorCode)}. Try another source.`;
        if (this.streamCandidates.length > 1) {
          this.openSourcesPanel();
        } else {
          this.renderSourcesPanel();
        }
        console.warn("Playback failed", {
          url: this.activePlaybackUrl,
          mediaErrorCode
        });
      };
      const bindings = [
        ["waiting", onWaiting],
        ["playing", onPlaying],
        ["error", onError],
        ["pause", onPause],
        ["timeupdate", onTimeUpdate],
        ["loadedmetadata", onLoadedMetadata],
        ["loadeddata", onPlayable],
        ["canplay", onPlayable],
        ["avplaytrackschanged", onTrackListChanged],
        ["dashtrackschanged", onTrackListChanged]
      ];
      bindings.forEach(([eventName, handler]) => {
        video.addEventListener(eventName, handler);
        this.videoListeners.push({ target: video, eventName, handler });
      });
      const trackTargets = [this.getVideoTextTrackList(), this.getVideoAudioTrackList()].filter(Boolean);
      trackTargets.forEach((target) => {
        if (typeof target.addEventListener !== "function") {
          return;
        }
        ["addtrack", "removetrack", "change"].forEach((eventName) => {
          target.addEventListener(eventName, onTrackListChanged);
          this.videoListeners.push({ target, eventName, handler: onTrackListChanged });
        });
      });
    },
    unbindVideoEvents() {
      this.videoListeners.forEach(({ target, eventName, handler }) => {
        var _a;
        (_a = target == null ? void 0 : target.removeEventListener) == null ? void 0 : _a.call(target, eventName, handler);
      });
      this.videoListeners = [];
    },
    getControlDefinitions() {
      const base = [
        {
          action: "playPause",
          label: this.paused ? ">" : "II",
          icon: this.paused ? "assets/icons/ic_player_play.svg" : "assets/icons/ic_player_pause.svg",
          title: "Play/Pause"
        },
        { action: "subtitleDialog", icon: "assets/icons/ic_player_subtitles.svg", title: "Subtitles" },
        {
          action: "audioTrack",
          icon: this.selectedAudioTrackIndex >= 0 || this.selectedManifestAudioTrackId ? "assets/icons/ic_player_audio_filled.svg" : "assets/icons/ic_player_audio_outline.svg",
          title: "Audio"
        },
        { action: "source", icon: "assets/icons/ic_player_source.svg", title: "Sources" },
        { action: "episodes", icon: "assets/icons/ic_player_episodes.svg", title: "Episodes" },
        { action: "more", label: this.moreActionsVisible ? "<" : ">", title: "More" }
      ];
      if (!this.moreActionsVisible) {
        return base;
      }
      return [
        ...base.slice(0, Math.max(0, base.length - 1)),
        { action: "aspect", icon: "assets/icons/ic_player_aspect_ratio.svg", title: "Display Mode" },
        { action: "source", icon: "assets/icons/ic_player_source.svg", title: "Sources" },
        { action: "backFromMore", label: "<", title: "Back" }
      ];
    },
    renderControlButtons() {
      var _a, _b;
      const wrap = this.container.querySelector("#playerControlButtons");
      if (!wrap) {
        return;
      }
      const currentAction = ((_b = (_a = wrap.querySelector(".player-control-btn.focused")) == null ? void 0 : _a.dataset) == null ? void 0 : _b.action) || "";
      const controls = this.getControlDefinitions();
      wrap.innerHTML = controls.map((control) => `
      <button class="player-control-btn focusable"
              data-action="${control.action}"
              title="${escapeHtml(control.title || "")}">
        ${control.icon ? `<img class="player-control-icon" src="${control.icon}" alt="" aria-hidden="true" />` : `<span class="player-control-label">${escapeHtml(control.label || "")}</span>`}
      </button>
    `).join("");
      const preferred = wrap.querySelector(`.player-control-btn[data-action="${currentAction}"]`) || wrap.querySelector(".player-control-btn");
      if (preferred) {
        preferred.classList.add("focused");
      }
    },
    isDialogOpen() {
      return this.subtitleDialogVisible || this.audioDialogVisible || this.sourcesPanelVisible || this.episodePanelVisible;
    },
    setControlsVisible(visible, { focus = false } = {}) {
      this.controlsVisible = Boolean(visible);
      const overlay = this.container.querySelector("#playerControlsOverlay");
      if (!overlay) {
        return;
      }
      overlay.classList.toggle("hidden", !this.controlsVisible);
      if (this.controlsVisible) {
        this.renderControlButtons();
        if (focus) {
          this.focusFirstControl();
        }
        this.resetControlsAutoHide();
      } else {
        this.clearControlsAutoHide();
      }
    },
    focusFirstControl() {
      const buttons = Array.from(this.container.querySelectorAll(".player-control-btn"));
      if (!buttons.length) {
        return;
      }
      buttons.forEach((node) => node.classList.remove("focused"));
      buttons[0].classList.add("focused");
      buttons[0].focus();
    },
    clearControlsAutoHide() {
      if (this.controlsHideTimer) {
        clearTimeout(this.controlsHideTimer);
        this.controlsHideTimer = null;
      }
    },
    resetControlsAutoHide() {
      this.clearControlsAutoHide();
      if (!this.controlsVisible || this.paused || this.isDialogOpen() || this.seekOverlayVisible) {
        return;
      }
      this.controlsHideTimer = setTimeout(() => {
        this.setControlsVisible(false);
      }, 4200);
    },
    getPlaybackCurrentSeconds() {
      var _a;
      if (typeof PlayerController.getCurrentTimeSeconds === "function") {
        return Number(PlayerController.getCurrentTimeSeconds() || 0);
      }
      return Number(((_a = PlayerController.video) == null ? void 0 : _a.currentTime) || 0);
    },
    getPlaybackDurationSeconds() {
      var _a;
      if (typeof PlayerController.getDurationSeconds === "function") {
        return Number(PlayerController.getDurationSeconds() || 0);
      }
      return Number(((_a = PlayerController.video) == null ? void 0 : _a.duration) || 0);
    },
    seekPlaybackSeconds(seconds) {
      if (typeof PlayerController.seekToSeconds === "function") {
        return Boolean(PlayerController.seekToSeconds(seconds));
      }
      const video = PlayerController.video;
      if (!video) {
        return false;
      }
      video.currentTime = Number(seconds || 0);
      return true;
    },
    updateLoadingVisibility() {
      const overlay = this.container.querySelector("#playerLoadingOverlay");
      if (!overlay) {
        return;
      }
      overlay.classList.toggle("hidden", !this.loadingVisible);
    },
    updateUiTick() {
      const current = this.getPlaybackCurrentSeconds();
      const duration = this.getPlaybackDurationSeconds();
      const progress = duration > 0 ? clamp(current / duration, 0, 1) : 0;
      const progressFill = this.container.querySelector("#playerProgressFill");
      if (progressFill) {
        progressFill.style.width = `${Math.round(progress * 1e4) / 100}%`;
      }
      const clock = this.container.querySelector("#playerClock");
      if (clock) {
        clock.textContent = formatClock(/* @__PURE__ */ new Date());
      }
      const endsAt = this.container.querySelector("#playerEndsAt");
      if (endsAt) {
        endsAt.textContent = formatEndsAt(current, duration);
      }
      const timeLabel = this.container.querySelector("#playerTimeLabel");
      if (timeLabel) {
        timeLabel.textContent = `${formatTime(current)} / ${formatTime(duration)}`;
      }
      if (this.seekOverlayVisible && this.seekPreviewSeconds == null) {
        this.renderSeekOverlay();
      }
    },
    renderSeekOverlay() {
      const overlay = this.container.querySelector("#playerSeekOverlay");
      const directionNode = this.container.querySelector("#playerSeekDirection");
      const previewNode = this.container.querySelector("#playerSeekPreview");
      const fillNode = this.container.querySelector("#playerSeekFill");
      if (!overlay || !directionNode || !previewNode || !fillNode) {
        return;
      }
      const duration = this.getPlaybackDurationSeconds();
      const currentPreview = this.seekPreviewSeconds != null ? Number(this.seekPreviewSeconds) : this.getPlaybackCurrentSeconds();
      overlay.classList.toggle("hidden", !this.seekOverlayVisible);
      previewNode.textContent = `${formatTime(currentPreview)} / ${formatTime(duration)}`;
      directionNode.textContent = this.seekPreviewDirection < 0 ? "<<" : this.seekPreviewDirection > 0 ? ">>" : "";
      const percent = duration > 0 ? clamp(currentPreview / duration, 0, 1) : 0;
      fillNode.style.width = `${Math.round(percent * 1e4) / 100}%`;
    },
    beginSeekPreview(direction, isRepeat = false) {
      const currentTime = this.getPlaybackCurrentSeconds();
      if (Number.isNaN(currentTime)) {
        return;
      }
      if (direction !== this.seekPreviewDirection || !isRepeat) {
        this.seekRepeatCount = 0;
      }
      this.seekPreviewDirection = direction;
      this.seekRepeatCount += 1;
      const stepSeconds = this.seekRepeatCount >= 10 ? 30 : this.seekRepeatCount >= 4 ? 20 : 10;
      const duration = this.getPlaybackDurationSeconds();
      const base = this.seekPreviewSeconds == null ? currentTime : Number(this.seekPreviewSeconds);
      let next = base + direction * stepSeconds;
      if (duration > 0) {
        next = clamp(next, 0, duration);
      } else {
        next = Math.max(0, next);
      }
      this.seekPreviewSeconds = next;
      this.seekOverlayVisible = true;
      this.renderSeekOverlay();
      if (this.seekOverlayTimer) {
        clearTimeout(this.seekOverlayTimer);
        this.seekOverlayTimer = null;
      }
      this.scheduleSeekPreviewCommit();
    },
    scheduleSeekPreviewCommit() {
      if (this.seekCommitTimer) {
        clearTimeout(this.seekCommitTimer);
      }
      this.seekCommitTimer = setTimeout(() => {
        this.commitSeekPreview();
      }, 280);
    },
    commitSeekPreview() {
      if (!PlayerController.video) {
        this.cancelSeekPreview({ commit: false });
        return;
      }
      if (this.seekPreviewSeconds != null) {
        this.seekPlaybackSeconds(Number(this.seekPreviewSeconds));
      }
      this.seekPreviewSeconds = null;
      this.seekRepeatCount = 0;
      if (this.seekCommitTimer) {
        clearTimeout(this.seekCommitTimer);
        this.seekCommitTimer = null;
      }
      this.seekOverlayVisible = true;
      this.renderSeekOverlay();
      if (this.seekOverlayTimer) {
        clearTimeout(this.seekOverlayTimer);
      }
      this.seekOverlayTimer = setTimeout(() => {
        this.seekOverlayVisible = false;
        this.seekPreviewDirection = 0;
        this.renderSeekOverlay();
        this.resetControlsAutoHide();
      }, 700);
    },
    cancelSeekPreview({ commit = false } = {}) {
      if (commit) {
        this.commitSeekPreview();
        return;
      }
      if (this.seekCommitTimer) {
        clearTimeout(this.seekCommitTimer);
        this.seekCommitTimer = null;
      }
      if (this.seekOverlayTimer) {
        clearTimeout(this.seekOverlayTimer);
        this.seekOverlayTimer = null;
      }
      this.seekPreviewSeconds = null;
      this.seekPreviewDirection = 0;
      this.seekRepeatCount = 0;
      this.seekOverlayVisible = false;
      this.renderSeekOverlay();
    },
    togglePause() {
      if (this.paused) {
        PlayerController.resume();
        this.paused = false;
        this.setControlsVisible(true, { focus: false });
        this.renderControlButtons();
        return;
      }
      PlayerController.pause();
      this.paused = true;
      this.setControlsVisible(true, { focus: true });
      this.renderControlButtons();
    },
    async playStreamByUrl(streamUrl, { preservePanel = false, resetSilentAudioState = true } = {}) {
      if (!streamUrl) {
        return;
      }
      const selectedIndex = this.streamCandidates.findIndex((entry) => entry.url === streamUrl);
      if (selectedIndex >= 0) {
        this.currentStreamIndex = selectedIndex;
      }
      this.loadingVisible = true;
      this.updateLoadingVisibility();
      this.cancelSeekPreview({ commit: false });
      this.markPlaybackProgress();
      this.clearPlaybackStallGuard();
      if (resetSilentAudioState) {
        this.silentAudioFallbackAttempts.clear();
        this.silentAudioFallbackCount = 0;
      }
      if (!preservePanel) {
        this.closeSourcesPanel();
      }
      this.subtitleDialogVisible = false;
      this.audioDialogVisible = false;
      this.selectedAddonSubtitleId = null;
      this.selectedSubtitleTrackIndex = -1;
      this.builtInSubtitleCount = 0;
      this.trackDiscoveryInProgress = true;
      this.clearTrackDiscoveryTimer();
      this.updateModalBackdrop();
      this.renderSubtitleDialog();
      this.renderAudioDialog();
      const sourceCandidate = this.getStreamCandidateByUrl(streamUrl) || this.getCurrentStreamCandidate();
      this.activePlaybackUrl = streamUrl;
      PlayerController.play(this.activePlaybackUrl, this.buildPlaybackContext(sourceCandidate));
      this.paused = false;
      this.loadSubtitles();
      this.loadManifestTrackDataForCurrentStream(this.activePlaybackUrl);
      this.startTrackDiscoveryWindow();
      this.syncTrackState();
      this.updateUiTick();
      this.setControlsVisible(true, { focus: false });
      this.schedulePlaybackStallGuard();
    },
    switchStream(direction) {
      if (!this.streamCandidates.length) {
        return;
      }
      this.currentStreamIndex += direction;
      if (this.currentStreamIndex >= this.streamCandidates.length) {
        this.currentStreamIndex = 0;
      }
      if (this.currentStreamIndex < 0) {
        this.currentStreamIndex = this.streamCandidates.length - 1;
      }
      const selected = this.streamCandidates[this.currentStreamIndex];
      if (!(selected == null ? void 0 : selected.url)) {
        return;
      }
      this.playStreamByUrl(selected.url);
    },
    mediaErrorMessage(errorCode = 0) {
      const code = Number(errorCode || 0);
      if (code === 1) return "Playback aborted";
      if (code === 2) return "Network error";
      if (code === 3) return "Decode error";
      if (code === 4) return "Source not supported on this TV";
      return "Playback error";
    },
    findNextRecoverableStream({ preferAudioCompatible = false } = {}) {
      if (!this.streamCandidates.length) {
        return null;
      }
      const candidates = [];
      for (let offset = 1; offset < this.streamCandidates.length; offset += 1) {
        const index = (this.currentStreamIndex + offset) % this.streamCandidates.length;
        const candidate = this.streamCandidates[index];
        const candidateUrl = String((candidate == null ? void 0 : candidate.url) || "").trim();
        if (!candidateUrl || this.failedStreamUrls.has(candidateUrl)) {
          continue;
        }
        candidates.push({ index, offset, stream: candidate });
      }
      if (!candidates.length) {
        return null;
      }
      if (!preferAudioCompatible) {
        return candidates[0];
      }
      return candidates.slice().sort((left, right) => {
        const scoreDelta = this.getWebOsAudioCompatibilityScore(right.stream) - this.getWebOsAudioCompatibilityScore(left.stream);
        if (scoreDelta !== 0) {
          return scoreDelta;
        }
        return left.offset - right.offset;
      })[0] || candidates[0];
    },
    attemptSilentAudioRecovery(reason = "silent-audio") {
      var _a;
      if (!Environment.isWebOS()) {
        return false;
      }
      if (this.sourcesPanelVisible || this.subtitleDialogVisible || this.audioDialogVisible) {
        return false;
      }
      if (String(PlayerController.playbackEngine || "") !== "native") {
        return false;
      }
      if (typeof PlayerController.canUseAvPlay === "function" && PlayerController.canUseAvPlay()) {
        return false;
      }
      const currentUrl = String(this.activePlaybackUrl || "").trim();
      if (!currentUrl || this.silentAudioFallbackAttempts.has(currentUrl)) {
        return false;
      }
      if (Number(this.silentAudioFallbackCount || 0) >= Number(this.maxSilentAudioFallbackCount || 0)) {
        return false;
      }
      const nativeAudioCount = this.getAudioTracks().length;
      const dashAudioCount = typeof PlayerController.getDashAudioTracks === "function" ? PlayerController.getDashAudioTracks().length : 0;
      const hlsAudioCount = typeof PlayerController.getHlsAudioTracks === "function" ? PlayerController.getHlsAudioTracks().length : 0;
      const hasAudio = nativeAudioCount > 0 || dashAudioCount > 0 || hlsAudioCount > 0;
      if (hasAudio) {
        return false;
      }
      const currentCandidate = this.getStreamCandidateByUrl(currentUrl) || this.getCurrentStreamCandidate();
      const currentScore = this.getWebOsAudioCompatibilityScore(currentCandidate);
      const currentText = this.getStreamSearchText(currentCandidate);
      const clearlyUnsupportedAudio = /\b(eac3|ec-3|ddp|atmos|truehd|dts-hd|dts:x|dts)\b/.test(currentText);
      if (!clearlyUnsupportedAudio && currentScore >= 0) {
        return false;
      }
      this.silentAudioFallbackAttempts.add(currentUrl);
      const fallback = this.findNextRecoverableStream({ preferAudioCompatible: true });
      if (!((_a = fallback == null ? void 0 : fallback.stream) == null ? void 0 : _a.url)) {
        this.sourcesError = "Audio codec not supported on this TV for this source.";
        this.renderSourcesPanel();
        return false;
      }
      const fallbackScore = this.getWebOsAudioCompatibilityScore(fallback.stream);
      if (fallbackScore <= currentScore) {
        return false;
      }
      this.silentAudioFallbackCount = Number(this.silentAudioFallbackCount || 0) + 1;
      this.currentStreamIndex = fallback.index;
      this.sourcesError = "Audio unavailable on this source, trying a compatible one...";
      console.warn("Silent audio fallback", {
        reason,
        currentUrl,
        nextUrl: fallback.stream.url
      });
      this.playStreamByUrl(fallback.stream.url, {
        preservePanel: false,
        resetSilentAudioState: false
      });
      return true;
    },
    recoverFromPlaybackError(errorCode = 0) {
      var _a;
      const currentUrl = String(this.activePlaybackUrl || "").trim();
      if (currentUrl) {
        this.failedStreamUrls.add(currentUrl);
      }
      const fallback = this.findNextRecoverableStream({
        preferAudioCompatible: Environment.isWebOS()
      });
      if (!((_a = fallback == null ? void 0 : fallback.stream) == null ? void 0 : _a.url)) {
        return false;
      }
      this.currentStreamIndex = fallback.index;
      this.sourcesError = `${this.mediaErrorMessage(errorCode)}. Trying next source...`;
      this.playStreamByUrl(fallback.stream.url, { preservePanel: false });
      return true;
    },
    clearPlaybackStallGuard() {
      if (this.playbackStallTimer) {
        clearTimeout(this.playbackStallTimer);
        this.playbackStallTimer = null;
      }
    },
    markPlaybackProgress() {
      this.lastPlaybackProgressAt = Date.now();
    },
    schedulePlaybackStallGuard() {
      this.clearPlaybackStallGuard();
      this.playbackStallTimer = setTimeout(() => {
        const video = PlayerController.video;
        const ended = typeof PlayerController.isPlaybackEnded === "function" ? PlayerController.isPlaybackEnded() : Boolean(video == null ? void 0 : video.ended);
        if (!video || ended || this.paused || this.sourcesPanelVisible) {
          return;
        }
        const readyState = typeof PlayerController.getPlaybackReadyState === "function" ? Number(PlayerController.getPlaybackReadyState() || 0) : Number(video.readyState || 0);
        const currentTime = this.getPlaybackCurrentSeconds();
        const elapsedFromProgress = Date.now() - Number(this.lastPlaybackProgressAt || 0);
        const stalledAtStart = currentTime < 0.5 && readyState < 2;
        const stalledWhilePlaying = elapsedFromProgress >= 9e3 && readyState < 3;
        if (!stalledAtStart && !stalledWhilePlaying) {
          return;
        }
        if (this.recoverFromPlaybackError(2)) {
          return;
        }
        this.loadingVisible = false;
        this.paused = true;
        this.updateLoadingVisibility();
        this.setControlsVisible(true, { focus: false });
        this.sourcesError = "Stream stalled while buffering. Try another source.";
        if (this.streamCandidates.length > 1) {
          this.openSourcesPanel();
        } else {
          this.renderSourcesPanel();
        }
      }, 9e3);
    },
    getSubtitleTabs() {
      return [
        { id: "builtIn", label: "Built-in" },
        { id: "addons", label: "Addons" },
        { id: "style", label: "Style" },
        { id: "delay", label: "Delay" }
      ];
    },
    refreshTrackDialogs() {
      this.syncTrackState();
      this.renderControlButtons();
      if (this.subtitleDialogVisible) {
        this.renderSubtitleDialog();
      }
      if (this.audioDialogVisible) {
        this.renderAudioDialog();
      }
    },
    hasAudioTracksAvailable() {
      let dashCount = 0;
      try {
        dashCount = typeof PlayerController.getDashAudioTracks === "function" ? PlayerController.getDashAudioTracks().length : 0;
      } catch (_) {
        dashCount = 0;
      }
      let avplayCount = 0;
      try {
        avplayCount = typeof PlayerController.getAvPlayAudioTracks === "function" ? PlayerController.getAvPlayAudioTracks().length : 0;
      } catch (_) {
        avplayCount = 0;
      }
      let hlsCount = 0;
      try {
        hlsCount = typeof PlayerController.getHlsAudioTracks === "function" ? PlayerController.getHlsAudioTracks().length : 0;
      } catch (_) {
        hlsCount = 0;
      }
      let nativeCount = 0;
      try {
        nativeCount = this.getAudioTracks().length;
      } catch (_) {
        nativeCount = 0;
      }
      return dashCount > 0 || avplayCount > 0 || hlsCount > 0 || nativeCount > 0 || this.manifestAudioTracks.length > 0;
    },
    hasSubtitleTracksAvailable() {
      let dashCount = 0;
      try {
        dashCount = typeof PlayerController.getDashTextTracks === "function" ? PlayerController.getDashTextTracks().length : 0;
      } catch (_) {
        dashCount = 0;
      }
      let avplayCount = 0;
      try {
        avplayCount = typeof PlayerController.getAvPlaySubtitleTracks === "function" ? PlayerController.getAvPlaySubtitleTracks().length : 0;
      } catch (_) {
        avplayCount = 0;
      }
      let nativeCount = 0;
      try {
        nativeCount = this.getTextTracks().length;
      } catch (_) {
        nativeCount = 0;
      }
      return dashCount > 0 || avplayCount > 0 || nativeCount > 0 || this.manifestSubtitleTracks.length > 0 || this.subtitles.length > 0;
    },
    clearTrackDiscoveryTimer() {
      if (this.trackDiscoveryTimer) {
        clearTimeout(this.trackDiscoveryTimer);
        this.trackDiscoveryTimer = null;
      }
    },
    startTrackDiscoveryWindow({ durationMs = 7e3, intervalMs = 350 } = {}) {
      const token = (this.trackDiscoveryToken || 0) + 1;
      this.trackDiscoveryToken = token;
      this.trackDiscoveryInProgress = true;
      this.trackDiscoveryStartedAt = Date.now();
      this.trackDiscoveryDeadline = this.trackDiscoveryStartedAt + Math.max(500, Number(durationMs || 0));
      this.clearTrackDiscoveryTimer();
      const tick = () => {
        if (token !== this.trackDiscoveryToken) {
          return;
        }
        const doneByData = this.hasAudioTracksAvailable() || this.hasSubtitleTracksAvailable();
        const doneByIdle = !this.subtitleLoading && !this.manifestLoading && Date.now() - Number(this.trackDiscoveryStartedAt || 0) >= 1200;
        const doneByTimeout = Date.now() >= this.trackDiscoveryDeadline;
        this.refreshTrackDialogs();
        if (doneByData || doneByIdle || doneByTimeout) {
          this.trackDiscoveryInProgress = false;
          this.clearTrackDiscoveryTimer();
          this.refreshTrackDialogs();
          return;
        }
        this.trackDiscoveryTimer = setTimeout(tick, Math.max(120, Number(intervalMs || 0)));
      };
      tick();
    },
    ensureTrackDataWarmup(force = false) {
      var _a;
      const now = Date.now();
      if (!force && now - Number(this.lastTrackWarmupAt || 0) < 1200) {
        return;
      }
      if (!force && (this.subtitleLoading || this.manifestLoading)) {
        this.startTrackDiscoveryWindow();
        return;
      }
      this.lastTrackWarmupAt = now;
      this.loadSubtitles();
      this.loadManifestTrackDataForCurrentStream(this.activePlaybackUrl || ((_a = this.getCurrentStreamCandidate()) == null ? void 0 : _a.url) || null);
      this.startTrackDiscoveryWindow();
    },
    getTextTracks() {
      const trackList = this.getVideoTextTrackList();
      if (!trackList) {
        return [];
      }
      try {
        return trackListToArray(trackList);
      } catch (_) {
        return [];
      }
    },
    getAudioTracks() {
      const trackList = this.getVideoAudioTrackList();
      if (!trackList) {
        return [];
      }
      try {
        return trackListToArray(trackList);
      } catch (_) {
        return [];
      }
    },
    resolveBuiltInSubtitleBoundary(textTracks = this.getTextTracks()) {
      const trackCount = textTracks.length;
      if (!trackCount) {
        return 0;
      }
      if (Number.isFinite(this.builtInSubtitleCount) && this.builtInSubtitleCount > 0) {
        return clamp(this.builtInSubtitleCount, 0, trackCount);
      }
      if (this.externalTrackNodes.length > 0) {
        const inferred = trackCount - this.externalTrackNodes.length;
        if (inferred >= 0) {
          return clamp(inferred, 0, trackCount);
        }
        return trackCount;
      }
      return trackCount;
    },
    syncTrackState() {
      var _a;
      const textTracks = this.getTextTracks();
      const audioTracks = this.getAudioTracks();
      const dashAudioTracks = typeof PlayerController.getDashAudioTracks === "function" ? PlayerController.getDashAudioTracks() : [];
      const dashSubtitleTracks = typeof PlayerController.getDashTextTracks === "function" ? PlayerController.getDashTextTracks() : [];
      const avplayAudioTracks = typeof PlayerController.getAvPlayAudioTracks === "function" ? PlayerController.getAvPlayAudioTracks() : [];
      const avplaySubtitleTracks = typeof PlayerController.getAvPlaySubtitleTracks === "function" ? PlayerController.getAvPlaySubtitleTracks() : [];
      const hlsAudioTracks = typeof PlayerController.getHlsAudioTracks === "function" ? PlayerController.getHlsAudioTracks() : [];
      if (!this.externalTrackNodes.length) {
        this.builtInSubtitleCount = textTracks.length;
      } else if ((!Number.isFinite(this.builtInSubtitleCount) || this.builtInSubtitleCount <= 0) && textTracks.length > this.externalTrackNodes.length) {
        this.builtInSubtitleCount = textTracks.length - this.externalTrackNodes.length;
      }
      if (avplaySubtitleTracks.length) {
        const selectedAvPlaySubtitleTrack = typeof PlayerController.getSelectedAvPlaySubtitleTrackIndex === "function" ? PlayerController.getSelectedAvPlaySubtitleTrackIndex() : -1;
        this.selectedSubtitleTrackIndex = Number.isFinite(selectedAvPlaySubtitleTrack) ? selectedAvPlaySubtitleTrack : -1;
      } else if (dashSubtitleTracks.length) {
        const selectedDashSubtitleTrack = typeof PlayerController.getSelectedDashTextTrackIndex === "function" ? PlayerController.getSelectedDashTextTrackIndex() : -1;
        this.selectedSubtitleTrackIndex = Number.isFinite(selectedDashSubtitleTrack) ? selectedDashSubtitleTrack : -1;
      } else {
        this.selectedSubtitleTrackIndex = textTracks.findIndex((track) => (track == null ? void 0 : track.mode) && track.mode !== "disabled");
      }
      if (avplayAudioTracks.length) {
        const selectedAvPlayAudioTrack = typeof PlayerController.getSelectedAvPlayAudioTrackIndex === "function" ? PlayerController.getSelectedAvPlayAudioTrackIndex() : -1;
        const fallbackTrackIndex = Number((_a = avplayAudioTracks[0]) == null ? void 0 : _a.avplayTrackIndex);
        this.selectedAudioTrackIndex = selectedAvPlayAudioTrack >= 0 ? selectedAvPlayAudioTrack : Number.isFinite(fallbackTrackIndex) ? fallbackTrackIndex : 0;
        return;
      }
      if (dashAudioTracks.length) {
        const selectedDashAudioTrack = typeof PlayerController.getSelectedDashAudioTrackIndex === "function" ? PlayerController.getSelectedDashAudioTrackIndex() : -1;
        this.selectedAudioTrackIndex = selectedDashAudioTrack >= 0 ? selectedDashAudioTrack : 0;
        return;
      }
      if (hlsAudioTracks.length) {
        const selectedHlsAudioTrack = typeof PlayerController.getSelectedHlsAudioTrackIndex === "function" ? PlayerController.getSelectedHlsAudioTrackIndex() : -1;
        const defaultHlsAudioTrack = hlsAudioTracks.findIndex((track) => Boolean(track == null ? void 0 : track.default));
        this.selectedAudioTrackIndex = selectedHlsAudioTrack >= 0 ? selectedHlsAudioTrack : defaultHlsAudioTrack >= 0 ? defaultHlsAudioTrack : 0;
        return;
      }
      this.selectedAudioTrackIndex = audioTracks.findIndex((track) => Boolean((track == null ? void 0 : track.enabled) || (track == null ? void 0 : track.selected)));
    },
    getSubtitleEntries(tab = this.subtitleDialogTab) {
      const textTracks = this.getTextTracks();
      const builtInBoundary = this.resolveBuiltInSubtitleBoundary(textTracks);
      const dashSubtitleTracks = typeof PlayerController.getDashTextTracks === "function" ? PlayerController.getDashTextTracks() : [];
      const selectedDashSubtitleTrack = typeof PlayerController.getSelectedDashTextTrackIndex === "function" ? PlayerController.getSelectedDashTextTrackIndex() : -1;
      const avplaySubtitleTracks = typeof PlayerController.getAvPlaySubtitleTracks === "function" ? PlayerController.getAvPlaySubtitleTracks() : [];
      const selectedAvPlaySubtitleTrack = typeof PlayerController.getSelectedAvPlaySubtitleTrackIndex === "function" ? PlayerController.getSelectedAvPlaySubtitleTrackIndex() : -1;
      const builtInTracks = textTracks.filter((_, index) => index < builtInBoundary);
      const addonTracks = textTracks.filter((_, index) => index >= builtInBoundary);
      const trackDiscoveryPending = this.isCurrentSourceAdaptiveManifest() && (this.trackDiscoveryInProgress || this.subtitleLoading || this.manifestLoading);
      if (tab === "builtIn") {
        if (avplaySubtitleTracks.length) {
          return [
            {
              id: "subtitle-off",
              label: "None",
              secondary: "",
              selected: selectedAvPlaySubtitleTrack < 0,
              trackIndex: -1,
              avplaySubtitleTrackIndex: -1
            },
            ...avplaySubtitleTracks.map((track, index) => {
              const avplayTrackIndex = Number(track == null ? void 0 : track.avplayTrackIndex);
              const normalizedTrackIndex = Number.isFinite(avplayTrackIndex) ? avplayTrackIndex : index;
              return {
                id: `subtitle-avplay-${normalizedTrackIndex}`,
                label: (track == null ? void 0 : track.label) || `Subtitle ${index + 1}`,
                secondary: String((track == null ? void 0 : track.language) || "").toUpperCase(),
                selected: normalizedTrackIndex === selectedAvPlaySubtitleTrack,
                trackIndex: null,
                avplaySubtitleTrackIndex: normalizedTrackIndex
              };
            })
          ];
        }
        if (dashSubtitleTracks.length) {
          return [
            {
              id: "subtitle-off",
              label: "None",
              secondary: "",
              selected: selectedDashSubtitleTrack < 0,
              trackIndex: -1,
              dashSubtitleTrackIndex: -1
            },
            ...dashSubtitleTracks.map((track, index) => {
              var _a;
              return {
                id: `subtitle-dash-${index}-${(_a = track == null ? void 0 : track.id) != null ? _a : ""}`,
                label: (track == null ? void 0 : track.label) || `Subtitle ${index + 1}`,
                secondary: String((track == null ? void 0 : track.language) || "").toUpperCase(),
                selected: index === selectedDashSubtitleTrack,
                trackIndex: null,
                dashSubtitleTrackIndex: index
              };
            })
          ];
        }
        if (!builtInTracks.length && this.manifestSubtitleTracks.length) {
          return [
            {
              id: "subtitle-off",
              label: "None",
              secondary: "",
              selected: !this.selectedManifestSubtitleTrackId,
              trackIndex: -1,
              manifestSubtitleTrackId: null
            },
            ...this.manifestSubtitleTracks.map((track) => ({
              id: `subtitle-manifest-${track.id}`,
              label: track.name || "Subtitle",
              secondary: String(track.language || "").toUpperCase(),
              selected: this.selectedManifestSubtitleTrackId === track.id,
              trackIndex: null,
              manifestSubtitleTrackId: track.id
            }))
          ];
        }
        const entries = [
          {
            id: "subtitle-off",
            label: "None",
            secondary: "",
            selected: this.selectedSubtitleTrackIndex < 0 && !this.selectedManifestSubtitleTrackId,
            trackIndex: -1
          },
          ...builtInTracks.map((track, index) => ({
            id: `subtitle-built-${index}`,
            label: track.label || `Subtitle ${index + 1}`,
            secondary: String(track.language || "").toUpperCase(),
            selected: index === this.selectedSubtitleTrackIndex,
            trackIndex: index
          }))
        ];
        if (builtInTracks.length || !trackDiscoveryPending) {
          return entries;
        }
        return [
          ...entries,
          {
            id: "subtitle-builtin-loading",
            label: "Loading subtitle tracks...",
            secondary: "",
            selected: false,
            disabled: true,
            trackIndex: null
          }
        ];
      }
      if (tab === "addons") {
        if (!addonTracks.length) {
          if (this.subtitles.length) {
            return this.subtitles.slice(0, 16).map((subtitle, index) => {
              const subtitleId = subtitle.id || subtitle.url || `subtitle-${index}`;
              return {
                id: `subtitle-addon-fallback-${subtitleId}`,
                label: subtitle.lang || `Addon subtitle ${index + 1}`,
                secondary: subtitle.addonName || "Addon",
                selected: this.selectedAddonSubtitleId === subtitleId,
                trackIndex: null,
                subtitleIndex: index,
                fallbackAddonSubtitle: true
              };
            });
          }
          if (this.subtitleLoading || this.trackDiscoveryInProgress) {
            return [
              {
                id: "subtitle-addon-loading",
                label: "Loading addon subtitles...",
                secondary: "",
                selected: false,
                disabled: true,
                trackIndex: null
              }
            ];
          }
          return [
            {
              id: "subtitle-addon-empty",
              label: this.getUnavailableTrackMessage("subtitle"),
              secondary: "",
              selected: false,
              disabled: true,
              trackIndex: null
            }
          ];
        }
        return addonTracks.map((track, relativeIndex) => {
          const absoluteIndex = builtInBoundary + relativeIndex;
          return {
            id: `subtitle-addon-${absoluteIndex}`,
            label: track.label || `Addon subtitle ${relativeIndex + 1}`,
            secondary: String(track.language || "").toUpperCase(),
            selected: absoluteIndex === this.selectedSubtitleTrackIndex,
            trackIndex: absoluteIndex
          };
        });
      }
      if (tab === "style") {
        return [
          {
            id: "subtitle-style-default",
            label: "Default",
            secondary: "System style",
            selected: true,
            disabled: true,
            trackIndex: null
          }
        ];
      }
      return [
        {
          id: "subtitle-delay-default",
          label: "0.0s",
          secondary: "Delay control not available in web player",
          selected: true,
          disabled: true,
          trackIndex: null
        }
      ];
    },
    openSubtitleDialog() {
      this.cancelSeekPreview({ commit: false });
      this.syncTrackState();
      this.subtitleDialogVisible = true;
      this.audioDialogVisible = false;
      this.sourcesPanelVisible = false;
      const textTracks = this.getTextTracks();
      const builtInBoundary = this.resolveBuiltInSubtitleBoundary(textTracks);
      const dashSubtitleTracks = typeof PlayerController.getDashTextTracks === "function" ? PlayerController.getDashTextTracks() : [];
      const avplaySubtitleTracks = typeof PlayerController.getAvPlaySubtitleTracks === "function" ? PlayerController.getAvPlaySubtitleTracks() : [];
      const hasBuiltInTracks = builtInBoundary > 0 || avplaySubtitleTracks.length > 0 || dashSubtitleTracks.length > 0;
      const hasAddonTracks = textTracks.length > builtInBoundary || this.subtitles.length > 0;
      this.subtitleDialogTab = !hasBuiltInTracks && hasAddonTracks ? "addons" : "builtIn";
      let entries = this.getSubtitleEntries(this.subtitleDialogTab);
      if (!hasBuiltInTracks && !hasAddonTracks && !this.manifestSubtitleTracks.length) {
        this.ensureTrackDataWarmup();
        entries = this.getSubtitleEntries(this.subtitleDialogTab);
      }
      const selected = entries.findIndex((entry) => entry.selected);
      this.subtitleDialogIndex = Math.max(0, selected >= 0 ? selected : 0);
      this.setControlsVisible(true, { focus: false });
      this.renderSubtitleDialog();
      this.renderAudioDialog();
      this.renderSourcesPanel();
      this.updateModalBackdrop();
    },
    closeSubtitleDialog() {
      this.subtitleDialogVisible = false;
      this.renderSubtitleDialog();
      this.updateModalBackdrop();
      this.resetControlsAutoHide();
    },
    cycleSubtitleTab(delta) {
      const tabs = this.getSubtitleTabs();
      const index = tabs.findIndex((tab) => tab.id === this.subtitleDialogTab);
      const nextIndex = clamp(index + delta, 0, tabs.length - 1);
      this.subtitleDialogTab = tabs[nextIndex].id;
      const entries = this.getSubtitleEntries(this.subtitleDialogTab);
      const selected = entries.findIndex((entry) => entry.selected);
      this.subtitleDialogIndex = Math.max(0, selected >= 0 ? selected : 0);
      this.renderSubtitleDialog();
    },
    applySubtitleEntry(entry) {
      if (!entry || entry.disabled) {
        return;
      }
      if (Object.prototype.hasOwnProperty.call(entry, "avplaySubtitleTrackIndex")) {
        const targetTrackIndex = Number(entry.avplaySubtitleTrackIndex);
        const applied = typeof PlayerController.setAvPlaySubtitleTrack === "function" ? PlayerController.setAvPlaySubtitleTrack(targetTrackIndex) : false;
        if (!applied) {
          return;
        }
        this.selectedSubtitleTrackIndex = Number.isFinite(targetTrackIndex) ? targetTrackIndex : -1;
        this.selectedAddonSubtitleId = null;
        this.renderControlButtons();
        this.renderSubtitleDialog();
        return;
      }
      if (Object.prototype.hasOwnProperty.call(entry, "dashSubtitleTrackIndex")) {
        const targetTrackIndex = Number(entry.dashSubtitleTrackIndex);
        const applied = typeof PlayerController.setDashTextTrack === "function" ? PlayerController.setDashTextTrack(targetTrackIndex) : false;
        if (!applied) {
          return;
        }
        this.selectedSubtitleTrackIndex = Number.isFinite(targetTrackIndex) ? targetTrackIndex : -1;
        this.selectedAddonSubtitleId = null;
        this.renderControlButtons();
        this.renderSubtitleDialog();
        return;
      }
      if (Object.prototype.hasOwnProperty.call(entry, "manifestSubtitleTrackId")) {
        this.applyManifestTrackSelection({ subtitleTrackId: entry.manifestSubtitleTrackId });
        this.selectedSubtitleTrackIndex = -1;
        this.selectedAddonSubtitleId = null;
        this.renderControlButtons();
        this.renderSubtitleDialog();
        return;
      }
      if (entry.fallbackAddonSubtitle) {
        this.applyFallbackAddonSubtitle(entry.subtitleIndex);
        return;
      }
      const textTracks = this.getTextTracks();
      const targetIndex = Number(entry.trackIndex);
      textTracks.forEach((track, index) => {
        try {
          track.mode = index === targetIndex ? "showing" : "disabled";
        } catch (_) {
        }
      });
      if (targetIndex < 0) {
        textTracks.forEach((track) => {
          try {
            track.mode = "disabled";
          } catch (_) {
          }
        });
      }
      this.selectedAddonSubtitleId = null;
      this.selectedSubtitleTrackIndex = targetIndex;
      this.renderControlButtons();
      this.renderSubtitleDialog();
    },
    applyFallbackAddonSubtitle(subtitleIndex) {
      const subtitle = this.subtitles[subtitleIndex];
      if (!(subtitle == null ? void 0 : subtitle.url)) {
        return;
      }
      const usingAvPlay = typeof PlayerController.isUsingAvPlay === "function" ? PlayerController.isUsingAvPlay() : false;
      if (usingAvPlay) {
        const applied = typeof PlayerController.setAvPlayExternalSubtitle === "function" ? PlayerController.setAvPlayExternalSubtitle(subtitle.url) : false;
        if (applied) {
          this.selectedAddonSubtitleId = subtitle.id || subtitle.url || `subtitle-${subtitleIndex}`;
          this.selectedSubtitleTrackIndex = -1;
          this.renderControlButtons();
          this.renderSubtitleDialog();
          return;
        }
      }
      const video = PlayerController.video;
      if (!video) {
        return;
      }
      this.externalTrackNodes.forEach((node) => node.remove());
      this.externalTrackNodes = [];
      const track = document.createElement("track");
      track.kind = "subtitles";
      track.label = subtitle.lang || `Sub ${subtitleIndex + 1}`;
      track.srclang = (subtitle.lang || "und").slice(0, 2).toLowerCase();
      track.src = subtitle.url;
      track.default = true;
      video.appendChild(track);
      this.externalTrackNodes.push(track);
      if (this.subtitleSelectionTimer) {
        clearTimeout(this.subtitleSelectionTimer);
        this.subtitleSelectionTimer = null;
      }
      this.subtitleSelectionTimer = setTimeout(() => {
        const textTracks = this.getTextTracks();
        const builtInBoundary = this.resolveBuiltInSubtitleBoundary(textTracks);
        if (textTracks.length > builtInBoundary) {
          textTracks.forEach((textTrack, index) => {
            try {
              textTrack.mode = index === builtInBoundary ? "showing" : "disabled";
            } catch (_) {
            }
          });
        }
        this.refreshTrackDialogs();
      }, 160);
      this.selectedAddonSubtitleId = subtitle.id || subtitle.url || `subtitle-${subtitleIndex}`;
      this.renderControlButtons();
      this.renderSubtitleDialog();
    },
    renderSubtitleDialog() {
      const dialog = this.container.querySelector("#playerSubtitleDialog");
      if (!dialog) {
        return;
      }
      dialog.classList.toggle("hidden", !this.subtitleDialogVisible);
      if (!this.subtitleDialogVisible) {
        dialog.innerHTML = "";
        return;
      }
      const tabs = this.getSubtitleTabs();
      const entries = this.getSubtitleEntries(this.subtitleDialogTab);
      const focusIndex = clamp(this.subtitleDialogIndex, 0, Math.max(0, entries.length - 1));
      this.subtitleDialogIndex = focusIndex;
      dialog.innerHTML = `
      <div class="player-dialog-title">Subtitles</div>
      <div class="player-dialog-tabs">
        ${tabs.map((tab) => `
          <div class="player-dialog-tab${tab.id === this.subtitleDialogTab ? " selected" : ""}">
            ${escapeHtml(tab.label)}
          </div>
        `).join("")}
      </div>
      <div class="player-dialog-list">
        ${entries.map((entry, index) => `
          <div class="player-dialog-item${entry.selected ? " selected" : ""}${index === focusIndex ? " focused" : ""}${entry.disabled ? " disabled" : ""}">
            <div class="player-dialog-item-main">${escapeHtml(entry.label || "")}</div>
            <div class="player-dialog-item-sub">${escapeHtml(entry.secondary || "")}</div>
            <div class="player-dialog-item-check">${entry.selected ? "&#10003;" : ""}</div>
          </div>
        `).join("")}
      </div>
    `;
    },
    handleSubtitleDialogKey(event) {
      const keyCode = Number((event == null ? void 0 : event.keyCode) || 0);
      const entries = this.getSubtitleEntries(this.subtitleDialogTab);
      if (keyCode === 37) {
        this.cycleSubtitleTab(-1);
        return true;
      }
      if (keyCode === 39) {
        this.cycleSubtitleTab(1);
        return true;
      }
      if (keyCode === 38) {
        this.subtitleDialogIndex = clamp(this.subtitleDialogIndex - 1, 0, Math.max(0, entries.length - 1));
        this.renderSubtitleDialog();
        return true;
      }
      if (keyCode === 40) {
        this.subtitleDialogIndex = clamp(this.subtitleDialogIndex + 1, 0, Math.max(0, entries.length - 1));
        this.renderSubtitleDialog();
        return true;
      }
      if (keyCode === 13) {
        this.applySubtitleEntry(entries[this.subtitleDialogIndex]);
        return true;
      }
      return false;
    },
    getAudioEntries() {
      const avplayAudioTracks = typeof PlayerController.getAvPlayAudioTracks === "function" ? PlayerController.getAvPlayAudioTracks() : [];
      if (avplayAudioTracks.length) {
        const selectedAvPlayAudioTrack = typeof PlayerController.getSelectedAvPlayAudioTrackIndex === "function" ? PlayerController.getSelectedAvPlayAudioTrackIndex() : -1;
        return avplayAudioTracks.map((track, index) => {
          const avplayTrackIndex = Number(track == null ? void 0 : track.avplayTrackIndex);
          const normalizedTrackIndex = Number.isFinite(avplayTrackIndex) ? avplayTrackIndex : index;
          return {
            id: `audio-avplay-${normalizedTrackIndex}`,
            label: (track == null ? void 0 : track.label) || `Track ${index + 1}`,
            secondary: String((track == null ? void 0 : track.language) || "").toUpperCase(),
            selected: normalizedTrackIndex === selectedAvPlayAudioTrack || selectedAvPlayAudioTrack < 0 && normalizedTrackIndex === this.selectedAudioTrackIndex,
            avplayAudioTrackIndex: normalizedTrackIndex
          };
        });
      }
      const dashAudioTracks = typeof PlayerController.getDashAudioTracks === "function" ? PlayerController.getDashAudioTracks() : [];
      if (dashAudioTracks.length) {
        const selectedDashAudioTrack = typeof PlayerController.getSelectedDashAudioTrackIndex === "function" ? PlayerController.getSelectedDashAudioTrackIndex() : -1;
        return dashAudioTracks.map((track, index) => {
          var _a;
          return {
            id: `audio-dash-${index}-${(_a = track == null ? void 0 : track.id) != null ? _a : ""}`,
            label: (track == null ? void 0 : track.label) || `Track ${index + 1}`,
            secondary: String((track == null ? void 0 : track.language) || "").toUpperCase(),
            selected: index === selectedDashAudioTrack || selectedDashAudioTrack < 0 && index === this.selectedAudioTrackIndex,
            dashAudioTrackIndex: index
          };
        });
      }
      const hlsAudioTracks = typeof PlayerController.getHlsAudioTracks === "function" ? PlayerController.getHlsAudioTracks() : [];
      if (hlsAudioTracks.length) {
        const selectedHlsAudioTrack = typeof PlayerController.getSelectedHlsAudioTrackIndex === "function" ? PlayerController.getSelectedHlsAudioTrackIndex() : -1;
        return hlsAudioTracks.map((track, index) => {
          var _a, _b, _c;
          return {
            id: `audio-hls-${index}-${(_c = (_b = (_a = track == null ? void 0 : track.id) != null ? _a : track == null ? void 0 : track.name) != null ? _b : track == null ? void 0 : track.lang) != null ? _c : ""}`,
            label: (track == null ? void 0 : track.name) || (track == null ? void 0 : track.lang) || (track == null ? void 0 : track.language) || `Track ${index + 1}`,
            secondary: String((track == null ? void 0 : track.lang) || (track == null ? void 0 : track.language) || "").toUpperCase(),
            selected: index === selectedHlsAudioTrack || selectedHlsAudioTrack < 0 && index === this.selectedAudioTrackIndex,
            hlsAudioTrackIndex: index
          };
        });
      }
      const audioTracks = this.getAudioTracks();
      if (audioTracks.length) {
        return audioTracks.map((track, index) => ({
          id: `audio-track-${index}`,
          label: track.label || `Track ${index + 1}`,
          secondary: String(track.language || "").toUpperCase(),
          selected: index === this.selectedAudioTrackIndex,
          audioTrackIndex: index
        }));
      }
      if (this.manifestAudioTracks.length) {
        return this.manifestAudioTracks.map((track) => ({
          id: `audio-manifest-${track.id}`,
          label: track.name || "Audio",
          secondary: String(track.language || "").toUpperCase(),
          selected: this.selectedManifestAudioTrackId === track.id,
          manifestAudioTrackId: track.id
        }));
      }
      return [];
    },
    openAudioDialog() {
      this.cancelSeekPreview({ commit: false });
      this.syncTrackState();
      this.audioDialogVisible = true;
      this.subtitleDialogVisible = false;
      this.sourcesPanelVisible = false;
      let entries = this.getAudioEntries();
      if (!entries.length) {
        this.ensureTrackDataWarmup();
        entries = this.getAudioEntries();
      }
      const selectedEntry = entries.findIndex((entry) => entry.selected);
      this.audioDialogIndex = Math.max(0, selectedEntry >= 0 ? selectedEntry : 0);
      this.setControlsVisible(true, { focus: false });
      this.renderSubtitleDialog();
      this.renderAudioDialog();
      this.renderSourcesPanel();
      this.updateModalBackdrop();
    },
    closeAudioDialog() {
      this.audioDialogVisible = false;
      this.renderAudioDialog();
      this.updateModalBackdrop();
      this.resetControlsAutoHide();
    },
    applyAudioTrack(index) {
      const entries = this.getAudioEntries();
      const selectedEntry = entries[index] || null;
      if (!selectedEntry) {
        return;
      }
      if (Number.isFinite(selectedEntry.avplayAudioTrackIndex)) {
        const applied = typeof PlayerController.setAvPlayAudioTrack === "function" ? PlayerController.setAvPlayAudioTrack(selectedEntry.avplayAudioTrackIndex) : false;
        if (applied) {
          this.selectedAudioTrackIndex = selectedEntry.avplayAudioTrackIndex;
          this.refreshTrackDialogs();
        }
        return;
      }
      if (Number.isFinite(selectedEntry.dashAudioTrackIndex)) {
        const applied = typeof PlayerController.setDashAudioTrack === "function" ? PlayerController.setDashAudioTrack(selectedEntry.dashAudioTrackIndex) : false;
        if (applied) {
          this.selectedAudioTrackIndex = selectedEntry.dashAudioTrackIndex;
          this.refreshTrackDialogs();
        }
        return;
      }
      if (Number.isFinite(selectedEntry.hlsAudioTrackIndex)) {
        const applied = typeof PlayerController.setHlsAudioTrack === "function" ? PlayerController.setHlsAudioTrack(selectedEntry.hlsAudioTrackIndex) : false;
        if (applied) {
          this.selectedAudioTrackIndex = selectedEntry.hlsAudioTrackIndex;
          this.refreshTrackDialogs();
        }
        return;
      }
      if (selectedEntry.manifestAudioTrackId) {
        this.applyManifestTrackSelection({ audioTrackId: selectedEntry.manifestAudioTrackId });
        this.renderControlButtons();
        this.renderAudioDialog();
        return;
      }
      const audioTracks = this.getAudioTracks();
      const nativeTrackIndex = Number(selectedEntry.audioTrackIndex);
      if (!audioTracks.length || !Number.isFinite(nativeTrackIndex) || nativeTrackIndex < 0 || nativeTrackIndex >= audioTracks.length) {
        return;
      }
      audioTracks.forEach((track, trackIndex) => {
        const selected = trackIndex === nativeTrackIndex;
        try {
          if ("enabled" in track) {
            track.enabled = selected;
          }
        } catch (_) {
        }
        try {
          if ("selected" in track) {
            track.selected = selected;
          }
        } catch (_) {
        }
      });
      this.selectedAudioTrackIndex = nativeTrackIndex;
      this.renderControlButtons();
      this.renderAudioDialog();
    },
    renderAudioDialog() {
      const dialog = this.container.querySelector("#playerAudioDialog");
      if (!dialog) {
        return;
      }
      dialog.classList.toggle("hidden", !this.audioDialogVisible);
      if (!this.audioDialogVisible) {
        dialog.innerHTML = "";
        return;
      }
      const entries = this.getAudioEntries();
      if (!entries.length) {
        const loading = this.isCurrentSourceAdaptiveManifest() && (this.manifestLoading || this.trackDiscoveryInProgress);
        const emptyMessage = loading ? "Loading audio tracks..." : this.getUnavailableTrackMessage("audio");
        dialog.innerHTML = `
        <div class="player-dialog-title">Audio</div>
        <div class="player-dialog-empty">${emptyMessage}</div>
      `;
        return;
      }
      this.audioDialogIndex = clamp(this.audioDialogIndex, 0, entries.length - 1);
      dialog.innerHTML = `
      <div class="player-dialog-title">Audio</div>
      <div class="player-dialog-list">
        ${entries.map((entry, index) => {
        const selected = entry.selected;
        const focused = index === this.audioDialogIndex;
        return `
            <div class="player-dialog-item${selected ? " selected" : ""}${focused ? " focused" : ""}">
              <div class="player-dialog-item-main">${escapeHtml(entry.label || "")}</div>
              <div class="player-dialog-item-sub">${escapeHtml(entry.secondary || "")}</div>
              <div class="player-dialog-item-check">${selected ? "&#10003;" : ""}</div>
            </div>
          `;
      }).join("")}
      </div>
    `;
    },
    handleAudioDialogKey(event) {
      const keyCode = Number((event == null ? void 0 : event.keyCode) || 0);
      const entries = this.getAudioEntries();
      if (!entries.length) {
        return true;
      }
      if (keyCode === 38) {
        this.audioDialogIndex = clamp(this.audioDialogIndex - 1, 0, entries.length - 1);
        this.renderAudioDialog();
        return true;
      }
      if (keyCode === 40) {
        this.audioDialogIndex = clamp(this.audioDialogIndex + 1, 0, entries.length - 1);
        this.renderAudioDialog();
        return true;
      }
      if (keyCode === 13) {
        this.applyAudioTrack(this.audioDialogIndex);
        return true;
      }
      return false;
    },
    getSourceFilters() {
      const addons = Array.from(new Set(this.streamCandidates.map((stream) => stream.addonName).filter(Boolean)));
      return ["all", ...addons];
    },
    getFilteredSources() {
      if (this.sourceFilter === "all") {
        return this.streamCandidates;
      }
      return this.streamCandidates.filter((stream) => stream.addonName === this.sourceFilter);
    },
    ensureSourcesFocus() {
      const filters = this.getSourceFilters();
      const list = this.getFilteredSources();
      if (!this.sourcesFocus || !["top", "filter", "list"].includes(this.sourcesFocus.zone)) {
        this.sourcesFocus = { zone: "filter", index: 0 };
      }
      if (this.sourcesFocus.zone === "top") {
        this.sourcesFocus.index = clamp(this.sourcesFocus.index, 0, 1);
        return;
      }
      if (this.sourcesFocus.zone === "filter") {
        this.sourcesFocus.index = clamp(this.sourcesFocus.index, 0, Math.max(0, filters.length - 1));
        return;
      }
      this.sourcesFocus.index = clamp(this.sourcesFocus.index, 0, Math.max(0, list.length - 1));
      if (!list.length && filters.length) {
        this.sourcesFocus = { zone: "filter", index: 0 };
      }
    },
    setSourceFilter(filter) {
      const available = this.getSourceFilters();
      if (!available.includes(filter)) {
        this.sourceFilter = "all";
        return;
      }
      this.sourceFilter = filter;
      this.sourcesFocus = { zone: "filter", index: clamp(available.indexOf(filter), 0, available.length - 1) };
    },
    openSourcesPanel({ forceReload = false } = {}) {
      this.cancelSeekPreview({ commit: false });
      this.sourcesPanelVisible = true;
      this.subtitleDialogVisible = false;
      this.audioDialogVisible = false;
      this.moreActionsVisible = false;
      const filters = this.getSourceFilters();
      this.sourcesFocus = { zone: "filter", index: clamp(filters.indexOf(this.sourceFilter), 0, Math.max(0, filters.length - 1)) };
      this.renderControlButtons();
      this.renderSubtitleDialog();
      this.renderAudioDialog();
      this.renderSourcesPanel();
      this.updateModalBackdrop();
      if (forceReload || !this.streamCandidates.length) {
        this.reloadSources();
      }
    },
    closeSourcesPanel() {
      this.sourcesPanelVisible = false;
      this.sourcesError = "";
      this.renderSourcesPanel();
      this.updateModalBackdrop();
      this.resetControlsAutoHide();
    },
    async reloadSources() {
      var _a, _b, _c, _d, _e, _f, _g, _h;
      if (this.sourcesLoading) {
        return;
      }
      const type = normalizeItemType(((_a = this.params) == null ? void 0 : _a.itemType) || "movie");
      const videoId = String(((_b = this.params) == null ? void 0 : _b.videoId) || ((_c = this.params) == null ? void 0 : _c.itemId) || "");
      if (!videoId) {
        return;
      }
      const token = this.sourceLoadToken + 1;
      this.sourceLoadToken = token;
      this.sourcesLoading = true;
      this.sourcesError = "";
      this.renderSourcesPanel();
      const options = {
        itemId: String(((_d = this.params) == null ? void 0 : _d.itemId) || ""),
        season: (_f = (_e = this.params) == null ? void 0 : _e.season) != null ? _f : null,
        episode: (_h = (_g = this.params) == null ? void 0 : _g.episode) != null ? _h : null,
        onChunk: (chunkResult) => {
          if (token !== this.sourceLoadToken) {
            return;
          }
          const chunkItems = flattenStreamGroups(chunkResult);
          if (!chunkItems.length) {
            return;
          }
          this.streamCandidates = mergeStreamItems(this.streamCandidates, chunkItems);
          this.renderSourcesPanel();
        }
      };
      try {
        const result = await streamRepository.getStreamsFromAllAddons(type, videoId, options);
        if (token !== this.sourceLoadToken) {
          return;
        }
        const merged = mergeStreamItems(this.streamCandidates, flattenStreamGroups(result));
        if (merged.length) {
          this.streamCandidates = merged;
        }
      } catch (error) {
        if (token === this.sourceLoadToken) {
          this.sourcesError = "Failed to load sources";
        }
      } finally {
        if (token === this.sourceLoadToken) {
          this.sourcesLoading = false;
          this.renderSourcesPanel();
        }
      }
    },
    renderSourcesPanel() {
      const panel = this.container.querySelector("#playerSourcesPanel");
      if (!panel) {
        return;
      }
      panel.classList.toggle("hidden", !this.sourcesPanelVisible);
      if (!this.sourcesPanelVisible) {
        panel.innerHTML = "";
        return;
      }
      const filters = this.getSourceFilters();
      const filtered = this.getFilteredSources();
      this.ensureSourcesFocus();
      panel.innerHTML = `
      <div class="player-sources-header">
        <div class="player-sources-title">Sources</div>
        <div class="player-sources-actions">
          <button class="player-sources-top-btn${this.sourcesFocus.zone === "top" && this.sourcesFocus.index === 0 ? " focused" : ""}" data-top-action="reload">Reload</button>
          <button class="player-sources-top-btn${this.sourcesFocus.zone === "top" && this.sourcesFocus.index === 1 ? " focused" : ""}" data-top-action="close">Close</button>
        </div>
      </div>

      <div class="player-sources-filters">
        ${filters.map((filter, index) => {
        const selected = this.sourceFilter === filter;
        const focused = this.sourcesFocus.zone === "filter" && this.sourcesFocus.index === index;
        return `
            <div class="player-sources-filter${selected ? " selected" : ""}${focused ? " focused" : ""}">
              ${escapeHtml(filter === "all" ? "All" : filter)}
            </div>
          `;
      }).join("")}
      </div>

      <div class="player-sources-list">
        ${this.sourcesLoading ? `<div class="player-sources-empty">Loading sources...</div>` : ""}
        ${this.sourcesError ? `<div class="player-sources-empty">${escapeHtml(this.sourcesError)}</div>` : ""}
        ${!this.sourcesLoading && !filtered.length ? `<div class="player-sources-empty">No sources found.</div>` : filtered.map((stream, index) => {
        var _a;
        const focused = this.sourcesFocus.zone === "list" && this.sourcesFocus.index === index;
        const isCurrent = ((_a = this.streamCandidates[this.currentStreamIndex]) == null ? void 0 : _a.url) === stream.url;
        return `
              <article class="player-source-card${focused ? " focused" : ""}${isCurrent ? " selected" : ""}">
                <div class="player-source-main">
                  <div class="player-source-title">${escapeHtml(stream.label || "Stream")}</div>
                  <div class="player-source-desc">${escapeHtml(stream.description || stream.addonName || "")}</div>
                  <div class="player-source-tags">
                    <span class="player-source-tag">${escapeHtml(qualityLabelFromText(`${stream.label} ${stream.description}`))}</span>
                    <span class="player-source-tag">${escapeHtml(String(stream.sourceType || "stream") || "stream")}</span>
                  </div>
                </div>
                <div class="player-source-side">
                  <div class="player-source-addon">${escapeHtml(stream.addonName || "Addon")}</div>
                  ${isCurrent ? `<div class="player-source-playing">Playing</div>` : ""}
                </div>
              </article>
            `;
      }).join("")}
      </div>
    `;
      const focusedCard = panel.querySelector(".player-source-card.focused");
      if (focusedCard) {
        focusedCard.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    },
    moveSourcesFocus(direction) {
      const filters = this.getSourceFilters();
      const list = this.getFilteredSources();
      const zone = this.sourcesFocus.zone;
      let index = Number(this.sourcesFocus.index || 0);
      if (zone === "top") {
        if (direction === "left") {
          this.sourcesFocus = { zone: "top", index: clamp(index - 1, 0, 1) };
          return;
        }
        if (direction === "right") {
          this.sourcesFocus = { zone: "top", index: clamp(index + 1, 0, 1) };
          return;
        }
        if (direction === "down") {
          if (filters.length) {
            this.sourcesFocus = { zone: "filter", index: clamp(filters.indexOf(this.sourceFilter), 0, filters.length - 1) };
          } else if (list.length) {
            this.sourcesFocus = { zone: "list", index: 0 };
          }
          return;
        }
        return;
      }
      if (zone === "filter") {
        if (direction === "left") {
          this.sourcesFocus = { zone: "filter", index: clamp(index - 1, 0, Math.max(0, filters.length - 1)) };
          return;
        }
        if (direction === "right") {
          this.sourcesFocus = { zone: "filter", index: clamp(index + 1, 0, Math.max(0, filters.length - 1)) };
          return;
        }
        if (direction === "up") {
          this.sourcesFocus = { zone: "top", index: 0 };
          return;
        }
        if (direction === "down" && list.length) {
          this.sourcesFocus = { zone: "list", index: clamp(index, 0, list.length - 1) };
        }
        return;
      }
      if (zone === "list") {
        if (direction === "up") {
          if (index > 0) {
            this.sourcesFocus = { zone: "list", index: index - 1 };
          } else if (filters.length) {
            this.sourcesFocus = { zone: "filter", index: clamp(filters.indexOf(this.sourceFilter), 0, filters.length - 1) };
          } else {
            this.sourcesFocus = { zone: "top", index: 0 };
          }
          return;
        }
        if (direction === "down") {
          this.sourcesFocus = { zone: "list", index: clamp(index + 1, 0, Math.max(0, list.length - 1)) };
        }
      }
    },
    async activateSourcesFocus() {
      const zone = this.sourcesFocus.zone;
      const index = Number(this.sourcesFocus.index || 0);
      const filters = this.getSourceFilters();
      const list = this.getFilteredSources();
      if (zone === "top") {
        if (index === 0) {
          await this.reloadSources();
          return;
        }
        this.closeSourcesPanel();
        return;
      }
      if (zone === "filter") {
        const selected = filters[clamp(index, 0, Math.max(0, filters.length - 1))] || "all";
        this.setSourceFilter(selected);
        this.renderSourcesPanel();
        return;
      }
      const selectedStream = list[clamp(index, 0, Math.max(0, list.length - 1))] || null;
      if (selectedStream == null ? void 0 : selectedStream.url) {
        await this.playStreamByUrl(selectedStream.url);
      }
    },
    async handleSourcesPanelKey(event) {
      const keyCode = Number((event == null ? void 0 : event.keyCode) || 0);
      if (keyCode === 82) {
        await this.reloadSources();
        return true;
      }
      if (keyCode === 37) {
        this.moveSourcesFocus("left");
        this.renderSourcesPanel();
        return true;
      }
      if (keyCode === 39) {
        this.moveSourcesFocus("right");
        this.renderSourcesPanel();
        return true;
      }
      if (keyCode === 38) {
        this.moveSourcesFocus("up");
        this.renderSourcesPanel();
        return true;
      }
      if (keyCode === 40) {
        this.moveSourcesFocus("down");
        this.renderSourcesPanel();
        return true;
      }
      if (keyCode === 13) {
        await this.activateSourcesFocus();
        return true;
      }
      return false;
    },
    showAspectToast(label) {
      const toast = this.container.querySelector("#playerAspectToast");
      if (!toast) {
        return;
      }
      toast.textContent = label;
      toast.classList.remove("hidden");
      if (this.aspectToastTimer) {
        clearTimeout(this.aspectToastTimer);
      }
      this.aspectToastTimer = setTimeout(() => {
        toast.classList.add("hidden");
      }, 1400);
    },
    applyAspectMode({ showToast = false } = {}) {
      const mode = this.aspectModes[this.aspectModeIndex] || this.aspectModes[0];
      const video = PlayerController.video;
      if (video) {
        video.style.objectFit = mode.objectFit;
      }
      if (showToast) {
        this.showAspectToast(mode.label);
      }
    },
    cycleAspectMode() {
      this.aspectModeIndex = (this.aspectModeIndex + 1) % this.aspectModes.length;
      this.applyAspectMode({ showToast: true });
    },
    renderParentalGuideOverlay() {
      const overlay = this.container.querySelector("#playerParentalGuide");
      if (!overlay) {
        return;
      }
      overlay.classList.toggle("hidden", !this.parentalGuideVisible || !this.parentalWarnings.length);
      if (!this.parentalGuideVisible || !this.parentalWarnings.length) {
        overlay.innerHTML = "";
        return;
      }
      overlay.innerHTML = `
      <div class="player-parental-line"></div>
      <div class="player-parental-list">
        ${this.parentalWarnings.map((warning, index) => `
          <div class="player-parental-item" style="animation-delay:${index * 120}ms">
            <span class="player-parental-label">${escapeHtml(warning.label)}</span>
            <span class="player-parental-severity">${escapeHtml(warning.severity)}</span>
          </div>
        `).join("")}
      </div>
    `;
    },
    showParentalGuideOverlay() {
      if (!this.parentalWarnings.length) {
        return;
      }
      this.parentalGuideVisible = true;
      this.parentalGuideShown = true;
      this.renderParentalGuideOverlay();
      if (this.parentalGuideTimer) {
        clearTimeout(this.parentalGuideTimer);
      }
      this.parentalGuideTimer = setTimeout(() => {
        this.parentalGuideVisible = false;
        this.renderParentalGuideOverlay();
      }, 5200);
    },
    toggleEpisodePanel() {
      if (!this.episodes.length) {
        return;
      }
      if (this.episodePanelVisible) {
        this.hideEpisodePanel();
        return;
      }
      this.episodePanelVisible = true;
      this.subtitleDialogVisible = false;
      this.audioDialogVisible = false;
      this.sourcesPanelVisible = false;
      this.updateModalBackdrop();
      this.setControlsVisible(true, { focus: false });
      this.renderSubtitleDialog();
      this.renderAudioDialog();
      this.renderSourcesPanel();
      this.renderEpisodePanel();
    },
    moveEpisodePanel(delta) {
      if (!this.episodePanelVisible || !this.episodes.length) {
        return;
      }
      const lastIndex = this.episodes.length - 1;
      this.episodePanelIndex = clamp(this.episodePanelIndex + delta, 0, lastIndex);
      this.renderEpisodePanel();
    },
    renderEpisodePanel() {
      var _a;
      (_a = this.container.querySelector("#episodeSidePanel")) == null ? void 0 : _a.remove();
      if (!this.episodePanelVisible) {
        return;
      }
      const panel = document.createElement("div");
      panel.id = "episodeSidePanel";
      panel.className = "player-episode-panel";
      const cards = this.episodes.slice(0, 80).map((episode, index) => {
        const selected = index === this.episodePanelIndex;
        const selectedClass = selected ? " selected" : "";
        return `
        <div class="player-episode-item${selectedClass}">
          <div class="player-episode-item-title">S${episode.season}E${episode.episode} ${escapeHtml(episode.title || "Episode")}</div>
          <div class="player-episode-item-subtitle">${escapeHtml(episode.overview || "")}</div>
        </div>
      `;
      }).join("");
      panel.innerHTML = `
      <div class="player-episode-panel-title">Episodes</div>
      <div class="player-episode-panel-hint">UP/DOWN select, OK play, BACK close</div>
      ${cards}
    `;
      this.container.appendChild(panel);
    },
    hideEpisodePanel() {
      var _a, _b;
      this.episodePanelVisible = false;
      (_b = (_a = this.container) == null ? void 0 : _a.querySelector("#episodeSidePanel")) == null ? void 0 : _b.remove();
      this.resetControlsAutoHide();
    },
    async playEpisodeFromPanel() {
      var _a, _b, _c, _d, _e, _f, _g, _h;
      if (this.switchingEpisode || !this.episodes.length) {
        return;
      }
      const selected = this.episodes[this.episodePanelIndex];
      if (!(selected == null ? void 0 : selected.id)) {
        return;
      }
      this.switchingEpisode = true;
      try {
        const itemType = ((_a = this.params) == null ? void 0 : _a.itemType) || "series";
        const streamResult = await streamRepository.getStreamsFromAllAddons(normalizeItemType(itemType), selected.id);
        const streamItems = (streamResult == null ? void 0 : streamResult.status) === "success" ? flattenStreamGroups(streamResult) : [];
        if (!streamItems.length) {
          return;
        }
        const bestStream = this.selectBestStreamUrl(streamItems) || streamItems[0].url;
        const nextEpisode = this.episodes[this.episodePanelIndex + 1] || null;
        Router.navigate("player", {
          streamUrl: bestStream,
          itemId: (_b = this.params) == null ? void 0 : _b.itemId,
          itemType,
          videoId: selected.id,
          season: (_c = selected.season) != null ? _c : null,
          episode: (_d = selected.episode) != null ? _d : null,
          episodeLabel: `S${selected.season}E${selected.episode}`,
          playerTitle: ((_e = this.params) == null ? void 0 : _e.playerTitle) || ((_f = this.params) == null ? void 0 : _f.itemId),
          playerSubtitle: `${selected.title || ""}`.trim() || `S${selected.season}E${selected.episode}`,
          playerBackdropUrl: ((_g = this.params) == null ? void 0 : _g.playerBackdropUrl) || null,
          playerLogoUrl: ((_h = this.params) == null ? void 0 : _h.playerLogoUrl) || null,
          episodes: this.episodes,
          streamCandidates: streamItems,
          nextEpisodeVideoId: (nextEpisode == null ? void 0 : nextEpisode.id) || null,
          nextEpisodeLabel: nextEpisode ? `S${nextEpisode.season}E${nextEpisode.episode}` : null
        });
      } finally {
        this.switchingEpisode = false;
      }
    },
    async loadSubtitles() {
      const requestToken = (this.subtitleLoadToken || 0) + 1;
      this.subtitleLoadToken = requestToken;
      this.subtitleLoading = true;
      const sidecarSubtitles = this.collectStreamSidecarSubtitles();
      const subtitleLookup = this.buildSubtitleLookupContext();
      try {
        this.subtitles = this.mergeSubtitleCandidates(sidecarSubtitles, []);
        this.attachExternalSubtitles();
        this.refreshTrackDialogs();
        let repositorySubtitles = [];
        try {
          if (subtitleLookup.id && subtitleLookup.type) {
            repositorySubtitles = await subtitleRepository.getSubtitles(
              subtitleLookup.type,
              subtitleLookup.id,
              subtitleLookup.videoId || null
            );
          }
        } catch (error) {
          console.error("Subtitle fetch failed", error);
        }
        if (requestToken !== this.subtitleLoadToken) {
          return;
        }
        this.subtitles = this.mergeSubtitleCandidates(sidecarSubtitles, repositorySubtitles);
        this.attachExternalSubtitles();
        if (this.subtitleDialogVisible && this.subtitleDialogTab === "builtIn") {
          const builtInBoundary = this.resolveBuiltInSubtitleBoundary(this.getTextTracks());
          if (builtInBoundary <= 0 && this.subtitles.length > 0) {
            this.subtitleDialogTab = "addons";
            this.subtitleDialogIndex = 0;
          }
        }
        this.refreshTrackDialogs();
      } catch (error) {
        console.error("Subtitle attach failed", error);
        this.subtitles = this.mergeSubtitleCandidates(sidecarSubtitles, []);
        this.refreshTrackDialogs();
      } finally {
        if (requestToken === this.subtitleLoadToken) {
          this.subtitleLoading = false;
          this.refreshTrackDialogs();
        }
      }
    },
    attachExternalSubtitles() {
      const video = PlayerController.video;
      if (!video) {
        return;
      }
      this.externalTrackNodes.forEach((node) => node.remove());
      this.externalTrackNodes = [];
      this.builtInSubtitleCount = this.getTextTracks().length;
      const usingAvPlay = typeof PlayerController.isUsingAvPlay === "function" ? PlayerController.isUsingAvPlay() : false;
      if (usingAvPlay) {
        return;
      }
      this.subtitles.slice(0, 16).forEach((subtitle, index) => {
        if (!subtitle.url) {
          return;
        }
        const track = document.createElement("track");
        track.kind = "subtitles";
        track.label = subtitle.lang || `Sub ${index + 1}`;
        track.srclang = (subtitle.lang || "und").slice(0, 2).toLowerCase();
        track.src = subtitle.url;
        video.appendChild(track);
        this.externalTrackNodes.push(track);
      });
    },
    moveControlFocus(delta) {
      const controls = Array.from(this.container.querySelectorAll(".player-control-btn"));
      if (!controls.length) {
        return;
      }
      const current = this.container.querySelector(".player-control-btn.focused") || controls[0];
      let index = controls.indexOf(current);
      if (index < 0) {
        index = 0;
      }
      const nextIndex = clamp(index + delta, 0, controls.length - 1);
      if (nextIndex === index) {
        return;
      }
      current.classList.remove("focused");
      controls[nextIndex].classList.add("focused");
      controls[nextIndex].focus();
      this.resetControlsAutoHide();
    },
    performFocusedControl() {
      const current = this.container.querySelector(".player-control-btn.focused");
      if (!current) {
        return;
      }
      this.performControlAction(current.dataset.action || "");
    },
    performControlAction(action) {
      if (action === "playPause") {
        this.togglePause();
        this.renderControlButtons();
        return;
      }
      if (action === "subtitleDialog") {
        if (this.subtitleDialogVisible) {
          this.closeSubtitleDialog();
        } else {
          this.openSubtitleDialog();
        }
        return;
      }
      if (action === "audioTrack") {
        if (this.audioDialogVisible) {
          this.closeAudioDialog();
        } else {
          this.openAudioDialog();
        }
        return;
      }
      if (action === "source") {
        if (this.sourcesPanelVisible) {
          this.closeSourcesPanel();
        } else {
          this.openSourcesPanel();
        }
        return;
      }
      if (action === "episodes") {
        this.toggleEpisodePanel();
        return;
      }
      if (action === "more") {
        this.moreActionsVisible = true;
        this.renderControlButtons();
        this.focusFirstControl();
        return;
      }
      if (action === "backFromMore") {
        this.moreActionsVisible = false;
        this.renderControlButtons();
        this.focusFirstControl();
        return;
      }
      if (action === "aspect") {
        this.cycleAspectMode();
        return;
      }
    },
    consumeBackRequest() {
      if (this.seekOverlayVisible || this.seekPreviewSeconds != null) {
        this.cancelSeekPreview({ commit: false });
        return true;
      }
      if (this.sourcesPanelVisible) {
        this.closeSourcesPanel();
        return true;
      }
      if (this.subtitleDialogVisible) {
        this.closeSubtitleDialog();
        return true;
      }
      if (this.audioDialogVisible) {
        this.closeAudioDialog();
        return true;
      }
      if (this.episodePanelVisible) {
        this.hideEpisodePanel();
        return true;
      }
      if (this.moreActionsVisible) {
        this.moreActionsVisible = false;
        this.renderControlButtons();
        this.focusFirstControl();
        return true;
      }
      return false;
    },
    async onKeyDown(event) {
      var _a;
      const keyCode = Number((event == null ? void 0 : event.keyCode) || 0);
      if (keyCode === 37 || keyCode === 38 || keyCode === 39 || keyCode === 40 || keyCode === 13) {
        (_a = event == null ? void 0 : event.preventDefault) == null ? void 0 : _a.call(event);
      }
      if (this.sourcesPanelVisible) {
        if (await this.handleSourcesPanelKey(event)) {
          return;
        }
      }
      if (this.subtitleDialogVisible) {
        if (this.handleSubtitleDialogKey(event)) {
          return;
        }
      }
      if (this.audioDialogVisible) {
        if (this.handleAudioDialogKey(event)) {
          return;
        }
      }
      if (keyCode === 83) {
        if (this.subtitleDialogVisible) {
          this.closeSubtitleDialog();
        } else {
          this.openSubtitleDialog();
        }
        return;
      }
      if (keyCode === 84) {
        if (this.audioDialogVisible) {
          this.closeAudioDialog();
        } else {
          this.openAudioDialog();
        }
        return;
      }
      if (keyCode === 67) {
        if (this.sourcesPanelVisible) {
          this.closeSourcesPanel();
        } else {
          this.openSourcesPanel();
        }
        return;
      }
      if (keyCode === 69) {
        this.toggleEpisodePanel();
        return;
      }
      if (keyCode === 80) {
        this.togglePause();
        this.renderControlButtons();
        return;
      }
      if (this.episodePanelVisible) {
        if (keyCode === 38) {
          this.moveEpisodePanel(-1);
          return;
        }
        if (keyCode === 40) {
          this.moveEpisodePanel(1);
          return;
        }
        if (keyCode === 13) {
          this.playEpisodeFromPanel();
          return;
        }
      }
      if (!this.controlsVisible) {
        if (keyCode === 37) {
          this.beginSeekPreview(-1, Boolean(event == null ? void 0 : event.repeat));
          return;
        }
        if (keyCode === 39) {
          this.beginSeekPreview(1, Boolean(event == null ? void 0 : event.repeat));
          return;
        }
        if (keyCode === 38 || keyCode === 40 || keyCode === 13) {
          this.cancelSeekPreview({ commit: true });
          this.setControlsVisible(true, { focus: keyCode === 13 });
          if (keyCode === 13) {
            this.togglePause();
            this.renderControlButtons();
          }
        }
        return;
      }
      if (keyCode === 37) {
        this.moveControlFocus(-1);
        return;
      }
      if (keyCode === 39) {
        this.moveControlFocus(1);
        return;
      }
      if (keyCode === 40) {
        this.setControlsVisible(false);
        return;
      }
      if (keyCode === 13) {
        this.performFocusedControl();
        return;
      }
      this.resetControlsAutoHide();
    },
    selectBestStreamUrl(streams = []) {
      var _a, _b, _c, _d;
      if (!Array.isArray(streams) || !streams.length) {
        return null;
      }
      const hasCapabilityProbe = Boolean((_a = PlayerController) == null ? void 0 : _a.video);
      const isWebOsRuntime = Environment.isWebOS();
      const capabilities = hasCapabilityProbe && typeof PlayerController.getPlaybackCapabilities === "function" ? PlayerController.getPlaybackCapabilities() : null;
      const supports = (key, fallback = true) => {
        if (!capabilities) {
          return fallback;
        }
        return Boolean(capabilities[key]);
      };
      const scored = streams.filter((stream) => Boolean(stream == null ? void 0 : stream.url)).map((stream) => {
        const text = `${stream.title || stream.label || ""} ${stream.name || ""} ${stream.description || ""} ${stream.url || ""}`.toLowerCase();
        let score = 0;
        if (text.includes("2160") || text.includes("4k")) score += 60;
        else if (text.includes("1080")) score += 40;
        else if (text.includes("720")) score += 20;
        else if (text.includes("480")) score += 10;
        if (text.includes("web")) score += 8;
        if (text.includes("bluray")) score += 8;
        if (text.includes("cam")) score -= 70;
        if (text.includes("ts")) score -= 40;
        if (text.includes("hevc") || text.includes("h265") || text.includes("x265")) {
          score += supports("mp4Hevc", true) || supports("mp4HevcMain10", true) ? 12 : -90;
        }
        if (text.includes("av1")) {
          score += supports("mp4Av1", true) ? 10 : -80;
        }
        if (text.includes("vp9")) {
          score += supports("webmVp9", true) ? 8 : -50;
        }
        if (text.includes(".mkv") || text.includes("matroska")) {
          score += supports("mkvH264", true) ? 8 : -60;
        }
        if (text.includes(".webm")) {
          score += supports("webmVp9", true) ? 6 : -45;
        }
        if (text.includes("hdr") || text.includes("hdr10") || text.includes("hlg")) {
          score += supports("hdrLikely", true) ? 16 : -35;
        }
        if (text.includes("dolby vision") || text.includes(" dv ")) {
          score += supports("dolbyVision", true) ? 18 : -45;
        }
        if (text.includes("atmos") || text.includes("eac3") || text.includes("ec-3")) {
          score += supports("atmosLikely", true) || supports("audioEac3", true) ? 14 : -30;
        }
        if (/\b(aac|mp4a)\b/.test(text)) {
          score += 16;
        }
        if (/\b(ac3|dolby digital)\b/.test(text) && !/\b(eac3|ec-3|ddp|atmos)\b/.test(text)) {
          score += 10;
        }
        if (/\b(eac3|ec-3|ddp|atmos)\b/.test(text)) {
          score += isWebOsRuntime ? -70 : -18;
        }
        if (/\b(truehd|dts-hd|dts:x|dts)\b/.test(text)) {
          score += isWebOsRuntime ? -85 : -40;
        }
        if (/\b(stereo|2\.0|2ch)\b/.test(text)) {
          score += isWebOsRuntime ? 10 : 4;
        }
        return { stream, score };
      }).sort((left, right) => right.score - left.score);
      return ((_c = (_b = scored[0]) == null ? void 0 : _b.stream) == null ? void 0 : _c.url) || ((_d = streams[0]) == null ? void 0 : _d.url) || null;
    },
    async handlePlaybackEnded() {
      var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k;
      let nextVideoId = ((_a = this.params) == null ? void 0 : _a.nextEpisodeVideoId) || null;
      let nextEpisodeLabel = ((_b = this.params) == null ? void 0 : _b.nextEpisodeLabel) || null;
      let nextEpisode = null;
      if (!nextVideoId && ((_c = this.params) == null ? void 0 : _c.videoId) && this.episodes.length) {
        const currentIndex = this.episodes.findIndex((episode) => episode.id === this.params.videoId);
        nextEpisode = currentIndex >= 0 ? this.episodes[currentIndex + 1] : null;
        nextVideoId = (nextEpisode == null ? void 0 : nextEpisode.id) || null;
        nextEpisodeLabel = nextEpisode ? `S${nextEpisode.season}E${nextEpisode.episode}` : null;
      }
      if (!nextEpisode && nextVideoId && this.episodes.length) {
        nextEpisode = this.episodes.find((episode) => episode.id === nextVideoId) || null;
      }
      const itemType = normalizeItemType(((_d = this.params) == null ? void 0 : _d.itemType) || "movie");
      if (!nextVideoId || itemType !== "series") {
        return;
      }
      try {
        const streamResult = await streamRepository.getStreamsFromAllAddons(itemType, nextVideoId);
        const streamItems = (streamResult == null ? void 0 : streamResult.status) === "success" ? flattenStreamGroups(streamResult) : [];
        if (!streamItems.length) {
          return;
        }
        const bestStream = this.selectBestStreamUrl(streamItems) || streamItems[0].url;
        Router.navigate("player", {
          streamUrl: bestStream,
          itemId: (_e = this.params) == null ? void 0 : _e.itemId,
          itemType,
          videoId: nextVideoId,
          season: (_f = nextEpisode == null ? void 0 : nextEpisode.season) != null ? _f : null,
          episode: (_g = nextEpisode == null ? void 0 : nextEpisode.episode) != null ? _g : null,
          episodeLabel: nextEpisodeLabel || null,
          playerTitle: ((_h = this.params) == null ? void 0 : _h.playerTitle) || ((_i = this.params) == null ? void 0 : _i.itemId),
          playerSubtitle: nextEpisodeLabel || "",
          playerBackdropUrl: ((_j = this.params) == null ? void 0 : _j.playerBackdropUrl) || null,
          playerLogoUrl: ((_k = this.params) == null ? void 0 : _k.playerLogoUrl) || null,
          episodes: this.episodes || [],
          streamCandidates: streamItems,
          nextEpisodeVideoId: null,
          nextEpisodeLabel: null
        });
      } catch (error) {
        console.warn("Next episode auto-play failed", error);
      }
    },
    cleanup() {
      var _a, _b;
      this.cancelSeekPreview({ commit: false });
      this.subtitleLoadToken = (this.subtitleLoadToken || 0) + 1;
      this.manifestLoadToken = (this.manifestLoadToken || 0) + 1;
      this.trackDiscoveryToken = (this.trackDiscoveryToken || 0) + 1;
      this.trackDiscoveryInProgress = false;
      this.trackDiscoveryStartedAt = 0;
      this.trackDiscoveryDeadline = 0;
      this.subtitleLoading = false;
      this.manifestLoading = false;
      this.clearTrackDiscoveryTimer();
      this.clearPlaybackStallGuard();
      this.externalTrackNodes.forEach((node) => node.remove());
      this.externalTrackNodes = [];
      this.clearControlsAutoHide();
      if (this.tickTimer) {
        clearInterval(this.tickTimer);
        this.tickTimer = null;
      }
      if (this.aspectToastTimer) {
        clearTimeout(this.aspectToastTimer);
        this.aspectToastTimer = null;
      }
      if (this.parentalGuideTimer) {
        clearTimeout(this.parentalGuideTimer);
        this.parentalGuideTimer = null;
      }
      if (this.subtitleSelectionTimer) {
        clearTimeout(this.subtitleSelectionTimer);
        this.subtitleSelectionTimer = null;
      }
      this.unbindVideoEvents();
      PlayerController.stop();
      if (this.container) {
        this.container.style.display = "none";
        (_a = this.container.querySelector("#playerUiRoot")) == null ? void 0 : _a.remove();
        (_b = this.container.querySelector("#episodeSidePanel")) == null ? void 0 : _b.remove();
      }
      if (this.endedHandler && PlayerController.video) {
        PlayerController.video.removeEventListener("ended", this.endedHandler);
        this.endedHandler = null;
      }
    }
  };

  // js/ui/screens/account/accountScreen.js
  var AccountScreen = {
    async mount() {
      this.container = document.getElementById("account");
      this.container.style.display = "block";
      this.state = {
        authState: AuthManager.getAuthState(),
        email: null,
        linkedDevices: []
      };
      this.unsubscribe = AuthManager.subscribe((state) => {
        this.state.authState = state;
        this.render();
      });
      this.render();
    },
    cleanup() {
      if (this.unsubscribe) {
        this.unsubscribe();
        this.unsubscribe = null;
      }
      if (this.container) {
        this.container.style.display = "none";
        this.container.innerHTML = "";
      }
    },
    async signOut() {
      await AuthManager.signOut();
      Router.navigate("authQrSignIn");
    },
    render() {
      if (!this.container) {
        return;
      }
      if (this.state.authState === "loading") {
        this.container.innerHTML = `<div class="account-wrapper"><h2>Loading account...</h2></div>`;
        return;
      }
      if (this.state.authState === "signedOut") {
        this.container.innerHTML = `
        <div class="account-wrapper">
          <h1>Account</h1>
          <p>Sign in to sync your library and preferences.</p>
          <div class="account-card focusable" data-action="signin">
            <h3>Sign In</h3>
            <p>Use QR sign-in from mobile.</p>
          </div>
        </div>
      `;
        this.attachFocus();
        return;
      }
      this.container.innerHTML = `
      <div class="account-wrapper">
        <h1>Account</h1>
        <div class="account-info">
          <span>Signed in as</span>
          <strong>${this.state.email || "User"}</strong>
        </div>
        <div class="logout-btn focusable" data-action="logout">Sign Out</div>
      </div>
    `;
      this.attachFocus();
    },
    attachFocus() {
      var _a;
      const focusables = this.container.querySelectorAll(".focusable");
      focusables.forEach((el, index) => {
        el.dataset.index = String(index);
      });
      (_a = focusables[0]) == null ? void 0 : _a.classList.add("focused");
    },
    onKeyDown(event) {
      var _a;
      if (ScreenUtils.handleDpadNavigation(event, this.container)) {
        return;
      }
      const current = (_a = this.container) == null ? void 0 : _a.querySelector(".focused");
      if (event.keyCode === 13 && current) {
        const action = current.dataset.action;
        if (action === "signin") {
          Router.navigate("authQrSignIn");
        }
        if (action === "logout") {
          this.signOut();
        }
      }
    }
  };

  // js/core/auth/qrLoginService.js
  var lastError = null;
  function isJwtLike(token) {
    const value = String(token || "").trim();
    return value.split(".").length === 3;
  }
  function getBearerToken() {
    const token = SessionStore.accessToken;
    if (isJwtLike(token)) {
      return token;
    }
    return SUPABASE_ANON_KEY;
  }
  function generateDeviceNonce() {
    var _a, _b;
    if ((_a = globalThis.crypto) == null ? void 0 : _a.randomUUID) {
      return globalThis.crypto.randomUUID();
    }
    const bytes = new Uint8Array(24);
    if ((_b = globalThis.crypto) == null ? void 0 : _b.getRandomValues) {
      globalThis.crypto.getRandomValues(bytes);
    } else {
      for (let index = 0; index < bytes.length; index += 1) {
        bytes[index] = Math.floor(Math.random() * 256);
      }
    }
    let binary = "";
    bytes.forEach((value) => {
      binary += String.fromCharCode(value);
    });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function resolveRedirectBaseUrl() {
    var _a;
    if (TV_LOGIN_REDIRECT_BASE_URL) {
      return TV_LOGIN_REDIRECT_BASE_URL;
    }
    if (typeof window !== "undefined") {
      const protocol = String(((_a = window.location) == null ? void 0 : _a.protocol) || "");
      if (protocol === "http:" || protocol === "https:") {
        return window.location.origin;
      }
    }
    return TV_LOGIN_REDIRECT_BASE_URL;
  }
  function extractOrigin(url) {
    try {
      return new URL(url).origin;
    } catch (e) {
      return null;
    }
  }
  function buildRedirectCandidates() {
    const candidates = [];
    const base = resolveRedirectBaseUrl();
    if (base) {
      candidates.push(base);
      if (base.endsWith("/")) {
        candidates.push(base.slice(0, -1));
      } else {
        candidates.push(`${base}/`);
      }
      const origin = extractOrigin(base);
      if (origin) {
        candidates.push(origin);
        candidates.push(`${origin}/`);
      }
    }
    return Array.from(new Set(candidates.filter(Boolean)));
  }
  function toEpochMillis(session) {
    if (typeof (session == null ? void 0 : session.expires_at_millis) === "number") {
      return session.expires_at_millis;
    }
    if (session == null ? void 0 : session.expires_at) {
      const parsed = Date.parse(session.expires_at);
      if (!Number.isNaN(parsed)) {
        return parsed;
      }
    }
    return Date.now() + 5 * 60 * 1e3;
  }
  function isLegacyStartSignatureError(text) {
    const message = String(text || "").toLowerCase();
    return message.includes("start_tv_login_session") && message.includes("could not find the function") && message.includes("p_device_name");
  }
  async function parseErrorText(response) {
    try {
      return await response.text();
    } catch (e) {
      return `HTTP ${response.status}`;
    }
  }
  function extractSessionTokens(payload) {
    var _a, _b;
    if (!payload || typeof payload !== "object") {
      return null;
    }
    const accessToken = payload.access_token || payload.accessToken || ((_a = payload == null ? void 0 : payload.session) == null ? void 0 : _a.access_token) || null;
    const refreshToken = payload.refresh_token || payload.refreshToken || ((_b = payload == null ? void 0 : payload.session) == null ? void 0 : _b.refresh_token) || null;
    if (!accessToken || !refreshToken) {
      return null;
    }
    return { accessToken, refreshToken };
  }
  async function ensureQrSessionAuthenticated() {
    if (SessionStore.accessToken && !isJwtLike(SessionStore.accessToken)) {
      SessionStore.accessToken = null;
      SessionStore.refreshToken = null;
    }
    if (SessionStore.accessToken && !SessionStore.isAnonymousSession) {
      return true;
    }
    if (SessionStore.accessToken && SessionStore.isAnonymousSession) {
      return true;
    }
    const commonHeaders = {
      "Content-Type": "application/json",
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`
    };
    const tryAnonymousSignup = async () => {
      const response = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
        method: "POST",
        headers: commonHeaders,
        body: JSON.stringify({
          data: { tv_client: "webos" }
        })
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(text || `HTTP ${response.status}`);
      }
      return text ? JSON.parse(text) : {};
    };
    const tryAnonymousToken = async () => {
      const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=anonymous`, {
        method: "POST",
        headers: commonHeaders,
        body: JSON.stringify({})
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(text || `HTTP ${response.status}`);
      }
      return text ? JSON.parse(text) : {};
    };
    let payload;
    try {
      payload = await tryAnonymousSignup();
    } catch (firstError) {
      payload = await tryAnonymousToken().catch((secondError) => {
        throw new Error(`${(firstError == null ? void 0 : firstError.message) || "anonymous signup failed"} | ${(secondError == null ? void 0 : secondError.message) || "anonymous token failed"}`);
      });
    }
    const tokens = extractSessionTokens(payload);
    if (!tokens) {
      throw new Error("Anonymous auth did not return session tokens");
    }
    SessionStore.accessToken = tokens.accessToken;
    SessionStore.refreshToken = tokens.refreshToken;
    SessionStore.isAnonymousSession = true;
    return true;
  }
  async function startRpc(deviceNonce, redirectBaseUrl, includeDeviceName = true) {
    const payload = {
      p_device_nonce: deviceNonce,
      p_redirect_base_url: redirectBaseUrl
    };
    if (includeDeviceName) {
      payload.p_device_name = Environment.getDeviceLabel();
    }
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/start_tv_login_session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${getBearerToken()}`
      },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const errorText = await parseErrorText(response);
      throw new Error(errorText || `HTTP ${response.status}`);
    }
    const data = await response.json();
    return (data == null ? void 0 : data[0]) || null;
  }
  var QrLoginService = {
    getLastError() {
      return lastError;
    },
    async start() {
      lastError = null;
      try {
        await ensureQrSessionAuthenticated();
        const deviceNonce = generateDeviceNonce();
        const redirectCandidates = buildRedirectCandidates();
        if (!redirectCandidates.length) {
          throw new Error("Missing redirect_base_url configuration");
        }
        let session = null;
        let lastStartError = null;
        for (const redirectCandidate of redirectCandidates) {
          try {
            session = await startRpc(deviceNonce, redirectCandidate, true);
            if (session) {
              break;
            }
          } catch (error) {
            const message = String((error == null ? void 0 : error.message) || "");
            if (isLegacyStartSignatureError(message)) {
              try {
                session = await startRpc(deviceNonce, redirectCandidate, false);
                if (session) {
                  break;
                }
              } catch (legacyError) {
                lastStartError = legacyError;
                continue;
              }
            }
            lastStartError = error;
            continue;
          }
        }
        if (!session) {
          if (lastStartError) {
            throw new Error(`${lastStartError.message} | tried redirect_base_url: ${redirectCandidates.join(" , ")}`);
          }
          throw new Error("Empty response from start_tv_login_session");
        }
        return {
          code: session.code,
          loginUrl: session.qr_content || session.web_url || null,
          qrImageUrl: session.qr_image_url || `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(session.qr_content || session.web_url || "")}`,
          expiresAt: toEpochMillis(session),
          pollIntervalSeconds: Number(session.poll_interval_seconds || 3),
          deviceNonce
        };
      } catch (error) {
        lastError = String((error == null ? void 0 : error.message) || "QR start failed");
        console.error("QR start error:", error);
        return null;
      }
    },
    async poll(code, deviceNonce) {
      var _a;
      lastError = null;
      try {
        await ensureQrSessionAuthenticated();
        const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/poll_tv_login_session`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${getBearerToken()}`
          },
          body: JSON.stringify({
            p_code: code,
            p_device_nonce: deviceNonce
          })
        });
        if (!response.ok) {
          lastError = await parseErrorText(response);
          return null;
        }
        const data = await response.json();
        return ((_a = data == null ? void 0 : data[0]) == null ? void 0 : _a.status) || null;
      } catch (error) {
        lastError = String((error == null ? void 0 : error.message) || "QR poll failed");
        console.error("QR poll error:", error);
        return null;
      }
    },
    async exchange(code, deviceNonce) {
      lastError = null;
      try {
        await ensureQrSessionAuthenticated();
        const token = getBearerToken();
        const response = await fetch(`${SUPABASE_URL}/functions/v1/tv-logins-exchange`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            code,
            device_nonce: deviceNonce
          })
        });
        if (!response.ok) {
          lastError = await parseErrorText(response);
          console.error("Exchange failed", lastError);
          return false;
        }
        const result = await response.json();
        const tokens = extractSessionTokens(result) || {
          accessToken: (result == null ? void 0 : result.access_token) || null,
          refreshToken: (result == null ? void 0 : result.refresh_token) || null
        };
        if (!(tokens == null ? void 0 : tokens.accessToken) || !(tokens == null ? void 0 : tokens.refreshToken)) {
          lastError = "QR exchange missing session tokens";
          return false;
        }
        SessionStore.accessToken = tokens.accessToken;
        SessionStore.refreshToken = tokens.refreshToken;
        SessionStore.isAnonymousSession = false;
        AuthManager.setState(AuthState.AUTHENTICATED);
        return result;
      } catch (error) {
        lastError = String((error == null ? void 0 : error.message) || "QR exchange failed");
        console.error("QR exchange error:", error);
        return false;
      }
    },
    cleanup() {
    }
  };

  // js/ui/screens/account/authQrSignInScreen.js
  var pollInterval = null;
  var countdownInterval = null;
  var AuthQrSignInScreen = {
    async mount({ onboardingMode = false } = {}) {
      this.container = document.getElementById("account");
      this.onboardingMode = Boolean(onboardingMode);
      ScreenUtils.show(this.container);
      this.container.innerHTML = `
      <div class="qr-layout">
        <section class="qr-left-panel">
          <div class="qr-brand-lockup">
            <img src="assets/brand/app_logo_wordmark.png" class="qr-logo" alt="Nuvio" />
          </div>

          <div class="qr-copy-block">
            <h1 class="qr-title">Sign In With QR</h1>
            <p class="qr-description">
              Use your phone to sign in with email/password. TV stays QR-only for faster login.
            </p>
          </div>
        </section>

        <section class="qr-card-panel" aria-label="Account Login">
          <div class="qr-card">
            <header class="qr-card-header">
              <h2 class="qr-card-title">Account Login</h2>
              <p class="qr-card-subtitle">Scan QR, approve in browser, then return here.</p>
            </header>

            <div id="qr-container" class="qr-code-frame"></div>
            <div id="qr-code-text" class="qr-code-text"></div>
            <div id="qr-status" class="qr-status">Waiting for approval on your phone...</div>
            <div id="qr-expiry" class="qr-expiry"></div>

            <div class="qr-actions">
              <button id="qr-refresh-btn" class="qr-action-btn qr-action-btn-primary focusable" data-action="refresh">Refresh QR</button>
              <button id="qr-back-btn" class="qr-action-btn qr-action-btn-secondary focusable" data-action="back">${this.onboardingMode ? "Continue without account" : "Back"}</button>
            </div>
          </div>
        </section>
      </div>
    `;
      document.getElementById("qr-refresh-btn").onclick = () => this.startQr();
      document.getElementById("qr-back-btn").onclick = () => {
        this.cleanup();
        if (this.onboardingMode) {
          Router.navigate("home");
        } else {
          Router.back();
        }
      };
      ScreenUtils.indexFocusables(this.container);
      ScreenUtils.setInitialFocus(this.container);
      await this.startQr();
    },
    async startQr() {
      this.stopIntervals();
      this.setStatus("Waiting for approval on your phone...");
      const result = await QrLoginService.start();
      if (!result) {
        const raw = QrLoginService.getLastError();
        this.setStatus(this.toFriendlyQrError(raw));
        return;
      }
      this.renderQr(result);
      this.startPolling(result.code, result.deviceNonce, result.pollIntervalSeconds || 3);
      this.startCountdown(result.expiresAt);
    },
    renderQr({ qrImageUrl, code }) {
      const qrContainer = document.getElementById("qr-container");
      const codeText = document.getElementById("qr-code-text");
      if (!qrContainer || !codeText) {
        return;
      }
      qrContainer.innerHTML = `
      <img src="${qrImageUrl}" class="qr-image" alt="QR code" />
    `;
      codeText.innerText = `Code: ${code}`;
    },
    startCountdown(expiresAt) {
      const expiryEl = document.getElementById("qr-expiry");
      if (!expiryEl) {
        return;
      }
      const renderRemaining = () => {
        const remaining = expiresAt - Date.now();
        if (remaining <= 0) {
          expiryEl.innerText = "QR expires in 00:00";
          if (countdownInterval) {
            clearInterval(countdownInterval);
            countdownInterval = null;
          }
          return;
        }
        const minutes = Math.floor(remaining / 6e4);
        const seconds = Math.floor(remaining % 6e4 / 1e3);
        expiryEl.innerText = `QR expires in ${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
      };
      renderRemaining();
      countdownInterval = setInterval(renderRemaining, 1e3);
    },
    startPolling(code, deviceNonce, pollIntervalSeconds = 3) {
      pollInterval = setInterval(async () => {
        const status = await QrLoginService.poll(code, deviceNonce);
        if (status === "approved") {
          this.setStatus("Approved. Finishing login...");
          clearInterval(pollInterval);
          pollInterval = null;
          const exchange = await QrLoginService.exchange(code, deviceNonce);
          if (exchange) {
            LocalStore.set("hasSeenAuthQrOnFirstLaunch", true);
            Router.navigate("profileSelection");
          } else {
            this.setStatus(this.toFriendlyQrError(QrLoginService.getLastError()));
          }
        }
        if (status === "expired") {
          this.setStatus("QR expired. Refresh to retry.");
        }
      }, Math.max(2, Number(pollIntervalSeconds || 3)) * 1e3);
    },
    toFriendlyQrError(rawError) {
      const message = String(rawError || "").toLowerCase();
      if (!message) {
        return "QR unavailable. Try again.";
      }
      if (message.includes("invalid tv login redirect base url")) {
        return "QR backend redirect URL is invalid. Check TV login SQL setup.";
      }
      if (message.includes("start_tv_login_session") && message.includes("could not find the function")) {
        return "QR backend function is missing. Re-run TV login SQL setup.";
      }
      if (message.includes("gen_random_bytes") && message.includes("does not exist")) {
        return "QR backend missing extension. Re-run SQL setup for TV login.";
      }
      if (message.includes("network") || message.includes("failed to fetch")) {
        return "Network error while generating QR.";
      }
      return `QR unavailable: ${rawError}`;
    },
    setStatus(text) {
      const statusNode = document.getElementById("qr-status");
      if (!statusNode) {
        return;
      }
      statusNode.innerText = text;
    },
    onKeyDown(event) {
      var _a;
      if (ScreenUtils.handleDpadNavigation(event, this.container)) {
        return;
      }
      if (Number((event == null ? void 0 : event.keyCode) || 0) !== 13) {
        return;
      }
      const current = (_a = this.container) == null ? void 0 : _a.querySelector(".focusable.focused");
      if (!current) {
        return;
      }
      const action = current.dataset.action;
      if (action === "refresh") {
        this.startQr();
        return;
      }
      if (action === "back") {
        current.click();
      }
    },
    stopIntervals() {
      if (pollInterval) clearInterval(pollInterval);
      if (countdownInterval) clearInterval(countdownInterval);
      pollInterval = null;
      countdownInterval = null;
    },
    cleanup() {
      this.stopIntervals();
      ScreenUtils.hide(this.container);
      this.container = null;
    }
  };

  // js/ui/screens/account/authSignInScreen.js
  var AuthSignInScreen = {
    async mount() {
      this.container = document.getElementById("account");
      ScreenUtils.show(this.container);
      this.render();
    },
    render() {
      this.container.innerHTML = `
      <div class="row">
        <h2>Email Sign In</h2>
        <p>Press ENTER to open QR login or use the dev shortcut with preset credentials.</p>
      </div>
      <div class="row">
        <div class="card focusable" data-action="openQr">Open QR Login</div>
        <div class="card focusable" data-action="devLogin">Dev Email Login</div>
        <div class="card focusable" data-action="back">Back</div>
      </div>
    `;
      ScreenUtils.indexFocusables(this.container);
      ScreenUtils.setInitialFocus(this.container);
    },
    async onKeyDown(event) {
      if (ScreenUtils.handleDpadNavigation(event, this.container)) {
        return;
      }
      if (event.keyCode !== 13) {
        return;
      }
      const current = this.container.querySelector(".focusable.focused");
      if (!current) {
        return;
      }
      const action = current.dataset.action;
      if (action === "openQr") {
        Router.navigate("authQrSignIn");
        return;
      }
      if (action === "devLogin") {
        const email = window.prompt("Email");
        const password = window.prompt("Password");
        if (email && password) {
          try {
            await AuthManager.signInWithEmail(email, password);
            Router.navigate("profileSelection");
          } catch (error) {
            console.error("SignIn failed", error);
          }
        }
        return;
      }
      if (action === "back") {
        Router.back();
      }
    },
    cleanup() {
      ScreenUtils.hide(this.container);
    }
  };

  // js/ui/screens/account/syncCodeScreen.js
  var KEY5 = "manualSyncCode";
  var SyncCodeScreen = {
    async mount() {
      this.container = document.getElementById("account");
      ScreenUtils.show(this.container);
      this.render();
    },
    render() {
      const value = LocalStore.get(KEY5, "");
      this.container.innerHTML = `
      <div class="row">
        <h2>Sync Code</h2>
        <p>Current code: ${value || "(empty)"}</p>
      </div>
      <div class="row">
        <div class="card focusable" data-action="setCode">Set Code</div>
        <div class="card focusable" data-action="clearCode">Clear Code</div>
        <div class="card focusable" data-action="back">Back</div>
      </div>
    `;
      ScreenUtils.indexFocusables(this.container);
      ScreenUtils.setInitialFocus(this.container);
    },
    onKeyDown(event) {
      if (ScreenUtils.handleDpadNavigation(event, this.container)) {
        return;
      }
      if (event.keyCode !== 13) {
        return;
      }
      const current = this.container.querySelector(".focusable.focused");
      if (!current) {
        return;
      }
      const action = current.dataset.action;
      if (action === "setCode") {
        const value = window.prompt("Insert sync code", LocalStore.get(KEY5, ""));
        if (value !== null) {
          LocalStore.set(KEY5, String(value).trim());
          this.render();
        }
        return;
      }
      if (action === "clearCode") {
        LocalStore.remove(KEY5);
        this.render();
        return;
      }
      if (action === "back") {
        Router.back();
      }
    },
    cleanup() {
      ScreenUtils.hide(this.container);
    }
  };

  // js/core/profile/profileSyncService.js
  var TABLE2 = "tv_profiles";
  var FALLBACK_TABLE2 = "profiles";
  var PULL_RPC2 = "sync_pull_profiles";
  var PUSH_RPC2 = "sync_push_profiles";
  function shouldTryLegacyTable2(error) {
    if (!error) {
      return false;
    }
    if (error.status === 404) {
      return true;
    }
    if (typeof error.code === "string" && error.code === "PGRST205") {
      return true;
    }
    const message = String(error.message || "");
    return message.includes("PGRST205") || message.includes("Could not find the table");
  }
  function mapProfileRow(row = {}) {
    const profileIndex = Number(
      row.profile_index || row.profileIndex || row.id || 1
    );
    const normalizedIndex = Number.isFinite(profileIndex) && profileIndex > 0 ? Math.trunc(profileIndex) : 1;
    return {
      id: String(normalizedIndex),
      profileIndex: normalizedIndex,
      name: row.name || `Profile ${normalizedIndex}`,
      avatarColorHex: row.avatar_color_hex || row.avatarColorHex || "#1E88E5",
      usesPrimaryAddons: typeof row.uses_primary_addons === "boolean" ? row.uses_primary_addons : Boolean(row.usesPrimaryAddons),
      usesPrimaryPlugins: typeof row.uses_primary_plugins === "boolean" ? row.uses_primary_plugins : Boolean(row.usesPrimaryPlugins),
      isPrimary: typeof row.is_primary === "boolean" ? row.is_primary : normalizedIndex === 1
    };
  }
  var ProfileSyncService = {
    async pull() {
      try {
        if (!AuthManager.isAuthenticated) {
          return [];
        }
        let rows = [];
        try {
          rows = await SupabaseApi.rpc(PULL_RPC2, {}, true);
        } catch (rpcError) {
          const ownerId = await AuthManager.getEffectiveUserId();
          try {
            rows = await SupabaseApi.select(
              FALLBACK_TABLE2,
              `user_id=eq.${encodeURIComponent(ownerId)}&select=*&order=profile_index.asc`,
              true
            );
          } catch (primaryError) {
            if (!shouldTryLegacyTable2(primaryError)) {
              throw rpcError;
            }
            rows = await SupabaseApi.select(
              TABLE2,
              `owner_id=eq.${encodeURIComponent(ownerId)}&select=*&order=profile_index.asc`,
              true
            );
          }
        }
        const profiles = (rows || []).map((row) => mapProfileRow(row));
        if (profiles.length) {
          await ProfileManager.replaceProfiles(profiles);
        }
        return profiles;
      } catch (error) {
        console.warn("Profile sync pull failed", error);
        return [];
      }
    },
    async push() {
      try {
        if (!AuthManager.isAuthenticated) {
          return false;
        }
        const profiles = await ProfileManager.getProfiles();
        try {
          await SupabaseApi.rpc(PUSH_RPC2, {
            p_profiles: profiles.map((profile) => {
              const profileIndex = Number(profile.profileIndex || profile.id || 1);
              return {
                profile_index: Number.isFinite(profileIndex) && profileIndex > 0 ? Math.trunc(profileIndex) : 1,
                name: profile.name,
                avatar_color_hex: profile.avatarColorHex || "#1E88E5",
                uses_primary_addons: Boolean(profile.usesPrimaryAddons),
                uses_primary_plugins: Boolean(profile.usesPrimaryPlugins)
              };
            })
          }, true);
          return true;
        } catch (rpcError) {
          console.warn("Profile sync push RPC failed, falling back to table sync", rpcError);
        }
        const ownerId = await AuthManager.getEffectiveUserId();
        const rows = profiles.map((profile) => {
          const profileIndex = Number(profile.profileIndex || profile.id || 1);
          return {
            id: profile.id,
            owner_id: ownerId,
            profile_index: Number.isFinite(profileIndex) && profileIndex > 0 ? Math.trunc(profileIndex) : 1,
            name: profile.name,
            avatar_color_hex: profile.avatarColorHex || "#1E88E5",
            is_primary: Boolean(profile.isPrimary)
          };
        });
        const fallbackRows = rows.map((row) => ({
          user_id: ownerId,
          profile_index: row.profile_index,
          name: row.name,
          avatar_color_hex: row.avatar_color_hex,
          uses_primary_addons: row.profile_index !== 1,
          uses_primary_plugins: row.profile_index !== 1
        }));
        try {
          await SupabaseApi.delete(FALLBACK_TABLE2, `user_id=eq.${encodeURIComponent(ownerId)}`, true);
          if (fallbackRows.length) {
            await SupabaseApi.upsert(FALLBACK_TABLE2, fallbackRows, "user_id,profile_index", true);
          }
        } catch (primaryError) {
          if (!shouldTryLegacyTable2(primaryError)) {
            throw primaryError;
          }
          await SupabaseApi.upsert(TABLE2, rows, "id", true);
        }
        return true;
      } catch (error) {
        console.warn("Profile sync push failed", error);
        return false;
      }
    }
  };

  // js/core/profile/librarySyncService.js
  var ADDONS_TABLE = "addons";
  var TABLE3 = "tv_addons";
  function isMissingResourceError(error) {
    if (!error) {
      return false;
    }
    if (error.status === 404) {
      return true;
    }
    if (typeof error.code === "string" && (error.code === "PGRST205" || error.code === "PGRST202")) {
      return true;
    }
    const message = String(error.message || "");
    return message.includes("PGRST205") || message.includes("PGRST202") || message.includes("Could not find the table") || message.includes("Could not find the function");
  }
  function isOnConflictConstraintError(error) {
    if (!error) {
      return false;
    }
    if (typeof error.code === "string" && error.code === "42P10") {
      return true;
    }
    const message = String(error.message || "");
    return message.includes("42P10") || message.includes("no unique or exclusion constraint matching the ON CONFLICT specification");
  }
  async function resolveProfileId2() {
    const activeId = String(ProfileManager.getActiveProfileId() || "1");
    const direct = Number(activeId);
    if (Number.isFinite(direct) && direct > 0) {
      return Math.trunc(direct);
    }
    const profiles = await ProfileManager.getProfiles();
    const activeProfile = profiles.find((profile) => String(profile.id) === activeId);
    const candidate = Number((activeProfile == null ? void 0 : activeProfile.profileIndex) || (activeProfile == null ? void 0 : activeProfile.id) || 1);
    return Number.isFinite(candidate) && candidate > 0 ? Math.trunc(candidate) : 1;
  }
  async function resolveAddonProfileId() {
    const profileId = await resolveProfileId2();
    if (profileId === 1) {
      return 1;
    }
    const profiles = await ProfileManager.getProfiles();
    const activeProfile = profiles.find((profile) => {
      const id = Number((profile == null ? void 0 : profile.profileIndex) || (profile == null ? void 0 : profile.id) || 1);
      return Number.isFinite(id) && Math.trunc(id) === profileId;
    });
    const usesPrimaryAddons = typeof (activeProfile == null ? void 0 : activeProfile.usesPrimaryAddons) === "boolean" ? activeProfile.usesPrimaryAddons : typeof (activeProfile == null ? void 0 : activeProfile.uses_primary_addons) === "boolean" ? activeProfile.uses_primary_addons : true;
    return usesPrimaryAddons ? 1 : profileId;
  }
  function extractAddonUrls(rows = []) {
    return (rows || []).map((row) => (row == null ? void 0 : row.url) || (row == null ? void 0 : row.base_url) || null).filter(Boolean);
  }
  var LibrarySyncService = {
    async pull() {
      try {
        if (!AuthManager.isAuthenticated) {
          console.warn("[AddonSync] pull skipped: auth state is not AUTHENTICATED");
          return [];
        }
        const localUrls = addonRepository.getInstalledAddonUrls();
        const profileId = await resolveAddonProfileId();
        console.log(`[AddonSync] pull start profileId=${profileId}`);
        const ownerId = await AuthManager.getEffectiveUserId();
        let addonTableMissing = false;
        try {
          const addonRows = await SupabaseApi.select(
            ADDONS_TABLE,
            `user_id=eq.${encodeURIComponent(ownerId)}&profile_id=eq.${profileId}&select=url,sort_order&order=sort_order.asc`,
            true
          );
          const addonUrls = extractAddonUrls(addonRows);
          console.log(`[AddonSync] pull table addons returned ${addonUrls.length} urls`);
          await addonRepository.setAddonOrder(addonUrls, { silent: true });
          return addonUrls;
        } catch (addonsTableError) {
          addonTableMissing = isMissingResourceError(addonsTableError);
          console.warn("Addon sync pull addons-table read failed", addonsTableError);
        }
        let tvTableMissing = false;
        try {
          const rows = await SupabaseApi.select(
            TABLE3,
            `owner_id=eq.${encodeURIComponent(ownerId)}&select=base_url,position&order=position.asc`,
            true
          );
          const urls = extractAddonUrls(rows);
          console.log(`[AddonSync] pull table ${TABLE3} returned ${urls.length} urls`);
          await addonRepository.setAddonOrder(urls, { silent: true });
          return urls;
        } catch (tvTableError) {
          tvTableMissing = isMissingResourceError(tvTableError);
          console.warn("Addon sync pull tv-table read failed", tvTableError);
        }
        if (addonTableMissing && tvTableMissing) {
          try {
            const rpcRows = await SupabaseApi.rpc(
              "sync_pull_addons",
              { p_profile_id: profileId },
              true
            );
            const urls = extractAddonUrls(rpcRows);
            console.log(`[AddonSync] pull RPC sync_pull_addons returned ${urls.length} urls`);
            await addonRepository.setAddonOrder(urls, { silent: true });
            return urls;
          } catch (rpcError) {
            console.warn("Addon sync pull RPC failed", rpcError);
          }
        }
        if (localUrls.length) {
          console.log("[AddonSync] no remote addon source available, preserving local addons");
          return localUrls;
        }
        return [];
      } catch (error) {
        console.warn("Library sync pull failed", error);
        return [];
      }
    },
    async push() {
      try {
        if (!AuthManager.isAuthenticated) {
          console.warn("[AddonSync] push skipped: auth state is not AUTHENTICATED");
          return false;
        }
        const profileId = await resolveAddonProfileId();
        const urls = addonRepository.getInstalledAddonUrls();
        console.log(`[AddonSync] push start profileId=${profileId} urls=${urls.length}`);
        try {
          await SupabaseApi.rpc(
            "sync_push_addons",
            {
              p_profile_id: profileId,
              p_addons: urls.map((url, index) => ({
                url,
                sort_order: index
              }))
            },
            true
          );
          return true;
        } catch (rpcError) {
          console.warn("Addon sync push RPC failed, falling back to legacy table", rpcError);
        }
        const ownerId = await AuthManager.getEffectiveUserId();
        try {
          await SupabaseApi.delete(
            ADDONS_TABLE,
            `user_id=eq.${encodeURIComponent(ownerId)}&profile_id=eq.${profileId}`,
            true
          );
          const addonRows = urls.map((url, index) => ({
            user_id: ownerId,
            profile_id: profileId,
            url,
            sort_order: index
          }));
          if (addonRows.length) {
            try {
              await SupabaseApi.upsert(ADDONS_TABLE, addonRows, "user_id,profile_id,url", true);
            } catch (upsertError) {
              if (!isOnConflictConstraintError(upsertError)) {
                throw upsertError;
              }
              await SupabaseApi.upsert(ADDONS_TABLE, addonRows, null, true);
            }
          }
          return true;
        } catch (addonsTableError) {
          if (!isMissingResourceError(addonsTableError)) {
            console.warn("Addon sync push addons-table fallback failed", addonsTableError);
            return false;
          }
          console.warn("Addon sync push addons-table missing, trying tv_addons fallback", addonsTableError);
        }
        const rows = urls.map((baseUrl, index) => ({
          owner_id: ownerId,
          base_url: baseUrl,
          position: index
        }));
        try {
          await SupabaseApi.delete(TABLE3, `owner_id=eq.${encodeURIComponent(ownerId)}`, true);
          if (rows.length) {
            await SupabaseApi.upsert(TABLE3, rows, "owner_id,base_url", true);
          }
          return true;
        } catch (tvTableError) {
          console.warn("Addon sync push tv_addons fallback failed", tvTableError);
          return false;
        }
      } catch (error) {
        console.warn("Library sync push failed", error);
        return false;
      }
    }
  };

  // js/data/local/savedLibraryStore.js
  var SAVED_LIBRARY_KEY = "savedLibraryItems";
  var SavedLibraryStore = {
    list() {
      return LocalStore.get(SAVED_LIBRARY_KEY, []);
    },
    upsert(item) {
      const items = this.list();
      const next = [
        {
          ...item,
          updatedAt: item.updatedAt || Date.now()
        },
        ...items.filter((entry) => entry.contentId !== item.contentId)
      ].slice(0, 1e3);
      LocalStore.set(SAVED_LIBRARY_KEY, next);
    },
    findByContentId(contentId) {
      return this.list().find((item) => item.contentId === contentId) || null;
    },
    remove(contentId) {
      const next = this.list().filter((item) => item.contentId !== contentId);
      LocalStore.set(SAVED_LIBRARY_KEY, next);
    },
    replaceAll(items = []) {
      LocalStore.set(SAVED_LIBRARY_KEY, Array.isArray(items) ? items : []);
    }
  };

  // js/data/repository/savedLibraryRepository.js
  var SavedLibraryRepository = class {
    async getAll(limit = 200) {
      return SavedLibraryStore.list().slice(0, limit);
    }
    async isSaved(contentId) {
      return Boolean(SavedLibraryStore.findByContentId(contentId));
    }
    async save(item) {
      if (!(item == null ? void 0 : item.contentId)) {
        return;
      }
      SavedLibraryStore.upsert(item);
    }
    async remove(contentId) {
      SavedLibraryStore.remove(contentId);
    }
    async toggle(item) {
      if (!(item == null ? void 0 : item.contentId)) {
        return false;
      }
      const exists = SavedLibraryStore.findByContentId(item.contentId);
      if (exists) {
        SavedLibraryStore.remove(item.contentId);
        return false;
      }
      SavedLibraryStore.upsert(item);
      return true;
    }
    async replaceAll(items) {
      SavedLibraryStore.replaceAll(items || []);
    }
  };
  var savedLibraryRepository = new SavedLibraryRepository();

  // js/core/profile/savedLibrarySyncService.js
  var PULL_RPC3 = "sync_pull_library";
  var PUSH_RPC3 = "sync_push_library";
  function resolveProfileId3() {
    const raw = Number(ProfileManager.getActiveProfileId() || 1);
    if (Number.isFinite(raw) && raw > 0) {
      return Math.trunc(raw);
    }
    return 1;
  }
  function mapRemoteItem(row = {}) {
    const contentId = row.content_id || row.contentId || row.id || "";
    const updatedAtRaw = row.updated_at || row.updatedAt || row.created_at || row.createdAt || null;
    const updatedAt = Number(updatedAtRaw);
    return {
      contentId,
      contentType: row.content_type || row.contentType || "movie",
      title: row.name || row.title || "Untitled",
      poster: row.poster || null,
      background: row.background || null,
      description: row.description || "",
      releaseInfo: row.release_info || row.releaseInfo || "",
      imdbRating: row.imdb_rating || row.imdbRating || null,
      genres: Array.isArray(row.genres) ? row.genres : [],
      addonBaseUrl: row.addon_base_url || row.addonBaseUrl || null,
      updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now()
    };
  }
  function libraryItemKey(item = {}) {
    const contentType = String(item.contentType || "movie").trim();
    const contentId = String(item.contentId || "").trim();
    return `${contentType}:${contentId}`;
  }
  function mergeLibraryItems(localItems = [], remoteItems = []) {
    if (!remoteItems.length) {
      return [...localItems];
    }
    const byKey = /* @__PURE__ */ new Map();
    const upsert = (item, remote = false) => {
      if (!(item == null ? void 0 : item.contentId)) {
        return;
      }
      const key = libraryItemKey(item);
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, item);
        return;
      }
      const existingUpdated = Number(existing.updatedAt || 0);
      const incomingUpdated = Number(item.updatedAt || 0);
      if (incomingUpdated > existingUpdated || incomingUpdated === existingUpdated && remote) {
        byKey.set(key, item);
      }
    };
    localItems.forEach((item) => upsert(item, false));
    remoteItems.forEach((item) => upsert(item, true));
    return Array.from(byKey.values()).sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0));
  }
  function toRemoteItem(item = {}) {
    return {
      content_id: item.contentId,
      content_type: item.contentType || "movie",
      name: item.title || item.name || "Untitled",
      poster: item.poster || null,
      poster_shape: "POSTER",
      background: item.background || null,
      description: item.description || "",
      release_info: item.releaseInfo || "",
      imdb_rating: item.imdbRating == null ? null : Number(item.imdbRating),
      genres: Array.isArray(item.genres) ? item.genres : [],
      addon_base_url: item.addonBaseUrl || null
    };
  }
  var SavedLibrarySyncService = {
    async pull() {
      try {
        if (!AuthManager.isAuthenticated) {
          return [];
        }
        const localItems = await savedLibraryRepository.getAll(1e3);
        const rows = await SupabaseApi.rpc(PULL_RPC3, { p_profile_id: resolveProfileId3() }, true);
        const remoteItems = (rows || []).map((row) => mapRemoteItem(row)).filter((item) => Boolean(item.contentId));
        if (!remoteItems.length && localItems.length) {
          return localItems;
        }
        const mergedItems = mergeLibraryItems(localItems, remoteItems);
        await savedLibraryRepository.replaceAll(mergedItems);
        return mergedItems;
      } catch (error) {
        console.warn("Saved library sync pull failed", error);
        return [];
      }
    },
    async push() {
      try {
        if (!AuthManager.isAuthenticated) {
          return false;
        }
        const items = await savedLibraryRepository.getAll(1e3);
        await SupabaseApi.rpc(PUSH_RPC3, {
          p_profile_id: resolveProfileId3(),
          p_items: items.map((item) => toRemoteItem(item))
        }, true);
        return true;
      } catch (error) {
        console.warn("Saved library sync push failed", error);
        return false;
      }
    }
  };

  // js/data/local/watchedItemsStore.js
  var WATCHED_ITEMS_KEY = "watchedItems";
  function normalizeItem(item = {}, profileId) {
    return {
      profileId: String(profileId || 1),
      contentId: String(item.contentId || ""),
      contentType: String(item.contentType || "movie"),
      title: String(item.title || ""),
      season: item.season == null ? null : Number(item.season),
      episode: item.episode == null ? null : Number(item.episode),
      watchedAt: Number(item.watchedAt || Date.now())
    };
  }
  var WatchedItemsStore = {
    listAll() {
      const raw = LocalStore.get(WATCHED_ITEMS_KEY, []);
      return Array.isArray(raw) ? raw : [];
    },
    listForProfile(profileId) {
      const pid = String(profileId || 1);
      return this.listAll().filter((item) => String(item.profileId || "1") === pid);
    },
    upsert(item, profileId) {
      const pid = String(profileId || 1);
      const normalized = normalizeItem(item, pid);
      if (!normalized.contentId) {
        return;
      }
      const next = [
        normalized,
        ...this.listAll().filter((entry) => !(String(entry.profileId || "1") === pid && entry.contentId === normalized.contentId))
      ].slice(0, 5e3);
      LocalStore.set(WATCHED_ITEMS_KEY, next);
    },
    remove(contentId, profileId) {
      const pid = String(profileId || 1);
      const next = this.listAll().filter((entry) => !(String(entry.profileId || "1") === pid && entry.contentId === String(contentId || "")));
      LocalStore.set(WATCHED_ITEMS_KEY, next);
    },
    replaceForProfile(profileId, items = []) {
      const pid = String(profileId || 1);
      const keepOtherProfiles = this.listAll().filter((entry) => String(entry.profileId || "1") !== pid);
      const normalized = (Array.isArray(items) ? items : []).map((item) => normalizeItem(item, pid)).filter((item) => Boolean(item.contentId));
      LocalStore.set(WATCHED_ITEMS_KEY, [...normalized, ...keepOtherProfiles]);
    }
  };

  // js/data/repository/watchedItemsRepository.js
  function activeProfileId2() {
    return String(ProfileManager.getActiveProfileId() || "1");
  }
  var WatchedItemsRepository = class {
    async getAll(limit = 2e3) {
      return WatchedItemsStore.listForProfile(activeProfileId2()).slice(0, limit);
    }
    async isWatched(contentId) {
      const all = WatchedItemsStore.listForProfile(activeProfileId2());
      return all.some((item) => item.contentId === String(contentId || ""));
    }
    async mark(item) {
      if (!(item == null ? void 0 : item.contentId)) {
        return;
      }
      WatchedItemsStore.upsert({
        ...item,
        watchedAt: item.watchedAt || Date.now()
      }, activeProfileId2());
    }
    async unmark(contentId) {
      WatchedItemsStore.remove(contentId, activeProfileId2());
    }
    async replaceAll(items) {
      WatchedItemsStore.replaceForProfile(activeProfileId2(), items || []);
    }
  };
  var watchedItemsRepository = new WatchedItemsRepository();

  // js/core/profile/watchedItemsSyncService.js
  var PULL_RPC4 = "sync_pull_watched_items";
  var PUSH_RPC4 = "sync_push_watched_items";
  function resolveProfileId4() {
    const raw = Number(ProfileManager.getActiveProfileId() || 1);
    return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : 1;
  }
  function mapRemoteItem2(row = {}) {
    const watchedAtRaw = row.watched_at || row.watchedAt || null;
    const numeric = Number(watchedAtRaw);
    const parsedDate = Number.isFinite(numeric) ? numeric : new Date(watchedAtRaw).getTime();
    return {
      contentId: row.content_id || row.contentId || "",
      contentType: row.content_type || row.contentType || "movie",
      title: row.title || row.name || "",
      season: row.season == null ? null : Number(row.season),
      episode: row.episode == null ? null : Number(row.episode),
      watchedAt: Number.isFinite(parsedDate) ? parsedDate : Date.now()
    };
  }
  function watchedItemKey(item = {}) {
    const contentId = String(item.contentId || "").trim();
    const season = item.season == null ? "" : String(Number(item.season));
    const episode = item.episode == null ? "" : String(Number(item.episode));
    return `${contentId}:${season}:${episode}`;
  }
  function mergeWatchedItems(localItems = [], remoteItems = []) {
    if (!remoteItems.length) {
      return [...localItems];
    }
    const byKey = /* @__PURE__ */ new Map();
    const upsert = (item, remote = false) => {
      const key = watchedItemKey(item);
      if (key.startsWith(":")) {
        return;
      }
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, item);
        return;
      }
      const existingWatchedAt = Number(existing.watchedAt || 0);
      const incomingWatchedAt = Number(item.watchedAt || 0);
      if (incomingWatchedAt > existingWatchedAt || incomingWatchedAt === existingWatchedAt && remote) {
        byKey.set(key, item);
      }
    };
    localItems.forEach((item) => upsert(item, false));
    remoteItems.forEach((item) => upsert(item, true));
    return Array.from(byKey.values()).sort((left, right) => Number(right.watchedAt || 0) - Number(left.watchedAt || 0));
  }
  function toRemoteItem2(item = {}) {
    return {
      content_id: item.contentId,
      content_type: item.contentType || "movie",
      title: item.title || "",
      season: item.season == null ? null : Number(item.season),
      episode: item.episode == null ? null : Number(item.episode),
      watched_at: Number(item.watchedAt || Date.now())
    };
  }
  var WatchedItemsSyncService = {
    async pull() {
      try {
        if (!AuthManager.isAuthenticated) {
          return [];
        }
        const localItems = await watchedItemsRepository.getAll(5e3);
        const rows = await SupabaseApi.rpc(PULL_RPC4, { p_profile_id: resolveProfileId4() }, true);
        const remoteItems = (rows || []).map((row) => mapRemoteItem2(row)).filter((item) => Boolean(item.contentId));
        if (!remoteItems.length && localItems.length) {
          return localItems;
        }
        const mergedItems = mergeWatchedItems(localItems, remoteItems);
        await watchedItemsRepository.replaceAll(mergedItems);
        return mergedItems;
      } catch (error) {
        console.warn("Watched items sync pull failed", error);
        return [];
      }
    },
    async push() {
      try {
        if (!AuthManager.isAuthenticated) {
          return false;
        }
        const items = await watchedItemsRepository.getAll(5e3);
        await SupabaseApi.rpc(PUSH_RPC4, {
          p_profile_id: resolveProfileId4(),
          p_items: items.map((item) => toRemoteItem2(item))
        }, true);
        return true;
      } catch (error) {
        console.warn("Watched items sync push failed", error);
        return false;
      }
    }
  };

  // js/core/profile/pluginSyncService.js
  var TABLE4 = "plugins";
  var PUSH_RPC5 = "sync_push_plugins";
  function resolveProfileId5() {
    const raw = Number(ProfileManager.getActiveProfileId() || 1);
    if (Number.isFinite(raw) && raw > 0) {
      return Math.trunc(raw);
    }
    return 1;
  }
  async function resolvePluginProfileId() {
    const profileId = resolveProfileId5();
    if (profileId === 1) {
      return 1;
    }
    const profiles = await ProfileManager.getProfiles();
    const activeProfile = profiles.find((profile) => {
      const id = Number((profile == null ? void 0 : profile.profileIndex) || (profile == null ? void 0 : profile.id) || 1);
      return Number.isFinite(id) && Math.trunc(id) === profileId;
    });
    const usesPrimaryPlugins = typeof (activeProfile == null ? void 0 : activeProfile.usesPrimaryPlugins) === "boolean" ? activeProfile.usesPrimaryPlugins : typeof (activeProfile == null ? void 0 : activeProfile.uses_primary_plugins) === "boolean" ? activeProfile.uses_primary_plugins : false;
    return usesPrimaryPlugins ? 1 : profileId;
  }
  function shouldTryLegacyTable3(error) {
    if (!error) {
      return false;
    }
    if (error.status === 404) {
      return true;
    }
    if (typeof error.code === "string" && (error.code === "PGRST205" || error.code === "PGRST202")) {
      return true;
    }
    const message = String(error.message || "");
    return message.includes("PGRST205") || message.includes("PGRST202") || message.includes("Could not find the table") || message.includes("Could not find the function");
  }
  function sourceIdFromUrl(url, index) {
    const compact = String(url || "").replace(/[^a-z0-9]/gi, "").slice(-18).toLowerCase();
    return `plugin_${index + 1}_${compact || "source"}`;
  }
  function mapRemoteRowsToSources(rows = []) {
    return (rows || []).map((row, index) => {
      const url = row.url || row.url_template || row.urlTemplate || "";
      if (!url) {
        return null;
      }
      return {
        id: sourceIdFromUrl(url, index),
        name: row.name || `Plugin ${index + 1}`,
        urlTemplate: url,
        enabled: row.enabled !== false
      };
    }).filter(Boolean);
  }
  function sourceKey(source = {}) {
    return String(source.urlTemplate || "").trim();
  }
  function mergeSources(localSources = [], remoteSources = []) {
    if (!remoteSources.length) {
      return [...localSources];
    }
    const localByKey = /* @__PURE__ */ new Map();
    localSources.forEach((source) => {
      const key = sourceKey(source);
      if (!key) {
        return;
      }
      localByKey.set(key, source);
    });
    const merged = [];
    remoteSources.forEach((remoteSource, index) => {
      const key = sourceKey(remoteSource);
      if (!key) {
        return;
      }
      const localSource = localByKey.get(key);
      merged.push({
        ...localSource || {},
        ...remoteSource,
        id: remoteSource.id || (localSource == null ? void 0 : localSource.id) || sourceIdFromUrl(key, index)
      });
      localByKey.delete(key);
    });
    localByKey.forEach((localSource) => {
      merged.push(localSource);
    });
    return merged;
  }
  function readLocalSources() {
    return PluginRuntime.listSources();
  }
  function writeLocalSources(sources) {
    PluginRuntime.saveSources(sources || []);
  }
  var PluginSyncService = {
    async pull() {
      try {
        if (!AuthManager.isAuthenticated) {
          return [];
        }
        const localSources = readLocalSources();
        const profileId = await resolvePluginProfileId();
        const ownerId = await AuthManager.getEffectiveUserId();
        const rows = await SupabaseApi.select(
          TABLE4,
          `user_id=eq.${encodeURIComponent(ownerId)}&profile_id=eq.${profileId}&select=url,name,enabled,sort_order&order=sort_order.asc`,
          true
        );
        const remoteSources = mapRemoteRowsToSources(rows);
        if (!remoteSources.length && localSources.length) {
          return localSources;
        }
        const mergedSources = mergeSources(localSources, remoteSources);
        writeLocalSources(mergedSources);
        return mergedSources;
      } catch (error) {
        console.warn("Plugin sync pull failed", error);
        return [];
      }
    },
    async push() {
      try {
        if (!AuthManager.isAuthenticated) {
          return false;
        }
        const profileId = await resolvePluginProfileId();
        const sources = readLocalSources();
        try {
          await SupabaseApi.rpc(PUSH_RPC5, {
            p_profile_id: profileId,
            p_plugins: sources.map((source, index) => ({
              url: source.urlTemplate,
              name: source.name || `Plugin ${index + 1}`,
              enabled: source.enabled !== false,
              sort_order: index
            }))
          }, true);
          return true;
        } catch (rpcError) {
          if (!shouldTryLegacyTable3(rpcError)) {
            throw rpcError;
          }
        }
        const ownerId = await AuthManager.getEffectiveUserId();
        const rows = sources.map((source, index) => ({
          user_id: ownerId,
          profile_id: profileId,
          url: source.urlTemplate,
          name: source.name || `Plugin ${index + 1}`,
          enabled: source.enabled !== false,
          sort_order: index
        }));
        await SupabaseApi.delete(
          TABLE4,
          `user_id=eq.${encodeURIComponent(ownerId)}&profile_id=eq.${profileId}`,
          true
        );
        if (rows.length) {
          try {
            await SupabaseApi.upsert(TABLE4, rows, "user_id,profile_id,url", true);
          } catch (upsertError) {
            await SupabaseApi.upsert(TABLE4, rows, null, true);
          }
        }
        return true;
      } catch (error) {
        console.warn("Plugin sync push failed", error);
        return false;
      }
    }
  };

  // js/core/profile/startupSyncService.js
  var SYNC_INTERVAL_MS = 12e4;
  var ADDON_PUSH_DEBOUNCE_MS = 1e3;
  var MAX_PULL_ATTEMPTS = 3;
  function sleep(ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
  var StartupSyncService = {
    started: false,
    intervalId: null,
    inFlight: false,
    addonPushTimer: null,
    unsubscribeAddonChanges: null,
    async start() {
      if (this.started) {
        return;
      }
      this.started = true;
      this.unsubscribeAddonChanges = addonRepository.onInstalledAddonsChanged(() => {
        this.scheduleAddonPush();
      });
      await this.syncPull();
      this.intervalId = setInterval(() => {
        this.syncCycle();
      }, SYNC_INTERVAL_MS);
    },
    stop() {
      this.started = false;
      if (this.intervalId) {
        clearInterval(this.intervalId);
        this.intervalId = null;
      }
      if (this.addonPushTimer) {
        clearTimeout(this.addonPushTimer);
        this.addonPushTimer = null;
      }
      if (this.unsubscribeAddonChanges) {
        this.unsubscribeAddonChanges();
        this.unsubscribeAddonChanges = null;
      }
    },
    async syncPull() {
      if (!AuthManager.isAuthenticated) {
        return;
      }
      for (let attempt = 1; attempt <= MAX_PULL_ATTEMPTS; attempt += 1) {
        try {
          await ProfileSyncService.pull();
          await PluginSyncService.pull();
          await LibrarySyncService.pull();
          await SavedLibrarySyncService.pull();
          await WatchedItemsSyncService.pull();
          await WatchProgressSyncService.pull();
          return;
        } catch (error) {
          console.warn(`Startup sync pull failed (attempt ${attempt}/${MAX_PULL_ATTEMPTS})`, error);
          if (attempt < MAX_PULL_ATTEMPTS) {
            await sleep(3e3);
          }
        }
      }
    },
    async syncPush() {
      if (!AuthManager.isAuthenticated) {
        return;
      }
      try {
        await ProfileSyncService.push();
        await PluginSyncService.push();
        await LibrarySyncService.push();
        await SavedLibrarySyncService.push();
        await WatchedItemsSyncService.push();
        await WatchProgressSyncService.push();
      } catch (error) {
        console.warn("Startup sync push failed", error);
      }
    },
    async syncCycle() {
      if (!this.started || this.inFlight) {
        return;
      }
      this.inFlight = true;
      try {
        await this.syncPull();
        await this.syncPush();
      } finally {
        this.inFlight = false;
      }
    },
    scheduleAddonPush() {
      if (!this.started) {
        return;
      }
      if (this.addonPushTimer) {
        clearTimeout(this.addonPushTimer);
      }
      this.addonPushTimer = setTimeout(async () => {
        this.addonPushTimer = null;
        if (!AuthManager.isAuthenticated) {
          return;
        }
        try {
          await LibrarySyncService.push();
        } catch (error) {
          console.warn("Addon auto push failed", error);
        }
      }, ADDON_PUSH_DEBOUNCE_MS);
    }
  };

  // js/core/profile/profileSelectionScreen.js
  var ProfileSelectionScreen = {
    async mount() {
      this.container = document.getElementById("profileSelection");
      if (!this.container) {
        console.error("Missing #profileSelection container");
        return;
      }
      this.container.style.display = "block";
      await ProfileSyncService.pull();
      this.profiles = await ProfileManager.getProfiles();
      if (this.profiles.length === 1) {
        await this.activateProfile(this.profiles[0].id);
        return;
      }
      this.container.innerHTML = `
      <div class="profile-screen">
        <img src="assets/brand/app_logo_wordmark.png" class="profile-logo"/>

        <h1 class="profile-title">Who's watching?</h1>
        <p class="profile-subtitle">Select a profile to continue</p>

        <div class="profile-grid" id="profileGrid"></div>

        <p class="profile-hint">Use D-pad to choose a profile</p>
      </div>
    `;
      const grid = document.getElementById("profileGrid");
      this.profiles.forEach((profile) => {
        const card = document.createElement("div");
        card.className = "profile-card focusable";
        card.dataset.profileId = profile.id;
        card.tabIndex = 0;
        card.innerHTML = `
        <div class="profile-avatar-ring">
          <div class="profile-avatar"
               style="background:${profile.avatarColorHex}">
            ${profile.name.charAt(0).toUpperCase()}
          </div>
          ${profile.isPrimary ? `<span class="profile-primary-dot" aria-hidden="true">&#9733;</span>` : ""}
        </div>
        <div class="profile-name">${profile.name}</div>
        ${profile.isPrimary ? `<div class="profile-badge">PRIMARY</div>` : ""}
      `;
        card.addEventListener("focus", () => {
          document.querySelectorAll(".profile-card").forEach((c) => c.classList.remove("focused"));
          card.classList.add("focused");
          this.updateBackground(profile.avatarColorHex);
        });
        card.addEventListener("click", async () => {
          await this.activateProfile(profile.id);
        });
        grid.appendChild(card);
      });
      ScreenUtils.indexFocusables(this.container, ".profile-card");
      ScreenUtils.setInitialFocus(this.container, ".profile-card");
    },
    async activateProfile(profileId) {
      if (!profileId) {
        return;
      }
      await ProfileManager.setActiveProfile(profileId);
      await StartupSyncService.syncPull();
      Router.navigate("home");
    },
    updateBackground(colorHex) {
      const screen = document.querySelector(".profile-screen");
      if (!screen) {
        return;
      }
      screen.style.background = `
      radial-gradient(circle at 20% 0%, ${colorHex}2e 0%, transparent 56%),
      linear-gradient(90deg, #1b466f 0%, #0a1727 62%, #050b14 100%)
    `;
    },
    async onKeyDown(event) {
      if (!this.container) {
        return;
      }
      if (ScreenUtils.handleDpadNavigation(event, this.container, ".profile-card")) {
        return;
      }
      if (event.keyCode !== 13) {
        return;
      }
      const current = this.container.querySelector(".profile-card.focused");
      if (!current) {
        return;
      }
      await this.activateProfile(current.dataset.profileId);
    },
    cleanup() {
      const container = document.getElementById("profileSelection");
      if (!container) {
        return;
      }
      container.style.display = "none";
      container.innerHTML = "";
    }
  };

  // js/ui/screens/detail/metaDetailsScreen.js
  var TMDB_BASE_URL3 = "https://api.themoviedb.org/3";
  function toEpisodeEntry(video = {}) {
    const season = Number(video.season || 0);
    const episode = Number(video.episode || 0);
    const runtimeMinutes = Number(
      video.runtime || video.runtimeMinutes || video.durationMinutes || video.duration || 0
    );
    return {
      id: video.id || "",
      title: video.title || video.name || `S${season}E${episode}`,
      season,
      episode,
      thumbnail: video.thumbnail || null,
      overview: video.overview || video.description || "",
      runtimeMinutes: Number.isFinite(runtimeMinutes) && runtimeMinutes > 0 ? runtimeMinutes : 0
    };
  }
  function normalizeEpisodes(videos = []) {
    return videos.map((video) => toEpisodeEntry(video)).filter((video) => video.id && video.season > 0 && video.episode > 0).sort((left, right) => {
      if (left.season !== right.season) {
        return left.season - right.season;
      }
      return left.episode - right.episode;
    });
  }
  function extractCast(meta = {}) {
    var _a;
    const toPhoto = (value) => {
      const raw = String(value || "").trim();
      if (!raw) {
        return "";
      }
      if (raw.startsWith("//")) {
        return `https:${raw}`;
      }
      if (raw.startsWith("http://")) {
        return `https://${raw.slice("http://".length)}`;
      }
      if (raw.startsWith("http://") || raw.startsWith("https://")) {
        return raw;
      }
      if (raw.startsWith("/")) {
        return `https://image.tmdb.org/t/p/w300${raw}`;
      }
      return raw;
    };
    const members = Array.isArray(meta.castMembers) ? meta.castMembers : [];
    if (members.length) {
      return members.map((entry) => ({
        name: (entry == null ? void 0 : entry.name) || "",
        character: (entry == null ? void 0 : entry.character) || (entry == null ? void 0 : entry.role) || "",
        photo: toPhoto(
          (entry == null ? void 0 : entry.photo) || (entry == null ? void 0 : entry.profilePath) || (entry == null ? void 0 : entry.profile_path) || (entry == null ? void 0 : entry.avatar) || (entry == null ? void 0 : entry.image) || (entry == null ? void 0 : entry.poster) || ""
        ),
        tmdbId: (entry == null ? void 0 : entry.tmdbId) || (entry == null ? void 0 : entry.id) || null
      })).filter((entry) => Boolean(entry == null ? void 0 : entry.name)).slice(0, 18);
    }
    const direct = Array.isArray(meta.cast) ? meta.cast : [];
    if (direct.length) {
      return direct.map((entry) => {
        if (typeof entry === "string") {
          return { name: entry, character: "", photo: "", tmdbId: null };
        }
        return {
          name: (entry == null ? void 0 : entry.name) || "",
          character: (entry == null ? void 0 : entry.character) || "",
          photo: toPhoto(
            (entry == null ? void 0 : entry.photo) || (entry == null ? void 0 : entry.profilePath) || (entry == null ? void 0 : entry.profile_path) || (entry == null ? void 0 : entry.avatar) || (entry == null ? void 0 : entry.image) || (entry == null ? void 0 : entry.poster) || ""
          ),
          tmdbId: (entry == null ? void 0 : entry.tmdbId) || (entry == null ? void 0 : entry.id) || null
        };
      }).filter((entry) => Boolean(entry == null ? void 0 : entry.name)).slice(0, 12);
    }
    const credits = (_a = meta.credits) == null ? void 0 : _a.cast;
    if (Array.isArray(credits)) {
      return credits.map((entry) => ({
        name: (entry == null ? void 0 : entry.name) || (entry == null ? void 0 : entry.character) || "",
        character: (entry == null ? void 0 : entry.character) || "",
        photo: toPhoto(
          (entry == null ? void 0 : entry.profile_path) || (entry == null ? void 0 : entry.photo) || (entry == null ? void 0 : entry.profilePath) || (entry == null ? void 0 : entry.avatar_path) || (entry == null ? void 0 : entry.avatar) || (entry == null ? void 0 : entry.image) || ""
        ),
        tmdbId: (entry == null ? void 0 : entry.id) || null
      })).filter((entry) => Boolean(entry.name)).slice(0, 12);
    }
    return [];
  }
  function isBackEvent2(event) {
    return Environment.isBackEvent(event);
  }
  function getDpadDirection(event) {
    const keyCode = Number((event == null ? void 0 : event.keyCode) || 0);
    const key = String((event == null ? void 0 : event.key) || "").toLowerCase();
    if (keyCode === 37 || key === "arrowleft" || key === "left") return "left";
    if (keyCode === 39 || key === "arrowright" || key === "right") return "right";
    if (keyCode === 38 || key === "arrowup" || key === "up") return "up";
    if (keyCode === 40 || key === "arrowdown" || key === "down") return "down";
    return null;
  }
  async function withTimeout2(promise, ms, fallbackValue) {
    let timer = null;
    try {
      return await Promise.race([
        promise,
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(fallbackValue), ms);
        })
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
  function detectQuality(text = "") {
    const value = String(text).toLowerCase();
    if (value.includes("2160") || value.includes("4k")) return "4K";
    if (value.includes("1080")) return "1080p";
    if (value.includes("720")) return "720p";
    return "Auto";
  }
  function renderImdbBadge(rating) {
    const raw = String(rating != null ? rating : "").trim();
    if (!raw) {
      return "";
    }
    const normalized = raw.replace(",", ".");
    const parsed = Number(normalized);
    const value = Number.isFinite(parsed) ? String(parsed.toFixed(1)).replace(".", ",") : raw;
    return `
    <span class="series-imdb-badge">
      <img src="assets/icons/imdb_logo_2016.svg" alt="IMDb" />
      <span>${value}</span>
    </span>
  `;
  }
  function resolveImdbRating(meta = {}) {
    var _a, _b;
    if ((meta == null ? void 0 : meta.imdbRating) != null && String(meta.imdbRating).trim() !== "") {
      return meta.imdbRating;
    }
    if ((meta == null ? void 0 : meta.imdb_score) != null && String(meta.imdb_score).trim() !== "") {
      return meta.imdb_score;
    }
    if (((_a = meta == null ? void 0 : meta.ratings) == null ? void 0 : _a.imdb) != null && String(meta.ratings.imdb).trim() !== "") {
      return meta.ratings.imdb;
    }
    if (((_b = meta == null ? void 0 : meta.mdbListRatings) == null ? void 0 : _b.imdb) != null && String(meta.mdbListRatings.imdb).trim() !== "") {
      return meta.mdbListRatings.imdb;
    }
    return null;
  }
  function formatRuntimeMinutes(runtime) {
    const minutes = Number(runtime || 0);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      return "";
    }
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }
  function resolveEpisodeRuntimeForSeason(episodes = [], season = null) {
    const seasonNumber = Number(season || 0);
    const inSeason = episodes.find((episode) => Number(episode.season || 0) === seasonNumber && Number(episode.runtimeMinutes || 0) > 0);
    if (inSeason) {
      return Number(inSeason.runtimeMinutes || 0);
    }
    const anyEpisode = episodes.find((episode) => Number(episode.runtimeMinutes || 0) > 0);
    return anyEpisode ? Number(anyEpisode.runtimeMinutes || 0) : 0;
  }
  function renderPlayGlyph() {
    return `<img class="series-btn-svg" src="assets/icons/trailer_play_button.svg" alt="" aria-hidden="true" />`;
  }
  function ratingToneClass(value) {
    const num = Number(value || 0);
    if (num >= 8.5) return "excellent";
    if (num >= 8) return "great";
    if (num >= 7) return "good";
    if (num >= 6) return "mixed";
    if (num > 0) return "bad";
    return "normal";
  }
  function getAddonIconPath(addonName = "") {
    const value = String(addonName || "").toLowerCase();
    if (!value) {
      return "";
    }
    if (value.includes("trakt")) {
      return "assets/icons/trakt_tv_favicon.svg";
    }
    if (value.includes("letterboxd")) {
      return "assets/icons/mdblist_letterboxd.svg";
    }
    if (value.includes("tmdb")) {
      return "assets/icons/mdblist_tmdb.svg";
    }
    if (value.includes("tomato")) {
      return "assets/icons/mdblist_tomatoes.svg";
    }
    if (value.includes("mdblist")) {
      return "assets/icons/mdblist_trakt.svg";
    }
    return "";
  }
  var MetaDetailsScreen = {
    async mount(params = {}) {
      this.container = document.getElementById("detail");
      ScreenUtils.show(this.container);
      this.params = params;
      this.pendingEpisodeSelection = null;
      this.pendingMovieSelection = null;
      this.streamChooserFocus = null;
      this.streamChooserLoadToken = 0;
      this.isLoadingDetail = true;
      this.detailLoadToken = (this.detailLoadToken || 0) + 1;
      this.seriesInsightTab = this.seriesInsightTab || "cast";
      this.movieInsightTab = this.movieInsightTab || "cast";
      this.selectedRatingSeason = this.selectedRatingSeason || 1;
      this.backHandler = (event) => {
        if (!isBackEvent2(event)) {
          return;
        }
        if (typeof event.preventDefault === "function") {
          event.preventDefault();
        }
        if (typeof event.stopPropagation === "function") {
          event.stopPropagation();
        }
        if (typeof event.stopImmediatePropagation === "function") {
          event.stopImmediatePropagation();
        }
        if (this.consumeBackRequest()) {
          return;
        }
        Router.back();
      };
      document.addEventListener("keydown", this.backHandler, true);
      this.container.innerHTML = `
      <div class="detail-loading-shell" aria-label="Loading detail">
        <div class="detail-loading-top">
          <div class="detail-loading-block detail-loading-poster"></div>
        </div>
        <div class="detail-loading-meta">
          <div class="detail-loading-block detail-loading-pill"></div>
          <div class="detail-loading-block detail-loading-pill short"></div>
        </div>
        <div class="detail-loading-copy">
          <div class="detail-loading-block detail-loading-line"></div>
          <div class="detail-loading-block detail-loading-line wide"></div>
          <div class="detail-loading-block detail-loading-line mid"></div>
        </div>
        <div class="detail-loading-tags">
          <div class="detail-loading-block detail-loading-tag"></div>
          <div class="detail-loading-block detail-loading-tag"></div>
          <div class="detail-loading-block detail-loading-tag"></div>
          <div class="detail-loading-block detail-loading-tag"></div>
        </div>
        <div class="detail-loading-tags">
          <div class="detail-loading-block detail-loading-chip"></div>
          <div class="detail-loading-block detail-loading-chip"></div>
        </div>
      </div>
    `;
      await this.loadDetail();
    },
    async loadDetail() {
      var _a;
      const token = this.detailLoadToken;
      const { itemId, itemType = "movie", fallbackTitle = "Untitled" } = this.params || {};
      if (!itemId) {
        this.renderError("Item id mancante.");
        return;
      }
      const metaResult = await withTimeout2(
        metaRepository.getMetaFromAllAddons(itemType, itemId),
        4500,
        { status: "error", message: "timeout" }
      );
      const meta = metaResult.status === "success" ? metaResult.data : { id: itemId, type: itemType, name: fallbackTitle, description: "" };
      const [isSaved, progress, watchedItem] = await Promise.all([
        savedLibraryRepository.isSaved(itemId),
        watchProgressRepository.getProgressByContentId(itemId),
        watchedItemsRepository.isWatched(itemId)
      ]);
      if (token !== this.detailLoadToken) {
        return;
      }
      this.isSavedInLibrary = isSaved;
      this.isMarkedWatched = Boolean(
        watchedItem || progress && Number(progress.durationMs || 0) > 0 && Number(progress.positionMs || 0) >= Number(progress.durationMs || 0)
      );
      this.meta = meta;
      this.episodes = normalizeEpisodes((meta == null ? void 0 : meta.videos) || []);
      this.castItems = extractCast(meta);
      this.selectedSeason = this.selectedSeason || ((_a = this.episodes[0]) == null ? void 0 : _a.season) || 1;
      this.selectedRatingSeason = this.selectedRatingSeason || this.selectedSeason || 1;
      this.nextEpisodeToWatch = this.computeNextEpisodeToWatch(progress);
      this.moreLikeThisItems = [];
      this.streamItems = [];
      if (itemType === "series" || itemType === "tv") {
        this.seriesRatingsBySeason = {};
      } else {
        this.seriesRatingsBySeason = {};
      }
      this.render(meta);
      this.isLoadingDetail = false;
      (async () => {
        var _a2, _b;
        const enrichedMeta = await withTimeout2(this.enrichMeta(meta), 4e3, meta);
        if (token !== this.detailLoadToken) {
          return;
        }
        this.meta = enrichedMeta || meta;
        this.episodes = normalizeEpisodes(((_a2 = this.meta) == null ? void 0 : _a2.videos) || []);
        this.castItems = extractCast(this.meta);
        if (!this.castItems.length) {
          const fallbackCast = await withTimeout2(this.fetchTmdbCastFallback(this.meta), 3200, []);
          if (Array.isArray(fallbackCast) && fallbackCast.length) {
            this.castItems = fallbackCast;
          }
        }
        this.selectedSeason = this.selectedSeason || ((_b = this.episodes[0]) == null ? void 0 : _b.season) || 1;
        this.selectedRatingSeason = this.selectedRatingSeason || this.selectedSeason || 1;
        this.nextEpisodeToWatch = this.computeNextEpisodeToWatch(progress);
        this.render(this.meta);
        const tasks = [
          withTimeout2(this.fetchMoreLikeThis(this.meta), 5e3, [])
        ];
        if (itemType === "series" || itemType === "tv") {
          tasks.push(withTimeout2(this.fetchSeriesRatingsBySeason(this.meta), 5e3, {}));
        }
        const results = await Promise.all(tasks);
        if (token !== this.detailLoadToken) {
          return;
        }
        this.moreLikeThisItems = Array.isArray(results[0]) ? results[0] : [];
        if (itemType === "series" || itemType === "tv") {
          this.seriesRatingsBySeason = results[1] || {};
        }
        this.render(this.meta);
      })().catch((error) => {
        console.warn("Detail background enrichment failed", error);
      });
    },
    async fetchMoreLikeThis(meta) {
      try {
        const sourceTitle = String((meta == null ? void 0 : meta.name) || "").trim();
        if (!sourceTitle) {
          return [];
        }
        const terms = sourceTitle.split(/\s+/).filter((word) => word.length > 2).slice(0, 3).join(" ");
        if (!terms) {
          return [];
        }
        const wantedType = (meta == null ? void 0 : meta.type) === "tv" ? "series" : (meta == null ? void 0 : meta.type) || "movie";
        const addons = await addonRepository.getInstalledAddons();
        const searchableCatalogs = [];
        addons.forEach((addon) => {
          addon.catalogs.forEach((catalog) => {
            const requiresSearch = (catalog.extra || []).some((extra) => extra.name === "search");
            if (!requiresSearch || catalog.apiType !== wantedType) {
              return;
            }
            searchableCatalogs.push({
              addonBaseUrl: addon.baseUrl,
              addonId: addon.id,
              addonName: addon.displayName,
              catalogId: catalog.id,
              catalogName: catalog.name,
              type: catalog.apiType
            });
          });
        });
        const responses = await Promise.all(searchableCatalogs.slice(0, 6).map(async (catalog) => {
          var _a;
          const result = await catalogRepository.getCatalog({
            addonBaseUrl: catalog.addonBaseUrl,
            addonId: catalog.addonId,
            addonName: catalog.addonName,
            catalogId: catalog.catalogId,
            catalogName: catalog.catalogName,
            type: catalog.type,
            extraArgs: { search: terms },
            supportsSkip: true,
            skip: 0
          });
          return (result == null ? void 0 : result.status) === "success" ? ((_a = result.data) == null ? void 0 : _a.items) || [] : [];
        }));
        const flat = responses.flat();
        const unique2 = [];
        const seen = /* @__PURE__ */ new Set();
        flat.forEach((item) => {
          if (!(item == null ? void 0 : item.id) || item.id === (meta == null ? void 0 : meta.id) || seen.has(item.id)) {
            return;
          }
          seen.add(item.id);
          unique2.push(item);
        });
        return unique2.slice(0, 12);
      } catch (error) {
        console.warn("More like this load failed", error);
        return [];
      }
    },
    computeNextEpisodeToWatch(progress) {
      var _a;
      if (!((_a = this.episodes) == null ? void 0 : _a.length)) {
        return null;
      }
      const currentVideoId = (progress == null ? void 0 : progress.videoId) || null;
      if (!currentVideoId) {
        return this.episodes[0];
      }
      const currentIndex = this.episodes.findIndex((episode) => episode.id === currentVideoId);
      if (currentIndex < 0) {
        return this.episodes[0];
      }
      return this.episodes[currentIndex + 1] || this.episodes[currentIndex] || this.episodes[0];
    },
    async enrichMeta(meta) {
      var _a;
      const settings = TmdbSettingsStore.get();
      if (!settings.enabled || !settings.apiKey || !(meta == null ? void 0 : meta.id)) {
        return meta;
      }
      try {
        const tmdbId = await TmdbService.ensureTmdbId(meta.id, meta.type);
        if (!tmdbId) {
          return meta;
        }
        const enrichment = await TmdbMetadataService.fetchEnrichment({
          tmdbId,
          contentType: meta.type,
          language: settings.language
        });
        if (!enrichment) {
          return meta;
        }
        return {
          ...meta,
          name: settings.useBasicInfo ? enrichment.localizedTitle || meta.name : meta.name,
          description: settings.useBasicInfo ? enrichment.description || meta.description : meta.description,
          background: settings.useArtwork ? enrichment.backdrop || meta.background : meta.background,
          poster: settings.useArtwork ? enrichment.poster || meta.poster : meta.poster,
          logo: settings.useArtwork ? enrichment.logo || meta.logo : meta.logo,
          genres: settings.useDetails && ((_a = enrichment.genres) == null ? void 0 : _a.length) ? enrichment.genres : meta.genres,
          releaseInfo: settings.useDetails ? enrichment.releaseInfo || meta.releaseInfo : meta.releaseInfo,
          tmdbRating: typeof enrichment.rating === "number" ? Number(enrichment.rating.toFixed(1)) : meta.tmdbRating || null,
          credits: enrichment.credits || meta.credits || null,
          companies: Array.isArray(enrichment.companies) ? enrichment.companies : meta.companies || []
        };
      } catch (error) {
        console.warn("Meta TMDB enrichment failed", error);
        return meta;
      }
    },
    async searchTmdbIdByTitle(meta = {}, contentType = "movie") {
      var _a;
      const settings = TmdbSettingsStore.get();
      const apiKey = String(settings.apiKey || "").trim();
      if (!settings.enabled || !apiKey) {
        return null;
      }
      const name = String((meta == null ? void 0 : meta.name) || "").trim();
      if (!name) {
        return null;
      }
      const type = contentType === "series" || contentType === "tv" ? "tv" : "movie";
      const releaseYear = ((_a = String((meta == null ? void 0 : meta.releaseInfo) || "").match(/\b(19|20)\d{2}\b/)) == null ? void 0 : _a[0]) || "";
      const yearParam = releaseYear ? type === "tv" ? `&first_air_date_year=${encodeURIComponent(releaseYear)}` : `&year=${encodeURIComponent(releaseYear)}` : "";
      const url = `${TMDB_BASE_URL3}/search/${type}?api_key=${encodeURIComponent(apiKey)}&language=${encodeURIComponent(settings.language || "it-IT")}&query=${encodeURIComponent(name)}${yearParam}`;
      const response = await fetch(url);
      if (!response.ok) {
        return null;
      }
      const data = await response.json();
      const first = Array.isArray(data == null ? void 0 : data.results) ? data.results[0] : null;
      return (first == null ? void 0 : first.id) ? String(first.id) : null;
    },
    async fetchTmdbCastFallback(meta = {}) {
      var _a;
      const contentType = String((meta == null ? void 0 : meta.type) || ((_a = this.params) == null ? void 0 : _a.itemType) || "movie").toLowerCase();
      const normalizedType = contentType === "tv" ? "series" : contentType;
      let tmdbId = await TmdbService.ensureTmdbId(meta == null ? void 0 : meta.id, normalizedType);
      if (!tmdbId) {
        tmdbId = await this.searchTmdbIdByTitle(meta, normalizedType);
      }
      if (!tmdbId) {
        return [];
      }
      const enrichment = await TmdbMetadataService.fetchEnrichment({
        tmdbId,
        contentType: normalizedType,
        language: TmdbSettingsStore.get().language
      });
      const fallbackCast = extractCast({ credits: (enrichment == null ? void 0 : enrichment.credits) || null });
      return Array.isArray(fallbackCast) ? fallbackCast : [];
    },
    async fetchSeriesRatingsBySeason(meta) {
      var _a;
      try {
        if (!(meta == null ? void 0 : meta.id) || !((_a = this.episodes) == null ? void 0 : _a.length)) {
          return {};
        }
        const tmdbId = await TmdbService.ensureTmdbId(meta.id, "series");
        if (!tmdbId) {
          return {};
        }
        const seasons = Array.from(new Set(this.episodes.map((episode) => Number(episode.season || 0)).filter((value) => value > 0)));
        const entries = await Promise.all(seasons.map(async (season) => {
          const ratings = await TmdbMetadataService.fetchSeasonRatings({
            tmdbId,
            seasonNumber: season,
            language: TmdbSettingsStore.get().language
          });
          return [season, ratings];
        }));
        return Object.fromEntries(entries);
      } catch (error) {
        console.warn("Series ratings enrichment failed", error);
        return {};
      }
    },
    flattenStreams(streamResult) {
      if (!streamResult || streamResult.status !== "success") {
        return [];
      }
      return (streamResult.data || []).flatMap((group) => {
        const groupName = group.addonName || "Addon";
        return (group.streams || []).map((stream, index) => ({
          id: `${groupName}-${index}-${stream.url || ""}`,
          label: stream.title || stream.name || `${groupName} stream`,
          description: stream.description || stream.name || "",
          addonName: groupName,
          addonLogo: group.addonLogo || stream.addonLogo || null,
          sourceType: stream.type || stream.source || "",
          url: stream.url,
          raw: stream
        })).filter((stream) => Boolean(stream.url));
      });
    },
    mergeStreamItems(existing = [], incoming = []) {
      const byKey = /* @__PURE__ */ new Set();
      const merged = [];
      const push = (item) => {
        if (!(item == null ? void 0 : item.url)) {
          return;
        }
        const key = [
          String(item.addonName || "Addon"),
          String(item.url || ""),
          String(item.sourceType || ""),
          String(item.label || "")
        ].join("::");
        if (byKey.has(key)) {
          return;
        }
        byKey.add(key);
        merged.push(item);
      };
      (existing || []).forEach(push);
      (incoming || []).forEach(push);
      return merged;
    },
    render(meta) {
      const isSeries = meta.type === "series" || meta.type === "tv";
      if (isSeries) {
        this.renderSeriesLayout(meta);
        return;
      }
      this.renderMovieLayout(meta);
    },
    renderSeriesLayout(meta) {
      var _a, _b, _c;
      const backdrop = meta.background || meta.poster || "";
      const logoOrTitle = meta.logo ? `<img src="${meta.logo}" class="series-detail-logo" alt="${meta.name || "logo"}" />` : `<h1 class="series-detail-title">${meta.name || "Untitled"}</h1>`;
      const nextEpisodeLabel = this.nextEpisodeToWatch ? `Next S${this.nextEpisodeToWatch.season}E${this.nextEpisodeToWatch.episode}` : "Play";
      const imdbBadge = renderImdbBadge(resolveImdbRating(meta));
      const runtimeText = formatRuntimeMinutes(
        meta.runtime || meta.runtimeMinutes || resolveEpisodeRuntimeForSeason(this.episodes, this.selectedSeason) || 0
      );
      const metaInfo = [
        ...Array.isArray(meta.genres) ? meta.genres.slice(0, 3) : [],
        runtimeText,
        meta.releaseInfo || ""
      ].filter(Boolean).join(" \u2022 ");
      const writerLine = Array.isArray(meta.writers) ? meta.writers.slice(0, 2).join(", ") : meta.writer || "";
      const countryLine = Array.isArray(meta.country) ? meta.country.slice(0, 2).join(", ") : meta.country || "";
      if (!this.selectedRatingSeason || !((_a = this.seriesRatingsBySeason) == null ? void 0 : _a[this.selectedRatingSeason])) {
        this.selectedRatingSeason = this.selectedSeason || ((_c = (_b = this.episodes) == null ? void 0 : _b[0]) == null ? void 0 : _c.season) || 1;
      }
      this.container.innerHTML = `
      <div class="series-detail-shell">
        <div class="series-detail-backdrop"${backdrop ? ` style="background-image:url('${backdrop}')"` : ""}></div>
        <div class="series-detail-vignette"></div>

        <div class="series-detail-content">
          ${logoOrTitle}
          <div class="series-detail-actions">
            <button class="series-primary-btn focusable" data-action="playDefault">
              <span class="series-btn-icon">${renderPlayGlyph()}</span>
              <span>${nextEpisodeLabel}</span>
            </button>
            <button class="series-circle-btn focusable" data-action="toggleLibrary">
              ${this.isSavedInLibrary ? "-" : `<img class="series-btn-svg" src="assets/icons/library_add_plus.svg" alt="" aria-hidden="true" />`}
            </button>
          </div>
          ${writerLine ? `<p class="series-detail-support">Writer: ${writerLine}</p>` : ""}
          <p class="series-detail-description">${meta.description || "No description."}</p>
          <p class="series-detail-meta">${metaInfo}${imdbBadge}</p>
          ${countryLine ? `<p class="series-detail-support">${countryLine}</p>` : ""}

          <div class="series-season-row">${this.renderSeasonButtons()}</div>
          <div class="series-episode-track">${this.renderEpisodeCards()}</div>
          ${this.renderSeriesInsightSection()}
          ${this.renderCompanyLogosSection(meta)}
          ${this.renderMoreLikeThisSection()}
        </div>

        <div id="episodeStreamChooserMount"></div>
      </div>
    `;
      ScreenUtils.indexFocusables(this.container);
      ScreenUtils.setInitialFocus(this.container);
    },
    renderDefaultLayout(meta, streamItems) {
      const isSeries = meta.type === "series" || meta.type === "tv";
      const seasonButtons = this.renderSeasonButtons();
      const episodeCards = this.renderEpisodeCards();
      const castCards = this.renderCastCards();
      const moreLikeCards = this.renderMoreLikeCards();
      this.container.innerHTML = `
      <div class="row">
        <h2>${meta.name || "Untitled"}</h2>
        <p>${meta.description || "No description."}</p>
        <p style="opacity:0.8;">Type: ${meta.type || "unknown"} | Id: ${meta.id || "-"}</p>
      </div>
      <div class="row">
        <div class="card focusable" data-action="playDefault">${isSeries ? "Play Next Episode" : "Play"}</div>
        <div class="card focusable" data-action="toggleLibrary">${this.isSavedInLibrary ? "Remove from Library" : "Add to Library"}</div>
        <div class="card focusable" data-action="toggleWatched">${this.isMarkedWatched ? "Mark Unwatched" : "Mark Watched"}</div>
        <div class="card focusable" data-action="openSearch">Search Similar</div>
        <div class="card focusable" data-action="goBack">Back</div>
      </div>
      ${isSeries ? `
      <div class="row">
        <h3>Seasons</h3>
        <div id="detailSeasons">${seasonButtons}</div>
      </div>
      <div class="row">
        <h3>Episodes</h3>
        <div id="detailEpisodes">${episodeCards}</div>
      </div>
      ` : ""}
      ${castCards ? `
      <div class="row">
        <h3>Cast</h3>
        <div id="detailCast">${castCards}</div>
      </div>
      ` : ""}
      ${moreLikeCards ? `
      <div class="row">
        <h3>More Like This</h3>
        <div id="detailMoreLike">${moreLikeCards}</div>
      </div>
      ` : ""}
      <div class="row">
        <h3>Streams (${streamItems.length})</h3>
        <div id="detailStreams"></div>
      </div>
    `;
      const streamWrap = this.container.querySelector("#detailStreams");
      streamItems.slice(0, 30).forEach((stream, index) => {
        const node = document.createElement("div");
        node.className = "card focusable";
        node.dataset.action = "playStream";
        node.dataset.streamUrl = stream.url;
        node.dataset.streamIndex = String(index);
        node.innerHTML = `
        <div style="font-weight:700;">${stream.label}</div>
        <div style="opacity:0.8;">${stream.addonName}</div>
      `;
        streamWrap.appendChild(node);
      });
      ScreenUtils.indexFocusables(this.container);
      ScreenUtils.setInitialFocus(this.container);
    },
    renderMovieLayout(meta) {
      const backdrop = meta.background || meta.poster || "";
      const logoOrTitle = meta.logo ? `<img src="${meta.logo}" class="series-detail-logo" alt="${meta.name || "logo"}" />` : `<h1 class="series-detail-title">${meta.name || "Untitled"}</h1>`;
      const directorLine = Array.isArray(meta.director) ? meta.director.slice(0, 2).join(", ") : meta.director || "";
      const countryLine = Array.isArray(meta.country) ? meta.country.slice(0, 2).join(", ") : meta.country || "";
      const durationText = formatRuntimeMinutes(meta.runtime || meta.runtimeMinutes || 0);
      const imdbBadge = renderImdbBadge(resolveImdbRating(meta));
      const metaInfo = [
        ...Array.isArray(meta.genres) ? meta.genres.slice(0, 3) : [],
        durationText,
        meta.releaseInfo || ""
      ].filter(Boolean).join(" \u2022 ");
      this.container.innerHTML = `
      <div class="series-detail-shell movie-detail-shell">
        <div class="series-detail-backdrop"${backdrop ? ` style="background-image:url('${backdrop}')"` : ""}></div>
        <div class="series-detail-vignette"></div>

        <div class="series-detail-content movie-detail-content">
          ${logoOrTitle}
          <div class="series-detail-actions">
            <button class="series-primary-btn focusable" data-action="playDefault">
              <span class="series-btn-icon">${renderPlayGlyph()}</span>
              <span>Play</span>
            </button>
            <button class="series-circle-btn focusable" data-action="toggleLibrary">
              ${this.isSavedInLibrary ? "-" : `<img class="series-btn-svg" src="assets/icons/library_add_plus.svg" alt="" aria-hidden="true" />`}
            </button>
            <button class="series-circle-btn focusable" data-action="toggleWatched">${this.isMarkedWatched ? "&#10003;" : "&#9675;"}</button>
          </div>
          ${directorLine ? `<p class="series-detail-support">Director: ${directorLine}</p>` : ""}
          <p class="series-detail-description">${meta.description || "No description."}</p>
          <p class="series-detail-meta">${metaInfo}${imdbBadge}</p>
          ${countryLine ? `<p class="series-detail-support">${countryLine}</p>` : ""}

          ${this.renderMovieInsightSection(meta)}
          ${this.renderCompanyLogosSection(meta)}
          ${this.renderMoreLikeThisSection()}
        </div>
        <div id="movieStreamChooserMount"></div>
      </div>
    `;
      ScreenUtils.indexFocusables(this.container);
      ScreenUtils.setInitialFocus(this.container, ".movie-detail-content .focusable");
    },
    renderMovieInsightSection(meta) {
      const tabs = `
      <div class="series-insight-tabs">
        <button class="series-insight-tab focusable${this.movieInsightTab === "cast" ? " selected" : ""}" data-action="setMovieInsightTab" data-tab="cast">Creator and Cast</button>
        <span class="series-insight-divider">|</span>
        <button class="series-insight-tab focusable${this.movieInsightTab === "ratings" ? " selected" : ""}" data-action="setMovieInsightTab" data-tab="ratings">Ratings</button>
      </div>
    `;
      if (this.movieInsightTab === "ratings") {
        const imdbValue = resolveImdbRating(meta);
        const imdb = imdbValue != null && String(imdbValue).trim() !== "" ? String(imdbValue) : "-";
        const tmdb = Number.isFinite(Number(meta == null ? void 0 : meta.tmdbRating)) ? String(meta.tmdbRating) : "-";
        return `
        <section class="series-insight-section">
          ${tabs}
          <div class="movie-ratings-row">
            <article class="movie-rating-card">
              <img src="assets/icons/imdb_logo_2016.svg" alt="IMDb" />
              <div class="movie-rating-value">${imdb}</div>
            </article>
            <article class="movie-rating-card">
              <img src="assets/icons/mdblist_tmdb.svg" alt="TMDB" />
              <div class="movie-rating-value">${tmdb}</div>
            </article>
          </div>
        </section>
      `;
      }
      return `
      <section class="series-insight-section movie-cast-section">
        ${tabs}
        ${this.renderSeriesCastTrack("movie")}
      </section>
    `;
    },
    renderSeriesInsightSection() {
      const tabs = `
      <div class="series-insight-tabs">
        <button class="series-insight-tab focusable${this.seriesInsightTab === "cast" ? " selected" : ""}" data-action="setSeriesInsightTab" data-tab="cast">Creator and Cast</button>
        <span class="series-insight-divider">|</span>
        <button class="series-insight-tab focusable${this.seriesInsightTab === "ratings" ? " selected" : ""}" data-action="setSeriesInsightTab" data-tab="ratings">Ratings</button>
      </div>
    `;
      return `
      <section class="series-insight-section">
        ${tabs}
        ${this.seriesInsightTab === "ratings" ? this.renderSeriesRatingsPanel() : this.renderSeriesCastTrack("series")}
      </section>
    `;
    },
    renderSeriesCastTrack(kind = "series") {
      if (!Array.isArray(this.castItems) || !this.castItems.length) {
        return `<div class="series-insight-empty">No cast information.</div>`;
      }
      const className = kind === "movie" ? "movie-cast-track" : "series-cast-track";
      const cards = this.castItems.slice(0, 18).map((person) => `
      <article class="movie-cast-card focusable series-cast-card"
               data-action="openCastDetail"
               data-cast-id="${person.tmdbId || ""}"
               data-cast-name="${person.name || ""}"
               data-cast-role="${person.character || ""}"
               data-cast-photo="${person.photo || ""}">
        <div class="movie-cast-avatar"${person.photo ? ` style="background-image:url('${String(person.photo).replace(/'/g, "%27")}')"` : ""}></div>
        <div class="movie-cast-name">${person.name || ""}</div>
        <div class="movie-cast-role">${person.character || ""}</div>
      </article>
    `).join("");
      return `<div class="${className}">${cards}</div>`;
    },
    renderSeriesRatingsPanel() {
      var _a;
      const seasonKeys = Object.keys(this.seriesRatingsBySeason || {}).map((key) => Number(key)).filter((value) => value > 0).sort((a, b) => a - b);
      if (!seasonKeys.length) {
        return `<div class="series-insight-empty">Ratings not available.</div>`;
      }
      if (!seasonKeys.includes(Number(this.selectedRatingSeason))) {
        this.selectedRatingSeason = seasonKeys[0];
      }
      const ratings = ((_a = this.seriesRatingsBySeason) == null ? void 0 : _a[this.selectedRatingSeason]) || [];
      const seasonButtons = seasonKeys.map((season) => `
      <button class="series-rating-season focusable${season === this.selectedRatingSeason ? " selected" : ""}"
              data-action="selectRatingSeason"
              data-season="${season}">S${season}</button>
    `).join("");
      const chips = ratings.length ? ratings.map((entry) => `
          <div class="series-episode-rating-chip ${ratingToneClass(entry.rating)}">
            <span class="series-episode-rating-ep">E${entry.episode}</span>
            <span class="series-episode-rating-val">${entry.rating != null ? String(entry.rating).replace(".", ",") : "-"}</span>
          </div>
        `).join("") : `<div class="series-insight-empty">No episode ratings in this season.</div>`;
      return `
      <div class="series-rating-seasons">${seasonButtons}</div>
      <div class="series-episode-ratings-grid">${chips}</div>
    `;
    },
    renderSeasonButtons() {
      var _a;
      if (!((_a = this.episodes) == null ? void 0 : _a.length)) {
        return "<p>No episodes found.</p>";
      }
      const seasons = Array.from(new Set(this.episodes.map((episode) => episode.season)));
      return seasons.map((season) => `
      <button class="series-season-btn focusable${season === this.selectedSeason ? " selected" : ""}"
              data-action="selectSeason"
              data-season="${season}">
        Season ${season}
      </button>
    `).join("");
    },
    renderEpisodeCards() {
      var _a;
      if (!((_a = this.episodes) == null ? void 0 : _a.length)) {
        return "<p>No episodes found.</p>";
      }
      const selectedSeasonEpisodes = this.episodes.filter((episode) => episode.season === this.selectedSeason);
      if (!selectedSeasonEpisodes.length) {
        return "<p>No episodes for selected season.</p>";
      }
      return selectedSeasonEpisodes.map((episode) => `
      <article class="series-episode-card focusable"
           data-action="openEpisodeStreams"
           data-video-id="${episode.id}">
        <div class="series-episode-thumb"${episode.thumbnail ? ` style="background-image:url('${episode.thumbnail}')"` : ""}></div>
        <div class="series-episode-badge">S${String(episode.season).padStart(2, "0")}E${String(episode.episode).padStart(2, "0")}</div>
        <div class="series-episode-title">${episode.title}</div>
        <div class="series-episode-overview">${episode.overview || "Episode"}</div>
      </article>
    `).join("");
    },
    renderCastCards() {
      if (!Array.isArray(this.castItems) || !this.castItems.length) {
        return "";
      }
      return this.castItems.map((person) => `
      <div class="card focusable">
        <div style="font-weight:700;">${person.name}</div>
        <div style="opacity:0.8;">Cast</div>
      </div>
    `).join("");
    },
    renderMoreLikeCards() {
      if (!Array.isArray(this.moreLikeThisItems) || !this.moreLikeThisItems.length) {
        return "";
      }
      return this.moreLikeThisItems.map((item) => {
        var _a;
        return `
      <article class="detail-morelike-card focusable"
           data-action="openMoreLikeDetail"
           data-item-id="${item.id}"
           data-item-type="${item.type || ((_a = this.params) == null ? void 0 : _a.itemType) || "movie"}"
           data-item-title="${item.name || "Untitled"}">
        <div class="detail-morelike-poster"${item.poster ? ` style="background-image:url('${item.poster}')"` : ""}></div>
        <div class="detail-morelike-name">${item.name || "Untitled"}</div>
        <div class="detail-morelike-type">${item.type || "-"}</div>
      </article>
    `;
      }).join("");
    },
    renderMoreLikeThisSection() {
      const cards = this.renderMoreLikeCards();
      if (!cards) {
        return "";
      }
      return `
      <section class="detail-morelike-section">
        <h3 class="detail-morelike-title">More Like This</h3>
        <div class="detail-morelike-track">${cards}</div>
      </section>
    `;
    },
    renderCompanyLogosSection(meta = {}) {
      const rawCompanies = Array.isArray(meta == null ? void 0 : meta.companies) ? meta.companies : Array.isArray(meta == null ? void 0 : meta.productionCompanies) ? meta.productionCompanies : Array.isArray(meta == null ? void 0 : meta.production_companies) ? meta.production_companies : [];
      const toLogo = (logo) => {
        const value = String(logo || "").trim();
        if (!value) {
          return "";
        }
        if (value.startsWith("http://") || value.startsWith("https://")) {
          return value;
        }
        if (value.startsWith("/")) {
          return `https://image.tmdb.org/t/p/w500${value}`;
        }
        return value;
      };
      const companies = rawCompanies.map((entry) => ({
        name: (entry == null ? void 0 : entry.name) || "",
        logo: toLogo((entry == null ? void 0 : entry.logo) || (entry == null ? void 0 : entry.logoPath) || (entry == null ? void 0 : entry.logo_path) || "")
      })).filter((entry) => entry.logo || entry.name);
      if (!companies.length) {
        return "";
      }
      const logos = companies.slice(0, 10).map((company) => `
      <article class="detail-company-card">
        ${company.logo ? `<img src="${company.logo}" alt="${company.name || "Company"}" />` : `<span>${company.name || ""}</span>`}
      </article>
    `).join("");
      return `
      <section class="detail-company-section">
        <h3 class="detail-company-title">Studios</h3>
        <div class="detail-company-track">${logos}</div>
      </section>
    `;
    },
    async openEpisodeStreamChooser(videoId) {
      var _a, _b, _c, _d;
      if (!videoId || !this.meta) {
        return;
      }
      const episode = this.episodes.find((entry) => entry.id === videoId) || null;
      const requestKey = (this.streamChooserLoadToken || 0) + 1;
      this.streamChooserLoadToken = requestKey;
      this.pendingEpisodeSelection = {
        videoId,
        episode,
        streams: [],
        addonFilter: "all",
        loading: true,
        requestKey
      };
      this.streamChooserFocus = { zone: "filter", index: 0 };
      this.pendingMovieSelection = null;
      this.renderEpisodeStreamChooser();
      const streamResult = await streamRepository.getStreamsFromAllAddons(
        ((_a = this.params) == null ? void 0 : _a.itemType) || "series",
        videoId,
        {
          itemId: String(((_b = this.params) == null ? void 0 : _b.itemId) || ""),
          season: (_c = episode == null ? void 0 : episode.season) != null ? _c : null,
          episode: (_d = episode == null ? void 0 : episode.episode) != null ? _d : null,
          onChunk: (chunkResult) => {
            if (!this.pendingEpisodeSelection || this.pendingEpisodeSelection.videoId !== videoId || this.pendingEpisodeSelection.requestKey !== requestKey) {
              return;
            }
            const chunkItems = this.flattenStreams(chunkResult);
            if (!chunkItems.length) {
              return;
            }
            this.pendingEpisodeSelection.streams = this.mergeStreamItems(
              this.pendingEpisodeSelection.streams,
              chunkItems
            );
            this.renderEpisodeStreamChooser();
          }
        }
      );
      const streamItems = this.flattenStreams(streamResult);
      if (!this.pendingEpisodeSelection || this.pendingEpisodeSelection.videoId !== videoId || this.pendingEpisodeSelection.requestKey !== requestKey) {
        return;
      }
      this.pendingEpisodeSelection = {
        ...this.pendingEpisodeSelection,
        streams: this.mergeStreamItems(this.pendingEpisodeSelection.streams, streamItems),
        loading: false
      };
      this.renderEpisodeStreamChooser();
    },
    async openMovieStreamChooser() {
      var _a, _b, _c;
      const requestKey = (this.streamChooserLoadToken || 0) + 1;
      this.streamChooserLoadToken = requestKey;
      this.pendingMovieSelection = {
        streams: [],
        addonFilter: "all",
        loading: true,
        requestKey
      };
      this.streamChooserFocus = { zone: "filter", index: 0 };
      this.pendingEpisodeSelection = null;
      this.renderMovieStreamChooser();
      const streamResult = await streamRepository.getStreamsFromAllAddons(
        ((_a = this.params) == null ? void 0 : _a.itemType) || "movie",
        (_b = this.params) == null ? void 0 : _b.itemId,
        {
          itemId: String(((_c = this.params) == null ? void 0 : _c.itemId) || ""),
          onChunk: (chunkResult) => {
            if (!this.pendingMovieSelection || this.pendingMovieSelection.requestKey !== requestKey) {
              return;
            }
            const chunkItems = this.flattenStreams(chunkResult);
            if (!chunkItems.length) {
              return;
            }
            this.pendingMovieSelection.streams = this.mergeStreamItems(
              this.pendingMovieSelection.streams,
              chunkItems
            );
            this.renderMovieStreamChooser();
          }
        }
      );
      const streams = this.flattenStreams(streamResult);
      this.streamItems = streams;
      if (!this.pendingMovieSelection || this.pendingMovieSelection.requestKey !== requestKey) {
        return;
      }
      this.pendingMovieSelection = {
        ...this.pendingMovieSelection,
        streams: this.mergeStreamItems(this.pendingMovieSelection.streams, streams),
        loading: false
      };
      this.renderMovieStreamChooser();
    },
    getActivePendingSelection() {
      return this.pendingEpisodeSelection || this.pendingMovieSelection || null;
    },
    getFilteredEpisodeStreams() {
      const pending = this.getActivePendingSelection();
      if (!pending || !pending.streams.length) {
        return [];
      }
      if (pending.addonFilter === "all") {
        return pending.streams;
      }
      return pending.streams.filter((stream) => stream.addonName === pending.addonFilter);
    },
    renderEpisodeStreamChooser() {
      var _a, _b, _c;
      const mount = this.container.querySelector("#episodeStreamChooserMount");
      if (!mount) {
        return;
      }
      const pending = this.pendingEpisodeSelection;
      if (!pending) {
        mount.innerHTML = "";
        return;
      }
      const addons = Array.from(new Set(pending.streams.map((stream) => stream.addonName).filter(Boolean)));
      const filtered = this.getFilteredEpisodeStreams();
      const filterTabs = [
        `<button class="series-stream-filter focusable${pending.addonFilter === "all" ? " selected" : ""}" data-action="setStreamFilter" data-addon="all">All</button>`,
        ...addons.map((addon) => `
        <button class="series-stream-filter focusable${pending.addonFilter === addon ? " selected" : ""}" data-action="setStreamFilter" data-addon="${addon}">
          ${addon}
        </button>
      `)
      ].join("");
      const streamCards = filtered.length ? filtered.map((stream) => `
          <article class="series-stream-card focusable"
                   data-action="playEpisodeStream"
                   data-stream-id="${stream.id}">
            <div class="series-stream-title">${stream.label || "Stream"}</div>
            <div class="series-stream-desc">${stream.description || ""}</div>
            <div class="series-stream-meta">
              ${getAddonIconPath(stream.addonName) ? `<img class="series-stream-addon-icon" src="${getAddonIconPath(stream.addonName)}" alt="" aria-hidden="true" />` : ""}
              <span>${stream.addonName || "Addon"}${stream.sourceType ? ` - ${stream.sourceType}` : ""}</span>
            </div>
            <div class="series-stream-tags">
              <span class="series-stream-tag">${detectQuality(stream.label || stream.description || "")}</span>
              <span class="series-stream-tag">${String(stream.sourceType || "").toLowerCase().includes("torrent") ? "Torrent" : "Stream"}</span>
            </div>
          </article>
        `).join("") : pending.loading ? `<div class="series-stream-empty">Loading streams...</div>` : `<div class="series-stream-empty">No streams found for this filter.</div>`;
      mount.innerHTML = `
      <div class="series-stream-overlay">
        <div class="series-stream-overlay-backdrop"></div>
        <div class="series-stream-panel">
          <div class="series-stream-left">
            ${((_a = this.meta) == null ? void 0 : _a.logo) ? `<img src="${this.meta.logo}" class="series-stream-logo" alt="logo" />` : `<div class="series-stream-heading">${((_b = this.meta) == null ? void 0 : _b.name) || "Series"}</div>`}
            <div class="series-stream-episode">${pending.episode ? `S${pending.episode.season} E${pending.episode.episode}` : ""}</div>
            <div class="series-stream-episode-title">${((_c = pending.episode) == null ? void 0 : _c.title) || ""}</div>
          </div>
          <div class="series-stream-right">
            <div class="series-stream-filters">${filterTabs}</div>
            <div class="series-stream-list">${streamCards}</div>
          </div>
        </div>
      </div>
    `;
      ScreenUtils.indexFocusables(this.container);
      this.applyStreamChooserFocus();
    },
    renderMovieStreamChooser() {
      var _a, _b, _c, _d;
      const mount = this.container.querySelector("#movieStreamChooserMount");
      if (!mount) {
        return;
      }
      const pending = this.pendingMovieSelection;
      if (!pending) {
        mount.innerHTML = "";
        return;
      }
      const addons = Array.from(new Set(pending.streams.map((stream) => stream.addonName).filter(Boolean)));
      const filtered = this.getFilteredEpisodeStreams();
      const filterTabs = [
        `<button class="series-stream-filter focusable${pending.addonFilter === "all" ? " selected" : ""}" data-action="setStreamFilter" data-addon="all">All</button>`,
        ...addons.map((addon) => `
        <button class="series-stream-filter focusable${pending.addonFilter === addon ? " selected" : ""}" data-action="setStreamFilter" data-addon="${addon}">
          ${addon}
        </button>
      `)
      ].join("");
      const streamCards = filtered.length ? filtered.map((stream) => `
          <article class="series-stream-card focusable"
                   data-action="playPendingStream"
                   data-stream-id="${stream.id}">
            <div class="series-stream-title">${stream.label || "Stream"}</div>
            <div class="series-stream-desc">${stream.description || ""}</div>
            <div class="series-stream-meta">
              ${getAddonIconPath(stream.addonName) ? `<img class="series-stream-addon-icon" src="${getAddonIconPath(stream.addonName)}" alt="" aria-hidden="true" />` : ""}
              <span>${stream.addonName || "Addon"}${stream.sourceType ? ` - ${stream.sourceType}` : ""}</span>
            </div>
            <div class="series-stream-tags">
              <span class="series-stream-tag">${detectQuality(stream.label || stream.description || "")}</span>
              <span class="series-stream-tag">${String(stream.sourceType || "").toLowerCase().includes("torrent") ? "Torrent" : "Stream"}</span>
            </div>
          </article>
        `).join("") : pending.loading ? `<div class="series-stream-empty">Loading streams...</div>` : `<div class="series-stream-empty">No streams found for this filter.</div>`;
      mount.innerHTML = `
      <div class="series-stream-overlay">
        <div class="series-stream-overlay-backdrop"></div>
        <div class="series-stream-panel">
          <div class="series-stream-left">
            ${((_a = this.meta) == null ? void 0 : _a.logo) ? `<img src="${this.meta.logo}" class="series-stream-logo" alt="logo" />` : `<div class="series-stream-heading">${((_b = this.meta) == null ? void 0 : _b.name) || "Movie"}</div>`}
            <div class="series-stream-episode">${((_c = this.meta) == null ? void 0 : _c.name) || ""}</div>
            <div class="series-stream-episode-title">${Array.isArray((_d = this.meta) == null ? void 0 : _d.genres) ? this.meta.genres.slice(0, 3).join(" \u2022 ") : ""}</div>
          </div>
          <div class="series-stream-right">
            <div class="series-stream-filters">${filterTabs}</div>
            <div class="series-stream-list">${streamCards}</div>
          </div>
        </div>
      </div>
    `;
      ScreenUtils.indexFocusables(this.container);
      this.applyStreamChooserFocus();
    },
    closeEpisodeStreamChooser() {
      this.streamChooserLoadToken = (this.streamChooserLoadToken || 0) + 1;
      this.pendingEpisodeSelection = null;
      this.pendingMovieSelection = null;
      this.streamChooserFocus = null;
      this.render(this.meta);
    },
    consumeBackRequest() {
      if (this.pendingEpisodeSelection || this.pendingMovieSelection) {
        this.closeEpisodeStreamChooser();
        return true;
      }
      if (this.isLoadingDetail) {
        Router.navigate("home");
        return true;
      }
      return false;
    },
    playEpisodeFromSelectedStream(streamId) {
      var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n;
      const pending = this.pendingEpisodeSelection;
      if (!pending) {
        return;
      }
      const selectedStream = pending.streams.find((stream) => stream.id === streamId) || this.getFilteredEpisodeStreams()[0];
      if (!(selectedStream == null ? void 0 : selectedStream.url)) {
        return;
      }
      const currentIndex = this.episodes.findIndex((entry) => entry.id === pending.videoId);
      const nextEpisode = currentIndex >= 0 ? this.episodes[currentIndex + 1] || null : null;
      Router.navigate("player", {
        streamUrl: selectedStream.url,
        itemId: (_a = this.params) == null ? void 0 : _a.itemId,
        itemType: ((_b = this.params) == null ? void 0 : _b.itemType) || "series",
        videoId: pending.videoId,
        season: (_d = (_c = pending.episode) == null ? void 0 : _c.season) != null ? _d : null,
        episode: (_f = (_e = pending.episode) == null ? void 0 : _e.episode) != null ? _f : null,
        episodeLabel: pending.episode ? `S${pending.episode.season}E${pending.episode.episode}` : null,
        playerTitle: ((_g = this.meta) == null ? void 0 : _g.name) || ((_h = this.params) == null ? void 0 : _h.fallbackTitle) || ((_i = this.params) == null ? void 0 : _i.itemId) || "Untitled",
        playerSubtitle: pending.episode ? `S${pending.episode.season}E${pending.episode.episode} - ${pending.episode.title || ""}`.replace(/\s+-\s*$/, "") : "",
        playerBackdropUrl: ((_j = this.meta) == null ? void 0 : _j.background) || ((_k = this.meta) == null ? void 0 : _k.poster) || null,
        playerLogoUrl: ((_l = this.meta) == null ? void 0 : _l.logo) || null,
        parentalWarnings: ((_m = this.meta) == null ? void 0 : _m.parentalWarnings) || null,
        parentalGuide: ((_n = this.meta) == null ? void 0 : _n.parentalGuide) || null,
        episodes: this.episodes || [],
        streamCandidates: pending.streams || [],
        nextEpisodeVideoId: (nextEpisode == null ? void 0 : nextEpisode.id) || null,
        nextEpisodeLabel: nextEpisode ? `S${nextEpisode.season}E${nextEpisode.episode}` : null
      });
    },
    navigateToStreamScreenForEpisode(episode) {
      var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j;
      if (!(episode == null ? void 0 : episode.id)) {
        return;
      }
      const currentIndex = this.episodes.findIndex((entry) => entry.id === episode.id);
      const nextEpisode = currentIndex >= 0 ? this.episodes[currentIndex + 1] || null : null;
      Router.navigate("stream", {
        itemId: ((_a = this.params) == null ? void 0 : _a.itemId) || null,
        itemType: "series",
        itemTitle: ((_b = this.meta) == null ? void 0 : _b.name) || ((_c = this.params) == null ? void 0 : _c.fallbackTitle) || ((_d = this.params) == null ? void 0 : _d.itemId) || "Untitled",
        backdrop: ((_e = this.meta) == null ? void 0 : _e.background) || ((_f = this.meta) == null ? void 0 : _f.poster) || null,
        poster: ((_g = this.meta) == null ? void 0 : _g.poster) || null,
        logo: ((_h = this.meta) == null ? void 0 : _h.logo) || null,
        parentalWarnings: ((_i = this.meta) == null ? void 0 : _i.parentalWarnings) || null,
        parentalGuide: ((_j = this.meta) == null ? void 0 : _j.parentalGuide) || null,
        videoId: episode.id,
        season: episode.season,
        episode: episode.episode,
        episodeTitle: episode.title || "",
        episodes: this.episodes || [],
        nextEpisodeVideoId: (nextEpisode == null ? void 0 : nextEpisode.id) || null,
        nextEpisodeLabel: nextEpisode ? `S${nextEpisode.season}E${nextEpisode.episode}` : null
      });
    },
    navigateToStreamScreenForMovie() {
      var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l;
      Router.navigate("stream", {
        itemId: ((_a = this.params) == null ? void 0 : _a.itemId) || null,
        itemType: "movie",
        itemTitle: ((_b = this.meta) == null ? void 0 : _b.name) || ((_c = this.params) == null ? void 0 : _c.fallbackTitle) || ((_d = this.params) == null ? void 0 : _d.itemId) || "Untitled",
        itemSubtitle: Array.isArray((_e = this.meta) == null ? void 0 : _e.genres) ? this.meta.genres.slice(0, 3).join(" \u2022 ") : "",
        backdrop: ((_f = this.meta) == null ? void 0 : _f.background) || ((_g = this.meta) == null ? void 0 : _g.poster) || null,
        poster: ((_h = this.meta) == null ? void 0 : _h.poster) || null,
        logo: ((_i = this.meta) == null ? void 0 : _i.logo) || null,
        parentalWarnings: ((_j = this.meta) == null ? void 0 : _j.parentalWarnings) || null,
        parentalGuide: ((_k = this.meta) == null ? void 0 : _k.parentalGuide) || null,
        videoId: ((_l = this.params) == null ? void 0 : _l.itemId) || null,
        episodes: []
      });
    },
    playMovieFromSelectedStream(streamId) {
      var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j;
      const pending = this.pendingMovieSelection;
      if (!pending) {
        return;
      }
      const selectedStream = pending.streams.find((stream) => stream.id === streamId) || this.getFilteredEpisodeStreams()[0];
      if (!(selectedStream == null ? void 0 : selectedStream.url)) {
        return;
      }
      Router.navigate("player", {
        streamUrl: selectedStream.url,
        itemId: (_a = this.params) == null ? void 0 : _a.itemId,
        itemType: ((_b = this.params) == null ? void 0 : _b.itemType) || "movie",
        season: null,
        episode: null,
        playerTitle: ((_c = this.meta) == null ? void 0 : _c.name) || ((_d = this.params) == null ? void 0 : _d.fallbackTitle) || ((_e = this.params) == null ? void 0 : _e.itemId) || "Untitled",
        playerSubtitle: "",
        playerBackdropUrl: ((_f = this.meta) == null ? void 0 : _f.background) || ((_g = this.meta) == null ? void 0 : _g.poster) || null,
        playerLogoUrl: ((_h = this.meta) == null ? void 0 : _h.logo) || null,
        parentalWarnings: ((_i = this.meta) == null ? void 0 : _i.parentalWarnings) || null,
        parentalGuide: ((_j = this.meta) == null ? void 0 : _j.parentalGuide) || null,
        episodes: [],
        streamCandidates: pending.streams || []
      });
    },
    renderError(message) {
      this.isLoadingDetail = false;
      this.container.innerHTML = `
      <div class="row">
        <h2>Detail</h2>
        <p>${message}</p>
        <div class="card focusable" data-action="goBack">Back</div>
      </div>
    `;
      ScreenUtils.indexFocusables(this.container);
      ScreenUtils.setInitialFocus(this.container);
    },
    focusInList(list, targetIndex) {
      var _a;
      if (!Array.isArray(list) || !list.length) {
        return false;
      }
      const index = Math.max(0, Math.min(list.length - 1, targetIndex));
      const target = list[index];
      if (!target) {
        return false;
      }
      this.container.querySelectorAll(".focusable").forEach((node) => node.classList.remove("focused"));
      target.classList.add("focused");
      target.focus();
      const horizontalTrack = target.closest(".series-episode-track, .series-cast-track, .movie-cast-track, .home-track, .series-episode-ratings-grid, .series-rating-seasons");
      if (horizontalTrack) {
        const targetLeft = target.offsetLeft;
        const targetRight = targetLeft + target.offsetWidth;
        const viewLeft = horizontalTrack.scrollLeft;
        const viewRight = viewLeft + horizontalTrack.clientWidth;
        const isStrictEdgeTrack = horizontalTrack.classList.contains("series-episode-track") || horizontalTrack.classList.contains("home-track");
        const edgePadding = isStrictEdgeTrack ? 0 : 24;
        if (targetRight > viewRight - edgePadding) {
          horizontalTrack.scrollLeft = Math.max(0, targetRight - horizontalTrack.clientWidth + edgePadding);
        } else if (targetLeft < viewLeft + edgePadding) {
          horizontalTrack.scrollLeft = Math.max(0, targetLeft - edgePadding);
        }
        const detailContent = (_a = this.container) == null ? void 0 : _a.querySelector(".series-detail-content");
        if (detailContent && detailContent.contains(target)) {
          const rect = target.getBoundingClientRect();
          const contentRect = detailContent.getBoundingClientRect();
          const pad = 16;
          if (rect.bottom > contentRect.bottom - pad) {
            detailContent.scrollTop += Math.ceil(rect.bottom - contentRect.bottom + pad);
          } else if (rect.top < contentRect.top + pad) {
            detailContent.scrollTop -= Math.ceil(contentRect.top + pad - rect.top);
          }
        }
      } else if (typeof target.scrollIntoView === "function") {
        target.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
      return true;
    },
    resolvePopupFocusNode() {
      var _a;
      let current = this.container.querySelector(".focusable.focused");
      if (current) {
        return current;
      }
      const active = document.activeElement;
      if (active && ((_a = active.classList) == null ? void 0 : _a.contains("focusable")) && this.container.contains(active)) {
        active.classList.add("focused");
        return active;
      }
      const first = this.container.querySelector(".series-stream-filter.focusable, .series-stream-card.focusable");
      if (first) {
        this.container.querySelectorAll(".focusable").forEach((node) => node.classList.remove("focused"));
        first.classList.add("focused");
        first.focus();
        return first;
      }
      return null;
    },
    getStreamChooserLists() {
      const filters = Array.from(this.container.querySelectorAll(".series-stream-filter.focusable"));
      const cards = Array.from(this.container.querySelectorAll(".series-stream-card.focusable"));
      const selectedFilterIndex = Math.max(0, filters.findIndex((node) => node.classList.contains("selected")));
      return { filters, cards, selectedFilterIndex };
    },
    syncStreamChooserFocusFromDom() {
      const { filters, cards, selectedFilterIndex } = this.getStreamChooserLists();
      const activeElement = document.activeElement;
      const focusedFilterIndex = filters.findIndex((node) => node.classList.contains("focused") || node === activeElement);
      if (focusedFilterIndex >= 0) {
        this.streamChooserFocus = { zone: "filter", index: focusedFilterIndex };
        return this.streamChooserFocus;
      }
      const focusedCardIndex = cards.findIndex((node) => node.classList.contains("focused") || node === activeElement);
      if (focusedCardIndex >= 0) {
        this.streamChooserFocus = { zone: "card", index: focusedCardIndex };
        return this.streamChooserFocus;
      }
      this.streamChooserFocus = { zone: "filter", index: selectedFilterIndex };
      return this.streamChooserFocus;
    },
    applyStreamChooserFocus() {
      var _a, _b;
      const { filters, cards, selectedFilterIndex } = this.getStreamChooserLists();
      if (!filters.length && !cards.length) {
        this.streamChooserFocus = null;
        return false;
      }
      if (!this.streamChooserFocus) {
        this.syncStreamChooserFocusFromDom();
      }
      let zone = ((_a = this.streamChooserFocus) == null ? void 0 : _a.zone) || "filter";
      let index = Number(((_b = this.streamChooserFocus) == null ? void 0 : _b.index) || 0);
      if (zone === "filter" && !filters.length && cards.length) {
        zone = "card";
        index = 0;
      } else if (zone === "card" && !cards.length && filters.length) {
        zone = "filter";
        index = selectedFilterIndex;
      }
      if (zone === "filter") {
        index = Math.max(0, Math.min(filters.length - 1, index));
        this.streamChooserFocus = { zone, index };
        return this.focusInList(filters, index);
      }
      index = Math.max(0, Math.min(cards.length - 1, index));
      this.streamChooserFocus = { zone: "card", index };
      return this.focusInList(cards, index);
    },
    handleStreamChooserDpad(event) {
      var _a;
      if (!this.pendingEpisodeSelection && !this.pendingMovieSelection) {
        return false;
      }
      const pending = this.getActivePendingSelection();
      if ((pending == null ? void 0 : pending.loading) && !((_a = pending == null ? void 0 : pending.streams) == null ? void 0 : _a.length)) {
        if (typeof (event == null ? void 0 : event.preventDefault) === "function") {
          event.preventDefault();
        }
        return true;
      }
      const direction = getDpadDirection(event);
      if (!direction) {
        return false;
      }
      const { filters, cards, selectedFilterIndex } = this.getStreamChooserLists();
      const hasValidLocalFocus = this.streamChooserFocus && (this.streamChooserFocus.zone === "filter" && filters.length && Number(this.streamChooserFocus.index) >= 0 && Number(this.streamChooserFocus.index) < filters.length || this.streamChooserFocus.zone === "card" && cards.length && Number(this.streamChooserFocus.index) >= 0 && Number(this.streamChooserFocus.index) < cards.length);
      const focusState = hasValidLocalFocus ? this.streamChooserFocus : this.syncStreamChooserFocusFromDom();
      let zone = (focusState == null ? void 0 : focusState.zone) || (filters.length ? "filter" : "card");
      let index = Number((focusState == null ? void 0 : focusState.index) || 0);
      if (zone === "filter" && !filters.length && cards.length) {
        zone = "card";
        index = Math.max(0, Math.min(cards.length - 1, index));
      } else if (zone === "card" && !cards.length && filters.length) {
        zone = "filter";
        index = selectedFilterIndex;
      }
      if (zone === "filter" && filters.length) {
        const focusedFilterIndex = filters.findIndex((node) => node.classList.contains("focused") || node === document.activeElement);
        if (focusedFilterIndex >= 0) {
          index = focusedFilterIndex;
        }
      } else if (zone === "card" && cards.length) {
        const focusedCardIndex = cards.findIndex((node) => node.classList.contains("focused") || node === document.activeElement);
        if (focusedCardIndex >= 0) {
          index = focusedCardIndex;
        }
      }
      if (typeof (event == null ? void 0 : event.preventDefault) === "function") {
        event.preventDefault();
      }
      if (zone === "filter") {
        if (direction === "left") {
          this.streamChooserFocus = { zone, index: Math.max(0, index - 1) };
          return this.applyStreamChooserFocus() || true;
        }
        if (direction === "right") {
          this.streamChooserFocus = { zone, index: Math.min(filters.length - 1, index + 1) };
          return this.applyStreamChooserFocus() || true;
        }
        if (direction === "down" && cards.length) {
          this.streamChooserFocus = { zone: "card", index: Math.min(index, cards.length - 1) };
          return this.applyStreamChooserFocus() || true;
        }
        return true;
      }
      if (zone === "card") {
        if (direction === "up") {
          if (index > 0) {
            this.streamChooserFocus = { zone: "card", index: index - 1 };
            return this.applyStreamChooserFocus() || true;
          }
          if (filters.length) {
            this.streamChooserFocus = { zone: "filter", index: selectedFilterIndex };
            return this.applyStreamChooserFocus() || true;
          }
          return true;
        }
        if (direction === "down") {
          this.streamChooserFocus = { zone: "card", index: Math.min(cards.length - 1, index + 1) };
          return this.applyStreamChooserFocus() || true;
        }
        if (direction === "left" || direction === "right") {
          return true;
        }
        return true;
      }
      if (direction === "up" && filters.length) {
        this.streamChooserFocus = { zone: "filter", index: selectedFilterIndex };
        return this.applyStreamChooserFocus() || true;
      }
      if (direction === "down" && cards.length) {
        this.streamChooserFocus = { zone: "card", index: 0 };
        return this.applyStreamChooserFocus() || true;
      }
      return true;
    },
    handleSeriesDpad(event) {
      if (!this.meta || this.meta.type !== "series" && this.meta.type !== "tv" || this.pendingEpisodeSelection || this.pendingMovieSelection) {
        return false;
      }
      const keyCode = Number((event == null ? void 0 : event.keyCode) || 0);
      const direction = keyCode === 37 ? "left" : keyCode === 39 ? "right" : keyCode === 38 ? "up" : keyCode === 40 ? "down" : null;
      if (!direction) {
        return false;
      }
      const current = this.container.querySelector(".focusable.focused");
      if (!current) {
        return false;
      }
      const actions = Array.from(this.container.querySelectorAll(".series-detail-actions .focusable"));
      const seasons = Array.from(this.container.querySelectorAll(".series-season-row .series-season-btn.focusable"));
      const episodes = Array.from(this.container.querySelectorAll(".series-episode-track .series-episode-card.focusable"));
      const insightTabs = Array.from(this.container.querySelectorAll(".series-insight-tabs .series-insight-tab.focusable"));
      const castCards = Array.from(this.container.querySelectorAll(".series-cast-track .series-cast-card.focusable"));
      const ratingSeasons = Array.from(this.container.querySelectorAll(".series-rating-seasons .series-rating-season.focusable"));
      const moreLikeCards = Array.from(this.container.querySelectorAll(".detail-morelike-track .detail-morelike-card.focusable"));
      if (typeof event.preventDefault === "function") {
        event.preventDefault();
      }
      const actionIndex = actions.indexOf(current);
      if (actionIndex >= 0) {
        if (direction === "left") return this.focusInList(actions, actionIndex - 1) || true;
        if (direction === "right") return this.focusInList(actions, actionIndex + 1) || true;
        if (direction === "down") {
          if (seasons.length) {
            return this.focusInList(seasons, Math.min(actionIndex, seasons.length - 1)) || true;
          }
          if (episodes.length) {
            return this.focusInList(episodes, actionIndex) || true;
          }
        }
        return true;
      }
      const seasonIndex = seasons.indexOf(current);
      if (seasonIndex >= 0) {
        if (direction === "left") return this.focusInList(seasons, seasonIndex - 1) || true;
        if (direction === "right") return this.focusInList(seasons, seasonIndex + 1) || true;
        if (direction === "up") {
          if (actions.length) {
            return this.focusInList(actions, Math.min(seasonIndex, actions.length - 1)) || true;
          }
        }
        if (direction === "down") {
          if (episodes.length) {
            return this.focusInList(episodes, Math.min(seasonIndex, episodes.length - 1)) || true;
          }
        }
        return true;
      }
      const episodeIndex = episodes.indexOf(current);
      if (episodeIndex >= 0) {
        if (direction === "left") return this.focusInList(episodes, episodeIndex - 1) || true;
        if (direction === "right") return this.focusInList(episodes, episodeIndex + 1) || true;
        if (direction === "up") {
          if (seasons.length) {
            return this.focusInList(seasons, Math.min(episodeIndex, seasons.length - 1)) || true;
          }
          if (actions.length) {
            return this.focusInList(actions, Math.min(episodeIndex, actions.length - 1)) || true;
          }
        }
        if (direction === "down" && insightTabs.length) {
          return this.focusInList(insightTabs, 0) || true;
        }
        return true;
      }
      const tabIndex = insightTabs.indexOf(current);
      if (tabIndex >= 0) {
        if (direction === "left") return this.focusInList(insightTabs, tabIndex - 1) || true;
        if (direction === "right") return this.focusInList(insightTabs, tabIndex + 1) || true;
        if (direction === "up") {
          if (episodes.length) {
            return this.focusInList(episodes, Math.min(tabIndex, episodes.length - 1)) || true;
          }
        }
        if (direction === "down") {
          if (this.seriesInsightTab === "ratings" && ratingSeasons.length) {
            return this.focusInList(ratingSeasons, Math.min(tabIndex, ratingSeasons.length - 1)) || true;
          }
          if (castCards.length) {
            return this.focusInList(castCards, Math.min(tabIndex, castCards.length - 1)) || true;
          }
          if (moreLikeCards.length) {
            return this.focusInList(moreLikeCards, 0) || true;
          }
        }
        return true;
      }
      const castIndex = castCards.indexOf(current);
      if (castIndex >= 0) {
        if (direction === "left") return this.focusInList(castCards, castIndex - 1) || true;
        if (direction === "right") return this.focusInList(castCards, castIndex + 1) || true;
        if (direction === "up") return this.focusInList(insightTabs, 0) || true;
        if (direction === "down" && moreLikeCards.length) {
          return this.focusInList(moreLikeCards, Math.min(castIndex, moreLikeCards.length - 1)) || true;
        }
        return true;
      }
      const ratingSeasonIndex = ratingSeasons.indexOf(current);
      if (ratingSeasonIndex >= 0) {
        if (direction === "left") return this.focusInList(ratingSeasons, ratingSeasonIndex - 1) || true;
        if (direction === "right") return this.focusInList(ratingSeasons, ratingSeasonIndex + 1) || true;
        if (direction === "up") return this.focusInList(insightTabs, 1) || true;
        if (direction === "down" && moreLikeCards.length) {
          return this.focusInList(moreLikeCards, Math.min(ratingSeasonIndex, moreLikeCards.length - 1)) || true;
        }
        return true;
      }
      const moreLikeIndex = moreLikeCards.indexOf(current);
      if (moreLikeIndex >= 0) {
        if (direction === "left") return this.focusInList(moreLikeCards, moreLikeIndex - 1) || true;
        if (direction === "right") return this.focusInList(moreLikeCards, moreLikeIndex + 1) || true;
        if (direction === "up") {
          if (this.seriesInsightTab === "ratings" && ratingSeasons.length) {
            return this.focusInList(ratingSeasons, Math.min(moreLikeIndex, ratingSeasons.length - 1)) || true;
          }
          if (castCards.length) {
            return this.focusInList(castCards, Math.min(moreLikeIndex, castCards.length - 1)) || true;
          }
          return this.focusInList(insightTabs, 0) || true;
        }
        return true;
      }
      return false;
    },
    handleMovieDpad(event) {
      if (!this.meta || this.meta.type === "series" || this.meta.type === "tv" || this.pendingEpisodeSelection || this.pendingMovieSelection) {
        return false;
      }
      const keyCode = Number((event == null ? void 0 : event.keyCode) || 0);
      const direction = keyCode === 37 ? "left" : keyCode === 39 ? "right" : keyCode === 38 ? "up" : keyCode === 40 ? "down" : null;
      if (!direction) {
        return false;
      }
      const current = this.container.querySelector(".focusable.focused");
      if (!current) {
        return false;
      }
      const actions = Array.from(this.container.querySelectorAll(".series-detail-actions .focusable"));
      const tabs = Array.from(this.container.querySelectorAll(".series-insight-tabs .series-insight-tab.focusable"));
      const cast = Array.from(this.container.querySelectorAll(".movie-cast-track .movie-cast-card.focusable"));
      const moreLikeCards = Array.from(this.container.querySelectorAll(".detail-morelike-track .detail-morelike-card.focusable"));
      if (typeof (event == null ? void 0 : event.preventDefault) === "function") {
        event.preventDefault();
      }
      const actionIndex = actions.indexOf(current);
      if (actionIndex >= 0) {
        if (direction === "left") return this.focusInList(actions, actionIndex - 1) || true;
        if (direction === "right") return this.focusInList(actions, actionIndex + 1) || true;
        if (direction === "down") {
          if (tabs.length) {
            return this.focusInList(tabs, 0) || true;
          }
          if (cast.length) {
            return this.focusInList(cast, actionIndex) || true;
          }
          if (moreLikeCards.length) {
            return this.focusInList(moreLikeCards, actionIndex) || true;
          }
        }
        return true;
      }
      const tabIndex = tabs.indexOf(current);
      if (tabIndex >= 0) {
        if (direction === "left") return this.focusInList(tabs, tabIndex - 1) || true;
        if (direction === "right") return this.focusInList(tabs, tabIndex + 1) || true;
        if (direction === "up") return this.focusInList(actions, Math.min(tabIndex, actions.length - 1)) || true;
        if (direction === "down") {
          if (cast.length) return this.focusInList(cast, Math.min(tabIndex, cast.length - 1)) || true;
          if (moreLikeCards.length) return this.focusInList(moreLikeCards, Math.min(tabIndex, moreLikeCards.length - 1)) || true;
        }
        return true;
      }
      const castIndex = cast.indexOf(current);
      if (castIndex >= 0) {
        if (direction === "left") return this.focusInList(cast, castIndex - 1) || true;
        if (direction === "right") return this.focusInList(cast, castIndex + 1) || true;
        if (direction === "up") {
          if (tabs.length) {
            return this.focusInList(tabs, 0) || true;
          }
          return this.focusInList(actions, Math.min(castIndex, actions.length - 1)) || true;
        }
        if (direction === "down" && moreLikeCards.length) {
          return this.focusInList(moreLikeCards, Math.min(castIndex, moreLikeCards.length - 1)) || true;
        }
        return true;
      }
      const moreLikeIndex = moreLikeCards.indexOf(current);
      if (moreLikeIndex >= 0) {
        if (direction === "left") return this.focusInList(moreLikeCards, moreLikeIndex - 1) || true;
        if (direction === "right") return this.focusInList(moreLikeCards, moreLikeIndex + 1) || true;
        if (direction === "up") {
          if (cast.length) {
            return this.focusInList(cast, Math.min(moreLikeIndex, cast.length - 1)) || true;
          }
          if (tabs.length) {
            return this.focusInList(tabs, 0) || true;
          }
          return this.focusInList(actions, Math.min(moreLikeIndex, actions.length - 1)) || true;
        }
        return true;
      }
      return false;
    },
    async onKeyDown(event) {
      var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _A, _B, _C, _D, _E, _F, _G, _H, _I, _J;
      if (!this.container) {
        return;
      }
      if (isBackEvent2(event)) {
        if (typeof event.preventDefault === "function") {
          event.preventDefault();
        }
        if (this.pendingEpisodeSelection || this.pendingMovieSelection) {
          this.closeEpisodeStreamChooser();
          return;
        }
        Router.back();
        return;
      }
      if (this.pendingEpisodeSelection || this.pendingMovieSelection) {
        if (this.handleStreamChooserDpad(event)) {
          return;
        }
        if (getDpadDirection(event)) {
          (_a = event == null ? void 0 : event.preventDefault) == null ? void 0 : _a.call(event);
          return;
        }
      }
      if (this.handleSeriesDpad(event)) {
        return;
      }
      if (this.handleMovieDpad(event)) {
        return;
      }
      if (ScreenUtils.handleDpadNavigation(event, this.container)) {
        return;
      }
      if (event.keyCode !== 13) {
        return;
      }
      const current = this.container.querySelector(".focusable.focused");
      if (!current) {
        return;
      }
      const action = current.dataset.action;
      if (action === "goBack") {
        Router.back();
        return;
      }
      if (action === "openSearch") {
        Router.navigate("search", {
          query: ((_b = this.params) == null ? void 0 : _b.fallbackTitle) || ((_c = this.params) == null ? void 0 : _c.itemId) || ""
        });
        return;
      }
      if (action === "playDefault") {
        if (((_d = this.params) == null ? void 0 : _d.itemType) === "series" || ((_e = this.params) == null ? void 0 : _e.itemType) === "tv") {
          const targetEpisode = this.nextEpisodeToWatch || ((_f = this.episodes) == null ? void 0 : _f.find((entry) => entry.season === this.selectedSeason)) || ((_g = this.episodes) == null ? void 0 : _g[0]) || null;
          if (targetEpisode == null ? void 0 : targetEpisode.id) {
            await this.openEpisodeStreamChooser(targetEpisode.id);
          }
          return;
        }
        await this.openMovieStreamChooser();
        return;
      }
      if (action === "selectSeason") {
        const season = Number(current.dataset.season || 1);
        if (season !== this.selectedSeason) {
          this.selectedSeason = season;
          this.render(this.meta);
        }
        return;
      }
      if (action === "setSeriesInsightTab") {
        const tab = String(current.dataset.tab || "cast");
        if (tab !== this.seriesInsightTab) {
          this.seriesInsightTab = tab === "ratings" ? "ratings" : "cast";
          this.render(this.meta);
        }
        return;
      }
      if (action === "setMovieInsightTab") {
        const tab = String(current.dataset.tab || "cast");
        if (tab !== this.movieInsightTab) {
          this.movieInsightTab = tab === "ratings" ? "ratings" : "cast";
          this.render(this.meta);
        }
        return;
      }
      if (action === "selectRatingSeason") {
        const season = Number(current.dataset.season || this.selectedRatingSeason || 1);
        if (season !== this.selectedRatingSeason) {
          this.selectedRatingSeason = season;
          this.render(this.meta);
        }
        return;
      }
      if (action === "openEpisodeStreams") {
        const selectedEpisode = this.episodes.find((entry) => entry.id === current.dataset.videoId);
        if (selectedEpisode) {
          await this.openEpisodeStreamChooser(selectedEpisode.id);
        }
        return;
      }
      if (action === "setStreamFilter") {
        if (this.pendingEpisodeSelection || this.pendingMovieSelection) {
          const addon = current.dataset.addon || "all";
          if (this.pendingEpisodeSelection) {
            this.pendingEpisodeSelection.addonFilter = addon;
            const addons = Array.from(new Set(this.pendingEpisodeSelection.streams.map((stream) => stream.addonName).filter(Boolean)));
            const order = ["all", ...addons];
            this.streamChooserFocus = { zone: "filter", index: Math.max(0, order.indexOf(addon)) };
            this.renderEpisodeStreamChooser();
          } else {
            this.pendingMovieSelection.addonFilter = addon;
            const addons = Array.from(new Set(this.pendingMovieSelection.streams.map((stream) => stream.addonName).filter(Boolean)));
            const order = ["all", ...addons];
            this.streamChooserFocus = { zone: "filter", index: Math.max(0, order.indexOf(addon)) };
            this.renderMovieStreamChooser();
          }
        }
        return;
      }
      if (action === "playEpisodeStream" || action === "playPendingStream") {
        if (this.pendingEpisodeSelection) {
          this.playEpisodeFromSelectedStream(current.dataset.streamId);
        } else if (this.pendingMovieSelection) {
          this.playMovieFromSelectedStream(current.dataset.streamId);
        }
        return;
      }
      if (action === "openCastDetail") {
        Router.navigate("castDetail", {
          castId: current.dataset.castId || "",
          castName: current.dataset.castName || "",
          castRole: current.dataset.castRole || "",
          castPhoto: current.dataset.castPhoto || ""
        });
        return;
      }
      if (action === "toggleLibrary") {
        await savedLibraryRepository.toggle({
          contentId: (_h = this.params) == null ? void 0 : _h.itemId,
          contentType: ((_i = this.params) == null ? void 0 : _i.itemType) || "movie",
          title: ((_j = this.meta) == null ? void 0 : _j.name) || ((_k = this.params) == null ? void 0 : _k.fallbackTitle) || ((_l = this.params) == null ? void 0 : _l.itemId) || "Untitled",
          poster: ((_m = this.meta) == null ? void 0 : _m.poster) || null,
          background: ((_n = this.meta) == null ? void 0 : _n.background) || null
        });
        await this.loadDetail();
        return;
      }
      if (action === "toggleWatched") {
        if (this.isMarkedWatched) {
          await watchedItemsRepository.unmark((_o = this.params) == null ? void 0 : _o.itemId);
          await watchProgressRepository.removeProgress((_p = this.params) == null ? void 0 : _p.itemId);
        } else {
          await watchedItemsRepository.mark({
            contentId: (_q = this.params) == null ? void 0 : _q.itemId,
            contentType: ((_r = this.params) == null ? void 0 : _r.itemType) || "movie",
            title: ((_s = this.meta) == null ? void 0 : _s.name) || ((_t = this.params) == null ? void 0 : _t.fallbackTitle) || "Untitled",
            watchedAt: Date.now()
          });
          await watchProgressRepository.saveProgress({
            contentId: (_u = this.params) == null ? void 0 : _u.itemId,
            contentType: ((_v = this.params) == null ? void 0 : _v.itemType) || "movie",
            videoId: null,
            positionMs: 100,
            durationMs: 100,
            updatedAt: Date.now()
          });
        }
        await this.loadDetail();
        return;
      }
      if (action === "playStream" && current.dataset.streamUrl) {
        Router.navigate("player", {
          streamUrl: current.dataset.streamUrl,
          itemId: (_w = this.params) == null ? void 0 : _w.itemId,
          itemType: (_x = this.params) == null ? void 0 : _x.itemType,
          season: (_z = (_y = this.nextEpisodeToWatch) == null ? void 0 : _y.season) != null ? _z : null,
          episode: (_B = (_A = this.nextEpisodeToWatch) == null ? void 0 : _A.episode) != null ? _B : null,
          playerTitle: ((_C = this.meta) == null ? void 0 : _C.name) || ((_D = this.params) == null ? void 0 : _D.fallbackTitle) || ((_E = this.params) == null ? void 0 : _E.itemId) || "Untitled",
          playerSubtitle: ((_F = this.params) == null ? void 0 : _F.itemType) === "series" ? ((_G = this.nextEpisodeToWatch) == null ? void 0 : _G.title) || "" : "",
          playerBackdropUrl: ((_H = this.meta) == null ? void 0 : _H.background) || ((_I = this.meta) == null ? void 0 : _I.poster) || null,
          playerLogoUrl: ((_J = this.meta) == null ? void 0 : _J.logo) || null,
          episodes: this.episodes || [],
          streamCandidates: this.streamItems || []
        });
        return;
      }
      if (action === "openMoreLikeDetail") {
        Router.navigate("detail", {
          itemId: current.dataset.itemId,
          itemType: current.dataset.itemType || "movie",
          fallbackTitle: current.dataset.itemTitle || "Untitled"
        });
      }
    },
    cleanup() {
      this.detailLoadToken = (this.detailLoadToken || 0) + 1;
      if (this.backHandler) {
        document.removeEventListener("keydown", this.backHandler, true);
        this.backHandler = null;
      }
      ScreenUtils.hide(this.container);
    }
  };

  // js/ui/screens/library/libraryScreen.js
  function profileInitial2(name) {
    const raw = String(name || "").trim();
    return raw ? raw.charAt(0).toUpperCase() : "P";
  }
  function navIconSvg2(action) {
    const iconAssetByAction = {
      gotoHome: "assets/icons/sidebar_home.svg",
      gotoSearch: "assets/icons/sidebar_search.svg",
      gotoLibrary: "assets/icons/sidebar_library.svg",
      gotoPlugin: "assets/icons/sidebar_plugin.svg",
      gotoSettings: "assets/icons/sidebar_settings.svg"
    };
    return `<img class="home-nav-icon" src="${iconAssetByAction[action] || iconAssetByAction.gotoLibrary}" alt="" aria-hidden="true" />`;
  }
  async function withTimeout3(promise, ms, fallbackValue) {
    let timer = null;
    try {
      return await Promise.race([
        promise,
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(fallbackValue), ms);
        })
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  var LibraryScreen = {
    async mount() {
      this.container = document.getElementById("library");
      ScreenUtils.show(this.container);
      this.selectedType = this.selectedType || "all";
      const activeProfileId3 = String(ProfileManager.getActiveProfileId() || "");
      const profiles = await ProfileManager.getProfiles();
      const activeProfile = profiles.find((profile) => String(profile.id || profile.profileIndex || "1") === activeProfileId3) || profiles[0] || null;
      this.activeProfileName = String((activeProfile == null ? void 0 : activeProfile.name) || "Profile").trim() || "Profile";
      this.activeProfileInitial = profileInitial2(this.activeProfileName);
      this.renderLoading();
      await this.loadData();
      this.render();
    },
    renderLoading() {
      this.container.innerHTML = `
      <div class="library-shell">
        <div class="library-loading">Loading library...</div>
      </div>
    `;
    },
    async loadData() {
      const [savedItems, progressItems] = await Promise.all([
        savedLibraryRepository.getAll(120),
        watchProgressRepository.getRecent(80)
      ]);
      this.savedItems = savedItems || [];
      this.progressItems = progressItems || [];
      const ids = /* @__PURE__ */ new Map();
      this.savedItems.forEach((item) => {
        ids.set(`${item.contentType || "movie"}::${item.contentId}`, {
          contentId: item.contentId,
          contentType: item.contentType || "movie"
        });
      });
      this.progressItems.forEach((item) => {
        ids.set(`${item.contentType || "movie"}::${item.contentId}`, {
          contentId: item.contentId,
          contentType: item.contentType || "movie"
        });
      });
      const metaEntries = await Promise.all(Array.from(ids.values()).map(async (entry) => {
        const result = await withTimeout3(
          metaRepository.getMetaFromAllAddons(entry.contentType, entry.contentId),
          2200,
          { status: "error", message: "timeout" }
        );
        if ((result == null ? void 0 : result.status) === "success" && (result == null ? void 0 : result.data)) {
          return [entry.contentId, {
            title: result.data.name || entry.contentId,
            poster: result.data.poster || result.data.background || "",
            type: result.data.type || entry.contentType
          }];
        }
        return [entry.contentId, { title: entry.contentId, poster: "", type: entry.contentType }];
      }));
      this.metaMap = new Map(metaEntries);
    },
    typeAllowed(type) {
      if (this.selectedType === "all") return true;
      return String(type || "").toLowerCase() === this.selectedType;
    },
    filteredSaved() {
      return (this.savedItems || []).filter((item) => this.typeAllowed(item.contentType || "movie"));
    },
    filteredProgress() {
      return (this.progressItems || []).filter((item) => this.typeAllowed(item.contentType || "movie"));
    },
    renderSavedCards() {
      const items = this.filteredSaved();
      if (!items.length) {
        return `<p class="home-empty">No saved items.</p>`;
      }
      return `
      <div class="home-track">
        ${items.map((item) => {
        var _a, _b;
        const meta = ((_b = (_a = this.metaMap) == null ? void 0 : _a.get) == null ? void 0 : _b.call(_a, item.contentId)) || {};
        return `
            <article class="home-content-card focusable"
                     data-action="openDetail"
                     data-item-id="${item.contentId}"
                     data-item-type="${item.contentType || "movie"}"
                     data-item-title="${meta.title || item.contentId}">
              ${meta.poster ? `<img class="content-poster" src="${meta.poster}" alt="${meta.title || item.contentId}" />` : `<div class="content-poster placeholder"></div>`}
            </article>
          `;
      }).join("")}
      </div>
    `;
    },
    renderProgressCards() {
      const items = this.filteredProgress();
      if (!items.length) {
        return `<p class="home-empty">No continue watching items.</p>`;
      }
      return `
      <div class="home-track">
        ${items.map((item) => {
        var _a, _b;
        const meta = ((_b = (_a = this.metaMap) == null ? void 0 : _a.get) == null ? void 0 : _b.call(_a, item.contentId)) || {};
        const positionMin = Math.floor(Number(item.positionMs || 0) / 6e4);
        const durationMin = Math.floor(Number(item.durationMs || 0) / 6e4);
        const remaining = Math.max(0, durationMin - positionMin);
        const progress = durationMin > 0 ? Math.max(0, Math.min(1, positionMin / durationMin)) : 0;
        return `
            <article class="home-content-card home-progress-card focusable"
                     data-action="openDetail"
                     data-item-id="${item.contentId}"
                     data-item-type="${item.contentType || "movie"}"
                     data-item-title="${meta.title || item.contentId}">
              <div class="home-progress-poster"${meta.poster ? ` style="background-image:url('${meta.poster}')"` : ""}>
                <span class="home-progress-left">${durationMin > 0 ? `${remaining}m left` : "Continue"}</span>
              </div>
              <div class="home-progress-meta">
                <div class="home-content-title">${meta.title || item.contentId}</div>
                <div class="home-content-type">${positionMin}m / ${durationMin || "?"}m</div>
                <div class="home-progress-track">
                  <div class="home-progress-fill" style="width:${Math.round(progress * 100)}%"></div>
                </div>
              </div>
            </article>
          `;
      }).join("")}
      </div>
    `;
    },
    render() {
      this.container.innerHTML = `
      <div class="home-shell library-shell">
        <aside class="home-sidebar expanded">
          <div class="home-brand-wrap">
            <img src="assets/brand/app_logo_wordmark.png" class="home-brand-logo-main" alt="Nuvio" />
          </div>
          <div class="home-nav-list">
            <button class="home-nav-item focusable" data-action="gotoHome"><span class="home-nav-icon-wrap">${navIconSvg2("gotoHome")}</span><span class="home-nav-label">Home</span></button>
            <button class="home-nav-item focusable" data-action="gotoSearch"><span class="home-nav-icon-wrap">${navIconSvg2("gotoSearch")}</span><span class="home-nav-label">Search</span></button>
            <button class="home-nav-item focusable" data-action="gotoLibrary"><span class="home-nav-icon-wrap">${navIconSvg2("gotoLibrary")}</span><span class="home-nav-label">Library</span></button>
            <button class="home-nav-item focusable" data-action="gotoPlugin"><span class="home-nav-icon-wrap">${navIconSvg2("gotoPlugin")}</span><span class="home-nav-label">Addons</span></button>
            <button class="home-nav-item focusable" data-action="gotoSettings"><span class="home-nav-icon-wrap">${navIconSvg2("gotoSettings")}</span><span class="home-nav-label">Settings</span></button>
          </div>
          <button class="home-profile-pill focusable" data-action="gotoAccount">
            <span class="home-profile-avatar">${this.activeProfileInitial || "P"}</span>
            <span class="home-profile-name">${this.activeProfileName || "Profile"}</span>
          </button>
        </aside>

        <main class="home-main library-main">
          <section class="library-topbar">
            <h2 class="library-title">Library</h2>
            <div class="library-type-tabs">
              <button class="library-type-tab focusable${this.selectedType === "all" ? " selected" : ""}" data-action="setType" data-type="all">All</button>
              <button class="library-type-tab focusable${this.selectedType === "movie" ? " selected" : ""}" data-action="setType" data-type="movie">Movie</button>
              <button class="library-type-tab focusable${this.selectedType === "series" ? " selected" : ""}" data-action="setType" data-type="series">Series</button>
            </div>
          </section>

          <section class="home-row">
            <h3 class="home-row-title">Continue Watching</h3>
            ${this.renderProgressCards()}
          </section>

          <section class="home-row">
            <h3 class="home-row-title">Saved</h3>
            ${this.renderSavedCards()}
          </section>
        </main>
      </div>
    `;
      ScreenUtils.indexFocusables(this.container);
      ScreenUtils.setInitialFocus(this.container, ".library-type-tabs .focusable");
    },
    onKeyDown(event) {
      var _a;
      if (Environment.isBackEvent(event)) {
        (_a = event == null ? void 0 : event.preventDefault) == null ? void 0 : _a.call(event);
        Router.navigate("home");
        return;
      }
      if (ScreenUtils.handleDpadNavigation(event, this.container)) {
        return;
      }
      if (event.keyCode !== 13) return;
      const current = this.container.querySelector(".focusable.focused");
      if (!current) return;
      const action = String(current.dataset.action || "");
      if (action === "gotoHome") Router.navigate("home");
      if (action === "gotoSearch") Router.navigate("search");
      if (action === "gotoLibrary") return;
      if (action === "gotoPlugin") Router.navigate("plugin");
      if (action === "gotoSettings") Router.navigate("settings");
      if (action === "gotoAccount") Router.navigate("profileSelection");
      if (action === "openDetail") {
        Router.navigate("detail", {
          itemId: current.dataset.itemId,
          itemType: current.dataset.itemType || "movie",
          fallbackTitle: current.dataset.itemTitle || "Untitled"
        });
      }
      if (action === "setType") {
        const nextType = String(current.dataset.type || "all");
        if (nextType !== this.selectedType) {
          this.selectedType = nextType;
          this.render();
        }
      }
    },
    cleanup() {
      ScreenUtils.hide(this.container);
    }
  };

  // js/ui/screens/search/searchScreen.js
  function toTitleCase2(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
  }
  function escapeRegExp2(value) {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  function formatCatalogRowTitle2(catalogName, addonName, type) {
    const typeLabel = toTitleCase2(type || "movie") || "Movie";
    let base = String(catalogName || "").trim();
    if (!base) return typeLabel;
    const addon = String(addonName || "").trim();
    const cleanedAddon = addon.replace(/\baddon\b/i, "").trim();
    [addon, cleanedAddon, "The Movie Database Addon", "TMDB Addon", "Addon"].filter(Boolean).forEach((term) => {
      const regex = new RegExp(`\\s*-?\\s*${escapeRegExp2(term)}\\s*`, "ig");
      base = base.replace(regex, " ");
    });
    base = base.replace(/\s{2,}/g, " ").trim();
    if (!base) return typeLabel;
    const endsWithType = new RegExp(`\\b${escapeRegExp2(typeLabel)}$`, "i").test(base);
    return endsWithType ? base : `${base} - ${typeLabel}`;
  }
  function formatDateLabel(item = {}) {
    const candidates = [
      item.released,
      item.releaseDate,
      item.release_date,
      item.releaseInfo,
      item.year
    ].filter(Boolean);
    for (const value of candidates) {
      const raw = String(value).trim();
      if (!raw) continue;
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) {
        return raw;
      }
      const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (iso) {
        return `${iso[3]}/${iso[2]}/${iso[1]}`;
      }
      const yearOnly = raw.match(/\b(19|20)\d{2}\b/);
      if (yearOnly) {
        return `01/01/${yearOnly[0]}`;
      }
    }
    return "";
  }
  function navIcon(action) {
    const map = {
      gotoHome: "assets/icons/sidebar_home.svg",
      gotoSearch: "assets/icons/sidebar_search.svg",
      gotoLibrary: "assets/icons/sidebar_library.svg",
      gotoPlugin: "assets/icons/sidebar_plugin.svg",
      gotoSettings: "assets/icons/sidebar_settings.svg"
    };
    return map[action] || map.gotoSearch;
  }
  async function withTimeout4(promise, ms, fallbackValue) {
    let timer = null;
    try {
      return await Promise.race([
        promise,
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(fallbackValue), ms);
        })
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  var SearchScreen = {
    async mount(params = {}) {
      this.container = document.getElementById("search");
      ScreenUtils.show(this.container);
      this.query = String(params.query || "").trim();
      this.mode = this.query.length >= 2 ? "search" : "idle";
      this.rows = [];
      this.loadToken = (this.loadToken || 0) + 1;
      this.renderLoading();
      await this.reloadRows();
    },
    renderLoading() {
      this.container.innerHTML = `
      <div class="search-screen-shell">
        <div class="search-loading">Loading...</div>
      </div>
    `;
    },
    async reloadRows() {
      const token = this.loadToken;
      if (this.mode === "search" && this.query.length >= 2) {
        this.rows = await this.searchRows(this.query);
      } else if (this.mode === "discover") {
        this.rows = await this.loadDiscoverRows();
      } else {
        this.rows = [];
      }
      if (token !== this.loadToken) return;
      this.render();
    },
    async loadDiscoverRows() {
      const addons = await addonRepository.getInstalledAddons();
      const sections = [];
      addons.forEach((addon) => {
        addon.catalogs.forEach((catalog) => {
          const requiresSearch = (catalog.extra || []).some((extra) => extra.name === "search");
          if (requiresSearch) return;
          if (catalog.apiType !== "movie" && catalog.apiType !== "series") return;
          sections.push({
            addonBaseUrl: addon.baseUrl,
            addonId: addon.id,
            addonName: addon.displayName,
            catalogId: catalog.id,
            catalogName: catalog.name,
            type: catalog.apiType
          });
        });
      });
      const picked = sections.slice(0, 8);
      const resolved = await Promise.all(picked.map(async (section) => {
        const result = await withTimeout4(catalogRepository.getCatalog({
          addonBaseUrl: section.addonBaseUrl,
          addonId: section.addonId,
          addonName: section.addonName,
          catalogId: section.catalogId,
          catalogName: section.catalogName,
          type: section.type,
          skip: 0,
          supportsSkip: true
        }), 3500, { status: "error", message: "timeout" });
        return { ...section, result };
      }));
      return resolved.filter((entry) => {
        var _a, _b, _c, _d;
        return ((_a = entry.result) == null ? void 0 : _a.status) === "success" && ((_d = (_c = (_b = entry.result) == null ? void 0 : _b.data) == null ? void 0 : _c.items) == null ? void 0 : _d.length);
      }).map((entry) => {
        var _a, _b;
        return {
          title: formatCatalogRowTitle2(entry.catalogName, entry.addonName, entry.type),
          subtitle: `from ${entry.addonName || "Addon"}`,
          type: entry.type,
          addonBaseUrl: entry.addonBaseUrl,
          addonId: entry.addonId,
          addonName: entry.addonName,
          catalogId: entry.catalogId,
          catalogName: entry.catalogName,
          items: (((_b = (_a = entry.result) == null ? void 0 : _a.data) == null ? void 0 : _b.items) || []).slice(0, 14)
        };
      });
    },
    async searchRows(query) {
      const addons = await addonRepository.getInstalledAddons();
      const searchableCatalogs = [];
      addons.forEach((addon) => {
        addon.catalogs.forEach((catalog) => {
          const requiresSearch = (catalog.extra || []).some((extra) => extra.name === "search");
          if (!requiresSearch) return;
          if (catalog.apiType !== "movie" && catalog.apiType !== "series") return;
          searchableCatalogs.push({
            addonBaseUrl: addon.baseUrl,
            addonId: addon.id,
            addonName: addon.displayName,
            catalogId: catalog.id,
            catalogName: catalog.name,
            type: catalog.apiType
          });
        });
      });
      const responses = await Promise.all(searchableCatalogs.slice(0, 14).map(async (catalog) => {
        const result = await withTimeout4(catalogRepository.getCatalog({
          addonBaseUrl: catalog.addonBaseUrl,
          addonId: catalog.addonId,
          addonName: catalog.addonName,
          catalogId: catalog.catalogId,
          catalogName: catalog.catalogName,
          type: catalog.type,
          skip: 0,
          extraArgs: { search: query },
          supportsSkip: true
        }), 3500, { status: "error", message: "timeout" });
        return { catalog, result };
      }));
      return responses.filter(({ result }) => {
        var _a, _b;
        return (result == null ? void 0 : result.status) === "success" && ((_b = (_a = result == null ? void 0 : result.data) == null ? void 0 : _a.items) == null ? void 0 : _b.length);
      }).map(({ catalog, result }) => {
        var _a;
        return {
          title: formatCatalogRowTitle2(catalog.catalogName, catalog.addonName, catalog.type),
          subtitle: `from ${catalog.addonName || "Addon"}`,
          type: catalog.type,
          addonBaseUrl: catalog.addonBaseUrl,
          addonId: catalog.addonId,
          addonName: catalog.addonName,
          catalogId: catalog.catalogId,
          catalogName: catalog.catalogName,
          items: (((_a = result == null ? void 0 : result.data) == null ? void 0 : _a.items) || []).slice(0, 18)
        };
      });
    },
    renderRows() {
      if (!Array.isArray(this.rows) || !this.rows.length) {
        if (this.mode === "search") {
          return `
          <div class="search-empty-state small">
            <img src="assets/icons/sidebar_search.svg" class="search-empty-icon" alt="" aria-hidden="true" />
            <h2>No Results</h2>
            <p>Try another keyword.</p>
          </div>
        `;
        }
        return `
        <div class="search-empty-state">
          <img src="assets/icons/sidebar_search.svg" class="search-empty-icon" alt="" aria-hidden="true" />
          <h2>Start Searching</h2>
          <p>Enter at least 2 characters</p>
        </div>
      `;
      }
      return this.rows.map((row, rowIndex) => `
      <section class="search-results-row">
        <h3 class="search-results-title">${row.title}</h3>
        <div class="search-results-subtitle">${row.subtitle}</div>
        <div class="search-results-track">
          ${(row.items || []).map((item) => `
            <article class="search-result-card focusable"
                     data-action="openDetail"
                     data-item-id="${item.id || ""}"
                     data-item-type="${item.type || row.type || "movie"}"
                     data-item-title="${item.name || "Untitled"}">
              <div class="search-result-poster-wrap">
                ${item.poster ? `<img class="search-result-poster" src="${item.poster}" alt="${item.name || "content"}" />` : `<div class="search-result-poster placeholder"></div>`}
              </div>
              <div class="search-result-name">${item.name || "Untitled"}</div>
              <div class="search-result-date">${formatDateLabel(item)}</div>
            </article>
          `).join("")}
          <article class="search-result-card search-seeall-card focusable"
                   data-action="openCatalogSeeAll"
                   data-addon-base-url="${row.addonBaseUrl || ""}"
                   data-addon-id="${row.addonId || ""}"
                   data-addon-name="${row.addonName || ""}"
                   data-catalog-id="${row.catalogId || ""}"
                   data-catalog-name="${row.catalogName || ""}"
                   data-catalog-type="${row.type || "movie"}"
                   data-row-index="${rowIndex}">
            <div class="search-seeall-inner">
              <div class="search-seeall-arrow" aria-hidden="true">&#8594;</div>
              <div class="search-seeall-label">See All</div>
            </div>
          </article>
        </div>
      </section>
    `).join("");
    },
    render() {
      var _a;
      const queryText = this.query || "";
      this.container.innerHTML = `
      <div class="search-screen-shell">
        <aside class="search-sidebar">
          <button class="search-nav-item focusable" data-action="gotoHome"><img src="${navIcon("gotoHome")}" alt="" aria-hidden="true" /></button>
          <button class="search-nav-item focusable active" data-action="gotoSearch"><img src="${navIcon("gotoSearch")}" alt="" aria-hidden="true" /></button>
          <button class="search-nav-item focusable" data-action="gotoLibrary"><img src="${navIcon("gotoLibrary")}" alt="" aria-hidden="true" /></button>
          <button class="search-nav-item focusable" data-action="gotoPlugin"><img src="${navIcon("gotoPlugin")}" alt="" aria-hidden="true" /></button>
          <button class="search-nav-item focusable" data-action="gotoSettings"><img src="${navIcon("gotoSettings")}" alt="" aria-hidden="true" /></button>
        </aside>

        <main class="search-content">
          <section class="search-header">
            <button class="search-discover-btn focusable" data-action="openDiscover">
              <img src="assets/icons/discover_compass.svg" alt="" aria-hidden="true" />
            </button>
            <input
              id="searchInput"
              class="search-input-field focusable"
              type="text"
              data-action="searchInput"
              autocomplete="off"
              autocapitalize="off"
              spellcheck="false"
              placeholder="Search movies & series"
              value="${queryText.replace(/"/g, "&quot;")}"
            />
          </section>
          ${this.renderRows()}
        </main>
      </div>
    `;
      ScreenUtils.indexFocusables(this.container);
      this.buildNavigationModel();
      this.bindSearchInputEvents();
      const input = this.container.querySelector("#searchInput");
      (_a = input == null ? void 0 : input.blur) == null ? void 0 : _a.call(input);
      ScreenUtils.setInitialFocus(this.container, ".search-discover-btn");
    },
    buildNavigationModel() {
      var _a, _b, _c, _d, _e;
      const sidebar = Array.from(((_a = this.container) == null ? void 0 : _a.querySelectorAll(".search-sidebar .focusable")) || []);
      const header = [
        (_b = this.container) == null ? void 0 : _b.querySelector(".search-discover-btn.focusable"),
        (_c = this.container) == null ? void 0 : _c.querySelector("#searchInput.focusable")
      ].filter(Boolean);
      const rows = Array.from(((_d = this.container) == null ? void 0 : _d.querySelectorAll(".search-results-row .search-results-track")) || []).map((track) => Array.from(track.querySelectorAll(".search-result-card.focusable"))).filter((row) => row.length > 0);
      sidebar.forEach((node, index) => {
        node.dataset.navZone = "sidebar";
        node.dataset.navIndex = String(index);
      });
      header.forEach((node, index) => {
        node.dataset.navZone = "header";
        node.dataset.navCol = String(index);
      });
      rows.forEach((rowNodes, rowIndex) => {
        rowNodes.forEach((node, colIndex) => {
          node.dataset.navZone = "results";
          node.dataset.navRow = String(rowIndex);
          node.dataset.navCol = String(colIndex);
        });
      });
      this.navModel = { sidebar, header, rows };
      this.lastMainFocus = header[1] || header[0] || ((_e = rows[0]) == null ? void 0 : _e[0]) || null;
    },
    focusNode(current, target) {
      var _a;
      if (!target) return false;
      if (current && current !== target) {
        current.classList.remove("focused");
      }
      (_a = this.container) == null ? void 0 : _a.querySelectorAll(".focusable.focused").forEach((node) => {
        if (node !== target) node.classList.remove("focused");
      });
      target.classList.add("focused");
      target.focus();
      const zone = String(target.dataset.navZone || "");
      if (zone === "header" || zone === "results") {
        this.lastMainFocus = target;
      }
      if (zone === "results") {
        target.scrollIntoView({ behavior: "auto", block: "nearest", inline: "nearest" });
      }
      return true;
    },
    handleSearchDpad(event) {
      var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y;
      const keyCode = Number((event == null ? void 0 : event.keyCode) || 0);
      const direction = keyCode === 38 ? "up" : keyCode === 40 ? "down" : keyCode === 37 ? "left" : keyCode === 39 ? "right" : null;
      if (!direction) {
        return false;
      }
      const nav = this.navModel || {};
      const current = ((_a = this.container) == null ? void 0 : _a.querySelector(".focusable.focused")) || null;
      if (!current) {
        return false;
      }
      const zone = String(current.dataset.navZone || "");
      (_b = event == null ? void 0 : event.preventDefault) == null ? void 0 : _b.call(event);
      if (zone === "sidebar") {
        const sidebarIndex = Number(current.dataset.navIndex || 0);
        if (direction === "up") {
          return this.focusNode(current, ((_c = nav.sidebar) == null ? void 0 : _c[Math.max(0, sidebarIndex - 1)]) || current) || true;
        }
        if (direction === "down") {
          return this.focusNode(current, ((_e = nav.sidebar) == null ? void 0 : _e[Math.min((((_d = nav.sidebar) == null ? void 0 : _d.length) || 1) - 1, sidebarIndex + 1)]) || current) || true;
        }
        if (direction === "right") {
          const target = this.lastMainFocus || ((_f = nav.header) == null ? void 0 : _f[1]) || ((_g = nav.header) == null ? void 0 : _g[0]) || ((_i = (_h = nav.rows) == null ? void 0 : _h[0]) == null ? void 0 : _i[0]) || null;
          return this.focusNode(current, target) || true;
        }
        return true;
      }
      if (zone === "header") {
        const col = Number(current.dataset.navCol || 0);
        if (direction === "left") {
          if (col > 0) return this.focusNode(current, ((_j = nav.header) == null ? void 0 : _j[col - 1]) || current) || true;
          return this.focusNode(current, ((_k = nav.sidebar) == null ? void 0 : _k[1]) || ((_l = nav.sidebar) == null ? void 0 : _l[0]) || current) || true;
        }
        if (direction === "right") {
          if (col < (((_m = nav.header) == null ? void 0 : _m.length) || 0) - 1) {
            return this.focusNode(current, ((_n = nav.header) == null ? void 0 : _n[col + 1]) || current) || true;
          }
          return true;
        }
        if (direction === "down") {
          const firstRow = ((_o = nav.rows) == null ? void 0 : _o[0]) || [];
          const target = firstRow[Math.min(col, Math.max(0, firstRow.length - 1))] || firstRow[0] || null;
          return this.focusNode(current, target) || true;
        }
        if (direction === "up") {
          return this.focusNode(current, ((_p = nav.sidebar) == null ? void 0 : _p[1]) || ((_q = nav.sidebar) == null ? void 0 : _q[0]) || current) || true;
        }
        return true;
      }
      if (zone === "results") {
        const row = Number(current.dataset.navRow || 0);
        const col = Number(current.dataset.navCol || 0);
        const rowNodes = ((_r = nav.rows) == null ? void 0 : _r[row]) || [];
        if (direction === "left") {
          if (col > 0) {
            return this.focusNode(current, rowNodes[col - 1] || current) || true;
          }
          return this.focusNode(current, ((_s = nav.sidebar) == null ? void 0 : _s[1]) || ((_t = nav.sidebar) == null ? void 0 : _t[0]) || current) || true;
        }
        if (direction === "right") {
          const target = rowNodes[col + 1] || null;
          return this.focusNode(current, target || current) || true;
        }
        if (direction === "down") {
          const nextRowNodes = ((_u = nav.rows) == null ? void 0 : _u[row + 1]) || null;
          if (!nextRowNodes) {
            return true;
          }
          const target = nextRowNodes[Math.min(col, nextRowNodes.length - 1)] || nextRowNodes[0] || null;
          return this.focusNode(current, target) || true;
        }
        if (direction === "up") {
          const prevRowNodes = ((_v = nav.rows) == null ? void 0 : _v[row - 1]) || null;
          if (prevRowNodes) {
            const target2 = prevRowNodes[Math.min(col, prevRowNodes.length - 1)] || prevRowNodes[0] || null;
            return this.focusNode(current, target2) || true;
          }
          const target = ((_x = nav.header) == null ? void 0 : _x[Math.min(col, (((_w = nav.header) == null ? void 0 : _w.length) || 1) - 1)]) || ((_y = nav.header) == null ? void 0 : _y[0]) || null;
          return this.focusNode(current, target) || true;
        }
        return true;
      }
      return false;
    },
    bindSearchInputEvents() {
      var _a;
      const input = (_a = this.container) == null ? void 0 : _a.querySelector("#searchInput");
      if (!input || input.__boundSearchListeners) return;
      input.__boundSearchListeners = true;
      input.addEventListener("input", (event) => {
        var _a2;
        this.query = String(((_a2 = event.target) == null ? void 0 : _a2.value) || "").trimStart();
        if (this.query.length === 0 && this.mode !== "idle") {
          this.mode = "idle";
          this.loadToken = (this.loadToken || 0) + 1;
          this.renderLoading();
          this.reloadRows();
        }
      });
      input.addEventListener("keydown", async (event) => {
        if (event.keyCode !== 13) return;
        event.preventDefault();
        this.query = String(input.value || "").trim();
        this.mode = this.query.length >= 2 ? "search" : "idle";
        this.loadToken = (this.loadToken || 0) + 1;
        this.renderLoading();
        await this.reloadRows();
      });
    },
    openDetailFromNode(node) {
      Router.navigate("detail", {
        itemId: node.dataset.itemId,
        itemType: node.dataset.itemType || "movie",
        fallbackTitle: node.dataset.itemTitle || "Untitled"
      });
    },
    openCatalogSeeAllFromNode(node) {
      Router.navigate("catalogSeeAll", {
        addonBaseUrl: node.dataset.addonBaseUrl || "",
        addonId: node.dataset.addonId || "",
        addonName: node.dataset.addonName || "",
        catalogId: node.dataset.catalogId || "",
        catalogName: node.dataset.catalogName || "",
        type: node.dataset.catalogType || "movie",
        initialItems: []
      });
    },
    async onKeyDown(event) {
      var _a, _b;
      if (Environment.isBackEvent(event)) {
        (_a = event == null ? void 0 : event.preventDefault) == null ? void 0 : _a.call(event);
        Router.navigate("home");
        return;
      }
      if (this.handleSearchDpad(event)) {
        return;
      }
      if (ScreenUtils.handleDpadNavigation(event, this.container)) {
        return;
      }
      if (event.keyCode !== 13) return;
      const current = this.container.querySelector(".focusable.focused");
      if (!current) return;
      const action = String(current.dataset.action || "");
      if (action === "gotoHome") Router.navigate("home");
      if (action === "gotoSearch") return;
      if (action === "gotoLibrary") Router.navigate("library");
      if (action === "gotoPlugin") Router.navigate("plugin");
      if (action === "gotoSettings") Router.navigate("settings");
      if (action === "openDetail") this.openDetailFromNode(current);
      if (action === "openCatalogSeeAll") this.openCatalogSeeAllFromNode(current);
      if (action === "openDiscover") {
        Router.navigate("discover");
      }
      if (action === "searchInput") {
        const input = (_b = this.container) == null ? void 0 : _b.querySelector("#searchInput");
        if (input) {
          input.focus();
        }
      }
    },
    cleanup() {
      ScreenUtils.hide(this.container);
    }
  };

  // js/ui/screens/search/discoverScreen.js
  function toTitleCase3(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
  }
  function formatAddonTypeLabel(value) {
    const type = String(value || "").trim().toLowerCase();
    if (!type) return "Movie";
    if (type === "tv") return "Tv";
    if (type === "series") return "Series";
    if (type === "movie") return "Movie";
    return toTitleCase3(type);
  }
  function navIcon2(action) {
    const map = {
      gotoHome: "assets/icons/sidebar_home.svg",
      gotoSearch: "assets/icons/sidebar_search.svg",
      gotoLibrary: "assets/icons/sidebar_library.svg",
      gotoPlugin: "assets/icons/sidebar_plugin.svg",
      gotoSettings: "assets/icons/sidebar_settings.svg"
    };
    return map[action] || map.gotoSearch;
  }
  function isBackEvent3(event) {
    return Environment.isBackEvent(event);
  }
  function isKey(event, code, aliases = []) {
    const keyCode = Number((event == null ? void 0 : event.keyCode) || 0);
    if (keyCode === code) return true;
    const key = String((event == null ? void 0 : event.key) || "");
    return aliases.includes(key);
  }
  function isUpKey(event) {
    return isKey(event, 38, ["ArrowUp", "Up"]);
  }
  function isDownKey(event) {
    return isKey(event, 40, ["ArrowDown", "Down"]);
  }
  function isLeftKey(event) {
    return isKey(event, 37, ["ArrowLeft", "Left"]);
  }
  function isRightKey(event) {
    return isKey(event, 39, ["ArrowRight", "Right"]);
  }
  function isEnterKey(event) {
    return isKey(event, 13, ["Enter"]);
  }
  var DiscoverScreen = {
    async mount() {
      this.container = document.getElementById("discover");
      ScreenUtils.show(this.container);
      this.loadToken = (this.loadToken || 0) + 1;
      this.typeOptions = [];
      this.selectedType = "movie";
      this.catalogs = [];
      this.catalogOptions = [];
      this.selectedCatalogKey = "";
      this.genreOptions = ["Default"];
      this.selectedGenre = "Default";
      this.items = [];
      this.loading = true;
      this.openPicker = null;
      this.pickerOptionIndex = 0;
      this.lastFocusedAction = "discoverFilterType";
      this.render();
      await this.loadCatalogsAndContent();
    },
    async loadCatalogsAndContent() {
      const token = this.loadToken;
      const addons = await addonRepository.getInstalledAddons();
      if (token !== this.loadToken) return;
      this.catalogs = [];
      addons.forEach((addon) => {
        addon.catalogs.forEach((catalog) => {
          const isSearchOnly = (catalog.extra || []).some((extra) => (extra == null ? void 0 : extra.name) === "search");
          if (isSearchOnly) return;
          const type = String(catalog.apiType || "").trim();
          if (!type) return;
          this.catalogs.push({
            key: `${addon.baseUrl}::${type}::${catalog.id}`,
            addonBaseUrl: addon.baseUrl,
            addonId: addon.id,
            addonName: addon.displayName || addon.name,
            catalogId: catalog.id,
            catalogName: catalog.name || catalog.id,
            type,
            extra: Array.isArray(catalog.extra) ? catalog.extra : []
          });
        });
      });
      this.updateCatalogOptions();
      await this.reloadItems();
    },
    updateCatalogOptions() {
      var _a;
      const dynamicTypes = [...new Set(this.catalogs.map((entry) => entry.type).filter(Boolean))];
      this.typeOptions = dynamicTypes.length ? dynamicTypes : ["movie", "series"];
      if (!this.typeOptions.includes(this.selectedType)) {
        this.selectedType = this.typeOptions[0] || "movie";
      }
      const forType = this.catalogs.filter((entry) => entry.type === this.selectedType);
      this.catalogOptions = forType;
      if (!forType.some((entry) => entry.key === this.selectedCatalogKey)) {
        this.selectedCatalogKey = ((_a = forType[0]) == null ? void 0 : _a.key) || "";
      }
      this.updateGenreOptions();
    },
    updateGenreOptions() {
      const selectedCatalog = this.catalogOptions.find((entry) => entry.key === this.selectedCatalogKey) || null;
      const genreExtra = ((selectedCatalog == null ? void 0 : selectedCatalog.extra) || []).find((extra) => (extra == null ? void 0 : extra.name) === "genre");
      const genres = Array.isArray(genreExtra == null ? void 0 : genreExtra.options) ? genreExtra.options.filter(Boolean) : [];
      this.genreOptions = ["Default", ...genres];
      if (!this.genreOptions.includes(this.selectedGenre)) {
        this.selectedGenre = "Default";
      }
    },
    async reloadItems() {
      var _a;
      const token = this.loadToken;
      const selectedCatalog = this.catalogOptions.find((entry) => entry.key === this.selectedCatalogKey) || null;
      this.loading = true;
      this.items = [];
      this.render();
      if (!selectedCatalog) {
        this.loading = false;
        this.render();
        return;
      }
      const extraArgs = {};
      if (this.selectedGenre && this.selectedGenre !== "Default") {
        extraArgs.genre = this.selectedGenre;
      }
      const result = await catalogRepository.getCatalog({
        addonBaseUrl: selectedCatalog.addonBaseUrl,
        addonId: selectedCatalog.addonId,
        addonName: selectedCatalog.addonName,
        catalogId: selectedCatalog.catalogId,
        catalogName: selectedCatalog.catalogName,
        type: selectedCatalog.type,
        skip: 0,
        extraArgs,
        supportsSkip: true
      });
      if (token !== this.loadToken) return;
      this.items = result.status === "success" ? ((_a = result.data) == null ? void 0 : _a.items) || [] : [];
      this.loading = false;
      this.render();
    },
    getPickerOptions(kind) {
      if (kind === "type") {
        return this.typeOptions.map((value) => ({
          value,
          label: formatAddonTypeLabel(value)
        }));
      }
      if (kind === "catalog") {
        return this.catalogOptions.map((entry) => ({
          value: entry.key,
          label: entry.catalogName || "Select"
        }));
      }
      if (kind === "genre") {
        return this.genreOptions.map((value) => ({
          value,
          label: value
        }));
      }
      return [];
    },
    getCurrentPickerValue(kind) {
      if (kind === "type") return this.selectedType;
      if (kind === "catalog") return this.selectedCatalogKey;
      if (kind === "genre") return this.selectedGenre || "Default";
      return "";
    },
    setPickerValue(kind, value) {
      if (kind === "type") {
        if (!value || value === this.selectedType) return;
        this.selectedType = value;
        this.updateCatalogOptions();
        this.reloadItems();
        return;
      }
      if (kind === "catalog") {
        if (!value || value === this.selectedCatalogKey) return;
        this.selectedCatalogKey = value;
        this.updateGenreOptions();
        this.reloadItems();
        return;
      }
      if (kind === "genre") {
        const safeValue = value || "Default";
        if (safeValue === this.selectedGenre) return;
        this.selectedGenre = safeValue;
        this.reloadItems();
      }
    },
    openPickerMenu(kind) {
      const options = this.getPickerOptions(kind);
      if (!options.length) return;
      this.openPicker = kind;
      const currentValue = this.getCurrentPickerValue(kind);
      const currentIndex = Math.max(0, options.findIndex((option) => option.value === currentValue));
      this.pickerOptionIndex = currentIndex;
      this.lastFocusedAction = kind === "type" ? "discoverFilterType" : kind === "catalog" ? "discoverFilterCatalog" : "discoverFilterGenre";
      this.render();
    },
    closePickerMenu() {
      if (!this.openPicker) return;
      this.openPicker = null;
      this.render();
    },
    movePickerIndex(delta) {
      const options = this.getPickerOptions(this.openPicker);
      if (!options.length) return;
      const next = this.pickerOptionIndex + delta;
      this.pickerOptionIndex = Math.min(options.length - 1, Math.max(0, next));
      this.render();
    },
    selectCurrentPickerOption() {
      if (!this.openPicker) return;
      const kind = this.openPicker;
      const options = this.getPickerOptions(kind);
      const option = options[this.pickerOptionIndex] || null;
      this.openPicker = null;
      this.render();
      if (option) {
        this.setPickerValue(kind, option.value);
      }
    },
    focusFilter(action) {
      var _a;
      const target = ((_a = this.container) == null ? void 0 : _a.querySelector(`.discover-filter[data-action="${action}"]`)) || null;
      if (!target) return;
      this.container.querySelectorAll(".focusable.focused").forEach((node) => node.classList.remove("focused"));
      target.classList.add("focused");
      target.focus();
      this.lastFocusedAction = action;
    },
    moveFilterFocus(delta) {
      const filters = ["discoverFilterType", "discoverFilterCatalog", "discoverFilterGenre"];
      const currentAction = this.lastFocusedAction || "discoverFilterType";
      const currentIndex = Math.max(0, filters.indexOf(currentAction));
      const nextIndex = Math.min(filters.length - 1, Math.max(0, currentIndex + delta));
      this.focusFilter(filters[nextIndex]);
    },
    focusNearestFilterFromCard(cardNode) {
      var _a;
      const filters = Array.from(((_a = this.container) == null ? void 0 : _a.querySelectorAll(".discover-filter.focusable")) || []);
      if (!filters.length || !cardNode) return false;
      const cardRect = cardNode.getBoundingClientRect();
      const cardCenterX = cardRect.left + cardRect.width / 2;
      let target = null;
      let minDx = Number.POSITIVE_INFINITY;
      filters.forEach((filter) => {
        const rect = filter.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const dx = Math.abs(centerX - cardCenterX);
        if (dx < minDx) {
          minDx = dx;
          target = filter;
        }
      });
      if (!target) return false;
      this.container.querySelectorAll(".focusable.focused").forEach((node) => node.classList.remove("focused"));
      target.classList.add("focused");
      target.focus();
      this.lastFocusedAction = String(target.dataset.action || "discoverFilterType");
      return true;
    },
    moveCardFocus(direction) {
      var _a, _b;
      const selector = ".discover-grid .discover-card.focusable";
      const before = ((_a = this.container) == null ? void 0 : _a.querySelector(`${selector}.focused`)) || null;
      ScreenUtils.moveFocusDirectional(this.container, direction, selector);
      const after = ((_b = this.container) == null ? void 0 : _b.querySelector(`${selector}.focused`)) || null;
      return Boolean(after && before !== after);
    },
    focusFirstContentCard() {
      var _a;
      const firstCard = (_a = this.container) == null ? void 0 : _a.querySelector(".discover-grid .discover-card.focusable");
      if (!firstCard) {
        return false;
      }
      this.container.querySelectorAll(".focusable.focused").forEach((node) => node.classList.remove("focused"));
      firstCard.classList.add("focused");
      firstCard.focus();
      this.lastFocusedAction = String(firstCard.dataset.action || "openDetail");
      return true;
    },
    getKindFromFilterAction(action) {
      if (action === "discoverFilterType") return "type";
      if (action === "discoverFilterCatalog") return "catalog";
      if (action === "discoverFilterGenre") return "genre";
      return null;
    },
    renderFilterPicker(kind, title, value) {
      const action = kind === "type" ? "discoverFilterType" : kind === "catalog" ? "discoverFilterCatalog" : "discoverFilterGenre";
      const isOpen = this.openPicker === kind;
      const options = isOpen ? this.getPickerOptions(kind) : [];
      const currentValue = this.getCurrentPickerValue(kind);
      return `
      <div class="discover-filter-shell">
        <button class="discover-filter focusable" data-action="${action}">
          <span class="discover-filter-label">${title}</span>
          <span class="discover-filter-line">
            <span class="discover-filter-value">${value}</span>
            <span class="discover-filter-chevron" aria-hidden="true">${isOpen ? "&#9652;" : "&#9662;"}</span>
          </span>
        </button>
        ${isOpen ? `
          <div class="discover-picker-menu" role="listbox" aria-label="${title}">
            ${options.map((option, index) => `
              <div class="discover-picker-option${option.value === currentValue ? " selected" : ""}${index === this.pickerOptionIndex ? " focused-option" : ""}"
                   data-option-index="${index}"
                   role="option"
                   aria-selected="${option.value === currentValue ? "true" : "false"}">
                ${option.label}
              </div>
            `).join("")}
          </div>
        ` : ""}
      </div>
    `;
    },
    render() {
      var _a, _b;
      const currentFocused = (_a = this.container) == null ? void 0 : _a.querySelector(".focusable.focused");
      if ((_b = currentFocused == null ? void 0 : currentFocused.dataset) == null ? void 0 : _b.action) {
        this.lastFocusedAction = String(currentFocused.dataset.action);
      }
      const selectedCatalog = this.catalogOptions.find((entry) => entry.key === this.selectedCatalogKey) || null;
      const title = selectedCatalog ? `${selectedCatalog.addonName || "Addon"} - ${formatAddonTypeLabel(selectedCatalog.type)}` : "No catalog selected";
      const cards = this.loading ? `<div class="discover-empty">Loading...</div>` : this.items.length ? this.items.map((item) => `
              <article class="discover-card focusable"
                       data-action="openDetail"
                       data-item-id="${item.id || ""}"
                       data-item-type="${item.type || (selectedCatalog == null ? void 0 : selectedCatalog.type) || "movie"}"
                       data-item-title="${item.name || "Untitled"}">
                <div class="discover-card-poster"${item.poster ? ` style="background-image:url('${item.poster}')"` : ""}></div>
                <div class="discover-card-title">${item.name || "Untitled"}</div>
              </article>
            `).join("") : `<div class="discover-empty">No content found.</div>`;
      this.container.innerHTML = `
      <div class="discover-shell">
        <aside class="search-sidebar">
          <button class="search-nav-item focusable" data-action="gotoHome"><img src="${navIcon2("gotoHome")}" alt="" aria-hidden="true" /></button>
          <button class="search-nav-item focusable active" data-action="gotoSearch"><img src="${navIcon2("gotoSearch")}" alt="" aria-hidden="true" /></button>
          <button class="search-nav-item focusable" data-action="gotoLibrary"><img src="${navIcon2("gotoLibrary")}" alt="" aria-hidden="true" /></button>
          <button class="search-nav-item focusable" data-action="gotoPlugin"><img src="${navIcon2("gotoPlugin")}" alt="" aria-hidden="true" /></button>
          <button class="search-nav-item focusable" data-action="gotoSettings"><img src="${navIcon2("gotoSettings")}" alt="" aria-hidden="true" /></button>
        </aside>
        <main class="discover-main">
          <h1 class="discover-title">Discover</h1>
          <section class="discover-filters">
            ${this.renderFilterPicker("type", "Type", formatAddonTypeLabel(this.selectedType))}
            ${this.renderFilterPicker("catalog", "Catalog", (selectedCatalog == null ? void 0 : selectedCatalog.catalogName) || "Select")}
            ${this.renderFilterPicker("genre", "Genre", this.selectedGenre || "Default")}
          </section>
          <div class="discover-row-title">${title}</div>
          <section class="discover-grid">
            ${cards}
          </section>
        </main>
      </div>
    `;
      ScreenUtils.indexFocusables(this.container);
      this.bindPointerEvents();
      const selector = this.lastFocusedAction ? `.focusable[data-action="${this.lastFocusedAction}"]` : ".discover-filter.focusable";
      ScreenUtils.setInitialFocus(this.container, selector);
    },
    bindPointerEvents() {
      if (!this.container || this.container.__discoverPointerBound) return;
      this.container.__discoverPointerBound = true;
      this.container.addEventListener("click", (event) => {
        var _a, _b, _c, _d, _e, _f;
        const optionNode = (_b = (_a = event.target) == null ? void 0 : _a.closest) == null ? void 0 : _b.call(_a, ".discover-picker-option");
        if (optionNode && this.openPicker) {
          const optionIndex = Number(optionNode.dataset.optionIndex || -1);
          if (optionIndex >= 0) {
            this.pickerOptionIndex = optionIndex;
            this.selectCurrentPickerOption();
            return;
          }
        }
        const filterNode = (_d = (_c = event.target) == null ? void 0 : _c.closest) == null ? void 0 : _d.call(_c, ".discover-filter");
        if (filterNode) {
          const action = String(filterNode.dataset.action || "");
          this.focusFilter(action);
          if (action === "discoverFilterType") this.openPickerMenu("type");
          if (action === "discoverFilterCatalog") this.openPickerMenu("catalog");
          if (action === "discoverFilterGenre") this.openPickerMenu("genre");
          return;
        }
        const cardNode = (_f = (_e = event.target) == null ? void 0 : _e.closest) == null ? void 0 : _f.call(_e, ".discover-card");
        if (cardNode) {
          Router.navigate("detail", {
            itemId: cardNode.dataset.itemId,
            itemType: cardNode.dataset.itemType || "movie",
            fallbackTitle: cardNode.dataset.itemTitle || "Untitled"
          });
        }
      });
    },
    async onKeyDown(event) {
      var _a, _b, _c, _d, _e, _f;
      if (isBackEvent3(event)) {
        (_a = event == null ? void 0 : event.preventDefault) == null ? void 0 : _a.call(event);
        if (this.openPicker) {
          this.closePickerMenu();
          return;
        }
        Router.back();
        return;
      }
      if (isUpKey(event) || isDownKey(event) || isLeftKey(event) || isRightKey(event)) {
        (_b = event == null ? void 0 : event.preventDefault) == null ? void 0 : _b.call(event);
      }
      if (this.openPicker) {
        if (isUpKey(event)) {
          this.movePickerIndex(-1);
          return;
        }
        if (isDownKey(event)) {
          this.movePickerIndex(1);
          return;
        }
        if (isEnterKey(event)) {
          (_c = event == null ? void 0 : event.preventDefault) == null ? void 0 : _c.call(event);
          (_d = event == null ? void 0 : event.stopPropagation) == null ? void 0 : _d.call(event);
          (_e = event == null ? void 0 : event.stopImmediatePropagation) == null ? void 0 : _e.call(event);
          this.selectCurrentPickerOption();
          return;
        }
        if (isLeftKey(event) || isRightKey(event)) {
          const movingRight = isRightKey(event);
          const action2 = this.openPicker === "type" ? "discoverFilterType" : this.openPicker === "catalog" ? "discoverFilterCatalog" : "discoverFilterGenre";
          this.openPicker = null;
          this.render();
          this.lastFocusedAction = action2;
          this.moveFilterFocus(movingRight ? 1 : -1);
          return;
        }
        return;
      }
      const current = this.container.querySelector(".focusable.focused");
      const currentAction = String(((_f = current == null ? void 0 : current.dataset) == null ? void 0 : _f.action) || "");
      const focusedFilterKind = this.getKindFromFilterAction(currentAction);
      if (focusedFilterKind) {
        if (isLeftKey(event)) {
          if (currentAction === "discoverFilterType") {
            if (ScreenUtils.handleDpadNavigation(event, this.container)) {
              return;
            }
          }
          this.moveFilterFocus(-1);
          return;
        }
        if (isRightKey(event)) {
          this.moveFilterFocus(1);
          return;
        }
        if (isDownKey(event)) {
          this.focusFirstContentCard();
          return;
        }
      }
      if (currentAction === "openDetail") {
        if (isLeftKey(event)) {
          if (!this.moveCardFocus("left")) {
            ScreenUtils.moveFocusDirectional(this.container, "left");
          }
          return;
        }
        if (isRightKey(event)) {
          this.moveCardFocus("right");
          return;
        }
        if (isDownKey(event)) {
          this.moveCardFocus("down");
          return;
        }
        if (isUpKey(event)) {
          if (!this.moveCardFocus("up")) {
            this.focusNearestFilterFromCard(current);
          }
          return;
        }
      }
      if (ScreenUtils.handleDpadNavigation(event, this.container)) {
        return;
      }
      if (!isEnterKey(event)) return;
      if (!current) return;
      const action = String(current.dataset.action || "");
      this.lastFocusedAction = action;
      if (action === "gotoHome") Router.navigate("home");
      if (action === "gotoSearch") Router.navigate("search");
      if (action === "gotoLibrary") Router.navigate("library");
      if (action === "gotoPlugin") Router.navigate("plugin");
      if (action === "gotoSettings") Router.navigate("settings");
      if (action === "discoverFilterType") this.openPickerMenu("type");
      if (action === "discoverFilterCatalog") this.openPickerMenu("catalog");
      if (action === "discoverFilterGenre") this.openPickerMenu("genre");
      if (action === "openDetail") {
        Router.navigate("detail", {
          itemId: current.dataset.itemId,
          itemType: current.dataset.itemType || "movie",
          fallbackTitle: current.dataset.itemTitle || "Untitled"
        });
      }
    },
    cleanup() {
      this.loadToken = (this.loadToken || 0) + 1;
      ScreenUtils.hide(this.container);
    }
  };

  // js/data/local/themeStore.js
  var KEY6 = "themeSettings";
  var ACCENT_MIGRATION_FLAG_KEY = "themeAccentMigratedToWhite";
  var LEGACY_DEFAULT_ACCENT = "#ff3d00";
  var DEFAULT_THEME = {
    mode: "dark",
    accentColor: "#f5f8fc"
  };
  var ThemeStore = {
    get() {
      const stored = LocalStore.get(KEY6, {}) || {};
      if (String((stored == null ? void 0 : stored.accentColor) || "").toLowerCase() === LEGACY_DEFAULT_ACCENT && !LocalStore.get(ACCENT_MIGRATION_FLAG_KEY, false)) {
        const migrated = { ...stored, accentColor: DEFAULT_THEME.accentColor };
        LocalStore.set(KEY6, migrated);
        LocalStore.set(ACCENT_MIGRATION_FLAG_KEY, true);
        return {
          ...DEFAULT_THEME,
          ...migrated
        };
      }
      return {
        ...DEFAULT_THEME,
        ...stored
      };
    },
    set(partial) {
      LocalStore.set(KEY6, { ...this.get(), ...partial || {} });
    }
  };

  // js/ui/theme/themeColors.js
  var ThemeColors = {
    dark: {
      "--bg-color": "#0e0f12",
      "--text-color": "#ffffff",
      "--focus-color": "#f5f8fc",
      "--card-bg": "#1a1c20"
    }
  };

  // js/ui/theme/themeManager.js
  var ThemeManager = {
    apply() {
      const theme = ThemeStore.get();
      const colors = ThemeColors[theme.mode] || ThemeColors.dark;
      Object.entries(colors).forEach(([key, value]) => {
        document.documentElement.style.setProperty(key, value);
      });
      document.documentElement.style.setProperty("--focus-color", "#f5f8fc");
    }
  };

  // js/ui/screens/settings/themeSettings.js
  var ThemeSettings = {
    getItems() {
      const theme = ThemeStore.get();
      const setAccent = (accentColor) => {
        ThemeStore.set({ accentColor });
        ThemeManager.apply();
      };
      return [
        {
          id: "theme_apply_dark",
          label: "Apply Dark Theme",
          description: `Current accent: ${theme.accentColor}`,
          action: () => {
            ThemeStore.set({ mode: "dark" });
            ThemeManager.apply();
          }
        },
        {
          id: "theme_accent_white",
          label: "Accent White",
          description: "Android default focus style",
          action: () => setAccent("#f5f8fc")
        },
        {
          id: "theme_accent_crimson",
          label: "Accent Crimson",
          description: "High contrast warm accent",
          action: () => setAccent("#ff4d4f")
        },
        {
          id: "theme_accent_ocean",
          label: "Accent Ocean",
          description: "Blue accent",
          action: () => setAccent("#42a5f5")
        },
        {
          id: "theme_accent_violet",
          label: "Accent Violet",
          description: "Purple accent",
          action: () => setAccent("#ba68c8")
        },
        {
          id: "theme_accent_emerald",
          label: "Accent Emerald",
          description: "Green accent",
          action: () => setAccent("#66bb6a")
        },
        {
          id: "theme_accent_amber",
          label: "Accent Amber",
          description: "Amber accent",
          action: () => setAccent("#ffca28")
        }
      ];
    }
  };

  // js/data/local/playerSettingsStore.js
  var KEY7 = "playerSettings";
  var DEFAULTS4 = {
    autoplayNextEpisode: true,
    subtitlesEnabled: true,
    subtitleLanguage: "it",
    preferredQuality: "auto"
  };
  var PlayerSettingsStore = {
    get() {
      return {
        ...DEFAULTS4,
        ...LocalStore.get(KEY7, {}) || {}
      };
    },
    set(partial) {
      LocalStore.set(KEY7, { ...this.get(), ...partial || {} });
    }
  };

  // js/ui/screens/settings/playbackSettings.js
  var PlaybackSettings = {
    getItems() {
      const settings = PlayerSettingsStore.get();
      const quality = String(settings.preferredQuality || "auto");
      const qualityLabel = quality === "2160p" ? "2160p" : quality === "1080p" ? "1080p" : quality === "720p" ? "720p" : "Auto";
      return [
        {
          id: "playback_toggle_autoplay",
          label: `Autoplay Next: ${settings.autoplayNextEpisode ? "ON" : "OFF"}`,
          description: "Toggle automatic next episode",
          action: () => {
            PlayerSettingsStore.set({
              autoplayNextEpisode: !PlayerSettingsStore.get().autoplayNextEpisode
            });
          }
        },
        {
          id: "playback_toggle_subtitles",
          label: `Subtitles: ${settings.subtitlesEnabled ? "ON" : "OFF"}`,
          description: "Toggle subtitles by default",
          action: () => {
            PlayerSettingsStore.set({
              subtitlesEnabled: !PlayerSettingsStore.get().subtitlesEnabled
            });
          }
        },
        {
          id: "playback_quality_cycle",
          label: `Quality target: ${qualityLabel}`,
          description: "Cycle Auto -> 2160p -> 1080p -> 720p",
          action: () => {
            const current = String(PlayerSettingsStore.get().preferredQuality || "auto");
            const next = current === "auto" ? "2160p" : current === "2160p" ? "1080p" : current === "1080p" ? "720p" : "auto";
            PlayerSettingsStore.set({ preferredQuality: next });
          }
        }
      ];
    }
  };

  // js/ui/screens/settings/settingsScreen.js
  var ROTATED_DPAD_KEY2 = "rotatedDpadMapping";
  var STRICT_DPAD_GRID_KEY2 = "strictDpadGridNavigation";
  var SECTION_META = [
    { id: "account", label: "Account", subtitle: "Account and sync status." },
    { id: "profiles", label: "Profiles", subtitle: "Manage user profiles for this account." },
    { id: "appearance", label: "Appearance", subtitle: "Choose theme and visual preferences." },
    { id: "layout", label: "Layout", subtitle: "Home layout and navigation behavior." },
    { id: "plugins", label: "Plugins", subtitle: "Manage repositories and plugin runtime." },
    { id: "integration", label: "Integration", subtitle: "Cloud sync and metadata integration." },
    { id: "playback", label: "Playback", subtitle: "Video, audio, and subtitle defaults." },
    { id: "trakt", label: "Trakt", subtitle: "Trakt integration status." },
    { id: "about", label: "About", subtitle: "App information and links." }
  ];
  var RAIL_ITEMS = [
    { id: "home", label: "Home", action: () => Router.navigate("home") },
    { id: "search", label: "Search", action: () => Router.navigate("search") },
    { id: "library", label: "Library", action: () => Router.navigate("library") },
    { id: "plugin", label: "Addons", action: () => Router.navigate("plugin") },
    { id: "settings", label: "Settings", action: () => {
    } }
  ];
  function clamp2(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }
  function railIconPath(actionId) {
    if (actionId === "home") return "assets/icons/sidebar_home.svg";
    if (actionId === "search") return "assets/icons/sidebar_search.svg";
    if (actionId === "library") return "assets/icons/sidebar_library.svg";
    if (actionId === "plugin") return "assets/icons/sidebar_plugin.svg";
    return "assets/icons/sidebar_settings.svg";
  }
  var SettingsScreen = {
    async mount() {
      this.container = document.getElementById("settings");
      ScreenUtils.show(this.container);
      this.activeSection = this.activeSection || "account";
      this.focusZone = this.focusZone || "nav";
      this.railIndex = Number.isFinite(this.railIndex) ? this.railIndex : RAIL_ITEMS.findIndex((item) => item.id === "settings");
      if (this.railIndex < 0) {
        this.railIndex = 0;
      }
      this.navIndex = Number.isFinite(this.navIndex) ? this.navIndex : SECTION_META.findIndex((s) => s.id === this.activeSection);
      if (this.navIndex < 0) {
        this.navIndex = 0;
        this.activeSection = SECTION_META[0].id;
      }
      this.panelIndex = Number.isFinite(this.panelIndex) ? this.panelIndex : 0;
      await this.render();
    },
    async collectModel() {
      const addons = await addonRepository.getInstalledAddons();
      const profiles = await ProfileManager.getProfiles();
      const tmdbSettings = TmdbSettingsStore.get();
      const rotatedDpad = Boolean(LocalStore.get(ROTATED_DPAD_KEY2, true));
      const strictDpadGrid = Boolean(LocalStore.get(STRICT_DPAD_GRID_KEY2, true));
      const themeItems = ThemeSettings.getItems();
      const playbackItems = PlaybackSettings.getItems();
      return {
        addons,
        profiles,
        tmdbSettings,
        rotatedDpad,
        strictDpadGrid,
        themeItems,
        playbackItems,
        authState: AuthManager.getAuthState()
      };
    },
    buildSectionItems(sectionId, model) {
      const items = [];
      const addItem = (label, description, action) => {
        const id = `action_${Math.random().toString(36).slice(2, 9)}`;
        this.actionMap.set(id, action);
        items.push({ id, label, description });
      };
      if (sectionId === "account") {
        const signedIn = model.authState === "authenticated";
        addItem(
          signedIn ? "Signed in" : "Not signed in",
          signedIn ? "Account linked on this TV." : "Open QR login to connect account.",
          () => Router.navigate(signedIn ? "account" : "authQrSignIn")
        );
        addItem("Open account screen", "View sync overview and linked status", () => Router.navigate("account"));
        if (signedIn) {
          addItem("Sign out", "Disconnect account from this TV", async () => {
            await AuthManager.signOut();
            Router.navigate("authQrSignIn");
          });
        }
        return items;
      }
      if (sectionId === "profiles") {
        model.profiles.forEach((profile) => {
          addItem(
            `${profile.name}${String(profile.id) === String(ProfileManager.getActiveProfileId()) ? " (Active)" : ""}`,
            profile.isPrimary ? "Primary profile" : "Secondary profile",
            async () => {
              await ProfileManager.setActiveProfile(profile.id);
              await ProfileSyncService.pull();
            }
          );
        });
        addItem("Open profile selection", "Go back to profile chooser", () => Router.navigate("profileSelection"));
        return items;
      }
      if (sectionId === "appearance") {
        model.themeItems.forEach((item) => addItem(item.label, item.description, item.action));
        return items;
      }
      if (sectionId === "layout") {
        addItem("Reset home catalog prefs", "Restore catalog order and visibility", () => {
          HomeCatalogStore.reset();
        });
        addItem(
          `Remote D-Pad mapping: ${model.rotatedDpad ? "Rotated" : "Standard"}`,
          "Switch if arrows feel swapped on your TV",
          () => {
            LocalStore.set(ROTATED_DPAD_KEY2, !Boolean(LocalStore.get(ROTATED_DPAD_KEY2, true)));
          }
        );
        addItem(
          `Remote grid navigation: ${model.strictDpadGrid ? "Strict" : "Flexible"}`,
          "Strict matches Android-style row/column navigation",
          () => {
            LocalStore.set(STRICT_DPAD_GRID_KEY2, !Boolean(LocalStore.get(STRICT_DPAD_GRID_KEY2, true)));
          }
        );
        return items;
      }
      if (sectionId === "plugins") {
        addItem("Open plugins manager", "Manage plugin runtime and repositories", () => Router.navigate("plugin"));
        addItem("Sync pull plugins", "Download plugin repositories from cloud", () => PluginSyncService.pull());
        addItem("Sync push plugins", "Upload local plugin repositories to cloud", () => PluginSyncService.push());
        return items;
      }
      if (sectionId === "integration") {
        addItem(
          `TMDB enrichment: ${model.tmdbSettings.enabled ? "ON" : "OFF"}`,
          "Enable TMDB metadata enrichment",
          () => TmdbSettingsStore.set({ enabled: !TmdbSettingsStore.get().enabled })
        );
        addItem(
          `TMDB artwork: ${model.tmdbSettings.useArtwork ? "ON" : "OFF"}`,
          "Use poster/logo/backdrop from TMDB",
          () => TmdbSettingsStore.set({ useArtwork: !TmdbSettingsStore.get().useArtwork })
        );
        addItem("Set TMDB API key", model.tmdbSettings.apiKey ? "TMDB key configured" : "No TMDB key configured", () => {
          const value = window.prompt("Insert TMDB API key", TmdbSettingsStore.get().apiKey || "");
          if (value !== null) {
            TmdbSettingsStore.set({ apiKey: String(value).trim() });
          }
        });
        addItem("Sync pull all", "Download profiles/plugins/addons/library/progress", async () => {
          await ProfileSyncService.pull();
          await PluginSyncService.pull();
          await LibrarySyncService.pull();
          await SavedLibrarySyncService.pull();
          await WatchedItemsSyncService.pull();
          await WatchProgressSyncService.pull();
        });
        addItem("Sync push all", "Upload profiles/plugins/addons/library/progress", async () => {
          await ProfileSyncService.push();
          await PluginSyncService.push();
          await LibrarySyncService.push();
          await SavedLibrarySyncService.push();
          await WatchedItemsSyncService.push();
          await WatchProgressSyncService.push();
        });
        return items;
      }
      if (sectionId === "playback") {
        model.playbackItems.forEach((item) => addItem(item.label, item.description, item.action));
        return items;
      }
      if (sectionId === "trakt") {
        addItem("Open account", "Manage Trakt from account section", () => Router.navigate("account"));
        return items;
      }
      if (sectionId === "about") {
        addItem("Nuvio webOS build", "Full webOS mode (Android parity migration)", () => {
        });
        addItem("Privacy policy", "Open privacy page", () => {
          var _a;
          (_a = window.open) == null ? void 0 : _a.call(window, "https://nuvioapp.space/privacy", "_blank");
        });
        return items;
      }
      return items;
    },
    async render() {
      this.model = await this.collectModel();
      this.actionMap = /* @__PURE__ */ new Map();
      const section = SECTION_META.find((item) => item.id === this.activeSection) || SECTION_META[0];
      const panelItems = this.buildSectionItems(section.id, this.model);
      this.panelIndex = clamp2(this.panelIndex, 0, Math.max(panelItems.length - 1, 0));
      this.navIndex = clamp2(this.navIndex, 0, SECTION_META.length - 1);
      const navHtml = SECTION_META.map((item, index) => `
      <button class="settings-nav-item focusable${this.activeSection === item.id ? " selected" : ""}"
              data-zone="nav"
              data-nav-index="${index}"
              data-section="${item.id}">
        <span class="settings-nav-label">${item.label}</span>
        <span class="settings-nav-chevron">\u203A</span>
      </button>
    `).join("");
      const panelHtml = panelItems.length ? panelItems.map((item, index) => `
          <button class="settings-panel-item focusable"
                  data-zone="panel"
                  data-panel-index="${index}"
                  data-action-id="${item.id}">
            <span class="settings-panel-title">${item.label}</span>
            <span class="settings-panel-subtitle">${item.description || ""}</span>
            <span class="settings-panel-chevron">\u203A</span>
          </button>
        `).join("") : `<div class="settings-panel-empty">No options in this section.</div>`;
      const railHtml = RAIL_ITEMS.map((item, index) => `
      <button class="settings-rail-item focusable${item.id === "settings" ? " selected" : ""}"
              data-zone="rail"
              data-rail-index="${index}"
              data-rail-action="${item.id}">
        <img class="settings-rail-icon" src="${railIconPath(item.id)}" alt="" aria-hidden="true" />
      </button>
    `).join("");
      this.container.innerHTML = `
      <div class="settings-shell">
        <aside class="settings-rail">
          ${railHtml}
        </aside>
        <aside class="settings-sidebar">
          ${navHtml}
        </aside>
        <section class="settings-content">
          <h2 class="settings-title">${section.label}</h2>
          <p class="settings-subtitle">${section.subtitle}</p>
          <div class="settings-panel">
            ${panelHtml}
          </div>
        </section>
      </div>
    `;
      ScreenUtils.indexFocusables(this.container);
      this.applyFocus();
    },
    applyFocus() {
      const current = this.container.querySelector(".focusable.focused");
      current == null ? void 0 : current.classList.remove("focused");
      if (this.focusZone === "panel") {
        const panel = Array.from(this.container.querySelectorAll(".settings-panel-item.focusable"));
        const target2 = panel[this.panelIndex] || panel[0];
        if (target2) {
          target2.classList.add("focused");
          target2.focus();
          return;
        }
        this.focusZone = "nav";
      }
      if (this.focusZone === "rail") {
        const rail = Array.from(this.container.querySelectorAll(".settings-rail-item.focusable"));
        const target2 = rail[this.railIndex] || rail[0];
        if (target2) {
          target2.classList.add("focused");
          target2.focus();
          return;
        }
        this.focusZone = "nav";
      }
      const nav = Array.from(this.container.querySelectorAll(".settings-nav-item.focusable"));
      const target = nav[this.navIndex] || nav[0];
      if (target) {
        target.classList.add("focused");
        target.focus();
      }
    },
    async moveNav(delta) {
      const next = clamp2(this.navIndex + delta, 0, SECTION_META.length - 1);
      if (next === this.navIndex) {
        return;
      }
      this.navIndex = next;
      this.activeSection = SECTION_META[next].id;
      this.panelIndex = 0;
      await this.render();
    },
    movePanel(delta) {
      const panel = Array.from(this.container.querySelectorAll(".settings-panel-item.focusable"));
      if (!panel.length) {
        return;
      }
      this.panelIndex = clamp2(this.panelIndex + delta, 0, panel.length - 1);
      this.applyFocus();
    },
    moveRail(delta) {
      this.railIndex = clamp2(this.railIndex + delta, 0, RAIL_ITEMS.length - 1);
      this.applyFocus();
    },
    async onKeyDown(event) {
      var _a;
      const code = Number((event == null ? void 0 : event.keyCode) || 0);
      if (code === 38 || code === 40 || code === 37 || code === 39) {
        if (typeof (event == null ? void 0 : event.preventDefault) === "function") {
          event.preventDefault();
        }
        if (this.focusZone === "rail") {
          if (code === 38) {
            this.moveRail(-1);
            return;
          }
          if (code === 40) {
            this.moveRail(1);
            return;
          }
          if (code === 39) {
            this.focusZone = "nav";
            this.applyFocus();
            return;
          }
        } else if (this.focusZone === "nav") {
          if (code === 38) {
            await this.moveNav(-1);
            return;
          }
          if (code === 40) {
            await this.moveNav(1);
            return;
          }
          if (code === 39) {
            const panel = this.container.querySelectorAll(".settings-panel-item.focusable");
            if (panel.length) {
              this.focusZone = "panel";
              this.panelIndex = clamp2(this.panelIndex, 0, panel.length - 1);
              this.applyFocus();
            }
            return;
          }
          if (code === 37) {
            this.focusZone = "rail";
            this.applyFocus();
            return;
          }
        } else {
          if (code === 38) {
            this.movePanel(-1);
            return;
          }
          if (code === 40) {
            this.movePanel(1);
            return;
          }
          if (code === 37) {
            this.focusZone = "nav";
            this.applyFocus();
            return;
          }
        }
        return;
      }
      if (code !== 13) {
        return;
      }
      const current = this.container.querySelector(".focusable.focused");
      if (!current) {
        return;
      }
      const zone = String(current.dataset.zone || "");
      if (zone === "rail") {
        const actionId2 = String(current.dataset.railAction || "");
        const action2 = (_a = RAIL_ITEMS.find((item) => item.id === actionId2)) == null ? void 0 : _a.action;
        if (action2) {
          await action2();
        }
        return;
      }
      if (zone === "nav") {
        const section = current.dataset.section;
        const index = Number(current.dataset.navIndex || 0);
        if (section && this.activeSection !== section) {
          this.activeSection = section;
          this.navIndex = clamp2(index, 0, SECTION_META.length - 1);
          this.panelIndex = 0;
          await this.render();
        }
        return;
      }
      const actionId = current.dataset.actionId;
      const action = this.actionMap.get(actionId);
      if (!action) {
        return;
      }
      await action();
      if (Router.getCurrent() === "settings") {
        await this.render();
        this.focusZone = "panel";
        this.applyFocus();
      }
    },
    cleanup() {
      ScreenUtils.hide(this.container);
    }
  };

  // js/ui/screens/plugin/pluginScreen.js
  var RAIL_ITEMS2 = [
    { id: "home", action: () => Router.navigate("home") },
    { id: "search", action: () => Router.navigate("search") },
    { id: "library", action: () => Router.navigate("library") },
    { id: "plugin", action: () => {
    } },
    { id: "settings", action: () => Router.navigate("settings") }
  ];
  function railIconPath2(actionId) {
    if (actionId === "home") return "assets/icons/sidebar_home.svg";
    if (actionId === "search") return "assets/icons/sidebar_search.svg";
    if (actionId === "library") return "assets/icons/sidebar_library.svg";
    if (actionId === "plugin") return "assets/icons/sidebar_plugin.svg";
    return "assets/icons/sidebar_settings.svg";
  }
  function clamp3(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }
  var PluginScreen = {
    async mount() {
      this.container = document.getElementById("plugin");
      ScreenUtils.show(this.container);
      this.focusZone = this.focusZone || "content";
      this.railIndex = Number.isFinite(this.railIndex) ? this.railIndex : 3;
      this.contentRow = Number.isFinite(this.contentRow) ? this.contentRow : 0;
      this.contentCol = Number.isFinite(this.contentCol) ? this.contentCol : 0;
      await this.render();
    },
    async collectModel() {
      const addons = await addonRepository.getInstalledAddons();
      const addonUrls = addonRepository.getInstalledAddonUrls();
      return {
        addons,
        addonUrls
      };
    },
    getRowMaxCol(row) {
      if (row >= 3) {
        return 2;
      }
      return 0;
    },
    async render() {
      this.model = await this.collectModel();
      this.actionMap = /* @__PURE__ */ new Map();
      const addonRows = this.model.addons.map((addon, index) => {
        const baseUrl = addon.baseUrl || this.model.addonUrls[index] || "";
        const upActionId = `addon_up_${index}`;
        const downActionId = `addon_down_${index}`;
        const removeActionId = `addon_remove_${index}`;
        this.actionMap.set(upActionId, async () => {
          const urls = addonRepository.getInstalledAddonUrls();
          if (index <= 0 || index >= urls.length) {
            return;
          }
          const next = [...urls];
          const tmp = next[index - 1];
          next[index - 1] = next[index];
          next[index] = tmp;
          await addonRepository.setAddonOrder(next);
          await this.render();
        });
        this.actionMap.set(downActionId, async () => {
          const urls = addonRepository.getInstalledAddonUrls();
          if (index < 0 || index >= urls.length - 1) {
            return;
          }
          const next = [...urls];
          const tmp = next[index + 1];
          next[index + 1] = next[index];
          next[index] = tmp;
          await addonRepository.setAddonOrder(next);
          await this.render();
        });
        this.actionMap.set(removeActionId, async () => {
          await addonRepository.removeAddon(baseUrl);
          await this.render();
        });
        return `
        <article class="addons-installed-card">
          <div class="addons-installed-head">
            <div>
              <h3>${addon.displayName || addon.name || "Unknown addon"}</h3>
              <p class="addons-installed-version">v${addon.version || "0.0.0"}</p>
            </div>
            <div class="addons-installed-actions">
              <button class="addons-action-btn addons-focusable"
                      data-zone="content"
                      data-row="${index + 3}"
                      data-col="0"
                      data-action-id="${upActionId}">Up</button>
              <button class="addons-action-btn addons-focusable"
                      data-zone="content"
                      data-row="${index + 3}"
                      data-col="1"
                      data-action-id="${downActionId}">Down</button>
              <button class="addons-action-btn addons-focusable addons-remove-btn"
                      data-zone="content"
                      data-row="${index + 3}"
                      data-col="2"
                      data-action-id="${removeActionId}">Remove</button>
            </div>
          </div>
          <p class="addons-installed-description">${addon.description || "No description available."}</p>
        </article>
      `;
      }).join("");
      this.actionMap.set("install_addon", async () => {
        const value = window.prompt("Install addon URL", "https://example.com/manifest.json");
        if (value === null) {
          return;
        }
        const clean = String(value).trim();
        if (!clean) {
          return;
        }
        await addonRepository.addAddon(clean);
        await this.render();
      });
      this.actionMap.set("manage_from_phone", () => Router.navigate("syncCode"));
      this.actionMap.set("reorder_catalogs", () => Router.navigate("settings"));
      this.container.innerHTML = `
      <div class="addons-shell">
        <aside class="addons-rail">
          ${RAIL_ITEMS2.map((item, index) => `
            <button class="addons-rail-item addons-focusable${item.id === "plugin" ? " selected" : ""}"
                    data-zone="rail"
                    data-rail-index="${index}"
                    data-rail-action="${item.id}">
              <img class="addons-rail-icon" src="${railIconPath2(item.id)}" alt="" aria-hidden="true" />
            </button>
          `).join("")}
        </aside>
        <main class="addons-main">
          <h1 class="addons-title">Addons</h1>
          <section class="addons-install-card">
            <h2>Install addon</h2>
            <div class="addons-install-row">
              <div class="addons-install-input">https://example.com</div>
              <button class="addons-install-btn addons-focusable"
                      data-zone="content"
                      data-row="0"
                      data-col="0"
                      data-action-id="install_addon">Install</button>
            </div>
          </section>
          <button class="addons-large-row addons-focusable"
                  data-zone="content"
                  data-row="1"
                  data-col="0"
                  data-action-id="manage_from_phone">
            <span class="addons-large-row-icon">QR</span>
            <span>
              <strong>Manage from phone</strong>
              <small>Scan a QR code to manage addons and Home catalogs from your phone</small>
            </span>
            <span class="addons-large-row-tail">Open</span>
          </button>
          <button class="addons-large-row addons-focusable"
                  data-zone="content"
                  data-row="2"
                  data-col="0"
                  data-action-id="reorder_catalogs">
            <span class="addons-large-row-icon">Cat</span>
            <span>
              <strong>Reorder home catalogs</strong>
              <small>Controls catalog row order on Home (Classic + Modern + Grid)</small>
            </span>
            <span class="addons-large-row-tail">Sort</span>
          </button>
          <h2 class="addons-subtitle">Installed</h2>
          <section class="addons-installed-list">
            ${addonRows || `<div class="addons-empty">No addons installed yet.</div>`}
          </section>
        </main>
      </div>
    `;
      this.normalizeFocus();
      this.applyFocus();
    },
    normalizeFocus() {
      const maxRow = this.model.addons.length > 0 ? this.model.addons.length + 2 : 2;
      this.contentRow = clamp3(this.contentRow, 0, maxRow);
      this.contentCol = clamp3(this.contentCol, 0, this.getRowMaxCol(this.contentRow));
      this.railIndex = clamp3(this.railIndex, 0, RAIL_ITEMS2.length - 1);
    },
    applyFocus() {
      const current = this.container.querySelector(".addons-focusable.focused");
      current == null ? void 0 : current.classList.remove("focused");
      if (this.focusZone === "rail") {
        const node = this.container.querySelector(`.addons-rail-item[data-rail-index="${this.railIndex}"]`);
        if (node) {
          node.classList.add("focused");
          node.focus();
          return;
        }
        this.focusZone = "content";
      }
      const target = this.container.querySelector(
        `.addons-focusable[data-zone="content"][data-row="${this.contentRow}"][data-col="${this.contentCol}"]`
      ) || this.container.querySelector(`.addons-focusable[data-zone="content"][data-row="${this.contentRow}"][data-col="0"]`) || this.container.querySelector('.addons-focusable[data-zone="content"][data-row="0"][data-col="0"]');
      if (target) {
        target.classList.add("focused");
        target.focus();
      }
    },
    moveContent(deltaRow, deltaCol = 0) {
      if (deltaCol !== 0) {
        const nextCol = clamp3(this.contentCol + deltaCol, 0, this.getRowMaxCol(this.contentRow));
        this.contentCol = nextCol;
        this.applyFocus();
        return;
      }
      const maxRow = this.model.addons.length > 0 ? this.model.addons.length + 2 : 2;
      const nextRow = clamp3(this.contentRow + deltaRow, 0, maxRow);
      this.contentRow = nextRow;
      this.contentCol = clamp3(this.contentCol, 0, this.getRowMaxCol(nextRow));
      this.applyFocus();
    },
    moveRail(delta) {
      this.railIndex = clamp3(this.railIndex + delta, 0, RAIL_ITEMS2.length - 1);
      this.applyFocus();
    },
    async activateFocused() {
      var _a;
      const current = this.container.querySelector(".addons-focusable.focused");
      if (!current) {
        return;
      }
      if (String(current.dataset.zone || "") === "rail") {
        const id = String(current.dataset.railAction || "");
        const action2 = (_a = RAIL_ITEMS2.find((item) => item.id === id)) == null ? void 0 : _a.action;
        if (action2) {
          await action2();
        }
        return;
      }
      const actionId = String(current.dataset.actionId || "");
      const action = this.actionMap.get(actionId);
      if (!action) {
        return;
      }
      await action();
      if (Router.getCurrent() === "plugin") {
        this.normalizeFocus();
        this.applyFocus();
      }
    },
    async onKeyDown(event) {
      var _a;
      const code = Number((event == null ? void 0 : event.keyCode) || 0);
      if (code === 38 || code === 40 || code === 37 || code === 39) {
        (_a = event == null ? void 0 : event.preventDefault) == null ? void 0 : _a.call(event);
        if (this.focusZone === "rail") {
          if (code === 38) this.moveRail(-1);
          else if (code === 40) this.moveRail(1);
          else if (code === 39) {
            this.focusZone = "content";
            this.applyFocus();
          }
          return;
        }
        if (code === 38) this.moveContent(-1);
        else if (code === 40) this.moveContent(1);
        else if (code === 37) {
          if (this.contentCol > 0) {
            this.moveContent(0, -1);
          } else {
            this.focusZone = "rail";
            this.applyFocus();
          }
        } else if (code === 39) this.moveContent(0, 1);
        return;
      }
      if (code !== 13) {
        return;
      }
      await this.activateFocused();
    },
    cleanup() {
      ScreenUtils.hide(this.container);
    }
  };

  // js/ui/screens/stream/streamScreen.js
  function getDpadDirection2(event) {
    const keyCode = Number((event == null ? void 0 : event.keyCode) || 0);
    const key = String((event == null ? void 0 : event.key) || "").toLowerCase();
    if (keyCode === 37 || key === "arrowleft" || key === "left") return "left";
    if (keyCode === 39 || key === "arrowright" || key === "right") return "right";
    if (keyCode === 38 || key === "arrowup" || key === "up") return "up";
    if (keyCode === 40 || key === "arrowdown" || key === "down") return "down";
    return null;
  }
  function isBackEvent4(event) {
    return Environment.isBackEvent(event);
  }
  function detectQuality2(text = "") {
    const value = String(text).toLowerCase();
    if (value.includes("2160") || value.includes("4k")) return "4K";
    if (value.includes("1080")) return "1080p";
    if (value.includes("720")) return "720p";
    return "Auto";
  }
  function flattenStreams(streamResult) {
    if (!streamResult || streamResult.status !== "success") {
      return [];
    }
    return (streamResult.data || []).flatMap((group) => {
      const groupName = group.addonName || "Addon";
      return (group.streams || []).map((stream, index) => ({
        id: `${groupName}-${index}-${stream.url || ""}`,
        label: stream.title || stream.name || `${groupName} stream`,
        description: stream.description || stream.name || "",
        addonName: groupName,
        addonLogo: group.addonLogo || stream.addonLogo || null,
        sourceType: stream.type || stream.source || "",
        url: stream.url,
        raw: stream
      })).filter((entry) => Boolean(entry.url));
    });
  }
  function mergeStreamItems2(existing = [], incoming = []) {
    const byKey = /* @__PURE__ */ new Set();
    const merged = [];
    const push = (item) => {
      if (!(item == null ? void 0 : item.url)) {
        return;
      }
      const key = [
        String(item.addonName || "Addon"),
        String(item.url || ""),
        String(item.sourceType || ""),
        String(item.label || "")
      ].join("::");
      if (byKey.has(key)) {
        return;
      }
      byKey.add(key);
      merged.push(item);
    };
    (existing || []).forEach(push);
    (incoming || []).forEach(push);
    return merged;
  }
  function normalizeType(itemType) {
    const normalized = String(itemType || "movie").toLowerCase();
    if (normalized === "tv") {
      return "series";
    }
    return normalized || "movie";
  }
  var StreamScreen = {
    async mount(params = {}) {
      this.container = document.getElementById("stream");
      ScreenUtils.show(this.container);
      this.params = params || {};
      this.loading = true;
      this.streams = [];
      this.addonFilter = "all";
      this.focusState = { zone: "filter", index: 0 };
      this.loadToken = (this.loadToken || 0) + 1;
      this.render();
      await this.loadStreams();
    },
    async loadStreams() {
      var _a, _b, _c, _d, _e, _f, _g, _h;
      const token = this.loadToken;
      const itemType = normalizeType((_a = this.params) == null ? void 0 : _a.itemType);
      const videoId = String(((_b = this.params) == null ? void 0 : _b.videoId) || ((_c = this.params) == null ? void 0 : _c.itemId) || "");
      const options = {
        itemId: String(((_d = this.params) == null ? void 0 : _d.itemId) || ""),
        season: (_f = (_e = this.params) == null ? void 0 : _e.season) != null ? _f : null,
        episode: (_h = (_g = this.params) == null ? void 0 : _g.episode) != null ? _h : null,
        onChunk: (chunkResult) => {
          if (token !== this.loadToken) {
            return;
          }
          const chunkItems = flattenStreams(chunkResult);
          if (!chunkItems.length) {
            return;
          }
          this.streams = mergeStreamItems2(this.streams, chunkItems);
          this.render();
        }
      };
      const streamResult = await streamRepository.getStreamsFromAllAddons(itemType, videoId, options);
      if (token !== this.loadToken) {
        return;
      }
      this.streams = mergeStreamItems2(this.streams, flattenStreams(streamResult));
      this.loading = false;
      this.render();
    },
    getFilteredStreams() {
      if (this.addonFilter === "all") {
        return this.streams;
      }
      return this.streams.filter((stream) => stream.addonName === this.addonFilter);
    },
    focusList(list, index) {
      if (!Array.isArray(list) || !list.length) {
        return false;
      }
      const targetIndex = Math.max(0, Math.min(list.length - 1, index));
      const target = list[targetIndex];
      if (!target) {
        return false;
      }
      this.container.querySelectorAll(".focusable").forEach((node) => node.classList.remove("focused"));
      target.classList.add("focused");
      try {
        target.focus({ preventScroll: true });
      } catch (_) {
        target.focus();
      }
      const verticalList = target.closest(".series-stream-list");
      if (verticalList) {
        target.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
      return true;
    },
    getFocusLists() {
      const filters = Array.from(this.container.querySelectorAll(".series-stream-filter.focusable"));
      const cards = Array.from(this.container.querySelectorAll(".series-stream-card.focusable"));
      const selectedFilterIndex = Math.max(0, filters.findIndex((node) => node.classList.contains("selected")));
      return { filters, cards, selectedFilterIndex };
    },
    syncFocusFromDom() {
      const { filters, cards, selectedFilterIndex } = this.getFocusLists();
      const active = document.activeElement;
      const filterIndex = filters.findIndex((node) => node.classList.contains("focused") || node === active);
      if (filterIndex >= 0) {
        this.focusState = { zone: "filter", index: filterIndex };
        return;
      }
      const cardIndex = cards.findIndex((node) => node.classList.contains("focused") || node === active);
      if (cardIndex >= 0) {
        this.focusState = { zone: "card", index: cardIndex };
        return;
      }
      this.focusState = { zone: filters.length ? "filter" : "card", index: selectedFilterIndex };
    },
    applyFocus() {
      var _a, _b;
      const { filters, cards, selectedFilterIndex } = this.getFocusLists();
      if (!filters.length && !cards.length) {
        return;
      }
      let zone = ((_a = this.focusState) == null ? void 0 : _a.zone) || "filter";
      let index = Number(((_b = this.focusState) == null ? void 0 : _b.index) || 0);
      if (zone === "filter" && !filters.length && cards.length) {
        zone = "card";
        index = 0;
      } else if (zone === "card" && !cards.length && filters.length) {
        zone = "filter";
        index = selectedFilterIndex;
      }
      if (zone === "filter") {
        index = Math.max(0, Math.min(filters.length - 1, index));
        this.focusState = { zone, index };
        this.focusList(filters, index);
        return;
      }
      index = Math.max(0, Math.min(cards.length - 1, index));
      this.focusState = { zone: "card", index };
      this.focusList(cards, index);
    },
    getHeaderMeta() {
      var _a, _b, _c, _d, _e, _f, _g, _h;
      const isSeries = normalizeType((_a = this.params) == null ? void 0 : _a.itemType) === "series";
      const title = String(((_b = this.params) == null ? void 0 : _b.itemTitle) || ((_c = this.params) == null ? void 0 : _c.playerTitle) || "Untitled");
      const subtitle = isSeries ? String(((_d = this.params) == null ? void 0 : _d.episodeTitle) || ((_e = this.params) == null ? void 0 : _e.playerSubtitle) || "").trim() : String(((_f = this.params) == null ? void 0 : _f.itemSubtitle) || "").trim();
      const episodeLabel = isSeries && Number.isFinite(Number((_g = this.params) == null ? void 0 : _g.season)) && Number.isFinite(Number((_h = this.params) == null ? void 0 : _h.episode)) ? `S${Number(this.params.season)} E${Number(this.params.episode)}` : "";
      return { isSeries, title, subtitle, episodeLabel };
    },
    render() {
      var _a, _b, _c;
      const { isSeries, title, subtitle, episodeLabel } = this.getHeaderMeta();
      const addons = Array.from(new Set(this.streams.map((stream) => stream.addonName).filter(Boolean)));
      const filtered = this.getFilteredStreams();
      const backdrop = ((_a = this.params) == null ? void 0 : _a.backdrop) || ((_b = this.params) == null ? void 0 : _b.poster) || "";
      const logo = ((_c = this.params) == null ? void 0 : _c.logo) || "";
      const filterTabs = [
        `<button class="series-stream-filter focusable${this.addonFilter === "all" ? " selected" : ""}" data-action="setFilter" data-addon="all">All</button>`,
        ...addons.map((addon) => `
        <button class="series-stream-filter focusable${this.addonFilter === addon ? " selected" : ""}" data-action="setFilter" data-addon="${addon}">
          ${addon}
        </button>
      `)
      ].join("");
      const streamCards = filtered.length ? filtered.map((stream) => `
          <article class="series-stream-card focusable" data-action="playStream" data-stream-id="${stream.id}">
            <div class="series-stream-title">${stream.label || "Stream"}</div>
            <div class="series-stream-desc">${stream.description || ""}</div>
            <div class="series-stream-meta">
              <span>${stream.addonName || "Addon"}${stream.sourceType ? ` - ${stream.sourceType}` : ""}</span>
            </div>
            <div class="series-stream-tags">
              <span class="series-stream-tag">${detectQuality2(stream.label || stream.description || "")}</span>
              <span class="series-stream-tag">${String(stream.sourceType || "").toLowerCase().includes("torrent") ? "Torrent" : "Stream"}</span>
            </div>
          </article>
        `).join("") : this.loading ? `<div class="series-stream-empty">Loading streams...</div>` : `<div class="series-stream-empty">No streams found for this filter.</div>`;
      this.container.innerHTML = `
      <div class="series-detail-shell stream-screen-shell">
        <div class="series-detail-backdrop"${backdrop ? ` style="background-image:url('${backdrop}')"` : ""}></div>
        <div class="series-detail-vignette"></div>
        <div class="series-stream-panel stream-screen-panel">
          <div class="series-stream-left stream-screen-left">
            ${logo ? `<img src="${logo}" class="series-stream-logo" alt="logo" />` : `<div class="series-stream-heading">${title}</div>`}
            ${episodeLabel ? `<div class="series-stream-episode">${episodeLabel}</div>` : `<div class="series-stream-episode">${title}</div>`}
            <div class="series-stream-episode-title">${subtitle || (isSeries ? "Select a source to start episode playback." : "Select a source to start playback.")}</div>
          </div>
          <div class="series-stream-right">
            <div class="series-stream-filters">${filterTabs}</div>
            <div class="series-stream-list">${streamCards}</div>
          </div>
        </div>
      </div>
    `;
      ScreenUtils.indexFocusables(this.container);
      this.applyFocus();
    },
    playStream(streamId) {
      var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p, _q, _r, _s;
      const filtered = this.getFilteredStreams();
      const selected = filtered.find((stream) => stream.id === streamId) || filtered[0];
      if (!(selected == null ? void 0 : selected.url)) {
        return;
      }
      const isSeries = normalizeType((_a = this.params) == null ? void 0 : _a.itemType) === "series";
      Router.navigate("player", {
        streamUrl: selected.url,
        itemId: ((_b = this.params) == null ? void 0 : _b.itemId) || null,
        itemType: isSeries ? "series" : "movie",
        videoId: ((_c = this.params) == null ? void 0 : _c.videoId) || null,
        episodeLabel: ((_d = this.params) == null ? void 0 : _d.season) && ((_e = this.params) == null ? void 0 : _e.episode) ? `S${this.params.season}E${this.params.episode}` : null,
        playerTitle: ((_f = this.params) == null ? void 0 : _f.itemTitle) || ((_g = this.params) == null ? void 0 : _g.playerTitle) || "Untitled",
        playerSubtitle: ((_h = this.params) == null ? void 0 : _h.episodeTitle) || ((_i = this.params) == null ? void 0 : _i.playerSubtitle) || "",
        playerBackdropUrl: ((_j = this.params) == null ? void 0 : _j.backdrop) || ((_k = this.params) == null ? void 0 : _k.poster) || null,
        playerLogoUrl: ((_l = this.params) == null ? void 0 : _l.logo) || null,
        parentalWarnings: ((_m = this.params) == null ? void 0 : _m.parentalWarnings) || null,
        parentalGuide: ((_n = this.params) == null ? void 0 : _n.parentalGuide) || null,
        season: ((_o = this.params) == null ? void 0 : _o.season) == null ? null : Number(this.params.season),
        episode: ((_p = this.params) == null ? void 0 : _p.episode) == null ? null : Number(this.params.episode),
        episodes: Array.isArray((_q = this.params) == null ? void 0 : _q.episodes) ? this.params.episodes : [],
        streamCandidates: filtered,
        nextEpisodeVideoId: ((_r = this.params) == null ? void 0 : _r.nextEpisodeVideoId) || null,
        nextEpisodeLabel: ((_s = this.params) == null ? void 0 : _s.nextEpisodeLabel) || null
      });
    },
    onKeyDown(event) {
      var _a, _b, _c, _d;
      if (isBackEvent4(event)) {
        (_a = event == null ? void 0 : event.preventDefault) == null ? void 0 : _a.call(event);
        Router.back();
        return;
      }
      const direction = getDpadDirection2(event);
      if (direction) {
        const { filters, cards, selectedFilterIndex } = this.getFocusLists();
        const hasValidLocalFocus = this.focusState && (this.focusState.zone === "filter" && filters.length && Number(this.focusState.index) >= 0 && Number(this.focusState.index) < filters.length || this.focusState.zone === "card" && cards.length && Number(this.focusState.index) >= 0 && Number(this.focusState.index) < cards.length);
        if (!hasValidLocalFocus) {
          this.syncFocusFromDom();
        }
        let zone = ((_b = this.focusState) == null ? void 0 : _b.zone) || (filters.length ? "filter" : "card");
        let index = Number(((_c = this.focusState) == null ? void 0 : _c.index) || 0);
        if (zone === "filter" && !filters.length && cards.length) {
          zone = "card";
          index = Math.min(cards.length - 1, Math.max(0, index));
        } else if (zone === "card" && !cards.length && filters.length) {
          zone = "filter";
          index = selectedFilterIndex;
        }
        if (zone === "filter" && filters.length) {
          const focusedFilterIndex = filters.findIndex((node) => node.classList.contains("focused") || node === document.activeElement);
          if (focusedFilterIndex >= 0) {
            index = focusedFilterIndex;
          }
        } else if (zone === "card" && cards.length) {
          const focusedCardIndex = cards.findIndex((node) => node.classList.contains("focused") || node === document.activeElement);
          if (focusedCardIndex >= 0) {
            index = focusedCardIndex;
          }
        }
        (_d = event == null ? void 0 : event.preventDefault) == null ? void 0 : _d.call(event);
        if (zone === "filter") {
          if (direction === "left") {
            this.focusState = { zone: "filter", index: Math.max(0, index - 1) };
            this.applyFocus();
            return;
          }
          if (direction === "right") {
            this.focusState = { zone: "filter", index: Math.min(filters.length - 1, index + 1) };
            this.applyFocus();
            return;
          }
          if (direction === "down" && cards.length) {
            this.focusState = { zone: "card", index: Math.min(index, cards.length - 1) };
            this.applyFocus();
          }
          return;
        }
        if (zone === "card") {
          if (direction === "up") {
            if (index > 0) {
              this.focusState = { zone: "card", index: index - 1 };
            } else if (filters.length) {
              this.focusState = { zone: "filter", index: selectedFilterIndex };
            }
            this.applyFocus();
            return;
          }
          if (direction === "down") {
            this.focusState = { zone: "card", index: Math.min(cards.length - 1, index + 1) };
            this.applyFocus();
            return;
          }
          return;
        }
        return;
      }
      if (Number((event == null ? void 0 : event.keyCode) || 0) !== 13) {
        return;
      }
      const current = this.container.querySelector(".focusable.focused");
      if (!current) {
        return;
      }
      const action = String(current.dataset.action || "");
      if (action === "setFilter") {
        this.addonFilter = current.dataset.addon || "all";
        const order = ["all", ...Array.from(new Set(this.streams.map((stream) => stream.addonName).filter(Boolean)))];
        this.focusState = { zone: "filter", index: Math.max(0, order.indexOf(this.addonFilter)) };
        this.render();
        return;
      }
      if (action === "playStream") {
        this.playStream(current.dataset.streamId);
      }
    },
    cleanup() {
      this.loadToken = (this.loadToken || 0) + 1;
      ScreenUtils.hide(this.container);
    }
  };

  // js/ui/screens/cast/castDetailScreen.js
  var TMDB_BASE_URL4 = "https://api.themoviedb.org/3";
  var IMAGE_BASE_URL2 = "https://image.tmdb.org/t/p/w780";
  function toImage(path) {
    const value = String(path || "").trim();
    if (!value) {
      return "";
    }
    if (value.startsWith("http://") || value.startsWith("https://")) {
      return value;
    }
    if (value.startsWith("/")) {
      return `${IMAGE_BASE_URL2}${value}`;
    }
    return value;
  }
  function isBackEvent5(event) {
    return Environment.isBackEvent(event);
  }
  function toType(mediaType) {
    const value = String(mediaType || "").toLowerCase();
    if (value === "tv" || value === "series" || value === "show") {
      return "series";
    }
    return "movie";
  }
  var CastDetailScreen = {
    async mount(params = {}) {
      this.container = document.getElementById("castDetail");
      ScreenUtils.show(this.container);
      this.params = params || {};
      this.loadToken = (this.loadToken || 0) + 1;
      this.person = null;
      this.credits = [];
      this.renderLoading();
      await this.loadCastDetails();
    },
    async getPersonIdFromName(name) {
      const settings = TmdbSettingsStore.get();
      const apiKey = String(settings.apiKey || "").trim();
      if (!apiKey || !name) {
        return null;
      }
      const language = settings.language || "it-IT";
      const url = `${TMDB_BASE_URL4}/search/person?api_key=${encodeURIComponent(apiKey)}&language=${encodeURIComponent(language)}&query=${encodeURIComponent(name)}`;
      const response = await fetch(url);
      if (!response.ok) {
        return null;
      }
      const data = await response.json();
      const first = Array.isArray(data == null ? void 0 : data.results) ? data.results[0] : null;
      return (first == null ? void 0 : first.id) ? String(first.id) : null;
    },
    async loadCastDetails() {
      var _a, _b, _c, _d, _e;
      const token = this.loadToken;
      try {
        const settings = TmdbSettingsStore.get();
        const apiKey = String(settings.apiKey || "").trim();
        if (!apiKey) {
          this.renderError("TMDB API key not configured.");
          return;
        }
        let personId = String(((_a = this.params) == null ? void 0 : _a.castId) || "").trim();
        if (!personId || !/^\d+$/.test(personId)) {
          personId = await this.getPersonIdFromName(((_b = this.params) == null ? void 0 : _b.castName) || "");
        }
        if (!personId) {
          this.renderError("Cast profile not found.");
          return;
        }
        const language = settings.language || "it-IT";
        const url = `${TMDB_BASE_URL4}/person/${encodeURIComponent(personId)}?api_key=${encodeURIComponent(apiKey)}&language=${encodeURIComponent(language)}&append_to_response=combined_credits,images`;
        const response = await fetch(url);
        if (!response.ok) {
          this.renderError("Failed to load cast details.");
          return;
        }
        const person = await response.json();
        if (token !== this.loadToken) {
          return;
        }
        this.person = {
          id: String((person == null ? void 0 : person.id) || personId),
          name: (person == null ? void 0 : person.name) || ((_c = this.params) == null ? void 0 : _c.castName) || "Unknown",
          biography: (person == null ? void 0 : person.biography) || "",
          birthday: (person == null ? void 0 : person.birthday) || "",
          placeOfBirth: (person == null ? void 0 : person.place_of_birth) || "",
          knownForDepartment: (person == null ? void 0 : person.known_for_department) || "",
          profile: toImage((person == null ? void 0 : person.profile_path) || ((_d = this.params) == null ? void 0 : _d.castPhoto) || "")
        };
        const credits = Array.isArray((_e = person == null ? void 0 : person.combined_credits) == null ? void 0 : _e.cast) ? person.combined_credits.cast : [];
        this.credits = credits.map((item) => ({
          id: (item == null ? void 0 : item.id) ? String(item.id) : "",
          itemId: (item == null ? void 0 : item.imdb_id) || (item == null ? void 0 : item.id) ? String(item.imdb_id || item.id) : "",
          type: toType(item == null ? void 0 : item.media_type),
          name: (item == null ? void 0 : item.title) || (item == null ? void 0 : item.name) || "Untitled",
          subtitle: (item == null ? void 0 : item.character) || "",
          poster: toImage((item == null ? void 0 : item.poster_path) || (item == null ? void 0 : item.backdrop_path) || ""),
          popularity: Number((item == null ? void 0 : item.popularity) || 0)
        })).filter((item) => Boolean(item.itemId)).sort((left, right) => right.popularity - left.popularity).slice(0, 30);
        this.render();
      } catch (error) {
        console.warn("Cast detail load failed", error);
        this.renderError("Failed to load cast details.");
      }
    },
    renderLoading() {
      this.container.innerHTML = `
      <div class="cast-detail-shell">
        <div class="cast-detail-loading">Loading cast profile...</div>
      </div>
    `;
    },
    renderError(message) {
      this.container.innerHTML = `
      <div class="cast-detail-shell">
        <div class="cast-detail-error">${message}</div>
        <button class="cast-detail-back focusable" data-action="back">Back</button>
      </div>
    `;
      ScreenUtils.indexFocusables(this.container);
      ScreenUtils.setInitialFocus(this.container);
    },
    render() {
      const person = this.person || {};
      const creditsHtml = this.credits.length ? this.credits.map((item) => `
          <article class="cast-credit-card focusable"
                   data-action="openDetail"
                   data-item-id="${item.itemId}"
                   data-item-type="${item.type}"
                   data-item-title="${item.name}">
            <div class="cast-credit-poster"${item.poster ? ` style="background-image:url('${item.poster}')"` : ""}></div>
            <div class="cast-credit-title">${item.name}</div>
            <div class="cast-credit-subtitle">${item.subtitle || item.type}</div>
          </article>
        `).join("") : `<div class="cast-credit-empty">No titles found for this cast member.</div>`;
      this.container.innerHTML = `
      <div class="cast-detail-shell">
        <section class="cast-detail-hero">
          <button class="cast-detail-back focusable" data-action="back">Back</button>
          <div class="cast-detail-hero-content">
            <div class="cast-detail-avatar"${person.profile ? ` style="background-image:url('${person.profile}')"` : ""}></div>
            <div class="cast-detail-meta">
              <h2 class="cast-detail-name">${person.name || "Unknown"}</h2>
              <div class="cast-detail-facts">
                ${person.knownForDepartment ? `<span>${person.knownForDepartment}</span>` : ""}
                ${person.birthday ? `<span>${person.birthday}</span>` : ""}
                ${person.placeOfBirth ? `<span>${person.placeOfBirth}</span>` : ""}
              </div>
              <p class="cast-detail-bio">${person.biography || "No biography available."}</p>
            </div>
          </div>
        </section>
        <section class="cast-detail-credits">
          <h3 class="cast-detail-section-title">Known For</h3>
          <div class="cast-credit-track">${creditsHtml}</div>
        </section>
      </div>
    `;
      ScreenUtils.indexFocusables(this.container);
      ScreenUtils.setInitialFocus(this.container);
    },
    onKeyDown(event) {
      var _a;
      if (isBackEvent5(event)) {
        (_a = event == null ? void 0 : event.preventDefault) == null ? void 0 : _a.call(event);
        Router.back();
        return;
      }
      if (ScreenUtils.handleDpadNavigation(event, this.container)) {
        return;
      }
      if (Number((event == null ? void 0 : event.keyCode) || 0) !== 13) {
        return;
      }
      const current = this.container.querySelector(".focusable.focused");
      if (!current) {
        return;
      }
      const action = String(current.dataset.action || "");
      if (action === "back") {
        Router.back();
        return;
      }
      if (action === "openDetail") {
        Router.navigate("detail", {
          itemId: current.dataset.itemId,
          itemType: current.dataset.itemType || "movie",
          fallbackTitle: current.dataset.itemTitle || "Untitled"
        });
      }
    },
    cleanup() {
      this.loadToken = (this.loadToken || 0) + 1;
      ScreenUtils.hide(this.container);
    }
  };

  // js/ui/screens/catalog/catalogSeeAllScreen.js
  function isBackEvent6(event) {
    return Environment.isBackEvent(event);
  }
  function toTitleCase4(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
  }
  var CatalogSeeAllScreen = {
    async mount(params = {}) {
      this.container = document.getElementById("catalogSeeAll");
      ScreenUtils.show(this.container);
      this.params = params || {};
      this.items = Array.isArray(params == null ? void 0 : params.initialItems) ? [...params.initialItems] : [];
      this.nextSkip = this.items.length ? 100 : 0;
      this.loading = false;
      this.hasMore = true;
      this.loadToken = (this.loadToken || 0) + 1;
      this.render();
      if (!this.items.length) {
        await this.loadNextPage();
      }
    },
    async loadNextPage() {
      var _a;
      if (this.loading || !this.hasMore) {
        return;
      }
      const descriptor = this.params || {};
      if (!descriptor.addonBaseUrl || !descriptor.catalogId || !descriptor.type) {
        this.hasMore = false;
        this.render();
        return;
      }
      this.loading = true;
      this.render();
      const token = this.loadToken;
      const skip = Math.max(0, Number(this.nextSkip || 0));
      const result = await catalogRepository.getCatalog({
        addonBaseUrl: descriptor.addonBaseUrl,
        addonId: descriptor.addonId,
        addonName: descriptor.addonName,
        catalogId: descriptor.catalogId,
        catalogName: descriptor.catalogName,
        type: descriptor.type,
        skip,
        supportsSkip: true
      });
      if (token !== this.loadToken) {
        return;
      }
      if (result.status !== "success") {
        this.loading = false;
        this.hasMore = false;
        this.render();
        return;
      }
      const incoming = Array.isArray((_a = result == null ? void 0 : result.data) == null ? void 0 : _a.items) ? result.data.items : [];
      if (incoming.length) {
        const seen = new Set(this.items.map((item) => item.id));
        incoming.forEach((item) => {
          if (!(item == null ? void 0 : item.id) || seen.has(item.id)) {
            return;
          }
          seen.add(item.id);
          this.items.push(item);
        });
        this.nextSkip = skip + 100;
      }
      this.hasMore = incoming.length > 0;
      this.loading = false;
      this.render();
    },
    render() {
      const descriptor = this.params || {};
      const title = descriptor.catalogName ? `${descriptor.catalogName} - ${toTitleCase4(descriptor.type)}` : "Catalog";
      const cards = this.items.length ? this.items.map((item) => `
          <article class="seeall-card focusable"
                   data-action="openDetail"
                   data-item-id="${item.id}"
                   data-item-type="${item.type || descriptor.type || "movie"}"
                   data-item-title="${item.name || "Untitled"}">
            <div class="seeall-card-poster"${item.poster ? ` style="background-image:url('${item.poster}')"` : ""}></div>
            <div class="seeall-card-title">${item.name || "Untitled"}</div>
            <div class="seeall-card-subtitle">${toTitleCase4(item.type || descriptor.type || "movie")}</div>
          </article>
        `).join("") : `<div class="seeall-empty">No items available.</div>`;
      this.container.innerHTML = `
      <div class="seeall-shell">
        <header class="seeall-header">
          <button class="seeall-back focusable" data-action="back">Back</button>
          <h2 class="seeall-title">${title}</h2>
          <button class="seeall-load-more focusable${!this.hasMore || this.loading ? " disabled" : ""}"
                  data-action="loadMore"
                  ${!this.hasMore || this.loading ? "disabled" : ""}>
            ${this.loading ? "Loading..." : this.hasMore ? "Load More" : "No More"}
          </button>
        </header>
        <section class="seeall-grid">
          ${cards}
        </section>
      </div>
    `;
      ScreenUtils.indexFocusables(this.container);
      ScreenUtils.setInitialFocus(this.container);
    },
    async onKeyDown(event) {
      var _a;
      if (isBackEvent6(event)) {
        (_a = event == null ? void 0 : event.preventDefault) == null ? void 0 : _a.call(event);
        Router.back();
        return;
      }
      if (ScreenUtils.handleDpadNavigation(event, this.container)) {
        return;
      }
      if (Number((event == null ? void 0 : event.keyCode) || 0) !== 13) {
        return;
      }
      const current = this.container.querySelector(".focusable.focused");
      if (!current) {
        return;
      }
      const action = String(current.dataset.action || "");
      if (action === "back") {
        Router.back();
        return;
      }
      if (action === "loadMore") {
        await this.loadNextPage();
        return;
      }
      if (action === "openDetail") {
        Router.navigate("detail", {
          itemId: current.dataset.itemId,
          itemType: current.dataset.itemType || "movie",
          fallbackTitle: current.dataset.itemTitle || "Untitled"
        });
      }
    },
    cleanup() {
      this.loadToken = (this.loadToken || 0) + 1;
      ScreenUtils.hide(this.container);
    }
  };

  // js/ui/navigation/router.js
  var NON_BACKSTACK_ROUTES = /* @__PURE__ */ new Set([
    "splash",
    "profileSelection",
    "authQrSignIn",
    "authSignIn",
    "syncCode"
  ]);
  var Router = {
    current: null,
    currentParams: {},
    stack: [],
    historyInitialized: false,
    popstateBound: false,
    routes: {
      splash: SplashScreen,
      home: HomeScreen,
      player: PlayerScreen,
      account: AccountScreen,
      authQrSignIn: AuthQrSignInScreen,
      authSignIn: AuthSignInScreen,
      syncCode: SyncCodeScreen,
      profileSelection: ProfileSelectionScreen,
      detail: MetaDetailsScreen,
      library: LibraryScreen,
      search: SearchScreen,
      discover: DiscoverScreen,
      settings: SettingsScreen,
      plugin: PluginScreen,
      stream: StreamScreen,
      castDetail: CastDetailScreen,
      catalogSeeAll: CatalogSeeAllScreen
    },
    init() {
      if (this.popstateBound) {
        return;
      }
      this.popstateBound = true;
      window.addEventListener("popstate", async (event) => {
        var _a;
        const currentScreen = this.getCurrentScreen();
        if ((_a = currentScreen == null ? void 0 : currentScreen.consumeBackRequest) == null ? void 0 : _a.call(currentScreen)) {
          if ((window == null ? void 0 : window.history) && typeof window.history.pushState === "function") {
            window.history.pushState({ route: this.current, params: this.currentParams }, "");
          }
          return;
        }
        const state = (event == null ? void 0 : event.state) || null;
        if (this.current === "home" && (!(state == null ? void 0 : state.route) || NON_BACKSTACK_ROUTES.has(state.route))) {
          Platform.exitApp();
          return;
        }
        if ((state == null ? void 0 : state.route) && this.routes[state.route]) {
          await this.navigate(state.route, state.params || {}, {
            fromHistory: true,
            skipStackPush: true
          });
          return;
        }
        if (this.current && this.current !== "home" && this.routes.home) {
          await this.navigate("home", {}, {
            fromHistory: true,
            skipStackPush: true
          });
        }
      });
    },
    async navigate(routeName, params = {}, options = {}) {
      var _a, _b, _c, _d;
      const fromHistory = Boolean(options == null ? void 0 : options.fromHistory);
      const skipStackPush = Boolean(options == null ? void 0 : options.skipStackPush);
      const replaceHistory = Boolean(options == null ? void 0 : options.replaceHistory);
      const Screen = this.routes[routeName];
      if (!Screen) {
        console.error("Route not found:", routeName);
        return;
      }
      const previousRoute = this.current;
      const shouldSkipPush = skipStackPush || NON_BACKSTACK_ROUTES.has(previousRoute);
      if (this.current && this.current !== routeName) {
        (_b = (_a = this.routes[this.current]).cleanup) == null ? void 0 : _b.call(_a);
        if (!shouldSkipPush) {
          this.stack.push({
            route: this.current,
            params: this.currentParams || {}
          });
        }
      } else if (this.current === routeName) {
        (_d = (_c = this.routes[this.current]).cleanup) == null ? void 0 : _d.call(_c);
      }
      this.current = routeName;
      this.currentParams = params || {};
      await Screen.mount(this.currentParams);
      if ((window == null ? void 0 : window.history) && typeof window.history.pushState === "function") {
        const state = { route: this.current, params: this.currentParams };
        if (!this.historyInitialized) {
          window.history.replaceState(state, "");
          this.historyInitialized = true;
        } else if (!fromHistory) {
          if (replaceHistory || NON_BACKSTACK_ROUTES.has(previousRoute)) {
            window.history.replaceState(state, "");
          } else {
            window.history.pushState(state, "");
          }
        }
      }
    },
    async back() {
      var _a, _b, _c, _d, _e;
      const currentScreen = this.getCurrentScreen();
      if ((_a = currentScreen == null ? void 0 : currentScreen.consumeBackRequest) == null ? void 0 : _a.call(currentScreen)) {
        return;
      }
      if (this.current === "home") {
        Platform.exitApp();
        return;
      }
      if ((window == null ? void 0 : window.history) && typeof window.history.back === "function" && this.historyInitialized) {
        window.history.back();
        return;
      }
      if (this.stack.length === 0) {
        if (this.current && this.current !== "home" && this.routes.home) {
          (_c = (_b = this.routes[this.current]).cleanup) == null ? void 0 : _c.call(_b);
          this.current = "home";
          this.currentParams = {};
          await this.routes.home.mount();
          return;
        }
        Platform.exitApp();
        return;
      }
      const previous = this.stack.pop();
      const previousRoute = typeof previous === "string" ? previous : previous == null ? void 0 : previous.route;
      const previousParams = typeof previous === "string" ? {} : (previous == null ? void 0 : previous.params) || {};
      if (!previousRoute || !this.routes[previousRoute]) {
        return;
      }
      (_e = (_d = this.routes[this.current]).cleanup) == null ? void 0 : _e.call(_d);
      this.current = previousRoute;
      this.currentParams = previousParams;
      await this.routes[previousRoute].mount(previousParams);
    },
    getCurrent() {
      return this.current;
    },
    getCurrentScreen() {
      if (!this.current) {
        return null;
      }
      return this.routes[this.current] || null;
    }
  };

  // js/ui/navigation/focusEngine.js
  function buildNormalizedEvent(event) {
    const normalizedKey = Platform.normalizeKey(event);
    const normalizedCode = Number(normalizedKey.keyCode || 0);
    return {
      key: normalizedKey.key,
      code: normalizedKey.code,
      target: (event == null ? void 0 : event.target) || null,
      altKey: Boolean(event == null ? void 0 : event.altKey),
      ctrlKey: Boolean(event == null ? void 0 : event.ctrlKey),
      shiftKey: Boolean(event == null ? void 0 : event.shiftKey),
      metaKey: Boolean(event == null ? void 0 : event.metaKey),
      repeat: Boolean(event == null ? void 0 : event.repeat),
      defaultPrevented: Boolean(event == null ? void 0 : event.defaultPrevented),
      keyCode: normalizedCode,
      which: normalizedCode,
      originalKeyCode: Number(normalizedKey.originalKeyCode || (event == null ? void 0 : event.keyCode) || 0),
      preventDefault: () => {
        if (typeof (event == null ? void 0 : event.preventDefault) === "function") {
          event.preventDefault();
        }
      },
      stopPropagation: () => {
        if (typeof (event == null ? void 0 : event.stopPropagation) === "function") {
          event.stopPropagation();
        }
      },
      stopImmediatePropagation: () => {
        if (typeof (event == null ? void 0 : event.stopImmediatePropagation) === "function") {
          event.stopImmediatePropagation();
        }
      }
    };
  }
  var FocusEngine = {
    lastBackHandledAt: 0,
    init() {
      this.boundHandleKey = this.handleKey.bind(this);
      document.addEventListener("keydown", this.boundHandleKey, true);
    },
    handleKey(event) {
      var _a, _b;
      if (event.defaultPrevented) {
        return;
      }
      const normalizedEvent = buildNormalizedEvent(event);
      if (Platform.isBackEvent({
        target: (event == null ? void 0 : event.target) || null,
        key: (event == null ? void 0 : event.key) || "",
        code: (event == null ? void 0 : event.code) || "",
        keyCode: normalizedEvent.keyCode
      })) {
        const now = Date.now();
        if (now - this.lastBackHandledAt < 180) {
          return;
        }
        this.lastBackHandledAt = now;
        if (typeof event.preventDefault === "function") {
          event.preventDefault();
        }
        if (typeof event.stopPropagation === "function") {
          event.stopPropagation();
        }
        if (typeof event.stopImmediatePropagation === "function") {
          event.stopImmediatePropagation();
        }
        const currentScreen2 = Router.getCurrentScreen();
        if ((_a = currentScreen2 == null ? void 0 : currentScreen2.consumeBackRequest) == null ? void 0 : _a.call(currentScreen2)) {
          return;
        }
        Router.back();
        return;
      }
      const currentScreen = Router.getCurrentScreen();
      (_b = currentScreen == null ? void 0 : currentScreen.onKeyDown) == null ? void 0 : _b.call(currentScreen, normalizedEvent);
    }
  };

  // js/bootstrap/renderAppShell.js
  var APP_SHELL = `
  <div id="app">
    <div id="splash" class="screen"></div>
    <div id="account" class="screen"></div>
    <div id="profileSelection" class="screen"></div>
    <div id="home" class="screen"></div>
    <div id="detail" class="screen"></div>
    <div id="stream" class="screen"></div>
    <div id="castDetail" class="screen"></div>
    <div id="catalogSeeAll" class="screen"></div>
    <div id="library" class="screen"></div>
    <div id="search" class="screen"></div>
    <div id="discover" class="screen"></div>
    <div id="settings" class="screen"></div>
    <div id="plugin" class="screen"></div>
    <div id="player" class="screen">
      <video id="videoPlayer" autoplay playsinline webkit-playsinline preload="auto" style="width:100vw;height:100vh;background:black"></video>
    </div>
  </div>
`;
  function renderAppShell() {
    if (document.getElementById("app")) {
      return;
    }
    document.body.insertAdjacentHTML("afterbegin", APP_SHELL);
  }

  // js/runtime/loadStreamingLibs.js
  var STREAMING_LIBS = [
    {
      src: "https://cdn.jsdelivr.net/npm/hls.js@1.5.20/dist/hls.min.js",
      isLoaded: () => Boolean(globalThis.Hls)
    },
    {
      src: "https://cdn.jsdelivr.net/npm/dashjs@4.7.4/dist/dash.all.min.js",
      isLoaded: () => Boolean(globalThis.dashjs)
    }
  ];
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }
  async function loadStreamingLibs() {
    for (const entry of STREAMING_LIBS) {
      if (entry.isLoaded()) {
        continue;
      }
      try {
        await loadScript(entry.src);
      } catch (error) {
        console.warn("Streaming library failed to load", entry.src, error);
      }
    }
  }

  // js/app.js
  async function bootstrapApp() {
    renderAppShell();
    Platform.init();
    await loadStreamingLibs();
    console.log("Nuvio starting...", {
      platform: Platform.getName()
    });
    Router.init();
    PlayerController.init();
    FocusEngine.init();
    ThemeManager.apply();
    AuthManager.subscribe((state) => {
      if (state === AuthState.LOADING) {
        StartupSyncService.stop();
        Router.navigate("splash");
      }
      if (state === AuthState.SIGNED_OUT) {
        StartupSyncService.stop();
        Router.navigate("authQrSignIn");
      }
      if (state === AuthState.AUTHENTICATED) {
        StartupSyncService.start();
        Router.navigate("profileSelection");
      }
    });
    await AuthManager.bootstrap();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      bootstrapApp().catch((error) => {
        console.error("App bootstrap failed", error);
      });
    }, { once: true });
  } else {
    bootstrapApp().catch((error) => {
      console.error("App bootstrap failed", error);
    });
  }
})();
