const APP_LOADING_LOGO_SRC = "assets/brand/app_logo_wordmark.png";

function escapeAttribute(value = "") {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function renderLogoLoadingMarkup(options = {}) {
  const className = String(options?.className || "").trim();
  const label = String(options?.label || "Loading").trim() || "Loading";
  return `
    <div class="app-loading-screen${className ? ` ${escapeAttribute(className)}` : ""}" aria-label="${escapeAttribute(label)}">
      <img src="${APP_LOADING_LOGO_SRC}" class="app-loading-logo" alt="Nuvio" />
    </div>
  `;
}

export function createLoadingIndicator(text = "Loading...") {
  const node = document.createElement("div");
  node.className = "card";
  node.innerHTML = `<p>${text}</p>`;
  return node;
}
