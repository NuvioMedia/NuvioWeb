export function createSubtitle({
  id,
  url,
  lang,
  addonName = null,
  addonLogo = null
}) {
  return {
    id,
    url,
    lang,
    addonName,
    addonLogo
  };
}
