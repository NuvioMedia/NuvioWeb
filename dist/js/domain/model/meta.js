export function createMeta({
  id,
  type,
  name,
  poster = null,
  background = null,
  logo = null,
  description = "",
  genres = [],
  videos = [],
  releaseInfo = ""
}) {
  return {
    id,
    type,
    name,
    poster,
    background,
    logo,
    description,
    genres,
    videos,
    releaseInfo
  };
}
