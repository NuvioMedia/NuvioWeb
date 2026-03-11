import { Router } from "../../navigation/router.js";
import { ScreenUtils } from "../../navigation/screen.js";
import { addonRepository } from "../../../data/repository/addonRepository.js";

const RAIL_ITEMS = [
  { id: "home", action: () => Router.navigate("home") },
  { id: "search", action: () => Router.navigate("search") },
  { id: "library", action: () => Router.navigate("library") },
  { id: "plugin", action: () => {} },
  { id: "settings", action: () => Router.navigate("settings") }
];

function railIconPath(actionId) {
  if (actionId === "home") return "assets/icons/sidebar_home.svg";
  if (actionId === "search") return "assets/icons/sidebar_search.svg";
  if (actionId === "library") return "assets/icons/sidebar_library.svg";
  if (actionId === "plugin") return "assets/icons/sidebar_plugin.svg";
  return "assets/icons/sidebar_settings.svg";
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export const PluginScreen = {

  async mount() {
    this.container = document.getElementById("plugin");
    ScreenUtils.show(this.container);
    this.focusZone = this.focusZone || "content";
    this.railIndex = Number.isFinite(this.railIndex) ? this.railIndex : 3;
    this.contentRow = Number.isFinite(this.contentRow) ? this.contentRow : 0;
    this.contentCol = Number.isFinite(this.contentCol) ? this.contentCol : 0;
    await this.render();
  },

  async collectModel() {
    const addons = await addonRepository.getInstalledAddons();
    const addonUrls = addonRepository.getInstalledAddonUrls();
    return {
      addons,
      addonUrls
    };
  },

  getRowMaxCol(row) {
    if (row >= 3) {
      return 2;
    }
    return 0;
  },

  async render() {
    this.model = await this.collectModel();
    this.actionMap = new Map();
    const addonRows = this.model.addons.map((addon, index) => {
      const baseUrl = addon.baseUrl || this.model.addonUrls[index] || "";
      const upActionId = `addon_up_${index}`;
      const downActionId = `addon_down_${index}`;
      const removeActionId = `addon_remove_${index}`;
      this.actionMap.set(upActionId, async () => {
        const urls = addonRepository.getInstalledAddonUrls();
        if (index <= 0 || index >= urls.length) {
          return;
        }
        const next = [...urls];
        const tmp = next[index - 1];
        next[index - 1] = next[index];
        next[index] = tmp;
        await addonRepository.setAddonOrder(next);
        await this.render();
      });
      this.actionMap.set(downActionId, async () => {
        const urls = addonRepository.getInstalledAddonUrls();
        if (index < 0 || index >= urls.length - 1) {
          return;
        }
        const next = [...urls];
        const tmp = next[index + 1];
        next[index + 1] = next[index];
        next[index] = tmp;
        await addonRepository.setAddonOrder(next);
        await this.render();
      });
      this.actionMap.set(removeActionId, async () => {
        await addonRepository.removeAddon(baseUrl);
        await this.render();
      });

      return `
        <article class="addons-installed-card">
          <div class="addons-installed-head">
            <div>
              <h3>${addon.displayName || addon.name || "Unknown addon"}</h3>
              <p class="addons-installed-version">v${addon.version || "0.0.0"}</p>
            </div>
            <div class="addons-installed-actions">
              <button class="addons-action-btn addons-focusable"
                      data-zone="content"
                      data-row="${index + 3}"
                      data-col="0"
                      data-action-id="${upActionId}">Up</button>
              <button class="addons-action-btn addons-focusable"
                      data-zone="content"
                      data-row="${index + 3}"
                      data-col="1"
                      data-action-id="${downActionId}">Down</button>
              <button class="addons-action-btn addons-focusable addons-remove-btn"
                      data-zone="content"
                      data-row="${index + 3}"
                      data-col="2"
                      data-action-id="${removeActionId}">Remove</button>
            </div>
          </div>
          <p class="addons-installed-description">${addon.description || "No description available."}</p>
        </article>
      `;
    }).join("");

    this.actionMap.set("install_addon", async () => {
      const value = window.prompt("Install addon URL", "https://example.com/manifest.json");
      if (value === null) {
        return;
      }
      const clean = String(value).trim();
      if (!clean) {
        return;
      }
      await addonRepository.addAddon(clean);
      await this.render();
    });
    this.actionMap.set("manage_from_phone", () => Router.navigate("syncCode"));
    this.actionMap.set("reorder_catalogs", () => Router.navigate("settings"));

    this.container.innerHTML = `
      <div class="addons-shell">
        <aside class="addons-rail">
          ${RAIL_ITEMS.map((item, index) => `
            <button class="addons-rail-item addons-focusable${item.id === "plugin" ? " selected" : ""}"
                    data-zone="rail"
                    data-rail-index="${index}"
                    data-rail-action="${item.id}">
              <img class="addons-rail-icon" src="${railIconPath(item.id)}" alt="" aria-hidden="true" />
            </button>
          `).join("")}
        </aside>
        <main class="addons-main">
          <h1 class="addons-title">Addons</h1>
          <section class="addons-install-card">
            <h2>Install addon</h2>
            <div class="addons-install-row">
              <div class="addons-install-input">https://example.com</div>
              <button class="addons-install-btn addons-focusable"
                      data-zone="content"
                      data-row="0"
                      data-col="0"
                      data-action-id="install_addon">Install</button>
            </div>
          </section>
          <button class="addons-large-row addons-focusable"
                  data-zone="content"
                  data-row="1"
                  data-col="0"
                  data-action-id="manage_from_phone">
            <span class="addons-large-row-icon">QR</span>
            <span>
              <strong>Manage from phone</strong>
              <small>Scan a QR code to manage addons and Home catalogs from your phone</small>
            </span>
            <span class="addons-large-row-tail">Open</span>
          </button>
          <button class="addons-large-row addons-focusable"
                  data-zone="content"
                  data-row="2"
                  data-col="0"
                  data-action-id="reorder_catalogs">
            <span class="addons-large-row-icon">Cat</span>
            <span>
              <strong>Reorder home catalogs</strong>
              <small>Controls catalog row order on Home (Classic + Modern + Grid)</small>
            </span>
            <span class="addons-large-row-tail">Sort</span>
          </button>
          <h2 class="addons-subtitle">Installed</h2>
          <section class="addons-installed-list">
            ${addonRows || `<div class="addons-empty">No addons installed yet.</div>`}
          </section>
        </main>
      </div>
    `;
    this.normalizeFocus();
    this.applyFocus();
  },

  normalizeFocus() {
    const maxRow = this.model.addons.length > 0 ? this.model.addons.length + 2 : 2;
    this.contentRow = clamp(this.contentRow, 0, maxRow);
    this.contentCol = clamp(this.contentCol, 0, this.getRowMaxCol(this.contentRow));
    this.railIndex = clamp(this.railIndex, 0, RAIL_ITEMS.length - 1);
  },

  applyFocus() {
    const current = this.container.querySelector(".addons-focusable.focused");
    current?.classList.remove("focused");

    if (this.focusZone === "rail") {
      const node = this.container.querySelector(`.addons-rail-item[data-rail-index="${this.railIndex}"]`);
      if (node) {
        node.classList.add("focused");
        node.focus();
        return;
      }
      this.focusZone = "content";
    }

    const target = this.container.querySelector(
      `.addons-focusable[data-zone="content"][data-row="${this.contentRow}"][data-col="${this.contentCol}"]`
    ) || this.container.querySelector(`.addons-focusable[data-zone="content"][data-row="${this.contentRow}"][data-col="0"]`)
      || this.container.querySelector('.addons-focusable[data-zone="content"][data-row="0"][data-col="0"]');

    if (target) {
      target.classList.add("focused");
      target.focus();
    }
  },

  moveContent(deltaRow, deltaCol = 0) {
    if (deltaCol !== 0) {
      const nextCol = clamp(this.contentCol + deltaCol, 0, this.getRowMaxCol(this.contentRow));
      this.contentCol = nextCol;
      this.applyFocus();
      return;
    }

    const maxRow = this.model.addons.length > 0 ? this.model.addons.length + 2 : 2;
    const nextRow = clamp(this.contentRow + deltaRow, 0, maxRow);
    this.contentRow = nextRow;
    this.contentCol = clamp(this.contentCol, 0, this.getRowMaxCol(nextRow));
    this.applyFocus();
  },

  moveRail(delta) {
    this.railIndex = clamp(this.railIndex + delta, 0, RAIL_ITEMS.length - 1);
    this.applyFocus();
  },

  async activateFocused() {
    const current = this.container.querySelector(".addons-focusable.focused");
    if (!current) {
      return;
    }

    if (String(current.dataset.zone || "") === "rail") {
      const id = String(current.dataset.railAction || "");
      const action = RAIL_ITEMS.find((item) => item.id === id)?.action;
      if (action) {
        await action();
      }
      return;
    }

    const actionId = String(current.dataset.actionId || "");
    const action = this.actionMap.get(actionId);
    if (!action) {
      return;
    }
    await action();
    if (Router.getCurrent() === "plugin") {
      this.normalizeFocus();
      this.applyFocus();
    }
  },

  async onKeyDown(event) {
    const code = Number(event?.keyCode || 0);

    if (code === 38 || code === 40 || code === 37 || code === 39) {
      event?.preventDefault?.();
      if (this.focusZone === "rail") {
        if (code === 38) this.moveRail(-1);
        else if (code === 40) this.moveRail(1);
        else if (code === 39) {
          this.focusZone = "content";
          this.applyFocus();
        }
        return;
      }

      if (code === 38) this.moveContent(-1);
      else if (code === 40) this.moveContent(1);
      else if (code === 37) {
        if (this.contentCol > 0) {
          this.moveContent(0, -1);
        } else {
          this.focusZone = "rail";
          this.applyFocus();
        }
      } else if (code === 39) this.moveContent(0, 1);
      return;
    }

    if (code !== 13) {
      return;
    }
    await this.activateFocused();
  },

  cleanup() {
    ScreenUtils.hide(this.container);
  }

};
