export const NextEpisodeOverlay = {
  show(container, label = "Next episode available") {
    if (!container) return;
    const node = document.createElement("div");
    node.id = "nextEpisodeOverlay";
    node.className = "card";
    node.style.position = "absolute";
    node.style.left = "40px";
    node.style.bottom = "40px";
    node.textContent = label;
    container.appendChild(node);
  },
  hide(container) {
    container?.querySelector("#nextEpisodeOverlay")?.remove();
  }
};
