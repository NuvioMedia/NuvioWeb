export function createWatchProgress({
  contentId,
  contentType,
  videoId = null,
  positionMs = 0,
  durationMs = 0,
  updatedAt = Date.now()
}) {
  return {
    contentId,
    contentType,
    videoId,
    positionMs,
    durationMs,
    updatedAt
  };
}
