export function createHeroCarousel(items = []) {
  const wrap = document.createElement("div");
  wrap.className = "row";
  wrap.innerHTML = `
    <h2>Hero</h2>
    <p>${items[0]?.name || "No featured content"}</p>
  `;
  return wrap;
}
