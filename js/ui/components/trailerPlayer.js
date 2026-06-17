export const TrailerPlayer = {
  mount(container, url) {
    if (!container) return;
    const video = document.createElement("video");
    video.src = url || "";
    video.muted = true;
    video.autoplay = true;
    video.loop = true;
    video.playsInline = true;
    video.style.width = "100%";
    container.appendChild(video);
    return video;
  }
};
