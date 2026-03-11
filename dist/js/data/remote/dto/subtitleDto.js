export function mapSubtitleDto(dto = {}) {
  return {
    subtitles: Array.isArray(dto.subtitles) ? dto.subtitles : []
  };
}
