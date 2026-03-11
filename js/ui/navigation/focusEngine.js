import { Router } from "./router.js";
import { Platform } from "../../platform/index.js";

function buildNormalizedEvent(event) {
  const normalizedKey = Platform.normalizeKey(event);
  const normalizedCode = Number(normalizedKey.keyCode || 0);
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
    document.addEventListener("keydown", this.boundHandleKey, true);
  },

  handleKey(event) {
    if (event.defaultPrevented) {
      return;
    }

    const normalizedEvent = buildNormalizedEvent(event);

    if (Platform.isBackEvent({
      target: event?.target || null,
      key: event?.key || "",
      code: event?.code || "",
      keyCode: normalizedEvent.keyCode
    })) {
      const now = Date.now();
      if (now - this.lastBackHandledAt < 180) {
        return;
      }
      this.lastBackHandledAt = now;
      if (typeof event.preventDefault === "function") {
        event.preventDefault();
      }
      if (typeof event.stopPropagation === "function") {
        event.stopPropagation();
      }
      if (typeof event.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
      }
      const currentScreen = Router.getCurrentScreen();
      if (currentScreen?.consumeBackRequest?.()) {
        return;
      }
      Router.back();
      return;
    }

    const currentScreen = Router.getCurrentScreen();

    currentScreen?.onKeyDown?.(normalizedEvent);
  }
};
