const STREAMING_LIBS = [
  {
    src: "https://cdn.jsdelivr.net/npm/hls.js@1.5.20/dist/hls.min.js",
    isLoaded: () => Boolean(globalThis.Hls)
  },
  {
    src: "https://cdn.jsdelivr.net/npm/dashjs@4.7.4/dist/dash.all.min.js",
    isLoaded: () => Boolean(globalThis.dashjs)
  }
];

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

export async function loadStreamingLibs() {
  for (const entry of STREAMING_LIBS) {
    if (entry.isLoaded()) {
      continue;
    }
    try {
      await loadScript(entry.src);
    } catch (error) {
      console.warn("Streaming library failed to load", entry.src, error);
    }
  }
}
