import { HomeScreen } from "../screens/home/homeScreen.js";
import { PlayerScreen } from "../screens/player/playerScreen.js";
import { AccountScreen } from "../screens/account/accountScreen.js";
import { AuthQrSignInScreen } from "../screens/account/authQrSignInScreen.js";
import { AuthSignInScreen } from "../screens/account/authSignInScreen.js";
import { SyncCodeScreen } from "../screens/account/syncCodeScreen.js";
import { ProfileSelectionScreen } from "../../core/profile/profileSelectionScreen.js";
import { MetaDetailsScreen } from "../screens/detail/metaDetailsScreen.js";
import { LibraryScreen } from "../screens/library/libraryScreen.js";
import { SearchScreen } from "../screens/search/searchScreen.js";
import { DiscoverScreen } from "../screens/search/discoverScreen.js";
import { SettingsScreen } from "../screens/settings/settingsScreen.js";
import { PluginScreen } from "../screens/plugin/pluginScreen.js";
import { CatalogOrderScreen } from "../screens/plugin/catalogOrderScreen.js";
import { StreamScreen } from "../screens/stream/streamScreen.js";
import { CastDetailScreen } from "../screens/cast/castDetailScreen.js";
import { CatalogSeeAllScreen } from "../screens/catalog/catalogSeeAllScreen.js";
import { Platform } from "../../platform/index.js";
import { RouteStateStore } from "./routeStateStore.js";

const NON_BACKSTACK_ROUTES = new Set([
  "profileSelection",
  "authQrSignIn",
  "authSignIn",
  "syncCode"
]);

