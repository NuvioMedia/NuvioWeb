/**
 * NuvioDialog — reusable dialog component matching ATV NuvioDialog.kt
 *
 * ATV source: ui/components/NuvioDialog.kt
 *
 * Specs (all dp→vw at 320dpi, 1920px screen = 960dp wide):
 *   Default width:    520dp = 54.2vw  (520/960)
 *   Options width:    360dp = 37.5vw  (360/960)
 *   Delete width:     420dp = 43.75vw (420/960)
 *   Corner radius:    16dp  = 32px
 *   Padding:          24dp  = 48px
 *   Border:           1dp   = 2px, color #333333
 *   Background:       #1A1A1A (BackgroundElevated)
 *   Scrim:            rgba(0,0,0,0.72)
 *   Column gap:       16dp  = 32px
 *   Title:            titleLarge → 20sp=40px, Medium(500), TextPrimary=#FFFFFF
 *   Subtitle:         bodyMedium → 14sp=28px, Normal(400), TextSecondary=#B3B3B3
 *
 * Enter: fadeIn(200ms) + scale(0.92→1.0, 280ms, FastOutSlowIn)
 * Exit:  fadeOut(150ms) + scale(1.0→0.94, 150ms, ease-in)
 *
 * Button specs (ATV TV Material3 Button defaults):
 *   Shape:              pill (border-radius: 999px)
 *   Padding:            16dp v, 20dp h = 32px / 40px
 *   Unfocused bg:       #242424 (BackgroundCard), text #FFFFFF
 *   Focused bg:         #F5F5F5 (Secondary), text #111111
 *   Danger unfocused:   #4A2323, text #FFFFFF
 *   Danger focused:     #FF5252, text #FFFFFF
 *   Transition:         200ms cubic-bezier(0.22,1,0.36,1)
 *
 * Usage:
 *   const dialog = new NuvioDialog({
 *     title: 'Profile Options',
 *     widthVw: 37.5,       // vw, optional (default 54.2vw = 520dp)
 *     subtitle: '...',     // optional
 *     onDismiss: () => {}, // called on backdrop click or Escape
 *     buttons: [
 *       { label: 'Edit',    key: 'edit',   onAction: () => {} },
 *       { label: 'Delete',  key: 'delete', danger: true, onAction: () => {} },
 *     ]
 *   });
 *   dialog.mount(document.body);   // appends backdrop+dialog to element
 *   dialog.destroy();              // animated exit then removes from DOM
 */

export class NuvioDialog {
  constructor({ title, subtitle = null, widthVw = 54.2, buttons = [], onDismiss = null }) {
    this.title = title;
    this.subtitle = subtitle;
    this.widthVw = widthVw;
    this.buttons = buttons;
    this.onDismiss = onDismiss;

    this._focusedIndex = 0;
    this._destroyed = false;
    this._backdrop = null;
    this._panel = null;
    this._buttonEls = [];
    this._keyHandler = this._onKey.bind(this);
  }

  mount(container = document.body) {
    // Backdrop
    const backdrop = document.createElement("div");
    backdrop.className = "nuvio-dialog-backdrop";
    backdrop.setAttribute("aria-modal", "true");
    backdrop.setAttribute("role", "dialog");

    // Panel
    const panel = document.createElement("div");
    panel.className = "nuvio-dialog-panel";
    panel.style.maxWidth = `${this.widthVw}vw`;

    // Title
    const titleEl = document.createElement("div");
    titleEl.className = "nuvio-dialog-title";
    titleEl.textContent = this.title;
    panel.appendChild(titleEl);

    // Optional subtitle
    if (this.subtitle) {
      const subtitleEl = document.createElement("div");
      subtitleEl.className = "nuvio-dialog-subtitle";
      subtitleEl.textContent = this.subtitle;
      panel.appendChild(subtitleEl);
    }

    // Buttons
    if (this.buttons.length > 0) {
      const actions = document.createElement("div");
      actions.className = "nuvio-dialog-actions";

      this.buttons.forEach((btn, i) => {
        const el = document.createElement("button");
        el.className = "nuvio-dialog-button" + (btn.danger ? " nuvio-dialog-button-danger" : "");
        el.textContent = btn.label;
        el.dataset.key = btn.key || String(i);
        el.addEventListener("click", () => {
          if (btn.onAction) btn.onAction();
        });
        actions.appendChild(el);
        this._buttonEls.push(el);
      });

      panel.appendChild(actions);
    }

    backdrop.appendChild(panel);
    container.appendChild(backdrop);

    this._backdrop = backdrop;
    this._panel = panel;

    // Dismiss on backdrop click (outside panel)
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) this._dismiss();
    });

    // Keyboard navigation
    window.addEventListener("keydown", this._keyHandler, { capture: true });

    // Focus first button after 2 frames (matches ATV LaunchedEffect repeat(2) { withFrameNanos })
    requestAnimationFrame(() => requestAnimationFrame(() => this._focusIndex(0)));

    // Trigger enter animation
    requestAnimationFrame(() => {
      backdrop.classList.add("nuvio-dialog-backdrop-enter");
      panel.classList.add("nuvio-dialog-panel-enter");
    });

    return this;
  }

  _focusIndex(i) {
    if (this._buttonEls.length === 0) return;
    const clamped = Math.max(0, Math.min(i, this._buttonEls.length - 1));
    this._focusedIndex = clamped;
    this._buttonEls.forEach((el, idx) => {
      el.classList.toggle("focused", idx === clamped);
    });
    this._buttonEls[clamped]?.focus({ preventScroll: true });
  }

  _onKey(e) {
    if (this._destroyed) return;
    const key = e.key;

    if (key === "Escape" || key === "Backspace" || key === "GoBack") {
      e.preventDefault();
      e.stopPropagation();
      this._dismiss();
      return;
    }

    if (key === "ArrowDown" || key === "ArrowRight") {
      e.preventDefault();
      e.stopPropagation();
      this._focusIndex(this._focusedIndex + 1);
      return;
    }

    if (key === "ArrowUp" || key === "ArrowLeft") {
      e.preventDefault();
      e.stopPropagation();
      this._focusIndex(this._focusedIndex - 1);
      return;
    }

    if (key === "Enter" || key === " ") {
      e.preventDefault();
      e.stopPropagation();
      const btn = this.buttons[this._focusedIndex];
      if (btn?.onAction) btn.onAction();
      return;
    }
  }

  _dismiss() {
    if (this._destroyed) return;
    if (this.onDismiss) this.onDismiss();
    this.destroy();
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    window.removeEventListener("keydown", this._keyHandler, { capture: true });

    const backdrop = this._backdrop;
    const panel = this._panel;
    if (!backdrop) return;

    // Exit animation
    backdrop.classList.remove("nuvio-dialog-backdrop-enter");
    panel.classList.remove("nuvio-dialog-panel-enter");
    backdrop.classList.add("nuvio-dialog-backdrop-exit");
    panel.classList.add("nuvio-dialog-panel-exit");

    // Remove after animation completes (150ms exit)
    setTimeout(() => backdrop.remove(), 200);
  }
}
