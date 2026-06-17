export function createStream({
  name = null,
  title = null,
  description = null,
  url = null,
  ytId = null,
  infoHash = null,
  fileIdx = null,
  externalUrl = null,
  behaviorHints = null,
  addonName = null,
  addonLogo = null
}) {
  return {
    name,
    title,
    description,
    url,
    ytId,
    infoHash,
    fileIdx,
    externalUrl,
    behaviorHints,
    addonName,
    addonLogo
  };
}
