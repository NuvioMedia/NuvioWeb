import { AuthState } from "./authState.js";
import { SessionStore } from "../storage/sessionStore.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../../config.js";

class AuthManagerClass {

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
    this.listeners.forEach(l => l(newState));
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
        if (!data?.access_token) {
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
          ...(deviceName && { p_device_name: deviceName })
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
}

export const AuthManager = new AuthManagerClass();
