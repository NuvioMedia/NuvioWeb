import { Router } from "../../ui/navigation/router.js";
import { ProfileManager } from "../../core/profile/profileManager.js";
import { ProfileSyncService } from "../../core/profile/profileSyncService.js";
import { StartupSyncService } from "../../core/profile/startupSyncService.js";
import { ScreenUtils } from "../../ui/navigation/screen.js";

export const ProfileSelectionScreen = {

  async mount() {
    this.container = document.getElementById("profileSelection");
    if (!this.container) {
      console.error("Missing #profileSelection container");
      return;
    }
    this.container.style.display = "block";

    await ProfileSyncService.pull();
    this.profiles = await ProfileManager.getProfiles();
    if (this.profiles.length === 1) {
      await this.activateProfile(this.profiles[0].id);
      return;
    }

    this.container.innerHTML = `
      <div class="profile-screen">
        <img src="assets/brand/app_logo_wordmark.png" class="profile-logo"/>

        <h1 class="profile-title">Who's watching?</h1>
        <p class="profile-subtitle">Select a profile to continue</p>

        <div class="profile-grid" id="profileGrid"></div>

        <p class="profile-hint">Use D-pad to choose a profile</p>
      </div>
    `;

    const grid = document.getElementById("profileGrid");

    this.profiles.forEach((profile) => {
      const card = document.createElement("div");
      card.className = "profile-card focusable";
      card.dataset.profileId = profile.id;
      card.tabIndex = 0;

      card.innerHTML = `
        <div class="profile-avatar-ring">
          <div class="profile-avatar"
               style="background:${profile.avatarColorHex}">
            ${profile.name.charAt(0).toUpperCase()}
          </div>
          ${profile.isPrimary ? `<span class="profile-primary-dot" aria-hidden="true">&#9733;</span>` : ""}
        </div>
        <div class="profile-name">${profile.name}</div>
        ${profile.isPrimary ? `<div class="profile-badge">PRIMARY</div>` : ""}
      `;

      card.addEventListener("focus", () => {
        document.querySelectorAll(".profile-card")
          .forEach(c => c.classList.remove("focused"));

        card.classList.add("focused");
        this.updateBackground(profile.avatarColorHex);
      });

      card.addEventListener("click", async () => {
        await this.activateProfile(profile.id);
      });

      grid.appendChild(card);
    });

    ScreenUtils.indexFocusables(this.container, ".profile-card");
    ScreenUtils.setInitialFocus(this.container, ".profile-card");
  },

  async activateProfile(profileId) {
    if (!profileId) {
      return;
    }
    await ProfileManager.setActiveProfile(profileId);
    await StartupSyncService.syncPull();
    Router.navigate("home");
  },

  updateBackground(colorHex) {
    const screen = document.querySelector(".profile-screen");
    if (!screen) {
      return;
    }
    screen.style.background = `
      radial-gradient(circle at 20% 0%, ${colorHex}2e 0%, transparent 56%),
      linear-gradient(90deg, #1b466f 0%, #0a1727 62%, #050b14 100%)
    `;
  },

  async onKeyDown(event) {
    if (!this.container) {
      return;
    }

    if (ScreenUtils.handleDpadNavigation(event, this.container, ".profile-card")) {
      return;
    }

    if (event.keyCode !== 13) {
      return;
    }

    const current = this.container.querySelector(".profile-card.focused");
    if (!current) {
      return;
    }

    await this.activateProfile(current.dataset.profileId);
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
