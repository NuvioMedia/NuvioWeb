(function defineNuvioEnv() {
  var root = typeof globalThis !== "undefined" ? globalThis : window;
  root.__NUVIO_ENV__ = Object.assign({}, root.__NUVIO_ENV__ || {}, {
    SUPABASE_URL: "",
    SUPABASE_ANON_KEY: "",
    TV_LOGIN_REDIRECT_BASE_URL: "",
    PUBLIC_APP_URL: "",
    ADDON_REMOTE_BASE_URL: "",
    ENABLE_REMOTE_WRAPPER_MODE: false,
    PREFERRED_PLAYBACK_ORDER: ["native-hls", "hls.js", "dash.js", "native-file", "platform-avplay"],
    TMDB_API_KEY: ""
  });
}());
