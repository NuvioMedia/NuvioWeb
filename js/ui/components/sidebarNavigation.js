export function createSidebarNavigation(items = []) {
  const node = document.createElement("div");
  node.className = "row";
  node.innerHTML = `<h2>Navigation</h2>`;
  items.forEach((item) => {
    const btn = document.createElement("div");
    btn.className = "card";
    btn.textContent = item.label || item.id || "Item";
    node.appendChild(btn);
  });
  return node;
}
