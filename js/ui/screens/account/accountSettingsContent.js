export class AccountSettingsContent {

  constructor(container) {
    this.container = container;
    this.focusIndex = 0;
  }

  render(uiState, callbacks) {
    const { authState, syncOverview, isSyncOverviewLoading } = uiState;

    if (authState === "loading") {
      this.container.innerHTML = `<p class="text-secondary">Loading...</p>`;
      return;
    }

    if (authState === "signedOut") {
      this.container.innerHTML = `
        <p class="text-secondary">
          Sync your library and preferences across devices.
        </p>

        ${this.renderActionButton(
          "assets/icons/trakt_tv_glyph.svg",
          "Sign in with QR",
          "Scan a QR code to link this device",
          "signin"
        )}
      `;

      this.attachFocus(callbacks);
      return;
    }

    if (authState === "authenticated") {
      this.container.innerHTML = `
        ${this.renderStatusCard(uiState.email)}

        ${syncOverview
          ? this.renderSyncOverview(syncOverview)
          : isSyncOverviewLoading
            ? this.renderSyncLoading()
            : ""
        }

        ${this.renderSignOut()}
      `;

      this.attachFocus(callbacks);
    }
  }

  renderActionButton(icon, title, subtitle, action) {
    const iconHtml = String(icon || "").startsWith("assets/")
      ? `<img class="icon-img" src="${icon}" alt="" aria-hidden="true" />`
      : `<span class="icon">${icon}</span>`;

    return `
      <div class="card focusable" data-action="${action}">
        <div class="card-row">
          ${iconHtml}
          <div class="card-text">
            <div class="card-title">${title}</div>
            <div class="card-subtitle">${subtitle}</div>
          </div>
        </div>
      </div>
    `;
  }

  renderStatusCard(email) {
    return `
      <div class="status-card">
        <span class="status-label">Signed in as</span>
        <strong>${email}</strong>
      </div>
    `;
  }

  renderSyncLoading() {
    return `
      <div class="sync-card">
        <p class="text-secondary">Loading sync overview...</p>
      </div>
    `;
  }

  renderSyncOverview(overview) {
    return `
      <div class="sync-card">
        ${this.renderTotalRow(overview)}
        ${overview.perProfile.map((p) => this.renderProfileRow(p)).join("")}
      </div>
    `;
  }

  renderTotalRow(overview) {
    return `
      <div class="profile-row total">
        ${this.renderStat(overview.totalAddons, "addons")}
        ${this.renderStat(overview.totalPlugins, "plugins")}
        ${this.renderStat(overview.totalLibrary, "library")}
        ${this.renderStat(overview.totalWatchProgress, "progress")}
        ${this.renderStat(overview.totalWatchedItems, "watched")}
      </div>
    `;
  }

  renderProfileRow(profile) {
    return `
      <div class="profile-row">
        <div class="avatar" style="background:${profile.avatarColorHex}">
          ${profile.profileName.charAt(0)}
        </div>
        <div class="profile-name">${profile.profileName}</div>
        ${this.renderStat(profile.addons, "addons")}
        ${this.renderStat(profile.plugins, "plugins")}
        ${this.renderStat(profile.library, "library")}
        ${this.renderStat(profile.watchProgress, "progress")}
        ${this.renderStat(profile.watchedItems, "watched")}
      </div>
    `;
  }

  renderStat(value, label) {
    return `
      <div class="stat">
        <span class="stat-value">${value}</span>
        <span class="stat-label">${label}</span>
      </div>
    `;
  }

  renderSignOut() {
    return `
      <div class="card focusable danger" data-action="logout">
        <div class="card-row">
          <img class="icon-img" src="assets/icons/ic_chevron_compact_left.png" alt="" aria-hidden="true" />
          <div class="card-title">Sign Out</div>
        </div>
      </div>
    `;
  }

  attachFocus(callbacks) {
    const items = this.container.querySelectorAll(".focusable");

    items.forEach((el, i) => {
      el.dataset.index = i;
    });

    items[0]?.classList.add("focused");

    this.container.onkeydown = (event) => {
      const current = this.container.querySelector(".focused");
      if (!current) return;

      const index = parseInt(current.dataset.index, 10);

      if (event.keyCode === 40) {
        this.moveFocus(items, index + 1);
      }

      if (event.keyCode === 38) {
        this.moveFocus(items, index - 1);
      }

      if (event.keyCode === 13) {
        const action = current.dataset.action;
        callbacks?.[action]?.();
      }
    };
  }

  moveFocus(items, newIndex) {
    if (newIndex < 0 || newIndex >= items.length) return;

    const current = this.container.querySelector(".focused");
    current?.classList.remove("focused");

    items[newIndex].classList.add("focused");
  }

}
