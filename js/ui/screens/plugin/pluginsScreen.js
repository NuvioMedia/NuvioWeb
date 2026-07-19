import { ScreenUtils } from "../../navigation/screen.js";
import { Router } from "../../navigation/router.js";
import { Platform } from "../../../platform/index.js";
import { I18n } from "../../../i18n/index.js";

function t(key, params = {}, fallback = key) {
  return I18n.t(key, params, { fallback });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export const PluginsScreen = {
  async mount() {
    this.container = document.getElementById("plugins");
    ScreenUtils.show(this.container);
    this.routeEnterPending = true;
    await this.render();
  },

  async render() {
    const enterClass = this.routeEnterPending ? " nuvio-route-slide-enter" : "";
    this.container.innerHTML = `
      <div class="plugins-route-shell tv-route-shell">
        <div class="plugins-route-content${enterClass}">
          <header class="settings-content-header">
            <h1 class="settings-title">${escapeHtml(t("plugin_title", {}, "Plugins"))}</h1>
            <p class="settings-subtitle">${escapeHtml(t("settings.sections.plugins.subtitle", {}, "Manage repositories, providers, and plugin states"))}</p>
          </header>
          <div class="settings-group-card settings-group-card-fill">
            <div class="settings-empty-state settings-empty-state-plugins">
              <p class="settings-plugin-soon-text">${escapeHtml(t("settings.plugins.comingSoon", {}, "Plugin support is coming soon."))}</p>
            </div>
          </div>
        </div>
      </div>
    `;
    this.routeEnterPending = false;
    ScreenUtils.indexFocusables(this.container);
  },

  async onKeyDown(event) {
    if (Platform.isBackEvent(event)) {
      event?.preventDefault?.();
      await Router.back();
    }
  },

  consumeBackRequest() {
    return false;
  },

  cleanup() {
    this.routeEnterPending = false;
    ScreenUtils.hide(this.container);
  }
};
