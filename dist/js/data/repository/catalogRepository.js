import { safeApiCall } from "../../core/network/safeApiCall.js";
import { CatalogApi } from "../remote/api/catalogApi.js";

class CatalogRepository {

  constructor() {
    this.catalogCache = new Map();
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

    return safeApiCall(() =>
      CatalogApi.getCatalog(url).then((dto) => {
        const items = (dto?.metas || []).map((meta) => this.mapMeta(meta));

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
      return skip > 0
        ? `${cleanBaseUrl}/catalog/${type}/${catalogId}/skip=${skip}.json`
        : `${cleanBaseUrl}/catalog/${type}/${catalogId}.json`;
    }

    if (skip > 0 && !Object.prototype.hasOwnProperty.call(args, "skip")) {
      args.skip = String(skip);
    }

    const query = Object.entries(args)
      .map(([key, value]) => `${this.encodeArg(key)}=${this.encodeArg(String(value))}`)
      .join("&");

    return `${cleanBaseUrl}/catalog/${type}/${catalogId}/${query}.json`;
  }

  buildCacheKey({ addonId, type, catalogId, skip = 0, extraArgs = {} }) {
    const normalizedArgs = Object.entries(extraArgs)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}=${value}`)
      .join("&");

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
}

export const catalogRepository = new CatalogRepository();
