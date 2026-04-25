function getAvplayApi() {
  const webapis = globalThis.webapis;
  const avplay = webapis?.avplay || webapis?.avPlay || globalThis.avplay || null;
  if (!avplay || typeof avplay.open !== "function") {
    return null;
  }
  return avplay;
}

function createEngine(name) {
  return {
    name,

    isSupported() {
      return Boolean(getAvplayApi());
    },

    getApi() {
      return getAvplayApi();
    }
  };
}

export const webosAvplayEngine = createEngine("webos-avplay");
export const tizenAvplayEngine = createEngine("tizen-avplay");

export function resolvePlatformAvplayEngine(platformName) {
  if (platformName === "tizen") {
    return tizenAvplayEngine;
  }
  return webosAvplayEngine;
}
