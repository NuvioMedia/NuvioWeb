import { Router } from "../../ui/navigation/router.js";
import { ProfileManager } from "../../core/profile/profileManager.js";
import { ProfileSyncService } from "../../core/profile/profileSyncService.js";
import { StartupSyncService } from "../../core/profile/startupSyncService.js";
import { ScreenUtils } from "../../ui/navigation/screen.js";
import { AvatarRepository } from "../../data/remote/supabase/avatarRepository.js";

const PINNED_AVATAR_CATEGORIES = ["anime", "animation", "tv", "movie", "gaming"];
const DEFAULT_PROFILE_COLOR = "#1E88E5";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function getProfileInitial(name) {
  const trimmed = String(name || "").trim();
  return trimmed ? trimmed.charAt(0).toUpperCase() : "?";
}

function clampChannel(value) {
  return Math.min(255, Math.max(0, Math.round(value)));
}

function parseHexColor(colorHex, fallback = { r: 30, g: 136, b: 229 }) {
  const value = String(colorHex || "").trim();
  const match = value.match(/^#([0-9a-f]{6})$/i);
  if (!match) {
    return fallback;
  }
  const normalized = match[1];
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16)
  };
}

function mixColors(baseColor, accentColor, weight) {
  const normalizedWeight = Math.min(1, Math.max(0, Number(weight) || 0));
  return {
    r: clampChannel((baseColor.r * (1 - normalizedWeight)) + (accentColor.r * normalizedWeight)),
    g: clampChannel((baseColor.g * (1 - normalizedWeight)) + (accentColor.g * normalizedWeight)),
    b: clampChannel((baseColor.b * (1 - normalizedWeight)) + (accentColor.b * normalizedWeight))
  };
}

function colorToRgba(color, alpha = 1) {
  const normalizedAlpha = Math.min(1, Math.max(0, Number(alpha) || 0));
  return `rgba(${clampChannel(color.r)}, ${clampChannel(color.g)}, ${clampChannel(color.b)}, ${normalizedAlpha})`;
}

function categoryLabel(category) {
  switch (String(category || "").toLowerCase()) {
    case "all":
      return "All";
    case "anime":
      return "Anime";
    case "animation":
      return "Animation";
    case "movie":
      return "Movie";
    case "tv":
      return "TV";
    case "gaming":
      return "Gaming";
    default:
      return String(category || "Other").replace(/^./, (match) => match.toUpperCase());
  }
}

function getAvatarCategories(avatars) {
  const normalizedCategories = (Array.isArray(avatars) ? avatars : [])
    .map((avatar) => String(avatar?.category || "").trim().toLowerCase())
    .filter(Boolean);
  const uniqueCategories = Array.from(new Set(normalizedCategories));
  return [
    "all",
    ...PINNED_AVATAR_CATEGORIES.filter((category) => uniqueCategories.includes(category)),
    ...uniqueCategories
      .filter((category) => !PINNED_AVATAR_CATEGORIES.includes(category))
      .sort((left, right) => left.localeCompare(right))
  ];
}

function isTextInput(node) {
  if (!node) {
    return false;
  }
  const tagName = String(node.tagName || "").toLowerCase();
  return tagName === "input" || tagName === "textarea";
}

