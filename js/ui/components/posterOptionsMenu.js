import { I18n } from "../../i18n/index.js";
import { savedLibraryRepository } from "../../data/repository/savedLibraryRepository.js";
import { watchedItemsRepository } from "../../data/repository/watchedItemsRepository.js";
import { watchProgressRepository } from "../../data/repository/watchProgressRepository.js";
import { renderHoldMenuMarkup } from "./holdMenu.js";

function t(key, params = {}, fallback = key) {
  return I18n.t(key, params, { fallback });
}

function isSeriesType(type) {
  const normalized = String(type || "").toLowerCase();
  return normalized === "series" || normalized === "tv";
}

export function posterItemFromNode(node, fallbackType = "movie") {
  if (!node?.dataset?.itemId) {
    return null;
  }
  return {
    id: String(node.dataset.itemId || "").trim(),
    type: String(node.dataset.itemType || fallbackType || "movie").trim() || "movie",
    title: String(node.dataset.itemTitle || node.dataset.title || node.dataset.itemId || "Untitled").trim() || "Untitled",
    poster: String(node.dataset.posterSrc || node.dataset.poster || "").trim(),
    background: String(node.dataset.backdropSrc || node.dataset.background || "").trim()
  };
}

export async function createPosterOptionsState(item, options = {}) {
  if (!item?.id) {
    return null;
  }
  const watchedItems = Array.isArray(options.watchedItems)
    ? options.watchedItems
    : await watchedItemsRepository.getAll(2000).catch(() => []);
  return {
    item: {
      ...item,
      id: String(item.id || "").trim(),
      type: String(item.type || "movie").trim() || "movie",
      title: String(item.title || item.name || item.id || "Untitled").trim() || "Untitled"
    },
    isSaved: await savedLibraryRepository.isSaved(item.id).catch(() => false),
    isWatched: watchedItems.some((entry) => String(entry?.contentId || "") === String(item.id || "")),
    optionIndex: 0,
    focusKey: options.focusKey || "",
    itemIndex: Number.isFinite(Number(options.itemIndex)) ? Number(options.itemIndex) : -1
  };
}

export function getPosterOptions(state, options = {}) {
  const item = state?.item || null;
  if (!item?.id) {
    return [];
  }
  const includeLibrary = options.includeLibrary !== false;
  const includeWatched = options.includeWatched !== false && !isSeriesType(item.type);
  const actions = [
    { action: "details", label: t("cw_action_go_to_details", {}, "Go to details") }
  ];
  if (includeLibrary) {
    actions.push({
      action: "toggleLibrary",
      label: state.isSaved
        ? t("detail.removeFromLibrary", {}, "Remove from Library")
        : t("detail.addToLibrary", {}, "Add to Library")
    });
  }
  if (includeWatched) {
    actions.push({
      action: "toggleWatched",
      label: state.isWatched
        ? t("hero_mark_unwatched", {}, "Mark as unwatched")
        : t("hero_mark_watched", {}, "Mark as watched")
    });
  }
  return actions;
}

export function renderPosterOptionsMenu(state, options = {}) {
  const item = state?.item || null;
  if (!item?.id) {
    return "";
  }
  return renderHoldMenuMarkup({
    kicker: "",
    title: item.title || item.name || item.id || "Untitled",
    subtitle: t("home_poster_dialog_subtitle", {}, "Title actions"),
    focusedIndex: Number(state.optionIndex || 0),
    options: getPosterOptions(state, options)
  });
}

export async function activatePosterOption(state, action, options = {}) {
  const item = state?.item || null;
  if (!item?.id || !action) {
    return { type: "noop" };
  }
  if (action === "details") {
    return { type: "details", item };
  }
  if (action === "toggleLibrary") {
    const isSaved = await savedLibraryRepository.toggle({
      contentId: item.id,
      contentType: item.type || "movie",
      title: item.title || item.name || item.id || "Untitled",
      poster: item.poster || null,
      background: item.background || null
    });
    return { type: "updated", state: { ...state, isSaved: Boolean(isSaved) } };
  }
  if (action === "toggleWatched") {
    if (state.isWatched) {
      await watchedItemsRepository.unmark(item.id);
      await watchProgressRepository.removeProgress(item.id);
      return { type: "updated", state: { ...state, isWatched: false } };
    }
    await watchedItemsRepository.mark({
      contentId: item.id,
      contentType: item.type || "movie",
      title: item.title || item.name || item.id || "Untitled",
      watchedAt: Date.now()
    });
    await watchProgressRepository.saveProgress({
      contentId: item.id,
      contentType: item.type || "movie",
      videoId: null,
      positionMs: 100,
      durationMs: 100,
      updatedAt: Date.now()
    });
    return { type: "updated", state: { ...state, isWatched: true } };
  }
  return { type: "noop" };
}
