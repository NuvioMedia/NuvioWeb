import {
  LibraryListPrivacy,
  LibrarySortOptionKey,
  LibrarySourceMode,
  libraryRepository,
  libraryTypeLabel
} from "../../../data/repository/libraryRepository.js";

const ALL_KEY = "__all__";
const MESSAGE_CLEAR_MS = 2400;

export const LIBRARY_SORT_OPTIONS = [
  { key: LibrarySortOptionKey.DEFAULT, label: "List Order" },
  { key: LibrarySortOptionKey.ADDED_DESC, label: "Added ↓" },
  { key: LibrarySortOptionKey.ADDED_ASC, label: "Added ↑" },
  { key: LibrarySortOptionKey.TITLE_ASC, label: "Title A-Z" },
  { key: LibrarySortOptionKey.TITLE_DESC, label: "Title Z-A" }
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
    availableSortOptions: LIBRARY_SORT_OPTIONS.filter((option) => option.key !== LibrarySortOptionKey.DEFAULT),
    selectedListKey: null,
    selectedTypeKey: ALL_KEY,
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
    lastFocusedPosterKey: persistedPosterFocusKey
  };
}

function typeLabelForEmptyState(key) {
  if (!key || key === ALL_KEY) {
    return "all";
  }
  return libraryTypeLabel(key).toLowerCase();
}

function normalizeTypeTabs(items) {
  const seen = new Set();
  const tabs = [{ key: ALL_KEY, label: "All" }];
  items.forEach((item) => {
    const key = String(item.type || "").trim().toLowerCase();
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);
    tabs.push({
      key,
      label: libraryTypeLabel(key)
    });
  });
  return tabs;
}

function sortForState(items, state) {
  const selectedTypeKey = state.selectedTypeKey;
  const typeFiltered = items.filter((item) => {
    return selectedTypeKey === ALL_KEY || String(item.type || "").trim().toLowerCase() === selectedTypeKey;
  });

  const listFiltered = state.sourceMode === LibrarySourceMode.TRAKT && state.selectedListKey
    ? typeFiltered.filter((item) => Array.isArray(item.listKeys) && item.listKeys.includes(state.selectedListKey))
    : typeFiltered;

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

  const sorted = [...listFiltered];
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
        return byNameAsc(left, right);
      case LibrarySortOptionKey.TITLE_DESC:
        return byNameAsc(right, left);
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
      availableSortOptions: [...this.state.availableSortOptions],
      allItems: [...this.state.allItems],
      visibleItems: [...this.state.visibleItems],
      listEditorState: copyEditorState(this.state.listEditorState)
    };
  }

  setState(patch) {
    this.state = {
      ...this.state,
      ...patch
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

    const [sourceMode, listTabs, allItems] = await Promise.all([
      libraryRepository.getSourceMode(),
      libraryRepository.getListTabs(),
      libraryRepository.getItems()
    ]);

    const nextSelectedListKey = sourceMode === LibrarySourceMode.TRAKT
      ? (this.state.selectedListKey && listTabs.some((item) => item.key === this.state.selectedListKey)
        ? this.state.selectedListKey
        : (listTabs[0]?.key || null))
      : null;

    const typeItems = sourceMode === LibrarySourceMode.TRAKT && nextSelectedListKey
      ? allItems.filter((item) => item.listKeys?.includes(nextSelectedListKey))
      : allItems;
    const availableTypeTabs = normalizeTypeTabs(typeItems);
    const availableSortOptions = sourceMode === LibrarySourceMode.TRAKT
      ? LIBRARY_SORT_OPTIONS
      : LIBRARY_SORT_OPTIONS.filter((option) => option.key !== LibrarySortOptionKey.DEFAULT);
    const selectedTypeKey = availableTypeTabs.some((item) => item.key === this.state.selectedTypeKey)
      ? this.state.selectedTypeKey
      : ALL_KEY;
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
      availableTypeTabs,
      availableSortOptions,
      selectedListKey: nextSelectedListKey,
      selectedTypeKey,
      selectedSortKey,
      manageSelectedListKey,
      isLoading: false,
      isSyncing: false,
      expandedPicker: preserveOverlay ? this.state.expandedPicker : null,
      pickerFocusIndex: 0
    };
    this.state.visibleItems = sortForState(this.state.allItems, this.state);
    this.onChange(this.getState());
  }

  getSourceLabel() {
    return this.state.sourceMode === LibrarySourceMode.TRAKT ? "SYNCED" : "LOCAL";
  }

  getSelectedTypeLabel() {
    return this.state.availableTypeTabs.find((item) => item.key === this.state.selectedTypeKey)?.label || "All";
  }

  getSelectedSortLabel() {
    return this.state.availableSortOptions.find((item) => item.key === this.state.selectedSortKey)?.label || "Added ↓";
  }

  getSelectedListLabel() {
    return this.state.listTabs.find((item) => item.key === this.state.selectedListKey)?.title || "Select";
  }

  getEmptyStateTitle() {
    return `No ${typeLabelForEmptyState(this.state.selectedTypeKey)} yet`;
  }

  getEmptyStateSubtitle() {
    return "Start saving your favorites to see them here";
  }

  getPickerOptions(picker) {
    if (picker === "list") {
      return this.state.listTabs.map((item) => ({ value: item.key, label: item.title }));
    }
    if (picker === "type") {
      return this.state.availableTypeTabs.map((item) => ({ value: item.key, label: item.label }));
    }
    if (picker === "sort") {
      return this.state.availableSortOptions.map((item) => ({ value: item.key, label: item.label }));
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
        : (picker === "type" ? this.state.selectedTypeKey : this.state.selectedSortKey);
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

  movePickerFocus(direction) {
    const options = this.getPickerOptions(this.state.expandedPicker);
    if (!options.length) {
      return;
    }
    const delta = direction === "up" ? -1 : 1;
    const nextIndex = Math.max(0, Math.min(options.length - 1, Number(this.state.pickerFocusIndex || 0) + delta));
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
    }
  }

  selectList(key) {
    const typeItems = this.state.allItems.filter((item) => item.listKeys?.includes(key));
    const availableTypeTabs = normalizeTypeTabs(typeItems);
    this.setState({
      selectedListKey: key,
      availableTypeTabs,
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
    this.setState({ isSyncing: true, errorMessage: null });
    try {
      await libraryRepository.refreshNow();
      this.setTransientMessage("Library synced");
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
