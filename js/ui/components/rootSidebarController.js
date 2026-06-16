import {
  renderRootSidebar,
  getSidebarProfileState,
  setModernSidebarExpanded,
  setLegacySidebarExpanded,
  getModernSidebarSelectedNode,
  getLegacySidebarSelectedNode,
  focusWithoutAutoScroll,
  activateLegacySidebarAction,
  isSelectedSidebarAction,
  scheduleRootSidebarTextFit
} from "./sidebarNavigation.js";
import { LayoutPreferences } from "../../data/local/layoutPreferences.js";

// Routes with no sidebar at all
const NO_SIDEBAR_ROUTES = new Set(["account", "profileSelection", "stream", "player"]);

// Attribute that marks the sidebar host div we inject into screen containers
const RSC_ATTR = "data-rsc-sidebar";

export const RootSidebarController = {
  el: null,        // #root-nav-sidebar (kept hidden for managed routes)
  appEl: null,     // #app
  profile: null,
  expanded: false,
  lastScreenFocus: null,
  currentRoute: "",
  _observer: null, // MutationObserver to survive screen re-renders
  _screenEl: null, // Currently injected screen container
  _callbacks: {},  // routeName → { onExpand, onCollapse, onAfterInject }

  init() {
    this.el = document.getElementById("root-nav-sidebar");
    this.appEl = document.getElementById("app");
    if (!this.el || !this.appEl) return;
    getSidebarProfileState().then((profile) => { this.profile = profile; }).catch(() => {});
    this._bindAppEvents();
  },

  _isManaged(routeName) {
    return !NO_SIDEBAR_ROUTES.has(routeName);
  },

  // Screens that render sidebar in their own HTML call register() so the
  // controller's app-level events can call their expand/collapse logic.
  register(routeName, { onExpand = null, onCollapse = null, onAfterInject = null } = {}) {
    this._callbacks[String(routeName || "")] = { onExpand, onCollapse, onAfterInject };
  },

  unregister(routeName) {
    delete this._callbacks[String(routeName || "")];
  },

  // Called by Router.onNavigate (before screen mount) — clear previous state.
  update(routeName) {
    if (!this.el) return;
    this.currentRoute = routeName;
    this.expanded = false;
    this._stopObserver();

    // Keep #root-nav-sidebar hidden; sidebar lives in the screen container.
    this.el.hidden = true;
  },

  // Called by Router.afterNavigate (after screen mount) — inject sidebar into screen.
  afterMount(routeName) {
    if (!this._isManaged(routeName)) return;

    const screenEl = document.getElementById(routeName);
    if (!screenEl) return;

    this._screenEl = screenEl;

    // Refresh profile on every navigation so profile-switch changes are reflected.
    getSidebarProfileState().then((profile) => { this.profile = profile; }).catch(() => {});

    this._inject(routeName, screenEl);

    // Re-inject whenever the screen wipes its container with innerHTML = "..."
    if (typeof MutationObserver !== "undefined") {
      this._observer = new MutationObserver(() => {
        if (!screenEl.querySelector(`[${RSC_ATTR}]`)) {
          this._inject(routeName, screenEl);
        }
      });
      this._observer.observe(screenEl, { childList: true });
    }
  },

  _inject(routeName, screenEl) {
    const layout = LayoutPreferences.get();
    const host = document.createElement("div");
    host.setAttribute(RSC_ATTR, "true");
    host.innerHTML = renderRootSidebar({ selectedRoute: routeName, profile: this.profile, layout });
    screenEl.prepend(host);
    this._bindSidebarItemEvents(routeName, host);
    scheduleRootSidebarTextFit(host);
    // Restore expanded visual state if sidebar was open when re-render happened
    if (this.expanded) {
      const layout2 = LayoutPreferences.get();
      if (layout2.modernSidebar) setModernSidebarExpanded(host, true);
      else setLegacySidebarExpanded(host, true);
    }
    this._callbacks[routeName]?.onAfterInject?.();
  },

  _stopObserver() {
    this._observer?.disconnect();
    this._observer = null;
    this._screenEl = null;
  },

  _getSidebarHost() {
    return this._screenEl?.querySelector(`[${RSC_ATTR}]`) || null;
  },

  _bindAppEvents() {
    const app = this.appEl;

    // Detect cursor leaving the sidebar area → collapse
    app.addEventListener("mouseover", (event) => {
      if (!this._isManaged(this.currentRoute)) return;
      const target = event?.target;
      if (!target) return;

      const inSidebar = target.closest(`[${RSC_ATTR}]`);
      if (inSidebar) {
        // Only cancel a pending collapse if cursor genuinely moved FROM outside
        const fromOutside = event.relatedTarget && !event.relatedTarget.closest(`[${RSC_ATTR}]`);
        if (fromOutside && app.__rscCollapseTimer) {
          clearTimeout(app.__rscCollapseTimer);
          app.__rscCollapseTimer = null;
        }
        return;
      }

      if (app.__rscCollapseTimer) { clearTimeout(app.__rscCollapseTimer); app.__rscCollapseTimer = null; }
      if (this.expanded) {
        app.__rscCollapseTimer = setTimeout(() => {
          app.__rscCollapseTimer = null;
          this.collapse();
        }, 120);
      }
    });

    // LG Magic Remote auto-focuses elements on pointer hover → use focusin to detect
    app.addEventListener("focusin", (event) => {
      if (!this._isManaged(this.currentRoute)) return;
      const target = event?.target;
      if (!target?.closest) return;
      if (target.closest(`[${RSC_ATTR}]`)) {
        if (app.__rscCollapseTimer) { clearTimeout(app.__rscCollapseTimer); app.__rscCollapseTimer = null; }
        if (!this.expanded) this.expand();
      }
    });
  },

  _bindSidebarItemEvents(routeName, host) {
    const focusables = Array.from(
      host.querySelectorAll(".home-sidebar .focusable, .modern-sidebar-panel .focusable")
    );

    const moveFocus = (current, delta) => {
      const nodes = focusables.filter((n) => n.isConnected);
      const idx = nodes.indexOf(current);
      if (idx === -1) return;
      const next = nodes[Math.max(0, Math.min(nodes.length - 1, idx + delta))];
      if (next && next !== current) {
        nodes.forEach((n) => n.classList.remove("focused"));
        next.classList.add("focused");
        focusWithoutAutoScroll(next);
      }
    };

    focusables.forEach((node) => {
      node.onclick = (event) => {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        const action = String(node.dataset.action || "");
        activateLegacySidebarAction(action, routeName);
        // If user clicks the already-selected route, collapse the sidebar.
        if (isSelectedSidebarAction(action, routeName)) this.collapse();
      };
      node.onkeydown = (event) => {
        const key = Number(event?.keyCode || 0);
        if (key === 38) { event.preventDefault(); moveFocus(node, -1); }
        if (key === 40) { event.preventDefault(); moveFocus(node, 1); }
      };
      node.onmouseenter = () => {
        focusables.filter((n) => n.isConnected).forEach((n) => n.classList.remove("focused"));
        node.classList.add("focused");
      };
    });

    host.querySelectorAll(".modern-sidebar-pill").forEach((pill) => {
      pill.onclick = () => this.expand();
      pill.onmouseenter = () => {
        if (this.appEl.__rscCollapseTimer) {
          clearTimeout(this.appEl.__rscCollapseTimer);
          this.appEl.__rscCollapseTimer = null;
        }
        this.expand();
      };
    });
  },

  expand() {
    if (this.expanded) return;
    // Set flag BEFORE any focus() call — focusWithoutAutoScroll fires focusin
    // synchronously and would re-enter expand() causing infinite recursion.
    this.expanded = true;

    // Screens that manage their own sidebar register an onExpand callback.
    const cb = this._callbacks[this.currentRoute];
    if (cb?.onExpand) {
      cb.onExpand();
      return;
    }

    const host = this._getSidebarHost();
    if (!host) return;

    const layout = LayoutPreferences.get();

    // Remember what was focused in the screen content (excluding sidebar)
    const focused = this._screenEl?.querySelector(".focusable.focused");
    this.lastScreenFocus = (focused && !focused.closest(`[${RSC_ATTR}]`)) ? focused : null;

    if (layout.modernSidebar) {
      setModernSidebarExpanded(host, true);
      const target = getModernSidebarSelectedNode(host);
      if (target) {
        host.querySelectorAll(".focusable.focused").forEach((n) => n.classList.remove("focused"));
        target.classList.add("focused");
        focusWithoutAutoScroll(target);
      }
    } else {
      setLegacySidebarExpanded(host, true);
      const target = getLegacySidebarSelectedNode(host);
      if (target) {
        host.querySelectorAll(".focusable.focused").forEach((n) => n.classList.remove("focused"));
        target.classList.add("focused");
        focusWithoutAutoScroll(target);
      }
    }
  },

  collapse() {
    if (!this.expanded) return;
    this.expanded = false;

    // Screens that manage their own sidebar register an onCollapse callback.
    const cb = this._callbacks[this.currentRoute];
    if (cb?.onCollapse) {
      cb.onCollapse();
      return;
    }

    const host = this._getSidebarHost();
    const layout = LayoutPreferences.get();
    if (host) {
      if (layout.modernSidebar) setModernSidebarExpanded(host, false);
      else setLegacySidebarExpanded(host, false);
    }

    const target = (this.lastScreenFocus?.isConnected ? this.lastScreenFocus : null)
      || this._screenEl?.querySelector(".focusable:not([data-rsc-sidebar] *)") || null;
    if (target) {
      document.querySelectorAll(".focusable.focused").forEach((n) => n.classList.remove("focused"));
      target.classList.add("focused");
      focusWithoutAutoScroll(target);
    }
  }
};
