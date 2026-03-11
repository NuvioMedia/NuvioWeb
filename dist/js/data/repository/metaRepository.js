import { safeApiCall } from "../../core/network/safeApiCall.js";
import { addonRepository } from "./addonRepository.js";
import { MetaApi } from "../remote/api/metaApi.js";

class MetaRepository {

  constructor() {
    this.metaCache = new Map();
  }

  async getMeta(addonBaseUrl, type, id) {
    const cacheKey = `${addonBaseUrl}:${type}:${id}`;
    if (this.metaCache.has(cacheKey)) {
      return { status: "success", data: this.metaCache.get(cacheKey) };
    }

    const url = this.buildMetaUrl(addonBaseUrl, type, id);
    const result = await safeApiCall(() => MetaApi.getMeta(url));
    if (result.status !== "success") {
      return result;
    }

    const meta = this.mapMeta(result.data?.meta || null);
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

}

export const metaRepository = new MetaRepository();
