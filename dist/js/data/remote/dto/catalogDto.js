export function mapCatalogDto(dto = {}) {
  return {
    metas: Array.isArray(dto.metas) ? dto.metas : []
  };
}
