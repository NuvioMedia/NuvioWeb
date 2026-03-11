import { safeApiCall } from "../../core/network/safeApiCall.js";
import { addonRepository } from "./addonRepository.js";
import { StreamApi } from "../remote/api/streamApi.js";
import { PluginManager } from "../../core/player/pluginManager.js";
import { TmdbService } from "../../core/tmdb/tmdbService.js";

class StreamRepository {

  async getStreamsFromAddon(baseUrl, type, videoId) {
    const url = this.buildStreamUrl(baseUrl, type, videoId);
    const result = await safeApiCall(() => StreamApi.getStreams(url));
    if (result.status !== "success") {
      return result;
    }

    const streams = (result.data?.streams || []).map((stream) => this.mapStream(stream));
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

    const onChunk = typeof options?.onChunk === "function" ? options.onChunk : null;
    const notifyChunk = (group) => {
      if (!onChunk || !group?.streams?.length) {
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
        const pluginStreams = await this.getPluginStreams(type, videoId, options);
        pluginStreams.forEach((group) => notifyChunk(group));
        return pluginStreams;
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
    const mediaType = type === "series" ? "tv" : type;
    const tmdbLookupId = String(options?.itemId || videoId || "").trim();
    const tmdbId = await TmdbService.ensureTmdbId(tmdbLookupId, type);
    if (!tmdbId) {
      return [];
    }

    const pluginResults = await PluginManager.executeScrapersStreaming({
      tmdbId,
      mediaType,
      season: options?.season ?? null,
      episode: options?.episode ?? null
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
    const sidecarSubtitles = Array.isArray(stream.subtitles)
      ? stream.subtitles
        .filter((entry) => entry && entry.url)
        .map((entry) => ({
          id: entry.id || null,
          url: entry.url,
          lang: entry.lang || "unknown"
        }))
      : [];

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

}

export const streamRepository = new StreamRepository();
