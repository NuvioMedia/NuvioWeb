export function catalogRequiresExtras(catalog) {
  // Catalogs that cannot be requested without extra params (required search,
  // genre, ...) belong to the search/discover screens, not the home screen.
  return Array.isArray(catalog?.extra) && catalog.extra.some((entry) => Boolean(entry?.isRequired));
}

export function buildCatalogOrderKey(addonId, type, catalogId) {
  return `${addonId}_${type}_${catalogId}`;
}

export function buildCatalogDisableKey(addonBaseUrl, type, catalogId, catalogName) {
  return `${addonBaseUrl}_${type}_${catalogId}_${catalogName}`;
}

export function buildCollectionOrderKey(collectionId) {
  const id = String(collectionId || "").trim();
  return id ? `collection_${id}` : "";
}

export function toDisplayTypeLabel(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

export function buildOrderedCatalogItems(addons, savedOrderKeys = [], disabledKeys = []) {
  return buildOrderedHomeCatalogItems(addons, [], savedOrderKeys, disabledKeys);
}

export function buildOrderedHomeCatalogItems(
  addons,
  collections = [],
  savedOrderKeys = [],
  disabledKeys = []
) {
  const defaultEntries = [];
  const seenKeys = new Set();
  const disabledSet = new Set(disabledKeys || []);

  (addons || []).forEach((addon) => {
    (addon.catalogs || [])
      .filter((catalog) => !catalogRequiresExtras(catalog))
      .forEach((catalog) => {
        const key = buildCatalogOrderKey(addon.id, catalog.apiType, catalog.id);
        if (seenKeys.has(key)) {
          return;
        }
        seenKeys.add(key);
        defaultEntries.push({
          key,
          disableKey: buildCatalogDisableKey(
            addon.baseUrl,
            catalog.apiType,
            catalog.id,
            catalog.name
          ),
          addonBaseUrl: addon.baseUrl,
          addonId: addon.id,
          addonName: addon.displayName,
          catalogId: catalog.id,
          catalogName: catalog.name,
          type: catalog.apiType,
          isDisabled: false
        });
      });
  });

  (collections || []).forEach((collection) => {
    const key = buildCollectionOrderKey(collection?.id);
    if (!key || seenKeys.has(key)) {
      return;
    }
    seenKeys.add(key);
    const folderCount = Array.isArray(collection?.folders) ? collection.folders.length : 0;
    defaultEntries.push({
      key,
      disableKey: key,
      addonBaseUrl: "",
      addonId: "",
      addonName: folderCount === 1 ? "1 folder" : `${folderCount} folders`,
      catalogId: collection.id,
      catalogName: collection.title,
      type: "collection",
      isCollection: true,
      collectionId: collection.id,
      isDisabled: false
    });
  });

  const entryByKey = new Map(defaultEntries.map((entry) => [entry.key, entry]));
  const defaultOrderKeys = defaultEntries.map((entry) => entry.key);
  const savedValid = (savedOrderKeys || []).filter(
    (key, index, array) => array.indexOf(key) === index && entryByKey.has(key)
  );
  const savedSet = new Set(savedValid);
  const effectiveOrder = [...savedValid, ...defaultOrderKeys.filter((key) => !savedSet.has(key))];

  function isEntryDisabled(entry) {
    return disabledSet.has(entry.disableKey) || disabledSet.has(entry.key);
  }

  return effectiveOrder
    .map((key) => entryByKey.get(key))
    .filter(Boolean)
    .map((entry, index, array) => ({
      ...entry,
      disableKey:
        disabledSet.has(entry.key) && !disabledSet.has(entry.disableKey)
          ? entry.key
          : entry.disableKey,
      isDisabled: isEntryDisabled(entry),
      canMoveUp: index > 0,
      canMoveDown: index < array.length - 1
    }));
}
