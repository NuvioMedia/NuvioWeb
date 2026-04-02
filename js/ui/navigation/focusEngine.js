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

  init() {
    this.boundHandleKey = this.handleKey.bind(this);
    this.boundHandleKeyUp = this.handleKeyUp.bind(this);
    document.addEventListener("keydown", this.boundHandleKey, true);
    document.addEventListener("keyup", this.boundHandleKeyUp, true);
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
      const now = Date.now();
      if (now - this.lastBackHandledAt < 250) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      this.lastBackHandledAt = now;

      normalizedEvent.preventDefault();
      normalizedEvent.stopPropagation();
      normalizedEvent.stopImmediatePropagation();

      const currentScreen = Router.getCurrentScreen();
      if (currentScreen?.consumeBackRequest?.()) {
        return;
      }

      Router.back();
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
};