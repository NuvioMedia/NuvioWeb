import { LocalStore } from "../core/storage/localStore.js";

const ROTATED_DPAD_KEY = "rotatedDpadMapping";

export function getArrowCodeFromKey(key) {
  if (key === "ArrowUp" || key === "Up") return 38;
  if (key === "ArrowDown" || key === "Down") return 40;
  if (key === "ArrowLeft" || key === "Left") return 37;
  if (key === "ArrowRight" || key === "Right") return 39;
  return null;
}

function isEditableTarget(target) {
  const tagName = String(target?.tagName || "").toUpperCase();
  return Boolean(
    target?.isContentEditable
    || tagName === "INPUT"
    || tagName === "TEXTAREA"
    || tagName === "SELECT"
  );
}

function isSimulator() {
  const ua = String(globalThis.navigator?.userAgent || "").toLowerCase();
  return ua.includes("simulator");
}

function shouldUseRotatedMapping() {
  const stored = LocalStore.get(ROTATED_DPAD_KEY, null);
  if (typeof stored === "boolean") {
    return stored;
  }
  return isSimulator();
}

export function normalizeDirectionalKeyCode(code) {
  const rotatedMap = {
    37: 38,
    38: 37,
    39: 40,
    40: 39
  };
  if (shouldUseRotatedMapping() && rotatedMap[code]) {
    return rotatedMap[code];
  }
  return code;
}

export function normalizeKeyEvent(event, backCodes = []) {
  const key = String(event?.key || "");
  const code = String(event?.code || "");
  const rawCode = Number(getArrowCodeFromKey(key) || event?.keyCode || 0);
  const normalizedCode = normalizeDirectionalKeyCode(rawCode);
  const isBack = isBackEvent(event, backCodes, normalizedCode);
  return {
    key,
    code,
    keyCode: normalizedCode,
    originalKeyCode: rawCode,
    isArrow: normalizedCode >= 37 && normalizedCode <= 40,
    isEnter: normalizedCode === 13 || key === "Enter",
    isBack
  };
}

export function isBackEvent(event, backCodes = [], normalizedCode = null) {
  const target = event?.target || null;
  const key = String(event?.key || "");
  const keyLower = key.toLowerCase();
  const code = String(event?.code || "");
  const rawCode = Number(event?.keyCode || 0);
  const effectiveCode = Number(normalizedCode || rawCode || 0);

  if (isEditableTarget(target) && (key === "Backspace" || rawCode === 8 || key === "Delete" || rawCode === 46)) {
    return false;
  }

  if (backCodes.includes(effectiveCode) || backCodes.includes(rawCode)) {
    return true;
  }

  if (
    key === "Escape"
    || key === "Esc"
    || key === "Backspace"
    || key === "GoBack"
    || key === "XF86Back"
    || code === "BrowserBack"
    || code === "GoBack"
  ) {
    return true;
  }

  return keyLower.includes("back");
}
