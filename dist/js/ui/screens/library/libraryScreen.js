import { Router } from "../../navigation/router.js";
import { ScreenUtils } from "../../navigation/screen.js";
import { Environment } from "../../../platform/environment.js";
import { Platform } from "../../../platform/index.js";
import { LayoutPreferences } from "../../../data/local/layoutPreferences.js";
import { LibraryController, LIBRARY_PRIVACY_OPTIONS } from "./libraryController.js";
import {
  activateLegacySidebarAction,
  bindRootSidebarEvents,
  getRootSidebarNodes,
  getRootSidebarSelectedNode,
  getSidebarProfileState,
  isSelectedSidebarAction,
  isRootSidebarNode,
  renderRootSidebar,
  setModernSidebarExpanded,
  setModernSidebarPillIconOnly,
  setLegacySidebarExpanded
} from "../../components/sidebarNavigation.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function bookmarkOutlineSvg() {
  return `
    <svg viewBox="0 0 80 80" class="library-empty-icon" aria-hidden="true" focusable="false">
      <path d="M25 15h30c3.3 0 6 2.7 6 6v40L40 51 19 61V21c0-3.3 2.7-6 6-6z"
            fill="none"
            stroke="currentColor"
            stroke-width="5.5"
            stroke-linecap="round"
            stroke-linejoin="round" />
    </svg>
  `;
}

function chevronSvg(open) {
  return `
    <svg viewBox="0 0 24 24" class="library-picker-chevron" aria-hidden="true" focusable="false">
      <path d="${open ? "M6 14l6-6 6 6" : "M6 10l6 6 6-6"}"
            fill="none"
            stroke="currentColor"
            stroke-width="2.75"
            stroke-linecap="round"
            stroke-linejoin="round" />
    </svg>
  `;
}

function isTextField(node) {
  const tagName = String(node?.tagName || "").toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select";
}

