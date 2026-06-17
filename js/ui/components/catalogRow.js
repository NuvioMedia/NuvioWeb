import { createContentCard } from "./contentCard.js";

export function createCatalogRow(title, items = []) {
  const wrap = document.createElement("div");
  wrap.className = "row";
  wrap.innerHTML = `<h2>${title}</h2>`;
  items.forEach((item) => wrap.appendChild(createContentCard(item)));
  return wrap;
}
