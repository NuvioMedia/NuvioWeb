function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function chevronSvg(open, className) {
  return `
    <svg viewBox="0 0 24 24" class="${className}" aria-hidden="true" focusable="false">
      <path d="${open ? "M6 14l6-6 6 6" : "M6 10l6 6 6-6"}"
            fill="none"
            stroke="currentColor"
            stroke-width="2.75"
            stroke-linecap="round"
            stroke-linejoin="round" />
    </svg>
  `;
}

function joinClasses(...values) {
  return values.filter(Boolean).join(" ");
}

export function renderFilterPicker({
  picker,
  title,
  value,
  options = [],
  open = false,
  focusIndex = 0,
  widthClass = "",
  classPrefix = "library-picker",
  wrapperExtraClass = "",
  anchorExtraClass = "",
  menuExtraClass = "",
  optionExtraClass = "",
  focusedOptionClass = "",
  selectedOptionClass = "",
  targetOptionClass = "",
  anchorAction = "togglePicker",
  optionAction = "selectPickerOption",
  optionFocusable = true,
  selectedIndex = -1
} = {}) {
  const normalizedFocusIndex = Number.isFinite(Number(focusIndex)) ? Number(focusIndex) : 0;
  const normalizedSelectedIndex = Number.isFinite(Number(selectedIndex)) ? Number(selectedIndex) : -1;
  const wrapperClassName = joinClasses(
    classPrefix,
    open ? "open" : "",
    widthClass,
    wrapperExtraClass
  );
  const anchorClassName = joinClasses(`${classPrefix}-anchor`, "focusable", anchorExtraClass);
  const menuClassName = joinClasses(`${classPrefix}-menu`, menuExtraClass);
  const chevronClassName = `${classPrefix}-chevron`;

  return `
    <div class="${wrapperClassName}">
      <button class="${anchorClassName}"
              data-action="${escapeHtml(anchorAction)}"
              data-picker="${escapeHtml(picker)}">
        <span class="${classPrefix}-copy">
          <span class="${classPrefix}-title">${escapeHtml(title)}</span>
          <span class="${classPrefix}-value">${escapeHtml(value)}</span>
        </span>
        <span class="${classPrefix}-icon">${chevronSvg(open, chevronClassName)}</span>
      </button>
      ${open ? `
        <div class="${menuClassName}" role="listbox" aria-label="${escapeHtml(title)}">
          ${options.map((option, index) => {
            const optionClassName = joinClasses(
              `${classPrefix}-option`,
              optionFocusable ? "focusable" : "",
              optionExtraClass,
              index === normalizedFocusIndex ? focusedOptionClass : "",
              index === normalizedFocusIndex ? targetOptionClass : "",
              index === normalizedSelectedIndex ? selectedOptionClass : ""
            );
            return `
              <button class="${optionClassName}"
                      data-action="${escapeHtml(optionAction)}"
                      data-picker="${escapeHtml(picker)}"
                      data-option-index="${index}"
                      role="option"
                      aria-selected="${index === normalizedSelectedIndex ? "true" : "false"}">
                ${escapeHtml(option?.label ?? option?.value ?? "")}
              </button>
            `;
          }).join("")}
        </div>
      ` : ""}
    </div>
  `;
}