export const ProfileSelectionScreen = {

  async mount(params = {}) {
    this.container = document.getElementById("profileSelection");
    if (!this.container) {
      console.error("Missing #profileSelection container");
      return;
    }

    this.container.style.display = "block";
    this.screenMode = String(params?.mode || "selection").toLowerCase();
    this.returnRoute = String(params?.returnRoute || "");
    this.isManagementMode = this.screenMode === "management";
    this.activeProfileId = String(ProfileManager.getActiveProfileId() || "1");
    this.focusKey = "";
    this.pendingFocusKey = "";
    this.lastProfileFocusKey = "profile:1";
    this.optionsProfileId = null;
    this.deleteProfileId = null;
    this.editorState = null;
    this.avatarCatalog = [];

    await ProfileSyncService.pull();
    this.profiles = await ProfileManager.getProfiles();
    this.lastProfileFocusKey = `profile:${this.activeProfileId || "1"}`;
    if (!this.isManagementMode && this.profiles.length === 1) {
      await this.activateProfile(this.profiles[0].id);
      return;
    }

    await this.loadAvatarCatalog();
    this.render();
  },

  async loadAvatarCatalog() {
    try {
      this.avatarCatalog = await AvatarRepository.getAvatarCatalog();
    } catch (error) {
      console.warn("Failed to load avatar catalog", error);
      this.avatarCatalog = [];
    }
    this.avatarImageUrlsById = this.avatarCatalog.reduce((accumulator, avatar) => {
      accumulator[avatar.id] = avatar.imageUrl;
      return accumulator;
    }, {});
  },

  getProfileById(profileId) {
    return (this.profiles || []).find((profile) => String(profile.id) === String(profileId)) || null;
  },

  getVisibleProfiles() {
    return Array.isArray(this.profiles) ? this.profiles : [];
  },

  getAvatarImageUrl(avatarId) {
    const normalizedId = String(avatarId || "").trim();
    if (!normalizedId) {
      return null;
    }
    return this.avatarImageUrlsById?.[normalizedId] || null;
  },

  getEditorSelectedAvatar() {
    if (!this.editorState?.selectedAvatarId) {
      return null;
    }
    return this.avatarCatalog.find((avatar) => avatar.id === this.editorState.selectedAvatarId) || null;
  },

  getFilteredEditorAvatars() {
    const category = String(this.editorState?.category || "all");
    if (category === "all") {
      return this.avatarCatalog;
    }
    return this.avatarCatalog.filter((avatar) => avatar.category === category);
  },

  render() {
    const canAddProfile = this.isManagementMode && this.getVisibleProfiles().length < 4;
    const title = this.isManagementMode ? "Manage Profiles" : "Who's watching?";
    const subtitle = this.isManagementMode
      ? "Select a profile to edit, switch, or create a new one"
      : "Select a profile to continue";
    const hint = this.isManagementMode
      ? "Select a profile to manage"
      : "Hold to manage profile";

    this.container.innerHTML = `
      <div class="profile-screen">
        <img src="assets/brand/app_logo_wordmark.png" class="profile-logo" alt="Nuvio"/>

        <h1 class="profile-title">${escapeHtml(title)}</h1>
        <p class="profile-subtitle">${escapeHtml(subtitle)}</p>

        <div class="profile-grid" id="profileGrid">
          ${this.getVisibleProfiles().map((profile) => this.renderProfileCard(profile)).join("")}
          ${canAddProfile ? this.renderAddProfileCard() : ""}
        </div>

        <p class="profile-hint">${escapeHtml(hint)}</p>
      </div>
      ${this.renderEditorOverlay()}
      ${this.renderOptionsDialog()}
      ${this.renderDeleteDialog()}
    `;

    this.bindEvents();
    this.restoreFocus();
  },

  renderProfileCard(profile) {
    const avatarUrl = this.getAvatarImageUrl(profile.avatarId);
    return `
      <div class="profile-card profile-focusable focusable"
           data-profile-id="${escapeHtml(profile.id)}"
           data-focus-key="profile:${escapeHtml(profile.id)}"
           tabindex="0">
        <div class="profile-avatar-ring">
          <div class="profile-avatar" style="background:${escapeHtml(profile.avatarColorHex || DEFAULT_PROFILE_COLOR)}">
            ${avatarUrl
              ? `<img class="profile-avatar-image" src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(profile.name)}"/>`
              : escapeHtml(getProfileInitial(profile.name))}
          </div>
          ${profile.isPrimary ? `<span class="profile-primary-dot" aria-hidden="true">&#9733;</span>` : ""}
        </div>
        <div class="profile-name">${escapeHtml(profile.name)}</div>
        ${profile.isPrimary ? `<div class="profile-badge">PRIMARY</div>` : `<div class="profile-badge-slot" aria-hidden="true"></div>`}
      </div>
    `;
  },

  renderAddProfileCard() {
    return `
      <div class="profile-card profile-card-add profile-focusable focusable"
           data-profile-id="add"
           data-focus-key="profile:add"
           tabindex="0">
        <div class="profile-avatar-ring">
          <div class="profile-avatar profile-avatar-add" aria-hidden="true"></div>
        </div>
        <div class="profile-name">Add Profile</div>
        <div class="profile-badge-slot" aria-hidden="true"></div>
      </div>
    `;
  },

  renderEditorOverlay() {
    if (!this.editorState) {
      return "";
    }

    const editorTitle = this.editorState.mode === "edit" ? "Edit Profile" : "Create Profile";
    const editorButtonLabel = this.editorState.mode === "edit" ? "Save" : "Create";
    const previewName = String(this.editorState.name || "").trim() || "Profile name";
    const selectedAvatar = this.getEditorSelectedAvatar();
    const previewAvatarUrl = selectedAvatar?.imageUrl || this.getAvatarImageUrl(this.editorState.selectedAvatarId) || null;
    const overlayHeading = this.editorState.mode === "edit"
      ? `
          <div class="profile-editor-heading-stack">
            <span class="profile-editor-heading-kicker">${escapeHtml(editorTitle)}</span>
            <span class="profile-editor-heading-name">${escapeHtml(this.editorState.originalName || previewName)}</span>
          </div>
        `
      : `<span class="profile-editor-heading-title">${escapeHtml(editorTitle)}</span>`;
    const categories = getAvatarCategories(this.avatarCatalog);
    const filteredAvatars = this.getFilteredEditorAvatars();

    return `
      <div class="profile-editor-backdrop" data-action="dismiss-overlay">
        <div class="profile-editor-panel" data-overlay-root="editor">
          <div class="profile-editor-header">
            ${overlayHeading}
            <button class="profile-overlay-button profile-overlay-button-primary profile-overlay-focusable${this.isEditorSubmitDisabled() ? " is-disabled" : ""}"
                    type="button"
                    data-action="submit-editor"
                    data-focus-key="editor:submit"
                    ${this.isEditorSubmitDisabled() ? "disabled" : ""}
                    tabindex="0">
              ${escapeHtml(editorButtonLabel)}
            </button>
          </div>

          <div class="profile-editor-body">
            <div class="profile-editor-preview">
              <div class="profile-editor-preview-avatar" style="background:${escapeHtml(this.editorState.selectedColorHex || DEFAULT_PROFILE_COLOR)}">
                ${previewAvatarUrl
                  ? `<img class="profile-editor-preview-image" src="${escapeHtml(previewAvatarUrl)}" alt="${escapeHtml(previewName)}"/>`
                  : escapeHtml(getProfileInitial(previewName))}
              </div>

              <div class="profile-editor-preview-name${String(this.editorState.name || "").trim() ? "" : " is-placeholder"}" data-role="editor-preview-name">${escapeHtml(previewName)}</div>

              <label class="profile-editor-field-shell">
                <span class="sr-only">Profile name</span>
                <input class="profile-editor-name-input profile-overlay-focusable"
                       type="text"
                       maxlength="20"
                       value="${escapeHtml(this.editorState.name || "")}"
                       placeholder="Profile name"
                       data-role="editor-name-input"
                       data-focus-key="editor:name"
                       tabindex="0"/>
              </label>

              <button class="profile-overlay-button profile-overlay-button-secondary profile-overlay-focusable"
                      type="button"
                      data-action="cancel-editor"
                      data-focus-key="editor:cancel"
                      tabindex="0">
                Cancel
              </button>
            </div>

            <div class="profile-editor-divider" aria-hidden="true"></div>

            <div class="profile-editor-avatar-pane">
              <div class="profile-editor-avatar-title">Choose Avatar</div>

              <div class="profile-editor-category-row">
                ${categories.map((category) => `
                  <button class="profile-avatar-category profile-overlay-focusable${this.editorState.category === category ? " is-selected" : ""}"
                          type="button"
                          data-action="select-avatar-category"
                          data-category="${escapeHtml(category)}"
                          data-focus-key="editor:category:${escapeHtml(category)}"
                          tabindex="0">
                    ${escapeHtml(categoryLabel(category))}
                  </button>
                `).join("")}
              </div>

              ${filteredAvatars.length ? `
                <div class="profile-editor-avatar-grid">
                  ${filteredAvatars.map((avatar) => `
                    <button class="profile-avatar-tile profile-overlay-focusable${this.editorState.selectedAvatarId === avatar.id ? " is-selected" : ""}"
                            type="button"
                            data-action="select-avatar"
                            data-avatar-id="${escapeHtml(avatar.id)}"
                            data-focus-key="editor:avatar:${escapeHtml(avatar.id)}"
                            tabindex="0">
                      <img class="profile-avatar-tile-image" src="${escapeHtml(avatar.imageUrl)}" alt="${escapeHtml(avatar.displayName)}"/>
                    </button>
                  `).join("")}
                </div>
              ` : `
                <div class="profile-editor-avatar-empty">
                  Choose Avatar
                </div>
              `}

              <div class="profile-editor-avatar-hint" data-role="editor-avatar-hint">
                ${escapeHtml(this.editorState.focusedAvatarName || "Focus an avatar to view its name")}
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  },

  renderOptionsDialog() {
    const profile = this.getProfileById(this.optionsProfileId);
    if (!profile) {
      return "";
    }

    return `
      <div class="profile-dialog-backdrop" data-action="dismiss-options-dialog">
        <div class="profile-dialog profile-dialog-small" data-overlay-root="options">
          <div class="profile-dialog-title">Profile Options</div>
          <div class="profile-dialog-actions">
            <button class="profile-dialog-button profile-focusable focusable"
                    type="button"
                    data-action="open-edit-profile"
                    data-profile-id="${escapeHtml(profile.id)}"
                    data-focus-key="options:edit"
                    tabindex="0">
              Edit
            </button>
            ${profile.isPrimary ? "" : `
              <button class="profile-dialog-button profile-dialog-button-danger profile-focusable focusable"
                      type="button"
                      data-action="confirm-delete-profile"
                      data-profile-id="${escapeHtml(profile.id)}"
                      data-focus-key="options:delete"
                      tabindex="0">
                Delete
              </button>
            `}
          </div>
        </div>
      </div>
    `;
  },

  renderDeleteDialog() {
    const profile = this.getProfileById(this.deleteProfileId);
    if (!profile) {
      return "";
    }

    return `
      <div class="profile-dialog-backdrop" data-action="dismiss-delete-dialog">
        <div class="profile-dialog profile-dialog-medium" data-overlay-root="delete">
          <div class="profile-dialog-title">Delete Profile?</div>
          <p class="profile-dialog-subtitle">
            This will permanently delete this profile and all its data including library, watch history, and addon settings. This cannot be undone.
          </p>
          <div class="profile-dialog-actions">
            <button class="profile-dialog-button profile-dialog-button-danger profile-focusable focusable"
                    type="button"
                    data-action="delete-profile"
                    data-profile-id="${escapeHtml(profile.id)}"
                    data-focus-key="delete:confirm"
                    tabindex="0">
              Delete Profile
            </button>
          </div>
        </div>
      </div>
    `;
  },

  bindEvents() {
    const gridCards = Array.from(this.container.querySelectorAll(".profile-card"));
    gridCards.forEach((card) => {
      card.addEventListener("focus", () => this.handleFocusableFocus(card));
      card.addEventListener("click", async () => {
        await this.activateFocusedNode(card);
      });
    });

    Array.from(this.container.querySelectorAll(".profile-overlay-focusable, .profile-dialog-button")).forEach((node) => {
      node.addEventListener("focus", () => this.handleFocusableFocus(node));
      node.addEventListener("click", async (event) => {
        event.stopPropagation();
        await this.activateFocusedNode(node);
      });
    });

    const nameInput = this.container.querySelector("[data-role='editor-name-input']");
    if (nameInput) {
      nameInput.addEventListener("input", (event) => {
        const nextValue = String(event.target?.value || "").slice(0, 20);
        this.editorState.name = nextValue;
        if (event.target.value !== nextValue) {
          event.target.value = nextValue;
        }
        this.syncEditorPreview();
      });
    }

    const editorBackdrop = this.container.querySelector(".profile-editor-backdrop");
    if (editorBackdrop) {
      editorBackdrop.addEventListener("click", (event) => {
        if (event.target === editorBackdrop) {
          this.closeEditor();
        }
      });
    }

    Array.from(this.container.querySelectorAll(".profile-dialog-backdrop")).forEach((backdrop) => {
      backdrop.addEventListener("click", (event) => {
        if (event.target !== backdrop) {
          return;
        }
        if (backdrop.querySelector("[data-overlay-root='options']")) {
          this.closeOptionsDialog();
        } else {
          this.closeDeleteDialog();
        }
      });
    });
  },

  handleFocusableFocus(node) {
    Array.from(this.container.querySelectorAll(".profile-focusable.focused, .profile-overlay-focusable.focused")).forEach((entry) => {
      if (entry !== node) {
        entry.classList.remove("focused");
      }
    });
    node.classList.add("focused");
    this.focusKey = String(node.dataset.focusKey || "");

    const profileId = node.dataset.profileId;
    const avatarId = node.dataset.avatarId;
    const category = node.dataset.category;

    if (profileId && profileId !== "add") {
      const profile = this.getProfileById(profileId);
      if (profile) {
        this.lastProfileFocusKey = `profile:${profile.id}`;
        this.updateBackground(profile.avatarColorHex || DEFAULT_PROFILE_COLOR);
      }
    } else if (profileId === "add") {
      this.lastProfileFocusKey = "profile:add";
      this.updateBackground("#555555");
    }

    if (avatarId && this.editorState) {
      const avatar = this.avatarCatalog.find((entry) => entry.id === avatarId) || null;
      this.editorState.focusedAvatarName = avatar?.displayName || null;
      const hintNode = this.container.querySelector("[data-role='editor-avatar-hint']");
      if (hintNode) {
        hintNode.textContent = this.editorState.focusedAvatarName || "Focus an avatar to view its name";
      }
      node.scrollIntoView({ block: "nearest", inline: "nearest" });
    }

    if (category) {
      node.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  },

  restoreFocus() {
    const defaultFocusKey = this.getDefaultFocusKey();
    const target = this.findFocusableByKey(this.pendingFocusKey || defaultFocusKey || this.focusKey);
    this.pendingFocusKey = "";
    if (!target) {
      const fallback = this.container.querySelector(".profile-card, .profile-overlay-focusable, .profile-dialog-button");
      if (!fallback) {
        return;
      }
      fallback.classList.add("focused");
      fallback.focus();
      return;
    }
    target.classList.add("focused");
    target.focus();
  },

  getDefaultFocusKey() {
    if (this.deleteProfileId) {
      return "delete:confirm";
    }
    if (this.optionsProfileId) {
      return "options:edit";
    }
    if (this.editorState) {
      return "editor:name";
    }
    if (this.lastProfileFocusKey) {
      return this.lastProfileFocusKey;
    }
    if (this.focusKey) {
      return this.focusKey;
    }
    return `profile:${this.activeProfileId || "1"}`;
  },

  findFocusableByKey(focusKey) {
    if (!focusKey) {
      return null;
    }
    return Array.from(this.container.querySelectorAll("[data-focus-key]"))
      .find((node) => String(node.dataset.focusKey || "") === String(focusKey)) || null;
  },

  buildBackgroundStyle(colorHex) {
    const rootStyles = getComputedStyle(document.documentElement);
    const background = parseHexColor(rootStyles.getPropertyValue("--bg-color"), { r: 13, g: 13, b: 13 });
    const elevated = parseHexColor(rootStyles.getPropertyValue("--bg-elevated"), { r: 26, g: 26, b: 26 });
    const accent = parseHexColor(colorHex, parseHexColor(DEFAULT_PROFILE_COLOR));
    const gradientTop = mixColors(elevated, accent, 0.3);
    const gradientMid = mixColors(background, accent, 0.14);
    return `
      linear-gradient(180deg, ${colorToRgba(gradientTop, 1)} 0%, ${colorToRgba(gradientMid, 1)} 42%, ${colorToRgba(background, 1)} 100%),
      linear-gradient(90deg, ${colorToRgba(accent, 0.26)} 0%, ${colorToRgba(accent, 0.08)} 45%, rgba(0, 0, 0, 0) 72%, rgba(0, 0, 0, 0) 100%)
    `;
  },

  updateBackground(colorHex) {
    const screen = this.container?.querySelector(".profile-screen");
    if (!screen) {
      return;
    }
    screen.style.background = this.buildBackgroundStyle(colorHex);
  },

  syncEditorPreview() {
    if (!this.editorState) {
      return;
    }

    const previewName = String(this.editorState.name || "").trim() || "Profile name";
    const previewNameNode = this.container.querySelector("[data-role='editor-preview-name']");
    if (previewNameNode) {
      previewNameNode.textContent = previewName;
      previewNameNode.classList.toggle("is-placeholder", !String(this.editorState.name || "").trim());
    }

    const submitButton = this.container.querySelector("[data-action='submit-editor']");
    if (submitButton) {
      const disabled = this.isEditorSubmitDisabled();
      submitButton.disabled = disabled;
      submitButton.classList.toggle("is-disabled", disabled);
    }
  },

  isEditorSubmitDisabled() {
    return !String(this.editorState?.name || "").trim();
  },

  openCreateEditor() {
    this.optionsProfileId = null;
    this.deleteProfileId = null;
    this.editorState = {
      mode: "create",
      profileId: null,
      originalName: "",
      name: "",
      selectedColorHex: DEFAULT_PROFILE_COLOR,
      selectedAvatarId: null,
      baseColorHex: DEFAULT_PROFILE_COLOR,
      category: "all",
      focusedAvatarName: null
    };
    this.pendingFocusKey = "editor:name";
    this.render();
  },

  openEditEditor(profile) {
    if (!profile) {
      return;
    }
    this.optionsProfileId = null;
    this.deleteProfileId = null;
    this.editorState = {
      mode: "edit",
      profileId: String(profile.id),
      originalName: String(profile.name || ""),
      name: String(profile.name || ""),
      selectedColorHex: String(profile.avatarColorHex || DEFAULT_PROFILE_COLOR),
      selectedAvatarId: profile.avatarId || null,
      baseColorHex: String(profile.avatarColorHex || DEFAULT_PROFILE_COLOR),
      category: "all",
      focusedAvatarName: null
    };
    this.pendingFocusKey = "editor:name";
    this.render();
  },

  closeEditor() {
    this.editorState = null;
    this.pendingFocusKey = this.lastProfileFocusKey || "profile:1";
    this.render();
  },

  openOptionsDialog(profile) {
    if (!profile) {
      return;
    }
    this.editorState = null;
    this.deleteProfileId = null;
    this.optionsProfileId = String(profile.id);
    this.pendingFocusKey = "options:edit";
    this.render();
  },

  closeOptionsDialog() {
    const profileId = this.optionsProfileId;
    this.optionsProfileId = null;
    this.pendingFocusKey = profileId ? `profile:${profileId}` : (this.lastProfileFocusKey || "profile:1");
    this.render();
  },

  openDeleteDialog(profile) {
    if (!profile || profile.isPrimary) {
      return;
    }
    this.optionsProfileId = null;
    this.deleteProfileId = String(profile.id);
    this.pendingFocusKey = "delete:confirm";
    this.render();
  },

  closeDeleteDialog() {
    const profileId = this.deleteProfileId;
    this.deleteProfileId = null;
    this.pendingFocusKey = profileId ? `profile:${profileId}` : (this.lastProfileFocusKey || "profile:1");
    this.render();
  },

  async submitEditor() {
    if (!this.editorState || this.isEditorSubmitDisabled()) {
      return;
    }

    const editorState = { ...this.editorState };
    const trimmedName = String(editorState.name || "").trim();
    const focusProfileId = editorState.mode === "edit"
      ? editorState.profileId
      : String(this.getVisibleProfiles().reduce((max, profile) => Math.max(max, Number(profile.profileIndex || profile.id || 0)), 0) + 1);

    this.editorState = null;
    this.pendingFocusKey = `profile:${focusProfileId}`;
    this.render();

    let success = false;
    if (editorState.mode === "edit") {
      const existing = this.getProfileById(editorState.profileId);
      if (!existing) {
        await this.reloadProfiles();
        return;
      }
      success = await ProfileManager.updateProfile({
        ...existing,
        name: trimmedName,
        avatarColorHex: editorState.selectedColorHex || DEFAULT_PROFILE_COLOR,
        avatarId: editorState.selectedAvatarId || null
      });
    } else {
      success = await ProfileManager.createProfile({
        name: trimmedName,
        avatarColorHex: editorState.selectedColorHex || DEFAULT_PROFILE_COLOR,
        avatarId: editorState.selectedAvatarId || null
      });
    }

    if (success !== false) {
      await ProfileSyncService.push();
    }
    await this.reloadProfiles(`profile:${focusProfileId}`);
  },

  async deleteProfile(profileId) {
    const profile = this.getProfileById(profileId);
    if (!profile || profile.isPrimary) {
      return;
    }

    this.deleteProfileId = null;
    this.render();

    const deleted = await ProfileManager.deleteProfile(profile.id);
    if (deleted !== false) {
      await ProfileSyncService.push();
    }

    const remainingProfiles = await ProfileManager.getProfiles();
    const fallbackProfile = remainingProfiles.find((entry) => Number(entry.profileIndex || entry.id || 0) < Number(profile.profileIndex || profile.id || 0))
      || remainingProfiles[0]
      || null;
    this.profiles = remainingProfiles;
    this.pendingFocusKey = fallbackProfile ? `profile:${fallbackProfile.id}` : "";
    this.render();
  },

  async reloadProfiles(focusKey = "") {
    this.profiles = await ProfileManager.getProfiles();
    this.activeProfileId = String(ProfileManager.getActiveProfileId() || this.activeProfileId || "1");
    this.pendingFocusKey = focusKey;
    this.render();
  },

  async activateFocusedNode(node) {
    const action = String(node?.dataset?.action || "");
    const profileId = node?.dataset?.profileId;

    if (action === "cancel-editor") {
      this.closeEditor();
      return;
    }
    if (action === "submit-editor") {
      await this.submitEditor();
      return;
    }
    if (action === "select-avatar-category" && this.editorState) {
      this.editorState.category = String(node.dataset.category || "all");
      this.pendingFocusKey = `editor:category:${this.editorState.category}`;
      this.render();
      return;
    }
    if (action === "select-avatar" && this.editorState) {
      const avatar = this.avatarCatalog.find((entry) => entry.id === node.dataset.avatarId);
      if (!avatar) {
        return;
      }
      if (this.editorState.selectedAvatarId === avatar.id) {
        this.editorState.selectedAvatarId = null;
        this.editorState.selectedColorHex = this.editorState.mode === "edit"
          ? this.editorState.baseColorHex || DEFAULT_PROFILE_COLOR
          : DEFAULT_PROFILE_COLOR;
      } else {
        this.editorState.selectedAvatarId = avatar.id;
        this.editorState.selectedColorHex = avatar.bgColor || DEFAULT_PROFILE_COLOR;
      }
      this.editorState.focusedAvatarName = avatar.displayName;
      this.pendingFocusKey = `editor:avatar:${avatar.id}`;
      this.render();
      return;
    }
    if (action === "open-edit-profile") {
      this.openEditEditor(this.getProfileById(profileId));
      return;
    }
    if (action === "confirm-delete-profile") {
      this.openDeleteDialog(this.getProfileById(profileId));
      return;
    }
    if (action === "delete-profile") {
      await this.deleteProfile(profileId);
      return;
    }

    if (profileId === "add") {
      this.openCreateEditor();
      return;
    }

    const profile = this.getProfileById(profileId);
    if (!profile) {
      return;
    }

    if (this.isManagementMode) {
      this.openOptionsDialog(profile);
      return;
    }

    await this.activateProfile(profile.id);
  },

  async activateProfile(profileId) {
    if (!profileId) {
      return;
    }
    await ProfileManager.setActiveProfile(profileId);
    await StartupSyncService.syncPull();
    Router.navigate("home");
  },

  async onKeyDown(event) {
    if (!this.container) {
      return;
    }

    const code = Number(event?.keyCode || 0);
    const originalKeyCode = Number(event?.originalKeyCode || code || 0);
    const overlayRoot = this.container.querySelector("[data-overlay-root='delete']")
      || this.container.querySelector("[data-overlay-root='options']")
      || this.container.querySelector("[data-overlay-root='editor']");

    if (overlayRoot) {
      const overlaySelector = overlayRoot.dataset.overlayRoot === "editor"
        ? ".profile-overlay-focusable:not(.is-disabled)"
        : ".profile-dialog-button";

      if (ScreenUtils.handleDpadNavigation(event, overlayRoot, overlaySelector)) {
        return;
      }

      if (code !== 13) {
        return;
      }

      const focused = overlayRoot.querySelector(`${overlaySelector}.focused`) || document.activeElement;
      if (!focused || (isTextInput(focused) && overlayRoot.dataset.overlayRoot === "editor")) {
        return;
      }
      await this.activateFocusedNode(focused);
      return;
    }

    const wantsManageOptions = !this.isManagementMode
      && ((code === 13 && event?.repeat) || originalKeyCode === 82 || code === 93);

    if (wantsManageOptions) {
      const current = this.container.querySelector(".profile-card.focused");
      const profileId = current?.dataset?.profileId;
      if (profileId && profileId !== "add") {
        const profile = this.getProfileById(profileId);
        if (profile) {
          event?.preventDefault?.();
          this.openOptionsDialog(profile);
          return;
        }
      }
    }

    if (ScreenUtils.handleDpadNavigation(event, this.container, ".profile-card")) {
      return;
    }

    if (code !== 13) {
      return;
    }

    const current = this.container.querySelector(".profile-card.focused");
    if (!current) {
      return;
    }
    await this.activateFocusedNode(current);
  },

  consumeBackRequest() {
    if (this.deleteProfileId) {
      this.closeDeleteDialog();
      return true;
    }
    if (this.optionsProfileId) {
      this.closeOptionsDialog();
      return true;
    }
    if (this.editorState) {
      this.closeEditor();
      return true;
    }
    return false;
  },

  cleanup() {
    const container = document.getElementById("profileSelection");
    if (!container) {
      return;
    }
    container.style.display = "none";
    container.innerHTML = "";
  }

};