export const Router = {

  current: null,
  currentParams: {},
  stack: [],
  historyInitialized: false,
  popstateBound: false,

  routes: {
    home: HomeScreen,
    player: PlayerScreen,
    account: AccountScreen,
    authQrSignIn: AuthQrSignInScreen,
    authSignIn: AuthSignInScreen,
    syncCode: SyncCodeScreen,
    profileSelection: ProfileSelectionScreen,
    detail: MetaDetailsScreen,
    library: LibraryScreen,
    search: SearchScreen,
    discover: DiscoverScreen,
    settings: SettingsScreen,
    plugin: PluginScreen,
    catalogOrder: CatalogOrderScreen,
    stream: StreamScreen,
    castDetail: CastDetailScreen,
    catalogSeeAll: CatalogSeeAllScreen
  },

  getRouteStateKey(routeName, params = {}) {
    const screen = this.routes[routeName];
    if (!screen?.getRouteStateKey) {
      return null;
    }
    try {
      return screen.getRouteStateKey(params || {});
    } catch (error) {
      console.warn("Failed to resolve route state key", routeName, error);
      return null;
    }
  },

  captureCurrentRouteState() {
    if (!this.current) {
      return;
    }
    const screen = this.routes[this.current];
    if (!screen?.captureRouteState) {
      return;
    }
    const key = this.getRouteStateKey(this.current, this.currentParams);
    if (!key) {
      return;
    }
    try {
      RouteStateStore.set(key, screen.captureRouteState());
    } catch (error) {
      console.warn("Failed to capture route state", this.current, error);
    }
  },

  resolveNavigationContext(routeName, params = {}, options = {}) {
    const screen = this.routes[routeName];
    const key = this.getRouteStateKey(routeName, params);
    const shouldClear = Boolean(screen?.clearRouteStateOnMount?.(params || {}));
    if (shouldClear && key) {
      RouteStateStore.clear(key);
    }
    return {
      restoredState: !shouldClear && key ? RouteStateStore.get(key) : null,
      routeStateKey: key,
      fromHistory: Boolean(options?.fromHistory),
      isBackNavigation: Boolean(options?.isBackNavigation)
    };
  },

  init() {
    if (this.popstateBound) {
      return;
    }
    this.popstateBound = true;
    window.addEventListener("popstate", async (event) => {
      const currentScreen = this.getCurrentScreen();
      if (currentScreen?.consumeBackRequest?.()) {
        if (window?.history && typeof window.history.pushState === "function") {
          window.history.pushState({ route: this.current, params: this.currentParams }, "");
        }
        return;
      }
      const state = event?.state || null;
      if (this.current === "home" && (!state?.route || NON_BACKSTACK_ROUTES.has(state.route))) {
        Platform.exitApp();
        return;
      }
      if (state?.route && this.routes[state.route]) {
        await this.navigate(state.route, state.params || {}, {
          fromHistory: true,
          skipStackPush: true,
          isBackNavigation: true
        });
        return;
      }
      if (this.current && this.current !== "home" && this.routes.home) {
        await this.navigate("home", {}, {
          fromHistory: true,
          skipStackPush: true,
          isBackNavigation: true
        });
      }
    });
  },

  async navigate(routeName, params = {}, options = {}) {

    const fromHistory = Boolean(options?.fromHistory);
    const skipStackPush = Boolean(options?.skipStackPush);
    const replaceHistory = Boolean(options?.replaceHistory);
    const targetParams = params || {};

    const Screen = this.routes[routeName];

    if (!Screen) {
      console.error("Route not found:", routeName);
      return;
    }

    // Cleanup current
    const previousRoute = this.current;
    const shouldSkipPush = skipStackPush || NON_BACKSTACK_ROUTES.has(previousRoute);
    if (this.current && this.current !== routeName) {
      this.captureCurrentRouteState();
      this.routes[this.current].cleanup?.();
      if (!shouldSkipPush) {
        this.stack.push({
          route: this.current,
          params: this.currentParams || {}
        });
      }
    } else if (this.current === routeName) {
      this.captureCurrentRouteState();
      this.routes[this.current].cleanup?.();
    }

    this.current = routeName;
    this.currentParams = targetParams;
    const navigationContext = this.resolveNavigationContext(routeName, this.currentParams, options);

    await Screen.mount(this.currentParams, navigationContext);

    // If another navigation happened while this screen was mounting, this
    // navigation is stale and must not write an extra history entry.
    if (this.current !== routeName || this.currentParams !== targetParams) {
      return;
    }

    if (window?.history && typeof window.history.pushState === "function") {
      const state = { route: this.current, params: this.currentParams };
      if (!this.historyInitialized) {
        window.history.replaceState(state, "");
        this.historyInitialized = true;
      } else if (!fromHistory) {
        if (replaceHistory || NON_BACKSTACK_ROUTES.has(previousRoute)) {
          window.history.replaceState(state, "");
        } else {
          window.history.pushState(state, "");
        }
      }
    }
  },

  async back() {
    const currentScreen = this.getCurrentScreen();
    if (currentScreen?.consumeBackRequest?.()) {
      return;
    }

    if (this.current === "home") {
      Platform.exitApp();
      return;
    }

    if (window?.history && typeof window.history.back === "function" && this.historyInitialized) {
      window.history.back();
      return;
    }

    if (this.stack.length === 0) {
      if (this.current && this.current !== "home" && this.routes.home) {
        this.routes[this.current].cleanup?.();
        this.current = "home";
        this.currentParams = {};
        await this.routes.home.mount();
        return;
      }

      Platform.exitApp();
      return;
    }

    const previous = this.stack.pop();
    const previousRoute = typeof previous === "string" ? previous : previous?.route;
    const previousParams = typeof previous === "string" ? {} : (previous?.params || {});

    if (!previousRoute || !this.routes[previousRoute]) {
      return;
    }

    this.captureCurrentRouteState();
    this.routes[this.current].cleanup?.();
    this.current = previousRoute;
    this.currentParams = previousParams;
    const navigationContext = this.resolveNavigationContext(previousRoute, previousParams, {
      isBackNavigation: true
    });

    await this.routes[previousRoute].mount(previousParams, navigationContext);
  },

  getCurrent() {
    return this.current;
  },

  getCurrentScreen() {
    if (!this.current) {
      return null;
    }
    return this.routes[this.current] || null;
  }

};
