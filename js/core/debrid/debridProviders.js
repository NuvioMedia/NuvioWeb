export const DEBRID_PROVIDER_IDS = {
  TORBOX: "torbox",
  PREMIUMIZE: "premiumize",
  REAL_DEBRID: "realdebrid"
};

export const DEBRID_CAPABILITIES = {
  CLIENT_RESOLVE: "clientResolve",
  LOCAL_TORRENT_CACHE_CHECK: "localTorrentCacheCheck",
  LOCAL_TORRENT_RESOLVE: "localTorrentResolve",
  CLOUD_LIBRARY: "cloudLibrary"
};

const PROVIDERS = [
  {
    id: DEBRID_PROVIDER_IDS.TORBOX,
    displayName: "Torbox",
    shortName: "TB",
    visibleInUi: true,
    apiKeyField: "torboxApiKey",
    capabilities: [
      DEBRID_CAPABILITIES.CLIENT_RESOLVE,
      DEBRID_CAPABILITIES.LOCAL_TORRENT_CACHE_CHECK,
      DEBRID_CAPABILITIES.LOCAL_TORRENT_RESOLVE,
      DEBRID_CAPABILITIES.CLOUD_LIBRARY
    ]
  },
  {
    id: DEBRID_PROVIDER_IDS.PREMIUMIZE,
    displayName: "Premiumize",
    shortName: "PM",
    visibleInUi: true,
    apiKeyField: "premiumizeApiKey",
    capabilities: [
      DEBRID_CAPABILITIES.CLIENT_RESOLVE,
      DEBRID_CAPABILITIES.LOCAL_TORRENT_CACHE_CHECK,
      DEBRID_CAPABILITIES.LOCAL_TORRENT_RESOLVE,
      DEBRID_CAPABILITIES.CLOUD_LIBRARY
    ]
  },
  {
    id: DEBRID_PROVIDER_IDS.REAL_DEBRID,
    displayName: "Real-Debrid",
    shortName: "RD",
    visibleInUi: false,
    apiKeyField: "realDebridApiKey",
    capabilities: [
      DEBRID_CAPABILITIES.CLIENT_RESOLVE
    ]
  }
];

function normalizeProviderId(providerId) {
  const normalized = String(providerId || "").trim().toLowerCase();
  if (normalized === "real-debrid" || normalized === "real_debrid" || normalized === "rd") {
    return DEBRID_PROVIDER_IDS.REAL_DEBRID;
  }
  if (normalized === "tb") {
    return DEBRID_PROVIDER_IDS.TORBOX;
  }
  if (normalized === "pm") {
    return DEBRID_PROVIDER_IDS.PREMIUMIZE;
  }
  return normalized;
}

function fallbackDisplayName(providerId) {
  const value = String(providerId || "").trim();
  if (!value) {
    return "Debrid";
  }
  return value
    .replace(/[-_]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ") || "Debrid";
}

export const DebridProviders = {

  all() {
    return PROVIDERS.map((provider) => ({ ...provider, capabilities: [...provider.capabilities] }));
  },

  visible() {
    return this.all().filter((provider) => provider.visibleInUi);
  },

  byId(providerId) {
    const normalized = normalizeProviderId(providerId);
    return PROVIDERS.find((provider) => provider.id === normalized) || null;
  },

  isSupported(providerId) {
    return Boolean(this.byId(providerId));
  },

  supports(providerId, capability) {
    const provider = this.byId(providerId);
    return Boolean(provider && provider.capabilities.includes(capability));
  },

  displayName(providerId) {
    return this.byId(providerId)?.displayName || fallbackDisplayName(providerId);
  },

  apiKeyFor(settings = {}, providerId) {
    const provider = this.byId(providerId);
    if (!provider) {
      return "";
    }
    return String(settings?.[provider.apiKeyField] || "").trim();
  },

  configuredServices(settings = {}) {
    return PROVIDERS
      .filter((provider) => provider.visibleInUi)
      .map((provider) => ({
        provider,
        apiKey: this.apiKeyFor(settings, provider.id)
      }))
      .filter((credential) => credential.apiKey);
  },

  configuredResolverServices(settings = {}) {
    return this.configuredServices(settings).filter((credential) => (
      credential.provider.capabilities.includes(DEBRID_CAPABILITIES.CLIENT_RESOLVE)
        || credential.provider.capabilities.includes(DEBRID_CAPABILITIES.LOCAL_TORRENT_RESOLVE)
    ));
  },

  preferredResolverService(settings = {}) {
    const services = this.configuredResolverServices(settings);
    if (!services.length) {
      return null;
    }
    const preferredId = this.byId(settings.preferredResolverProviderId)?.id || "";
    return services.find((credential) => credential.provider.id === preferredId) || services[0];
  }

};
