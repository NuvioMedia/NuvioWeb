function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

export function renderHoldMenuMarkup(config = {}) {
  const options = Array.isArray(config.options) ? config.options : [];
  const focusedIndex = Math.max(0, Math.min(options.length - 1, Number(config.focusedIndex || 0)));
  const kicker = String(config.kicker || "").trim();
  const title = String(config.title || "Untitled").trim() || "Untitled";
  const subtitle = String(config.subtitle || "").trim();
  if (!options.length) {
    return "";
  }
  return `
    <div class="hold-menu-backdrop">
      <section class="hold-menu" role="dialog" aria-modal="true">
        <div class="hold-menu-header">
          ${kicker ? `<div class="hold-menu-kicker">${escapeHtml(kicker)}</div>` : ""}
          <h3 class="hold-menu-title">${escapeHtml(title)}</h3>
          ${subtitle ? `<p class="hold-menu-subtitle">${escapeHtml(subtitle)}</p>` : ""}
        </div>
        <div class="hold-menu-actions">
          ${options.map((option, index) => `
            <button class="hold-menu-button focusable${index === focusedIndex ? " focused" : ""}${option.danger ? " danger" : ""}"
                    data-action="holdMenuAction"
                    data-hold-action="${escapeAttribute(option.action || "")}"
                    data-hold-index="${index}">
              ${escapeHtml(option.label || option.action || "Option")}
            </button>
          `).join("")}
        </div>
      </section>
    </div>
  `;
}
