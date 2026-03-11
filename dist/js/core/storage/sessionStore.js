export const SessionStore = {

  normalizeToken(value) {
    const text = String(value ?? "").trim();
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
