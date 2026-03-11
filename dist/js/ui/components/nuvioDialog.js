export function createNuvioDialog({ title, message, actions = [] }) {
  const node = document.createElement("div");
  node.className = "card";
  const actionsHtml = actions.map((action) => `<button>${action.label}</button>`).join("");
  node.innerHTML = `
    <h3>${title || "Dialog"}</h3>
    <p>${message || ""}</p>
    <div>${actionsHtml}</div>
  `;
  return node;
}
