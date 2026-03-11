export function createContinueWatchingSection(items = []) {
  const wrap = document.createElement("div");
  wrap.className = "row";
  wrap.innerHTML = `<h2>Continue Watching</h2><p>${items.length} items</p>`;
  return wrap;
}
