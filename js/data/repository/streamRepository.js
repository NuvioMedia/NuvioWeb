import { safeApiCall } from "../../core/network/safeApiCall.js";
import { addonRepository } from "./addonRepository.js";
import { StreamApi } from "../remote/api/streamApi.js";
import { MetaApi } from "../remote/api/metaApi.js";
import { PluginManager } from "../../core/player/pluginManager.js";
import { TmdbService } from "../../core/tmdb/tmdbService.js";
import { LocalDebridAvailabilityService } from "../../core/debrid/localDebridAvailabilityService.js";
import { DebridStreamPresentation } from "../../core/debrid/directDebridStreamPresentation.js";

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
    const installedAddons = (await addonRepository.getInstalledAddons()).map((addon, index) => ({
      ...addon,
      orderIndex: index
    }));
    const onAddon = typeof options?.onAddon === "function" ? options.onAddon : null;

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

    const supportsStreamType = (addon) =>
      (addon?.resources || []).some((resource) => {
        if (resource.name !== "stream") {
          return false;
        }
        if (!resource.types || resource.types.length === 0) {
          return true;
        }
        return resource.types.some((resourceType) => resourceType === type);
      });

    const supportsMetaType = (addon) =>
      (addon?.resources || []).some((resource) => {
        if (resource.name !== "meta") {
          return false;
        }
        if (!resource.types || resource.types.length === 0) {
          return true;
        }
        return resource.types.some((resourceType) => resourceType === type);
      });

    const notifyAddon = (addon, orderIndex) => {
      if (!onAddon || !addon) {
        return;
      }
      try {
        onAddon({ ...addon, orderIndex });
      } catch (error) {
        console.warn("Stream addon callback failed", error);
      }
    };

    const prepareDebridGroup = async (group) => {
      const checkingGroup =
        DebridStreamPresentation.apply(LocalDebridAvailabilityService.markChecking([group]))[0] ||
        group;
      const checkedGroup =
        (await LocalDebridAvailabilityService.annotateCachedAvailability([checkingGroup]))[0] ||
        checkingGroup;
      const presentedGroup = DebridStreamPresentation.apply([checkedGroup])[0] || checkedGroup;
      notifyChunk(presentedGroup);
      return presentedGroup;
    };

    const addonTasks = installedAddons.map(async (addon) => {
      try {
        const canStream = supportsStreamType(addon);
        const canMeta = supportsMetaType(addon);
        if (!canStream && !canMeta) {
          return null;
        }
        const orderIndex = Number(addon.orderIndex ?? Number.MAX_SAFE_INTEGER);
        notifyAddon(addon, orderIndex);
        let addonStreams = [];
        if (canStream) {
          const streamsResult = await this.getStreamsFromAddon(addon.baseUrl, type, videoId);
          if (streamsResult.status === "success" && streamsResult.data.length) {
            addonStreams = streamsResult.data;
          }
        }
        // Some addons (e.g. debrid cloud catalogs) deliver the playable stream
        // inline in the meta's videos[].streams[] and only expose a meta resource
        // for the content type, not a stream resource. Fall back to that here.
        if (addonStreams.length === 0 && canMeta) {
          addonStreams = await this.fetchInlineStreamsFromMeta(addon, type, videoId);
        }
        if (addonStreams.length === 0) {
          return null;
        }

        const group = {
          addonId: addon.id,
          addonBaseUrl: addon.baseUrl,
          addonName: addon.displayName,
          addonLogo: addon.logo,
          addonOrderIndex: orderIndex,
          streamOrigin: {
            kind: "addon",
            addonId: addon.id,
            addonBaseUrl: addon.baseUrl,
            addonName: addon.displayName,
            addonOrderIndex: orderIndex
          },
          streams: addonStreams.map((stream) => ({
            ...stream,
            addonId: addon.id,
            addonBaseUrl: addon.baseUrl,
            addonName: addon.displayName,
            addonLogo: addon.logo,
            addonOrderIndex: orderIndex,
            streamOrigin: {
              ...(stream.streamOrigin || {}),
              kind: "addon",
              addonId: addon.id,
              addonBaseUrl: addon.baseUrl,
              addonName: addon.displayName,
              addonOrderIndex: orderIndex
            }
          }))
        };
        return prepareDebridGroup(group);
      } catch (_) {
        return null;
      }
    });

    const pluginTask = (async () => {
      try {
        const pluginStreams = await this.getPluginStreams(type, videoId, options);
        const preparedPluginStreams = [];
        for (const group of pluginStreams) {
          preparedPluginStreams.push(await prepareDebridGroup(group));
        }
        return preparedPluginStreams;
      } catch (error) {
        console.warn("Plugin stream fetch failed", error);
        return [];
      }
    })();

    const results = await Promise.all(addonTasks);
    const addonsWithStreams = results
      .filter(Boolean)
      .sort(
        (left, right) => Number(left.addonOrderIndex || 0) - Number(right.addonOrderIndex || 0)
      );
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
      sourceProviderId: result.sourceId || result.sourceName || null,
      addonName: result.sourceName,
      addonLogo: null,
      streamOrigin: {
        kind: "plugin",
        sourceProviderId: result.sourceId || result.sourceName || null,
        addonName: result.sourceName || null
      },
      streams: (result.streams || []).map((stream) => ({
        ...stream,
        sourceProviderId: result.sourceId || result.sourceName || null,
        addonName: result.sourceName,
        addonLogo: null,
        streamOrigin: {
          ...(stream.streamOrigin || {}),
          kind: "plugin",
          sourceProviderId: result.sourceId || result.sourceName || null,
          addonName: result.sourceName || null
        }
      }))
    }));
  }

  buildStreamUrl(baseUrl, type, videoId) {
    const cleanBaseUrl = addonRepository.canonicalizeUrl(baseUrl);
    const queryStart = cleanBaseUrl.indexOf("?");
    const basePath =
      queryStart >= 0 ? cleanBaseUrl.slice(0, queryStart).replace(/\/+$/, "") : cleanBaseUrl;
    const baseQuery = queryStart >= 0 ? cleanBaseUrl.slice(queryStart) : "";
    return `${basePath}/stream/${this.encode(type)}/${this.encode(videoId)}.json${baseQuery}`;
  }

  buildMetaUrl(baseUrl, type, id) {
    const cleanBaseUrl = addonRepository.canonicalizeUrl(baseUrl);
    const queryStart = cleanBaseUrl.indexOf("?");
    const basePath =
      queryStart >= 0 ? cleanBaseUrl.slice(0, queryStart).replace(/\/+$/, "") : cleanBaseUrl;
    const baseQuery = queryStart >= 0 ? cleanBaseUrl.slice(queryStart) : "";
    return `${basePath}/meta/${this.encode(type)}/${this.encode(id)}.json${baseQuery}`;
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
      fileIdx: stream.fileIdx ?? null,
      externalUrl: stream.externalUrl || null,
      behaviorHints: stream.behaviorHints || null,
      sources: Array.isArray(stream.sources) ? stream.sources : [],
      quality: stream.quality || null,
      qualityValue: Number.isFinite(Number(stream.qualityValue)) ? Number(stream.qualityValue) : -1,
      clientResolve: stream.clientResolve || null,
      debridCacheStatus: stream.debridCacheStatus || null,
      subtitles: sidecarSubtitles
    };
  }

  async fetchInlineStreamsFromMeta(addon, type, videoId) {
    const rawVideoId = String(videoId || "").trim();
    if (!addon?.baseUrl || !rawVideoId) {
      return [];
    }

    // Try the content-level id (handles series episode ids like tt123:1:2)
    // and the raw id (handles content whose clicked id is the meta id itself,
    // e.g. debrid cloud "other" items keyed dmm:<torrentId>).
    const contentLevelId = this.buildContentLevelMetaId(rawVideoId);
    const candidateMetaIds = [];
    if (contentLevelId) {
      candidateMetaIds.push(contentLevelId);
    }
    if (rawVideoId && rawVideoId !== contentLevelId) {
      candidateMetaIds.push(rawVideoId);
    }

    for (const metaId of candidateMetaIds) {
      const url = this.buildMetaUrl(addon.baseUrl, type, metaId);
      const result = await safeApiCall(() => MetaApi.getMeta(url));

      if (result.status !== "success") {
        continue;
      }

      const meta = result.data?.meta || null;
      const videos = Array.isArray(meta?.videos) ? meta.videos : [];

      if (!videos.length) {
        continue;
      }

      const matchingVideo =
        videos.find((video) => String(video?.id || "") === rawVideoId) ||
        (type !== "series" && videos.length === 1 ? videos[0] : null);

      const streams = Array.isArray(matchingVideo?.streams) ? matchingVideo.streams : [];

      const mapped = streams
        .map((stream) => this.mapStream(stream))
        .filter(
          (stream) =>
            stream.url ||
            stream.externalUrl ||
            stream.ytId ||
            stream.clientResolve ||
            stream.infoHash
        );

      if (mapped.length) {
        return mapped;
      }
    }

    return [];
  }

  buildContentLevelMetaId(videoId) {
    const raw = String(videoId || "").trim();
    if (!raw) {
      return "";
    }
    const parts = raw.split(":");
    const contentParts = parts.slice();
    while (contentParts.length > 1 && /^\d+$/.test(contentParts[contentParts.length - 1])) {
      contentParts.pop();
    }
    return contentParts.length ? contentParts.join(":") : raw;
  }
}

export const streamRepository = new StreamRepository();
