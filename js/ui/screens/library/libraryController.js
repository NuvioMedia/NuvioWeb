import {
  LibraryListPrivacy,
  LibrarySortOptionKey,
  LibrarySourceMode,
  libraryRepository,
  libraryTypeLabel
} from "../../../data/repository/libraryRepository.js";
import { AuthManager } from "../../../core/auth/authManager.js";
import { watchedItemsRepository } from "../../../data/repository/watchedItemsRepository.js";
import { I18n } from "../../../i18n/index.js";

const ALL_KEY = "__all__";
const MESSAGE_CLEAR_MS = 2400;
const SYNC_LOADING_MIN_MS = 700;
const LEADING_ARTICLE_REGEX = /^(the|an|a)\s+/i;

export const LIBRARY_SORT_OPTIONS = [
  { key: LibrarySortOptionKey.DEFAULT, labelKey: "library_sort_trakt_order", fallback: "Trakt Order" },
  { key: LibrarySortOptionKey.ADDED_DESC, labelKey: "library_sort_added_desc", fallback: "Added ↓" },
  { key: LibrarySortOptionKey.ADDED_ASC, labelKey: "library_sort_added_asc", fallback: "Added ↑" },
  { key: LibrarySortOptionKey.TITLE_ASC, labelKey: "library_sort_title_asc", fallback: "Title A-Z" },
  { key: LibrarySortOptionKey.TITLE_DESC, labelKey: "library_sort_title_desc", fallback: "Title Z-A" }
];

export const LIBRARY_PRIVACY_OPTIONS = [
  LibraryListPrivacy.PRIVATE,
  LibraryListPrivacy.LINK,
  LibraryListPrivacy.FRIENDS,
  LibraryListPrivacy.PUBLIC
];

let persistedPosterFocusKey = null;

function makeInitialState() {
  return {
    sourceMode: LibrarySourceMode.LOCAL,
    allItems: [],
    visibleItems: [],
    listTabs: [],
    availableTypeTabs: [{ key: ALL_KEY, label: "All" }],
    availableGenres: [],
    availableYears: [],
    availableSortOptions: LIBRARY_SORT_OPTIONS.filter((option) => option.key !== LibrarySortOptionKey.DEFAULT),
    selectedListKey: null,
    selectedTypeKey: ALL_KEY,
    selectedGenre: null,
    selectedYear: null,
    selectedSortKey: LibrarySortOptionKey.ADDED_DESC,
    expandedPicker: null,
    pickerFocusIndex: 0,
    isLoading: true,
    isSyncing: false,
    transientMessage: null,
    errorMessage: null,
    showManageDialog: false,
    manageSelectedListKey: null,
    listEditorState: null,
    showDeleteConfirm: false,
    pendingOperation: false,
    lastFocusedPosterKey: persistedPosterFocusKey,
    isNuvioAccount: false,
    isTraktAuthenticated: false,
    watchedMovieIds: new Set(),
    watchedSeriesIds: new Set()
  };
}

