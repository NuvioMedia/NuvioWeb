export function createLoadingIndicator(text = "Loading...") {
  const node = document.createElement("div");
  node.className = "card";
  node.innerHTML = `<p>${text}</p>`;
  return node;
}
