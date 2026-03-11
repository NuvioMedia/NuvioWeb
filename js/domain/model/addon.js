export function createAddon({
  id,
  name,
  displayName = name,
  version = "0.0.0",
  description = null,
  logo = null,
  baseUrl,
  catalogs = [],
  types = [],
  rawTypes = null,
  resources = []
}) {
  return {
    id,
    name,
    displayName,
    version,
    description,
    logo,
    baseUrl,
    catalogs,
    types,
    rawTypes: rawTypes || [...types],
    resources
  };
}
