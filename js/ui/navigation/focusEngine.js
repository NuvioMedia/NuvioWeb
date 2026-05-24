import { Router } from "./router.js";
import { Platform } from "../../platform/index.js";

function buildNormalizedEvent(event) {
  const normalizedKey = Platform.normalizeKey(event);
  const normalizedCode = Number(normalizedKey.keyCode || 0);
  
  const safeTarget = event?.target || { 
    nodeType: 0, 
    parentNode: null, 
    classList: { contains: () => false } 
  };
  return {
    key: normalizedKey.key,
    code: normalizedKey.code,
    keyName: normalizedKey.keyName,
    target: event?.target || null,
    altKey: Boolean(event?.altKey),
    ctrlKey: Boolean(event?.ctrlKey),
    shiftKey: Boolean(event?.shiftKey),
    metaKey: Boolean(event?.metaKey),
    repeat: Boolean(event?.repeat),
    defaultPrevented: Boolean(event?.defaultPrevented),
    keyCode: normalizedCode,
    which: normalizedCode,
    originalKeyCode: Number(normalizedKey.originalKeyCode || event?.keyCode || 0),
    preventDefault: () => {
      if (typeof event?.preventDefault === "function") {
        event.preventDefault();
      }
    },
    stopPropagation: () => {
      if (typeof event?.stopPropagation === "function") {
        event.stopPropagation();
      }
    },
    stopImmediatePropagation: () => {
      if (typeof event?.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }
    }
  };
}

export const FocusEngine = {
  lastBackHandledAt: 0,
  lastPointerFocusTarget: null,

  init() {
    this.boundHandleKey = this.handleKey.bind(this);
    this.boundHandleKeyUp = this.handleKeyUp.bind(this);
    this.boundHandleTizenHardwareKey = this.handleTizenHardwareKey.bind(this);
    this.boundHandlePointerMove = this.handlePointerMove.bind(this);
    this.boundHandlePointerClick = this.handlePointerClick.bind(this);
    document.addEventListener("keydown", this.boundHandleKey, true);
    document.addEventListener("keyup", this.boundHandleKeyUp, true);
    if (Platform.isTizen()) {
      document.addEventListener("tizenhwkey", this.boundHandleTizenHardwareKey, true);
    }
    if (Platform.isWebOS()) {
      document.addEventListener("mousemove", this.boundHandlePointerMove, true);
      document.addEventListener("pointermove", this.boundHandlePointerMove, true);
      document.addEventListener("click", this.boundHandlePointerClick, true);
      document.documentElement?.classList?.add("webos-pointer-remote");
      document.body?.classList?.add("webos-pointer-remote");
    }
  },

  handleBack(event, normalizedEvent = buildNormalizedEvent(event)) {
    const now = Date.now();
    if (now - this.lastBackHandledAt < 250) {
      event?.preventDefault?.();
      event?.stopImmediatePropagation?.();
      return;
    }
    this.lastBackHandledAt = now;

    normalizedEvent.preventDefault();
    normalizedEvent.stopPropagation();
    normalizedEvent.stopImmediatePropagation();

    const currentScreen = Router.getCurrentScreen();
    if (currentScreen?.consumeBackRequest?.()) {
      Router.suppressNextPopstate?.();
      return;
    }

    Router.back();
  },

  handleKey(event) {
    if (event?.target && !document.contains(event.target)) {
      return;
    }

    const normalizedEvent = buildNormalizedEvent(event);

    if (Platform.isBackEvent({
        target: normalizedEvent.target,
        key: normalizedEvent.key,
        code: normalizedEvent.code,
        keyCode: normalizedEvent.keyCode,
      })
    ) {
      this.handleBack(event, normalizedEvent);
      return;
    }

    const currentScreen = Router.getCurrentScreen();

    if (currentScreen?.onKeyDown) {
      currentScreen.onKeyDown(normalizedEvent);
    }
  },

  handleKeyUp(event) {
    if (event?.target && !document.contains(event.target)) return;

    const currentScreen = Router.getCurrentScreen();
    if (!currentScreen?.onKeyUp) {
      return;
    }
    const normalizedEvent = buildNormalizedEvent(event);
    currentScreen.onKeyUp(normalizedEvent);
  },

  handleTizenHardwareKey(event) {
    if (!Platform.isBackEvent(event)) {
      return;
    }
    this.handleBack(event, buildNormalizedEvent(event));
  },

  getPointerFocusable(event) {
    const target = event?.target?.closest?.(".focusable");
    if (!target || !(target instanceof HTMLElement) || !document.contains(target)) {
      return null;
    }
    if (
      target.disabled
      || target.classList.contains("is-disabled")
      || target.getAttribute("aria-disabled") === "true"
    ) {
      return null;
    }
    const rect = target.getBoundingClientRect?.();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return null;
    }
    return target;
  },

  focusPointerTarget(target, event = null) {
    if (!target) {
      return false;
    }
    const currentScreen = Router.getCurrentScreen();
    const screenContainer = currentScreen?.container instanceof HTMLElement
      ? currentScreen.container
      : target.closest(".screen");
    if (screenContainer && !screenContainer.contains(target)) {
      return false;
    }

    const focusRoot = screenContainer || document;
    focusRoot.querySelectorAll?.(".focusable.focused")?.forEach((node) => {
      if (node !== target) {
        node.classList.remove("focused");
      }
    });
    target.classList.add("focused");
    try {
      target.focus({ preventScroll: true });
    } catch (_) {
      try {
        target.focus();
      } catch (_) {
      }
    }
    currentScreen?.onPointerFocus?.(target, event);
    this.lastPointerFocusTarget = target;
    return true;
  },

  handlePointerMove(event) {
    if (!Platform.isWebOS()) {
      return;
    }
    const target = this.getPointerFocusable(event);
    if (!target || target === this.lastPointerFocusTarget) {
      return;
    }
    this.focusPointerTarget(target, event);
  },

  async handlePointerClick(event) {
    if (!Platform.isWebOS()) {
      return;
    }
    const target = this.getPointerFocusable(event);
    if (!target) {
      return;
    }
    this.focusPointerTarget(target, event);
    const currentScreen = Router.getCurrentScreen();
    if (typeof currentScreen?.onPointerActivate !== "function") {
      return;
    }
    const handled = await currentScreen.onPointerActivate(target, event);
    if (handled) {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      event?.stopImmediatePropagation?.();
    }
  },
};
