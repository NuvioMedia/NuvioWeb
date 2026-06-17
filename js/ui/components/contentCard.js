export function createContentCard(item) {
  const node = document.createElement("div");
  node.className = "card";
  node.innerHTML = `
    <div style="font-weight:700;">${item?.name || "Untitled"}</div>
    <div style="opacity:0.8;">${item?.type || "-"}</div>
  `;
  return node;
}
