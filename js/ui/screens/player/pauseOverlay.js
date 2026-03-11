export const PauseOverlay = {
  show(container, text = "Paused") {
    if (!container) return;
    const node = document.createElement("div");
    node.id = "pauseOverlay";
    node.className = "card";
    node.style.position = "absolute";
    node.style.right = "40px";
    node.style.bottom = "40px";
    node.textContent = text;
    container.appendChild(node);
  },
  hide(container) {
    container?.querySelector("#pauseOverlay")?.remove();
  }
};
