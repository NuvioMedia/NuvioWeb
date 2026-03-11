export const WebOSPlayerExtensions = {

  apply(videoElement) {
    if (!videoElement) {
      return;
    }

    videoElement.setAttribute("playsinline", "");
    videoElement.setAttribute("webkit-playsinline", "");
    videoElement.setAttribute("preload", "auto");
  }

};
