function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function chevronSvg(open, className) {
  const path = open
    ? "M7.41 15.41 12 10.83l4.59 4.58L18 14l-6-6-6 6z"
    : "M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z";
  return `
    <svg viewBox="0 0 24 24" class="${className}" aria-hidden="true" focusable="false">
      <path d="${path}" fill="currentColor" />
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
  closing = false,
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
    closing ? "closing" : "",
    widthClass,
    wrapperExtraClass
  );
  const anchorClassName = joinClasses(`${classPrefix}-anchor`, "focusable", anchorExtraClass);
  const menuClassName = joinClasses(
    `${classPrefix}-menu`,
    open ? `${classPrefix}-menu-open` : "",
    closing ? `${classPrefix}-menu-closing` : "",
    menuExtraClass
  );
  const chevronClassName = `${classPrefix}-chevron`;
  const shouldRenderMenu = open || closing;
  const canFocusOptions = optionFocusable && open;
  const shouldHighlightClosingOption = open || closing;

  return `
    <div class="${wrapperClassName}">
      <div class="${anchorClassName}"
           data-action="${escapeHtml(anchorAction)}"
           data-picker="${escapeHtml(picker)}"
           role="button"
           aria-haspopup="listbox"
           aria-expanded="${open ? "true" : "false"}"
           tabindex="-1">
        <span class="${classPrefix}-copy">
          <span class="${classPrefix}-title">${escapeHtml(title)}</span>
          <span class="${classPrefix}-value">${escapeHtml(value)}</span>
        </span>
        <span class="${classPrefix}-icon">${chevronSvg(open, chevronClassName)}</span>
      </div>
      ${shouldRenderMenu ? `
        <div class="${menuClassName}" role="listbox" aria-label="${escapeHtml(title)}" aria-hidden="${open ? "false" : "true"}">
          ${options.map((option, index) => {
            const isActiveOption = shouldHighlightClosingOption && index === normalizedFocusIndex;
            const optionClassName = joinClasses(
              `${classPrefix}-option`,
              canFocusOptions ? "focusable" : "",
              optionExtraClass,
              isActiveOption ? focusedOptionClass : "",
              isActiveOption ? targetOptionClass : "",
              index === normalizedSelectedIndex ? selectedOptionClass : ""
            );
            return `
              <div class="${optionClassName}"
                   data-action="${escapeHtml(optionAction)}"
                   data-picker="${escapeHtml(picker)}"
                   data-option-index="${index}"
                   role="option"
                   aria-selected="${index === normalizedSelectedIndex ? "true" : "false"}"
                   tabindex="-1">
                ${escapeHtml(option?.label ?? option?.value ?? "")}
              </div>
            `;
          }).join("")}
        </div>
      ` : ""}
    </div>
  `;
}

export function renderContentFilterPicker({
  variant = "library",
  widthClass = "library-picker-flex",
  anchorAction,
  targetOptionClass,
  ...config
} = {}) {
  const isDiscover = variant === "discover";
  return renderFilterPicker({
    widthClass,
    classPrefix: "library-picker",
    anchorExtraClass: isDiscover ? "library-primary discover-filter" : "library-primary",
    wrapperExtraClass: isDiscover ? "discover-filter-shell" : "",
    menuExtraClass: "",
    optionExtraClass: "",
    focusedOptionClass: "focused",
    selectedOptionClass: "selected",
    targetOptionClass: targetOptionClass || "library-picker-option-target",
    anchorAction: anchorAction || "togglePicker",
    optionFocusable: true,
    ...config
  });
}
