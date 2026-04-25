import { I18n } from "../../i18n/index.js";

function t(key, params = {}, fallback = key) {
  return I18n.t(key, params, { fallback });
}

export function createContinueWatchingSection(items = []) {
  const wrap = document.createElement("div");
  wrap.className = "row";
  wrap.innerHTML = `<h2>${t("home.continueWatching", {}, "Continue Watching")}</h2><p>${t("common.itemsCount", { count: items.length }, "{{count}} items")}</p>`;
  return wrap;
}
