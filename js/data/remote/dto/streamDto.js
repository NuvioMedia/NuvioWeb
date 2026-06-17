export function mapStreamDto(dto = {}) {
  return {
    streams: Array.isArray(dto.streams) ? dto.streams : []
  };
}
