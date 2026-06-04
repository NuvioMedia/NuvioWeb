import { LocalStore } from "../storage/localStore.js";
import { PluginEngine } from "./pluginEngine.js";

const KEY = "pluginSources";

function normalizeSources(input) {
  if (!Array.isArray(input)) {
    return [];
  }
  return input
    .map((source) => ({
      id: source.id || `plugin_${Math.random().toString(36).slice(2, 10)}`,
      name: String(source.name || "Custom Source").trim(),
      urlTemplate: String(source.urlTemplate || "").trim(),
      enabled: source.enabled !== false
    }))
    .filter((source) => Boolean(source.urlTemplate));
}

function applyTemplate(template, vars) {
  let output = template;
  Object.entries(vars).forEach(([key, value]) => {
    const token = `{${key}}`;
    output = output.split(token).join(String(value ?? ""));
  });
  return output;
}

export const PluginRuntime = {

  listSources() {
    return normalizeSources(LocalStore.get(KEY, []));
  },

  saveSources(sources) {
    LocalStore.set(KEY, normalizeSources(sources));
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

  // Run the real scraper-provider engine (pre-transpiled providers, executed on-device).
  // Returns [{ sourceId, sourceName, streams: [...] }].
  execute({ tmdbId, mediaType, season = null, episode = null, disabledRepoIds = [] } = {}) {
    return PluginEngine.execute({ tmdbId, mediaType, season, episode, disabledRepoIds });
  }

};