function t(key, params = {}, fallback = key) {
  return I18n.t(key, params, { fallback });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nextAnimationFrame() {
  if (typeof globalThis.requestAnimationFrame !== "function") {
    return delay(0);
  }
  return new Promise((resolve) => globalThis.requestAnimationFrame(() => resolve()));
}

async function allowLoadingFrame() {
  await nextAnimationFrame();
  await nextAnimationFrame();
}

function optionLabel(option = {}) {
  return option.labelKey ? t(option.labelKey, {}, option.fallback || option.key) : String(option.label || option.key || "");
}

function stripCountSuffix(value) {
  return String(value || "").replace(/\s+\(\d+\)$/, "");
}

function typeLabelForEmptyState(key) {
  if (!key || key === ALL_KEY) {
    return "all";
  }
  return libraryTypeLabel(key).replace(/\s+\(\d+\)$/, "").toLowerCase();
}

function normalizeTypeTabs(items) {
  const byKey = new Map();
  items.forEach((item) => {
    const key = String(item.type || "").trim().toLowerCase();
    if (!key || byKey.has(key)) {
      return;
    }
    byKey.set(key, libraryTypeLabel(key));
  });
  return [
    { key: ALL_KEY, label: `${t("library_type_all", {}, "All")} (${items.length})` },
    ...Array.from(byKey.entries()).map(([key, label]) => ({
      key,
      label: `${label} (${items.filter((item) => String(item.type || "").trim().toLowerCase() === key).length})`
    }))
  ];
}

function extractYear(item = {}) {
  const value = String(item.releaseInfo || item.releaseDate || item.released || item.year || "");
  return value.match(/\b(19|20)\d{2}\b/)?.[0] || null;
}

function titleSortKey(value) {
  return String(value || "").trim().replace(LEADING_ARTICLE_REGEX, "").toLowerCase();
}

function buildFilterOptions(items = [], field) {
  const counts = new Map();
  items.forEach((item) => {
    const values = field === "genre"
      ? (Array.isArray(item.genres) ? item.genres : [])
      : [extractYear(item)].filter(Boolean);
    values.forEach((value) => {
      const key = String(value || "").trim();
      if (key) {
        counts.set(key, (counts.get(key) || 0) + 1);
      }
    });
  });
  return Array.from(counts.entries())
    .sort((left, right) => field === "year"
      ? String(right[0]).localeCompare(String(left[0]))
      : String(left[0]).localeCompare(String(right[0]), undefined, { sensitivity: "base" }))
    .map(([key, count]) => ({ key, label: key, count }));
}

function itemMatchesGenre(item, genre) {
  if (!genre) {
    return true;
  }
  return (Array.isArray(item.genres) ? item.genres : [])
    .some((entry) => String(entry).toLowerCase() === String(genre).toLowerCase());
}

function itemMatchesYear(item, year) {
  return !year || extractYear(item) === year;
}

function buildFacets(allItems, state) {
  const listFiltered = state.sourceMode === LibrarySourceMode.TRAKT && state.selectedListKey
    ? allItems.filter((item) => Array.isArray(item.listKeys) && item.listKeys.includes(state.selectedListKey))
    : allItems;
  const selectedTypeKey = state.selectedTypeKey;
  const typeFiltered = listFiltered.filter((item) => {
    return selectedTypeKey === ALL_KEY || String(item.type || "").trim().toLowerCase() === selectedTypeKey;
  });
  const itemsForTypeCounts = listFiltered.filter((item) => itemMatchesGenre(item, state.selectedGenre) && itemMatchesYear(item, state.selectedYear));
  const itemsForGenreCounts = state.selectedYear
    ? typeFiltered.filter((item) => itemMatchesYear(item, state.selectedYear))
    : typeFiltered;
  const itemsForYearCounts = state.selectedGenre
    ? typeFiltered.filter((item) => itemMatchesGenre(item, state.selectedGenre))
    : typeFiltered;
  return {
    availableTypeTabs: normalizeTypeTabs(itemsForTypeCounts),
    availableGenres: buildFilterOptions(itemsForGenreCounts, "genre"),
    availableYears: buildFilterOptions(itemsForYearCounts, "year")
  };
}

function sortForState(items, state) {
  const selectedTypeKey = state.selectedTypeKey;
  const typeFiltered = items.filter((item) => {
    return selectedTypeKey === ALL_KEY || String(item.type || "").trim().toLowerCase() === selectedTypeKey;
  });

  const listFiltered = state.sourceMode === LibrarySourceMode.TRAKT && state.selectedListKey
    ? typeFiltered.filter((item) => Array.isArray(item.listKeys) && item.listKeys.includes(state.selectedListKey))
    : typeFiltered;

  const genreFiltered = state.selectedGenre
    ? listFiltered.filter((item) => itemMatchesGenre(item, state.selectedGenre))
    : listFiltered;

  const yearFiltered = state.selectedYear
    ? genreFiltered.filter((item) => itemMatchesYear(item, state.selectedYear))
    : genreFiltered;

  const listMetaValue = (item, field) => {
    if (!state.selectedListKey) {
      return field === "listedAt" ? Number(item.listedAt || 0) : item.traktRank;
    }
    return item.listMeta?.[state.selectedListKey]?.[field] ?? (field === "listedAt" ? Number(item.listedAt || 0) : item.traktRank);
  };

  const byNameAsc = (left, right) => {
    const nameResult = String(left.name || left.id).localeCompare(String(right.name || right.id), undefined, { sensitivity: "base" });
    if (nameResult !== 0) {
      return nameResult;
    }
    return String(left.id).localeCompare(String(right.id), undefined, { sensitivity: "base" });
  };

  const byTitleSortAsc = (left, right) => {
    const nameResult = titleSortKey(left.name || left.id).localeCompare(titleSortKey(right.name || right.id), undefined, { sensitivity: "base" });
    if (nameResult !== 0) {
      return nameResult;
    }
    return String(left.id).localeCompare(String(right.id), undefined, { sensitivity: "base" });
  };

  const sorted = [...yearFiltered];
  sorted.sort((left, right) => {
    switch (state.selectedSortKey) {
      case LibrarySortOptionKey.DEFAULT: {
        const rankDiff = Number(listMetaValue(left, "traktRank") ?? Number.MAX_SAFE_INTEGER)
          - Number(listMetaValue(right, "traktRank") ?? Number.MAX_SAFE_INTEGER);
        if (rankDiff !== 0) {
          return rankDiff;
        }
        const addedDiff = Number(listMetaValue(right, "listedAt") || 0) - Number(listMetaValue(left, "listedAt") || 0);
        if (addedDiff !== 0) {
          return addedDiff;
        }
        return byNameAsc(left, right);
      }
      case LibrarySortOptionKey.ADDED_ASC: {
        const addedDiff = Number(listMetaValue(left, "listedAt") || 0) - Number(listMetaValue(right, "listedAt") || 0);
        if (addedDiff !== 0) {
          return addedDiff;
        }
        return byNameAsc(left, right);
      }
      case LibrarySortOptionKey.TITLE_ASC:
        return byTitleSortAsc(left, right);
      case LibrarySortOptionKey.TITLE_DESC:
        return byTitleSortAsc(right, left);
      case LibrarySortOptionKey.ADDED_DESC:
      default: {
        const addedDiff = Number(listMetaValue(right, "listedAt") || 0) - Number(listMetaValue(left, "listedAt") || 0);
        if (addedDiff !== 0) {
          return addedDiff;
        }
        return byNameAsc(left, right);
      }
    }
  });
  return sorted;
}

function copyEditorState(state) {
  return state
    ? {
      mode: state.mode,
      listId: state.listId || null,
      name: state.name || "",
      description: state.description || "",
      privacy: state.privacy || LibraryListPrivacy.PRIVATE
    }
    : null;
}

export class LibraryController {

  constructor(onChange = () => {}) {
    this.onChange = onChange;
    this.state = makeInitialState();
    this.messageTimer = null;
  }

  async init() {
    await this.reload();
  }

  dispose() {
    if (this.messageTimer) {
      clearTimeout(this.messageTimer);
      this.messageTimer = null;
    }
  }

  getState() {
    return {
      ...this.state,
      listTabs: [...this.state.listTabs],
      availableTypeTabs: [...this.state.availableTypeTabs],
      availableGenres: [...this.state.availableGenres],
      availableYears: [...this.state.availableYears],
      availableSortOptions: [...this.state.availableSortOptions],
      allItems: [...this.state.allItems],
      visibleItems: [...this.state.visibleItems],
      watchedMovieIds: new Set(this.state.watchedMovieIds || []),
      watchedSeriesIds: new Set(this.state.watchedSeriesIds || []),
      listEditorState: copyEditorState(this.state.listEditorState)
    };
  }

  setState(patch) {
    this.state = {
      ...this.state,
      ...patch
    };
    const facets = buildFacets(this.state.allItems, this.state);
    const selectedGenre = this.state.selectedGenre && facets.availableGenres.some((item) => item.key === this.state.selectedGenre)
      ? this.state.selectedGenre
      : null;
    const selectedYear = this.state.selectedYear && facets.availableYears.some((item) => item.key === this.state.selectedYear)
      ? this.state.selectedYear
      : null;
    this.state = {
      ...this.state,
      ...facets,
      selectedTypeKey: facets.availableTypeTabs.some((item) => item.key === this.state.selectedTypeKey) ? this.state.selectedTypeKey : ALL_KEY,
      selectedGenre,
      selectedYear
    };
    this.state.visibleItems = sortForState(this.state.allItems, this.state);
    this.onChange(this.getState());
  }

  async reload(options = {}) {
    const preserveOverlay = options.preserveOverlay === true;
    if (!preserveOverlay) {
      this.state = {
        ...this.state,
        isLoading: true
      };
      this.onChange(this.getState());
    }

    const [sourceMode, listTabs, allItems, watchedItems] = await Promise.all([
      libraryRepository.getSourceMode(),
      libraryRepository.getListTabs(),
      libraryRepository.getItems(),
      watchedItemsRepository.getAll(5000).catch(() => [])
    ]);

    const nextSelectedListKey = sourceMode === LibrarySourceMode.TRAKT
      ? (this.state.selectedListKey && listTabs.some((item) => item.key === this.state.selectedListKey)
        ? this.state.selectedListKey
        : (listTabs[0]?.key || null))
      : null;

    const availableSortOptions = sourceMode === LibrarySourceMode.TRAKT
      ? LIBRARY_SORT_OPTIONS
      : LIBRARY_SORT_OPTIONS.filter((option) => option.key !== LibrarySortOptionKey.DEFAULT);
    const facets = buildFacets(allItems, {
      ...this.state,
      sourceMode,
      selectedListKey: nextSelectedListKey
    });
    const availableTypeTabs = facets.availableTypeTabs;
    const selectedTypeKey = availableTypeTabs.some((item) => item.key === this.state.selectedTypeKey)
      ? this.state.selectedTypeKey
      : ALL_KEY;
    const selectedGenre = this.state.selectedGenre && facets.availableGenres.some((item) => item.key === this.state.selectedGenre)
      ? this.state.selectedGenre
      : null;
    const selectedYear = this.state.selectedYear && facets.availableYears.some((item) => item.key === this.state.selectedYear)
      ? this.state.selectedYear
      : null;
    const selectedSortKey = availableSortOptions.some((item) => item.key === this.state.selectedSortKey)
      ? this.state.selectedSortKey
      : (sourceMode === LibrarySourceMode.TRAKT ? LibrarySortOptionKey.DEFAULT : LibrarySortOptionKey.ADDED_DESC);
    const manageSelectedListKey = this.state.manageSelectedListKey && listTabs.some((item) => item.key === this.state.manageSelectedListKey && item.type === "personal")
      ? this.state.manageSelectedListKey
      : (listTabs.find((item) => item.type === "personal")?.key || null);

    this.state = {
      ...this.state,
      sourceMode,
      allItems,
      listTabs,
      availableTypeTabs: facets.availableTypeTabs,
      availableGenres: facets.availableGenres,
      availableYears: facets.availableYears,
      availableSortOptions,
      selectedListKey: nextSelectedListKey,
      selectedTypeKey,
      selectedGenre,
      selectedYear,
      selectedSortKey,
      manageSelectedListKey,
      isNuvioAccount: sourceMode === LibrarySourceMode.LOCAL && AuthManager.isAuthenticated,
      isTraktAuthenticated: sourceMode === LibrarySourceMode.TRAKT,
      watchedMovieIds: new Set((watchedItems || []).filter((item) => item.season == null && item.episode == null).map((item) => String(item.contentId || ""))),
      watchedSeriesIds: new Set((watchedItems || []).filter((item) => item.season == null && item.episode == null).map((item) => String(item.contentId || ""))),
      isLoading: false,
      isSyncing: false,
      expandedPicker: preserveOverlay ? this.state.expandedPicker : null,
      pickerFocusIndex: 0
    };
    this.state.visibleItems = sortForState(this.state.allItems, this.state);
    this.onChange(this.getState());
  }

  getSourceLabel() {
    if (this.state.sourceMode === LibrarySourceMode.TRAKT) {
      return t("library_source_trakt", {}, "TRAKT");
    }
    if (this.state.isNuvioAccount) {
      return t("library_source_nuvio", {}, "NUVIO");
    }
    return t("library_source_local", {}, "LOCAL");
  }

  getSelectedTypeLabel() {
    const label = this.state.availableTypeTabs.find((item) => item.key === this.state.selectedTypeKey)?.label || t("library_type_all", {}, "All");
    return stripCountSuffix(label);
  }

  getSelectedSortLabel() {
    return optionLabel(this.state.availableSortOptions.find((item) => item.key === this.state.selectedSortKey)) || t("library_sort_added_desc", {}, "Added ↓");
  }

  getSelectedListLabel() {
    return this.state.listTabs.find((item) => item.key === this.state.selectedListKey)?.title || "Select";
  }

  getSelectedGenreLabel() {
    return this.state.selectedGenre || t("library_type_all", {}, "All");
  }

  getSelectedYearLabel() {
    return this.state.selectedYear || t("library_type_all", {}, "All");
  }

  getEmptyStateTitle() {
    const selectedTypeLabel = typeLabelForEmptyState(this.state.selectedTypeKey);
    if (this.state.sourceMode === LibrarySourceMode.TRAKT && !this.state.isTraktAuthenticated) {
      return t("library_empty_trakt_not_auth_title", {}, "Trakt not connected");
    }
    if (this.state.sourceMode === LibrarySourceMode.TRAKT) {
      return t("library_empty_trakt_title", [selectedTypeLabel], `No ${selectedTypeLabel} in this list`);
    }
    return t("library_empty_local_title", [selectedTypeLabel], `No ${selectedTypeLabel} yet`);
  }

  getEmptyStateSubtitle() {
    if (this.state.sourceMode === LibrarySourceMode.TRAKT && !this.state.isTraktAuthenticated) {
      return t("library_empty_trakt_not_auth_subtitle", {}, "Connect your Trakt account in Settings to view your Trakt library");
    }
    if (this.state.sourceMode === LibrarySourceMode.TRAKT) {
      return t("library_empty_trakt_subtitle", {}, "Use + in details to add items to watchlist or lists");
    }
    return t("library_empty_local_subtitle", {}, "Start saving your favorites to see them here");
  }

  getPickerOptions(picker) {
    if (picker === "list") {
      return this.state.listTabs.map((item) => ({ value: item.key, label: item.title }));
    }
    if (picker === "type") {
      return this.state.availableTypeTabs.map((item) => ({ value: item.key, label: item.label }));
    }
    if (picker === "sort") {
      return this.state.availableSortOptions.map((item) => ({ value: item.key, label: optionLabel(item) }));
    }
    if (picker === "genre") {
      return [
        { value: ALL_KEY, label: t("library_type_all", {}, "All") },
        ...this.state.availableGenres.map((item) => ({ value: item.key, label: `${item.label} (${item.count})` }))
      ];
    }
    if (picker === "year") {
      return [
        { value: ALL_KEY, label: t("library_type_all", {}, "All") },
        ...this.state.availableYears.map((item) => ({ value: item.key, label: `${item.label} (${item.count})` }))
      ];
    }
    return [];
  }

  togglePicker(picker) {
    const nextExpanded = this.state.expandedPicker === picker ? null : picker;
    const options = this.getPickerOptions(picker);
    let pickerFocusIndex = 0;
    if (nextExpanded) {
      const currentValue = picker === "list"
        ? this.state.selectedListKey
        : picker === "type"
          ? this.state.selectedTypeKey
          : picker === "genre"
            ? (this.state.selectedGenre || ALL_KEY)
            : picker === "year"
              ? (this.state.selectedYear || ALL_KEY)
              : this.state.selectedSortKey;
      const optionIndex = Math.max(0, options.findIndex((item) => item.value === currentValue));
      pickerFocusIndex = optionIndex;
    }
    this.setState({
      expandedPicker: nextExpanded,
      pickerFocusIndex
    });
  }

  closePicker() {
    if (!this.state.expandedPicker) {
      return false;
    }
    this.setState({
      expandedPicker: null,
      pickerFocusIndex: 0
    });
    return true;
  }

  movePickerFocus(direction, config = {}) {
    const pickerOptions = this.getPickerOptions(this.state.expandedPicker);
    if (!pickerOptions.length) {
      return;
    }
    const delta = direction === "up" ? -1 : 1;
    const nextIndex = Math.max(0, Math.min(pickerOptions.length - 1, Number(this.state.pickerFocusIndex || 0) + delta));
    if (config.silent === true) {
      this.state.pickerFocusIndex = nextIndex;
      return;
    }
    this.setState({ pickerFocusIndex: nextIndex });
  }

  selectOpenPickerOption() {
    const picker = this.state.expandedPicker;
    if (!picker) {
      return;
    }
    const options = this.getPickerOptions(picker);
    const option = options[Number(this.state.pickerFocusIndex || 0)];
    if (!option) {
      return;
    }
    if (picker === "list") {
      this.selectList(option.value);
      return;
    }
    if (picker === "type") {
      this.selectType(option.value);
      return;
    }
    if (picker === "sort") {
      this.selectSort(option.value);
      return;
    }
    if (picker === "genre") {
      this.selectGenre(option.value === ALL_KEY ? null : option.value);
      return;
    }
    if (picker === "year") {
      this.selectYear(option.value === ALL_KEY ? null : option.value);
    }
  }

  selectList(key) {
    this.setState({
      selectedListKey: key,
      selectedTypeKey: ALL_KEY,
      expandedPicker: null,
      pickerFocusIndex: 0
    });
  }

  selectType(key) {
    this.setState({
      selectedTypeKey: key,
      expandedPicker: null,
      pickerFocusIndex: 0
    });
  }

  selectGenre(key) {
    this.setState({
      selectedGenre: key || null,
      expandedPicker: null,
      pickerFocusIndex: 0
    });
  }

  selectYear(key) {
    this.setState({
      selectedYear: key || null,
      expandedPicker: null,
      pickerFocusIndex: 0
    });
  }

  selectSort(key) {
    this.state = {
      ...this.state,
      selectedSortKey: key,
      expandedPicker: null,
      pickerFocusIndex: 0
    };
    this.state.visibleItems = sortForState(this.state.allItems, this.state);
    const firstItem = this.state.visibleItems[0] || null;
    this.state.lastFocusedPosterKey = firstItem ? `${firstItem.type}:${firstItem.id}` : null;
    persistedPosterFocusKey = this.state.lastFocusedPosterKey;
    this.onChange(this.getState());
  }

  setFocusedPosterKey(key) {
    this.state.lastFocusedPosterKey = key || null;
    persistedPosterFocusKey = this.state.lastFocusedPosterKey;
  }

  openManageLists() {
    this.setState({
      showManageDialog: true,
      errorMessage: null,
      expandedPicker: null,
      manageSelectedListKey: this.state.manageSelectedListKey || this.state.listTabs.find((item) => item.type === "personal")?.key || null
    });
  }

  closeManageLists() {
    this.setState({
      showManageDialog: false,
      listEditorState: null,
      showDeleteConfirm: false,
      errorMessage: null
    });
  }

  selectManageList(key) {
    this.setState({
      manageSelectedListKey: key
    });
  }

  startCreateList() {
    this.setState({
      listEditorState: {
        mode: "create",
        listId: null,
        name: "",
        description: "",
        privacy: LibraryListPrivacy.PRIVATE
      },
      errorMessage: null
    });
  }

  startEditList() {
    const selected = this.state.listTabs.find((item) => item.key === this.state.manageSelectedListKey && item.type === "personal");
    if (!selected) {
      return;
    }
    this.setState({
      listEditorState: {
        mode: "edit",
        listId: selected.traktListId || selected.key.replace("personal:", ""),
        name: selected.title,
        description: selected.description || "",
        privacy: selected.privacy || LibraryListPrivacy.PRIVATE
      },
      errorMessage: null
    });
  }

  updateEditorField(field, value, options = {}) {
    if (!this.state.listEditorState) {
      return;
    }
    this.state.listEditorState = {
      ...this.state.listEditorState,
      [field]: value
    };
    if (options.silent === true) {
      return;
    }
    this.onChange(this.getState());
  }

  closeEditor() {
    this.setState({
      listEditorState: null
    });
  }

  promptDeleteList() {
    this.setState({
      showDeleteConfirm: true
    });
  }

  closeDeleteConfirm() {
    this.setState({
      showDeleteConfirm: false
    });
  }

  async submitEditor() {
    const editor = this.state.listEditorState;
    if (!editor) {
      return;
    }
    const name = String(editor.name || "").trim();
    if (!name) {
      this.setError("List name is required");
      return;
    }

    this.setState({ pendingOperation: true, errorMessage: null });
    try {
      if (editor.mode === "create") {
        const newKey = await libraryRepository.createPersonalList(name, editor.description.trim() || null, editor.privacy);
        this.setTransientMessage("List created");
        await this.reload({ preserveOverlay: true });
        this.setState({
          pendingOperation: false,
          listEditorState: null,
          manageSelectedListKey: newKey
        });
      } else {
        await libraryRepository.updatePersonalList(editor.listId, name, editor.description.trim() || null, editor.privacy);
        this.setTransientMessage("List updated");
        await this.reload({ preserveOverlay: true });
        this.setState({
          pendingOperation: false,
          listEditorState: null
        });
      }
    } catch (error) {
      this.setState({ pendingOperation: false });
      this.setError(error?.message || "Failed to save list");
    }
  }

  async deleteSelectedList() {
    const selected = this.state.listTabs.find((item) => item.key === this.state.manageSelectedListKey && item.type === "personal");
    if (!selected) {
      return;
    }
    this.setState({ pendingOperation: true, errorMessage: null });
    try {
      await libraryRepository.deletePersonalList(selected.traktListId || selected.key.replace("personal:", ""));
      this.setTransientMessage("List deleted");
      await this.reload({ preserveOverlay: true });
      this.setState({
        pendingOperation: false,
        showDeleteConfirm: false
      });
    } catch (error) {
      this.setState({ pendingOperation: false });
      this.setError(error?.message || "Failed to delete list");
    }
  }

  async moveSelectedList(direction) {
    const personalTabs = this.state.listTabs.filter((item) => item.type === "personal");
    const currentIndex = personalTabs.findIndex((item) => item.key === this.state.manageSelectedListKey);
    if (currentIndex < 0) {
      return;
    }
    const nextIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (nextIndex < 0 || nextIndex >= personalTabs.length) {
      return;
    }
    const reordered = [...personalTabs];
    const [selected] = reordered.splice(currentIndex, 1);
    reordered.splice(nextIndex, 0, selected);

    this.setState({ pendingOperation: true, errorMessage: null });
    try {
      await libraryRepository.reorderPersonalLists(reordered.map((item) => item.traktListId || item.key.replace("personal:", "")));
      this.setTransientMessage("List order updated");
      await this.reload({ preserveOverlay: true });
      this.setState({
        pendingOperation: false,
        manageSelectedListKey: selected.key
      });
    } catch (error) {
      this.setState({ pendingOperation: false });
      this.setError(error?.message || "Failed to reorder lists");
    }
  }

  async refreshNow() {
    const startedAt = Date.now();
    this.setState({ isSyncing: true, errorMessage: null });
    try {
      await allowLoadingFrame();
      await libraryRepository.refreshNow();
      const elapsed = Date.now() - startedAt;
      if (elapsed < SYNC_LOADING_MIN_MS) {
        await delay(SYNC_LOADING_MIN_MS - elapsed);
      }
      await this.reload({ preserveOverlay: true });
      this.setState({ isSyncing: false });
    } catch (error) {
      this.setState({ isSyncing: false });
      this.setError(error?.message || "Failed to refresh library");
    }
  }

  setError(message) {
    this.setState({
      errorMessage: message,
      transientMessage: message
    });
    this.scheduleMessageClear();
  }

  setTransientMessage(message) {
    this.setState({
      transientMessage: message,
      errorMessage: null
    });
    this.scheduleMessageClear();
  }

  clearTransientMessage() {
    this.setState({
      transientMessage: null
    });
  }

  scheduleMessageClear() {
    if (this.messageTimer) {
      clearTimeout(this.messageTimer);
    }
    this.messageTimer = setTimeout(() => {
      this.messageTimer = null;
      this.clearTransientMessage();
    }, MESSAGE_CLEAR_MS);
  }
}
