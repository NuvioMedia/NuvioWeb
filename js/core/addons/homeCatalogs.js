export function isSearchOnlyCatalog(catalog) {
  return Array.isArray(catalog?.extra) && catalog.extra.some((entry) =>
    String(entry?.name || "").toLowerCase() === "search" && Boolean(entry?.isRequired)
  );
}

export function buildCatalogOrderKey(addonId, type, catalogId) {
  return `${addonId}_${type}_${catalogId}`;
}

export function buildCatalogDisableKey(addonBaseUrl, type, catalogId, catalogName) {
  return `${addonBaseUrl}_${type}_${catalogId}_${catalogName}`;
}

export function toDisplayTypeLabel(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

export function buildOrderedCatalogItems(addons, savedOrderKeys = [], disabledKeys = []) {
  const defaultEntries = [];
  const seenKeys = new Set();
  const disabledSet = new Set(disabledKeys || []);

  (addons || []).forEach((addon) => {
    (addon.catalogs || [])
      .filter((catalog) => !isSearchOnlyCatalog(catalog))
      .forEach((catalog) => {
        const key = buildCatalogOrderKey(addon.id, catalog.apiType, catalog.id);
        if (seenKeys.has(key)) {
          return;
        }
        seenKeys.add(key);
        defaultEntries.push({
          key,
          disableKey: buildCatalogDisableKey(addon.baseUrl, catalog.apiType, catalog.id, catalog.name),
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

  const entryByKey = new Map(defaultEntries.map((entry) => [entry.key, entry]));
  const defaultOrderKeys = defaultEntries.map((entry) => entry.key);
  const savedValid = (savedOrderKeys || [])
    .filter((key, index, array) => array.indexOf(key) === index && entryByKey.has(key));
  const savedSet = new Set(savedValid);
  const effectiveOrder = [...savedValid, ...defaultOrderKeys.filter((key) => !savedSet.has(key))];

  return effectiveOrder
    .map((key) => entryByKey.get(key))
    .filter(Boolean)
    .map((entry, index, array) => ({
      ...entry,
      isDisabled: disabledSet.has(entry.disableKey),
      canMoveUp: index > 0,
      canMoveDown: index < array.length - 1
    }));
}
