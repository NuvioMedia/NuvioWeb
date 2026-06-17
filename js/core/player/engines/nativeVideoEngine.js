export const nativeVideoEngine = {
  name: "native",

  canPlay(videoElement, mimeType) {
    if (!videoElement || !mimeType) {
      return false;
    }
    try {
      const result = String(videoElement.canPlayType(String(mimeType))).toLowerCase();
      return result === "probably" || result === "maybe";
    } catch (_) {
      return false;
    }
  },

  load(videoElement, url, mimeType = null) {
    if (!videoElement) {
      return false;
    }
    videoElement.removeAttribute("src");
    Array.from(videoElement.querySelectorAll("source")).forEach((node) => node.remove());
    if (mimeType) {
      const sourceNode = document.createElement("source");
      sourceNode.src = url;
      sourceNode.type = mimeType;
      videoElement.appendChild(sourceNode);
    } else {
      videoElement.src = url;
    }
    videoElement.load();
    return true;
  }
};
