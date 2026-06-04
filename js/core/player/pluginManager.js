import { LocalStore } from "../storage/localStore.js";
import { PluginRuntime } from "./pluginRuntime.js";
import { PluginEngine } from "./pluginEngine.js";

const PLUGINS_ENABLED_KEY = "pluginsEnabled";
const PLUGIN_REPOS_DISABLED_KEY = "pluginReposDisabled";

export const PluginManager = {

  get pluginsEnabled() {
    return Boolean(LocalStore.get(PLUGINS_ENABLED_KEY, false));
  },

  // Repo ids the user turned off. Default: empty (all installed repos active).
  getDisabledRepoIds() {
    const value = LocalStore.get(PLUGIN_REPOS_DISABLED_KEY, []);
    return Array.isArray(value) ? value.map((id) => String(id)) : [];
  },

  // [{ repoId, repoName, count, enabled }] for the settings Plugins screen.
  listRepos() {
    const disabled = new Set(this.getDisabledRepoIds());
    return PluginEngine.listRepos().map((repo) => ({
      ...repo,
      enabled: !disabled.has(String(repo.repoId))
    }));
  },

  setRepoEnabled(repoId, enabled) {
    const id = String(repoId);
    const disabled = new Set(this.getDisabledRepoIds());
    if (enabled) {
      disabled.delete(id);
    } else {
      disabled.add(id);
    }
    LocalStore.set(PLUGIN_REPOS_DISABLED_KEY, Array.from(disabled));
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
    return PluginRuntime.execute({
      tmdbId,
      mediaType,
      season,
      episode,
      disabledRepoIds: this.getDisabledRepoIds()
    });
  }

};