function selectorValue(value) {
  const raw = String(value || "");
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(raw);
  }
  return raw.replace(/["\\]/g, "\\$&");
}

export const LibraryScreen = {

  async mount() {
    this.container = document.getElementById("library");
    ScreenUtils.show(this.container);
    this.controller = new LibraryController(() => this.render());
    this.libraryRouteEnterPending = true;
    this.sidebarProfile = await getSidebarProfileState();
    this.layoutPrefs = LayoutPreferences.get();
    this.sidebarExpanded = false;
    this.pillIconOnly = false;
    this.focusZone = "content";
    this.lastMainFocus = null;

    this.render();
    this.bindEvents();
    await this.controller.init();
    this.controller.closePicker();
  },

  bindEvents() {
    if (!this.container || this.container.__libraryEventsBound) {
      return;
    }
    this.container.__libraryEventsBound = true;

    this.container.addEventListener("click", async (event) => {
      const target = event.target?.closest?.(".focusable, .library-dialog-input, .library-dialog-textarea");
      if (!target || !this.container.contains(target)) {
        return;
      }
      if (target.classList.contains("focusable")) {
        this.setFocusedNode(target);
      }
      await this.activateNode(target);
    });

    this.container.addEventListener("input", (event) => {
      const target = event.target;
      if (!target) {
        return;
      }
      if (target.matches(".library-dialog-input[data-editor-field], .library-dialog-textarea[data-editor-field]")) {
        this.controller.updateEditorField(String(target.dataset.editorField || ""), target.value, { silent: true });
      }
    });
  },

  setFocusedNode(target) {
    this.container?.querySelectorAll(".focusable.focused").forEach((node) => {
      if (node !== target) {
        node.classList.remove("focused");
      }
    });
    target.classList.add("focused");
    target.focus();
    const sidebarFocused = this.isSidebarNode(target);
    this.focusZone = sidebarFocused ? "sidebar" : "content";
    if (!this.layoutPrefs?.modernSidebar) {
      setLegacySidebarExpanded(this.container, sidebarFocused);
    }
    if (!sidebarFocused) {
      this.lastMainFocus = target;
    }
    if (target.dataset.focusKey) {
      this.controller.setFocusedPosterKey(target.dataset.focusKey);
    }
  },

  renderLoading() {
    this.container.innerHTML = `
      <div class="home-shell library-shell${this.libraryRouteEnterPending ? " library-route-enter" : ""}">
        ${this.renderSidebar()}
        <main class="home-main library-main">
          <section class="library-loading-state">
            <div class="library-loading-spinner" aria-hidden="true"></div>
            <div class="library-loading-label">Syncing library...</div>
          </section>
        </main>
      </div>
    `;
    this.libraryRouteEnterPending = false;
  },

  renderSidebar() {
    return renderRootSidebar({
      selectedRoute: "library",
      profile: this.sidebarProfile,
      layout: this.layoutPrefs,
      expanded: Boolean(this.sidebarExpanded),
      pillIconOnly: Boolean(this.pillIconOnly)
    });
  },

  renderPicker(picker, title, value, options, widthClass = "") {
    const state = this.controller.getState();
    const open = state.expandedPicker === picker;
    return `
      <div class="library-picker${open ? " open" : ""} ${widthClass}">
        <button class="library-picker-anchor focusable library-primary"
                data-action="togglePicker"
                data-picker="${picker}">
          <span class="library-picker-copy">
            <span class="library-picker-title">${escapeHtml(title)}</span>
            <span class="library-picker-value">${escapeHtml(value)}</span>
          </span>
          <span class="library-picker-icon">${chevronSvg(open)}</span>
        </button>
        ${open ? `
          <div class="library-picker-menu" role="listbox" aria-label="${escapeHtml(title)}">
            ${options.map((option, index) => `
              <button class="library-picker-option focusable${index === Number(state.pickerFocusIndex || 0) ? " library-picker-option-target" : ""}"
                      data-action="selectPickerOption"
                      data-picker="${picker}"
                      data-option-index="${index}">
                ${escapeHtml(option.label)}
              </button>
            `).join("")}
          </div>
        ` : ""}
      </div>
    `;
  },

  renderGrid(items) {
    return `
      <section class="library-grid-wrap">
        <div class="library-grid">
          ${items.map((item) => {
            const focusKey = `${item.type}:${item.id}`;
            return `
              <article class="library-grid-card focusable"
                       data-action="openDetail"
                       data-item-id="${escapeHtml(item.id)}"
                       data-item-type="${escapeHtml(item.type || "movie")}"
                       data-item-title="${escapeHtml(item.name || item.id || "Untitled")}"
                       data-focus-key="${escapeHtml(focusKey)}">
                <div class="library-grid-poster${item.poster ? "" : " placeholder"}"${item.poster ? ` style="background-image:url('${escapeHtml(item.poster)}')"` : ""}></div>
                <div class="library-grid-title">${escapeHtml(item.name || item.id || "Untitled")}</div>
              </article>
            `;
          }).join("")}
        </div>
      </section>
    `;
  },

  renderEmptyState() {
    return `
      <section class="library-empty-state">
        ${bookmarkOutlineSvg()}
        <h3 class="library-empty-title">${escapeHtml(this.controller.getEmptyStateTitle())}</h3>
        <p class="library-empty-subtitle">${escapeHtml(this.controller.getEmptyStateSubtitle())}</p>
      </section>
    `;
  },

  renderActions(state) {
    if (state.sourceMode !== "trakt") {
      return "";
    }
    return `
      <section class="library-actions-row">
        <button class="library-action-button focusable library-primary"
                data-action="openManageLists"
                ${state.pendingOperation || state.isSyncing ? "disabled" : ""}>
          Manage Lists
        </button>
        <button class="library-action-button focusable library-primary"
                data-action="refreshLibrary"
                ${state.pendingOperation || state.isSyncing ? "disabled" : ""}>
          ${state.isSyncing ? "Syncing..." : "Sync"}
        </button>
      </section>
    `;
  },

  renderManageListsDialog(state) {
    if (!state.showManageDialog) {
      return "";
    }
    const personalTabs = state.listTabs.filter((item) => item.type === "personal");
    return `
      <div class="library-overlay">
        <section class="library-dialog library-manage-dialog">
          <h3 class="library-dialog-title">Manage Trakt Lists</h3>
          ${state.errorMessage ? `<p class="library-dialog-error">${escapeHtml(state.errorMessage)}</p>` : ""}
          <div class="library-manage-list">
            ${personalTabs.length
              ? personalTabs.map((tab) => `
                  <button class="library-manage-list-button focusable${tab.key === state.manageSelectedListKey ? " selected" : ""}"
                          data-action="selectManageList"
                          data-list-key="${escapeHtml(tab.key)}"
                          ${state.pendingOperation ? "disabled" : ""}>
                    ${escapeHtml(tab.title)}
                  </button>
                `).join("")
              : `<div class="library-manage-empty">No lists yet.</div>`
            }
          </div>
          <div class="library-dialog-actions">
            <button class="library-action-button focusable" data-action="createList" ${state.pendingOperation ? "disabled" : ""}>Create</button>
            <button class="library-action-button focusable" data-action="editList" ${state.pendingOperation || !state.manageSelectedListKey ? "disabled" : ""}>Edit</button>
            <button class="library-action-button focusable" data-action="moveListUp" ${state.pendingOperation || !state.manageSelectedListKey ? "disabled" : ""}>Move Up</button>
            <button class="library-action-button focusable" data-action="moveListDown" ${state.pendingOperation || !state.manageSelectedListKey ? "disabled" : ""}>Move Down</button>
          </div>
          <div class="library-dialog-actions">
            <button class="library-action-button focusable danger" data-action="deleteList" ${state.pendingOperation || !state.manageSelectedListKey ? "disabled" : ""}>Delete</button>
            <button class="library-action-button focusable" data-action="closeManageLists" ${state.pendingOperation ? "disabled" : ""}>Close</button>
          </div>
        </section>
      </div>
    `;
  },

  renderListEditorDialog(state) {
    if (!state.listEditorState) {
      return "";
    }
    const editor = state.listEditorState;
    return `
      <div class="library-overlay">
        <section class="library-dialog library-list-editor">
          <h3 class="library-dialog-title">${editor.mode === "create" ? "Create List" : "Edit List"}</h3>
          <label class="library-dialog-field">
            <span class="library-dialog-field-label">Name</span>
            <input class="library-dialog-input focusable"
                   data-editor-field="name"
                   value="${escapeHtml(editor.name)}"
                   ${state.pendingOperation ? "disabled" : ""} />
          </label>
          <label class="library-dialog-field">
            <span class="library-dialog-field-label">Description</span>
            <textarea class="library-dialog-textarea focusable"
                      data-editor-field="description"
                      ${state.pendingOperation ? "disabled" : ""}>${escapeHtml(editor.description)}</textarea>
          </label>
          <div class="library-dialog-field">
            <span class="library-dialog-field-label">Privacy</span>
            <div class="library-privacy-row">
              ${LIBRARY_PRIVACY_OPTIONS.map((privacy) => `
                <button class="library-privacy-button focusable${privacy === editor.privacy ? " selected" : ""}"
                        data-action="selectPrivacy"
                        data-privacy="${privacy}"
                        ${state.pendingOperation ? "disabled" : ""}>
                  ${escapeHtml(privacy.charAt(0).toUpperCase() + privacy.slice(1))}
                </button>
              `).join("")}
            </div>
          </div>
          <div class="library-dialog-actions stacked">
            <button class="library-action-button focusable"
                    data-action="saveListEditor"
                    ${state.pendingOperation ? "disabled" : ""}>
              ${state.pendingOperation ? "Saving..." : "Save"}
            </button>
            <button class="library-action-button focusable"
                    data-action="cancelListEditor"
                    ${state.pendingOperation ? "disabled" : ""}>
              Cancel
            </button>
          </div>
        </section>
      </div>
    `;
  },

  renderDeleteDialog(state) {
    if (!state.showDeleteConfirm) {
      return "";
    }
    return `
      <div class="library-overlay">
        <section class="library-dialog library-delete-dialog">
          <h3 class="library-dialog-title">Delete List</h3>
          <p class="library-dialog-subtitle">This will permanently delete the selected list.</p>
          <div class="library-dialog-actions stacked">
            <button class="library-action-button focusable danger"
                    data-action="confirmDeleteList"
                    ${state.pendingOperation ? "disabled" : ""}>
              Delete
            </button>
            <button class="library-action-button focusable"
                    data-action="cancelDeleteList"
                    ${state.pendingOperation ? "disabled" : ""}>
              Cancel
            </button>
          </div>
        </section>
      </div>
    `;
  },

  render() {
    this.layoutPrefs = LayoutPreferences.get();
    this.sidebarExpanded = Boolean(this.layoutPrefs?.modernSidebar && this.sidebarExpanded);
    const state = this.controller.getState();
    if (state.isLoading) {
      this.renderLoading();
      ScreenUtils.indexFocusables(this.container);
      if (!this.layoutPrefs?.modernSidebar) {
        setLegacySidebarExpanded(this.container, false);
      }
      return;
    }

    const pickerMarkup = [
      state.sourceMode === "trakt"
        ? this.renderPicker("list", "List", this.controller.getSelectedListLabel(), this.controller.getPickerOptions("list"), "library-picker-flex")
        : "",
      this.renderPicker("type", "Type", this.controller.getSelectedTypeLabel(), this.controller.getPickerOptions("type"), state.sourceMode === "trakt" ? "library-picker-flex" : "library-picker-wide"),
      this.renderPicker("sort", "Sort", this.controller.getSelectedSortLabel(), this.controller.getPickerOptions("sort"), state.sourceMode === "trakt" ? "library-picker-flex" : "library-picker-wide")
    ].filter(Boolean).join("");

    this.container.innerHTML = `
      <div class="home-shell library-shell${this.libraryRouteEnterPending ? " library-route-enter" : ""}">
        ${this.renderSidebar()}
        <main class="home-main library-main">
          <section class="library-page">
            <header class="library-page-header">
              <h1 class="library-page-title">Library</h1>
              <div class="library-page-source">${escapeHtml(this.controller.getSourceLabel())}</div>
            </header>

            <section class="library-picker-row">
              ${pickerMarkup}
            </section>

            ${this.renderActions(state)}

            ${state.visibleItems.length ? this.renderGrid(state.visibleItems) : this.renderEmptyState()}

            ${state.transientMessage ? `<div class="library-toast">${escapeHtml(state.transientMessage)}</div>` : ""}
          </section>
        </main>
        ${this.renderManageListsDialog(state)}
        ${this.renderListEditorDialog(state)}
        ${this.renderDeleteDialog(state)}
      </div>
    `;
    this.libraryRouteEnterPending = false;

    ScreenUtils.indexFocusables(this.container);
    bindRootSidebarEvents(this.container, {
      currentRoute: "library",
      onSelectedAction: () => this.focusMainNode(),
      onExpandSidebar: () => this.focusSidebarNode()
    });
    this.restoreFocus();
  },

  getMainFocusSelector(node) {
    if (!node) {
      return "";
    }
    if (node.dataset.focusKey) {
      return `.focusable[data-focus-key="${selectorValue(node.dataset.focusKey)}"]`;
    }
    if (node.dataset.action === "togglePicker" && node.dataset.picker) {
      return `.library-picker-anchor[data-picker="${selectorValue(node.dataset.picker)}"]`;
    }
    if (node.dataset.action) {
      return `.focusable[data-action="${selectorValue(node.dataset.action)}"]`;
    }
    return "";
  },

  resolveLastMainFocus() {
    const selector = this.getMainFocusSelector(this.lastMainFocus);
    return (selector ? this.container?.querySelector(selector) : null)
      || this.container?.querySelector(".library-picker-anchor.focusable")
      || this.container?.querySelector(".library-grid-card.focusable")
      || this.container?.querySelector(".home-main .focusable")
      || null;
  },

  restoreFocus() {
    const state = this.controller.getState();
    let selector = null;

    if (state.listEditorState) {
      selector = '.library-list-editor .focusable';
    } else if (state.showDeleteConfirm) {
      selector = '.library-delete-dialog .focusable';
    } else if (state.showManageDialog) {
      selector = state.manageSelectedListKey
        ? `.library-manage-list-button[data-list-key="${selectorValue(state.manageSelectedListKey)}"]`
        : '.library-manage-dialog .focusable';
    } else if (state.expandedPicker) {
      selector = `.library-picker.open .library-picker-option[data-option-index="${Number(state.pickerFocusIndex || 0)}"]`;
    } else if (state.lastFocusedPosterKey) {
      selector = `.library-grid-card[data-focus-key="${selectorValue(state.lastFocusedPosterKey)}"]`;
    } else {
      selector = null;
    }

    const target = (selector ? this.container?.querySelector(selector) : null)
      || (this.focusZone === "sidebar" ? getRootSidebarSelectedNode(this.container, this.layoutPrefs) : null)
      || (this.focusZone === "content" ? this.resolveLastMainFocus() : null)
      || this.container?.querySelector('.library-primary.focusable')
      || getRootSidebarSelectedNode(this.container, this.layoutPrefs)
      || this.container?.querySelector('.focusable');
    if (!target) {
      return;
    }
    this.setFocusedNode(target);
  },

  getFocusScopeSelector() {
    const state = this.controller.getState();
    if (state.listEditorState) {
      return ".library-list-editor .focusable";
    }
    if (state.showDeleteConfirm) {
      return ".library-delete-dialog .focusable";
    }
    if (state.showManageDialog) {
      return ".library-manage-dialog .focusable";
    }
    if (state.expandedPicker) {
      return ".library-picker.open .focusable";
    }
    return ".focusable";
  },

  isSidebarNode(node) {
    return isRootSidebarNode(node);
  },

  async focusSidebarNode(preferredNode = null) {
    this.focusZone = "sidebar";
    if (this.layoutPrefs?.modernSidebar && !this.sidebarExpanded) {
      this.sidebarExpanded = true;
      setModernSidebarExpanded(this.container, true);
    }
    const target = preferredNode
      || getRootSidebarSelectedNode(this.container, this.layoutPrefs)
      || getRootSidebarNodes(this.container, this.layoutPrefs)[0]
      || null;
    if (!target) {
      return false;
    }
    this.setFocusedNode(target);
    return true;
  },

  async focusMainNode(preferredNode = null) {
    this.focusZone = "content";
    if (this.layoutPrefs?.modernSidebar && this.sidebarExpanded) {
      this.sidebarExpanded = false;
      setModernSidebarExpanded(this.container, false);
    }
    const target = preferredNode
      || this.resolveLastMainFocus()
      || null;
    if (!target) {
      return false;
    }
    this.setFocusedNode(target);
    return true;
  },

  shouldTransferToSidebar(node) {
    if (!node || this.isSidebarNode(node)) {
      return false;
    }
    const main = this.container?.querySelector(".home-main");
    if (!main || !main.contains(node)) {
      return false;
    }
    const nodeRect = node.getBoundingClientRect();
    const mainRect = main.getBoundingClientRect();
    return (nodeRect.left - mainRect.left) <= 140;
  },

  closeTopOverlay() {
    const state = this.controller.getState();
    if (state.listEditorState) {
      this.controller.closeEditor();
      return true;
    }
    if (state.showDeleteConfirm) {
      this.controller.closeDeleteConfirm();
      return true;
    }
    if (state.showManageDialog) {
      this.controller.closeManageLists();
      return true;
    }
    if (state.expandedPicker) {
      this.controller.closePicker();
      return true;
    }
    return false;
  },

  async activateNode(node) {
    if (!node) {
      return;
    }

    const action = String(node.dataset.action || "");
    if (!action) {
      return;
    }

    if (action === "gotoHome") {
      activateLegacySidebarAction(action, "library");
      if (isSelectedSidebarAction(action, "library")) {
        await this.focusMainNode();
      }
      return;
    }
    if (action === "gotoSearch" || action === "gotoLibrary" || action === "gotoPlugin" || action === "gotoSettings" || action === "gotoAccount") {
      activateLegacySidebarAction(action, "library");
      if (isSelectedSidebarAction(action, "library")) {
        await this.focusMainNode();
      }
      return;
    }
    if (action === "togglePicker") {
      this.controller.togglePicker(String(node.dataset.picker || ""));
      return;
    }
    if (action === "selectPickerOption") {
      const picker = String(node.dataset.picker || "");
      const index = Number(node.dataset.optionIndex || 0);
      this.controller.setState({
        pickerFocusIndex: index,
        expandedPicker: picker
      });
      this.controller.selectOpenPickerOption();
      if (picker === "sort") {
        requestAnimationFrame(() => {
          this.container?.querySelector(".home-main")?.scrollTo?.({ top: 0, left: 0, behavior: "auto" });
        });
      }
      return;
    }
    if (action === "openDetail") {
      const focusKey = String(node.dataset.focusKey || "");
      if (focusKey) {
        this.controller.setFocusedPosterKey(focusKey);
      }
      Router.navigate("detail", {
        itemId: node.dataset.itemId,
        itemType: node.dataset.itemType || "movie",
        fallbackTitle: node.dataset.itemTitle || "Untitled"
      });
      return;
    }
    if (action === "openManageLists") {
      this.controller.openManageLists();
      return;
    }
    if (action === "refreshLibrary") {
      await this.controller.refreshNow();
      return;
    }
    if (action === "selectManageList") {
      this.controller.selectManageList(String(node.dataset.listKey || ""));
      return;
    }
    if (action === "createList") {
      this.controller.startCreateList();
      return;
    }
    if (action === "editList") {
      this.controller.startEditList();
      return;
    }
    if (action === "moveListUp") {
      await this.controller.moveSelectedList("up");
      return;
    }
    if (action === "moveListDown") {
      await this.controller.moveSelectedList("down");
      return;
    }
    if (action === "deleteList") {
      this.controller.promptDeleteList();
      return;
    }
    if (action === "closeManageLists") {
      this.controller.closeManageLists();
      return;
    }
    if (action === "selectPrivacy") {
      this.controller.updateEditorField("privacy", String(node.dataset.privacy || "private"));
      return;
    }
    if (action === "saveListEditor") {
      await this.controller.submitEditor();
      return;
    }
    if (action === "cancelListEditor") {
      this.controller.closeEditor();
      return;
    }
    if (action === "confirmDeleteList") {
      await this.controller.deleteSelectedList();
      return;
    }
    if (action === "cancelDeleteList") {
      this.controller.closeDeleteConfirm();
    }
  },

  async onKeyDown(event) {
    if (Environment.isBackEvent(event)) {
      event?.preventDefault?.();
      if (this.closeTopOverlay()) {
        return;
      }
      if (this.focusZone === "sidebar") {
        Platform.exitApp();
      } else {
        await this.focusSidebarNode();
      }
      return;
    }

    const state = this.controller.getState();
    const code = Number(event?.keyCode || 0);
    if (this.layoutPrefs?.modernSidebar && !this.sidebarExpanded) {
      if (code === 40) {
        this.pillIconOnly = true;
        setModernSidebarPillIconOnly(this.container, true);
      } else if (code === 38) {
        this.pillIconOnly = false;
        setModernSidebarPillIconOnly(this.container, false);
      }
    }
    const activeNode = document.activeElement;
    if (isTextField(activeNode) && ![37, 38, 39, 40].includes(code)) {
      return;
    }

    const current = this.container?.querySelector(".focusable.focused") || activeNode || null;
    const sidebarLocked = state.listEditorState || state.showDeleteConfirm || state.showManageDialog || state.expandedPicker;

    if (!sidebarLocked && code === 37 && current && this.shouldTransferToSidebar(current)) {
      event?.preventDefault?.();
      await this.focusSidebarNode();
      return;
    }

    if (!sidebarLocked && code === 39 && current && this.isSidebarNode(current)) {
      event?.preventDefault?.();
      await this.focusMainNode();
      return;
    }

    if (state.expandedPicker && (code === 38 || code === 40)) {
      event?.preventDefault?.();
      this.controller.movePickerFocus(code === 38 ? "up" : "down");
      return;
    }

    if (ScreenUtils.handleDpadNavigation(event, this.container, this.getFocusScopeSelector())) {
      const current = this.container?.querySelector(`${this.getFocusScopeSelector()}.focused`) || this.container?.querySelector(".focusable.focused");
      if (current?.dataset?.focusKey) {
        this.controller.setFocusedPosterKey(String(current.dataset.focusKey));
      }
      return;
    }

    if (code !== 13) {
      return;
    }
    const focused = this.container?.querySelector(`${this.getFocusScopeSelector()}.focused`) || this.container?.querySelector(".focusable.focused");
    if (!focused) {
      return;
    }
    await this.activateNode(focused);
  },

  cleanup() {
    this.controller?.dispose?.();
    this.controller = null;
    ScreenUtils.hide(this.container);
  }
};
