import { Router } from "../../navigation/router.js";
import { QrLoginService } from "../../../core/auth/qrLoginService.js";
import { LocalStore } from "../../../core/storage/localStore.js";
import { ScreenUtils } from "../../navigation/screen.js";
import { AuthManager } from "../../../core/auth/authManager.js";
import { I18n } from "../../../i18n/index.js";

let pollInterval = null;
let countdownInterval = null;
let activeQrSessionId = 0;

export const AuthQrSignInScreen = {

  async mount({ onboardingMode = false } = {}) {
    this.container = document.getElementById("account");
    this.onboardingMode = Boolean(onboardingMode);
    this.isSignedIn = AuthManager.isAuthenticated;
    this.hasBackDestination = Router.stack.length > 0;
    ScreenUtils.show(this.container);

    this.container.innerHTML = `
      <div class="qr-layout">
        <section class="qr-left-panel">
          <div class="qr-brand-lockup">
            <img src="assets/brand/app_logo_wordmark.png" class="qr-logo" alt="Nuvio" />
          </div>

          <div class="qr-copy-block">
            <h1 class="qr-title">${I18n.t("auth.qr.title")}</h1>
            <p id="qr-description" class="qr-description">${this.getLeftDescription()}</p>
          </div>
        </section>

        <section class="qr-card-panel" aria-label="${I18n.t("auth.qr.cardAriaLabel")}">
          <div class="qr-card">
            <header class="qr-card-header">
              <h2 class="qr-card-title">${I18n.t("auth.qr.cardTitle")}</h2>
              <p id="qr-card-subtitle" class="qr-card-subtitle">${this.getCardSubtitle()}</p>
            </header>

            <div id="qr-container" class="qr-code-frame"></div>
            <div id="qr-code-text" class="qr-code-text"></div>
            <div id="qr-status" class="qr-status">${I18n.t("auth.qr.waitingApproval")}</div>
            <div class="qr-actions">
              <button id="qr-refresh-btn" class="qr-action-btn qr-action-btn-primary focusable" data-action="refresh">${I18n.t("auth.qr.refresh")}</button>
              <button id="qr-back-btn" class="qr-action-btn qr-action-btn-secondary focusable" data-action="back">${this.getBackButtonLabel()}</button>
            </div>
          </div>
        </section>
      </div>
    `;

    document.getElementById("qr-refresh-btn").onclick = () => this.startQr();
    document.getElementById("qr-back-btn").onclick = () => {
      this.cleanup();
      if (this.hasBackDestination) {
        Router.back();
      } else {
        Router.navigate("home");
      }
    };

    ScreenUtils.indexFocusables(this.container);
    ScreenUtils.setInitialFocus(this.container);
    await this.startQr();
  },

  async startQr() {
    this.stopIntervals();
    const sessionId = activeQrSessionId + 1;
    activeQrSessionId = sessionId;
    this.setStatus(I18n.t("auth.qr.preparing"));

    const result = await QrLoginService.start();
    if (sessionId !== activeQrSessionId) {
      return;
    }

    if (!result) {
      const raw = QrLoginService.getLastError();
      this.setStatus(this.toFriendlyQrError(raw));
      return;
    }

    this.renderQr(result);
    this.setStatus(I18n.t("auth.qr.scanAndSignIn"));
    this.startPolling(result.code, result.deviceNonce, result.pollIntervalSeconds || 3, sessionId);
  },

  renderQr({ qrImageUrl, code }) {
    const qrContainer = document.getElementById("qr-container");
    const codeText = document.getElementById("qr-code-text");

    if (!qrContainer || !codeText) {
      return;
    }

    qrContainer.innerHTML = `
      <img src="${qrImageUrl}" class="qr-image" alt="${I18n.t("auth.qr.qrImageAlt")}" />
    `;

    codeText.innerText = I18n.t("auth.qr.codeLabel", { code });
  },

  startCountdown(expiresAt) {
    const renderRemaining = () => {
      const remaining = expiresAt - Date.now();
      if (remaining <= 0) {
        if (countdownInterval) {
          clearInterval(countdownInterval);
          countdownInterval = null;
        }
        return;
      }
    };

    renderRemaining();
    countdownInterval = setInterval(renderRemaining, 1000);
  },

  startPolling(code, deviceNonce, pollIntervalSeconds = 3, sessionId) {
    pollInterval = setInterval(async () => {
      const status = await QrLoginService.poll(code, deviceNonce);
      if (sessionId !== activeQrSessionId) {
        return;
      }

      if (status === "approved") {
        this.setStatus(I18n.t("auth.qr.approved"));
        clearInterval(pollInterval);
        pollInterval = null;

        const exchange = await QrLoginService.exchange(code, deviceNonce);
        if (sessionId !== activeQrSessionId) {
          return;
        }

        if (exchange) {
          LocalStore.set("hasSeenAuthQrOnFirstLaunch", true);
          this.isSignedIn = true;
          Router.navigate("profileSelection");
        } else {
          this.setStatus(this.toFriendlyQrError(QrLoginService.getLastError()));
        }
      }

      if (status === "pending") {
        this.setStatus(I18n.t("auth.qr.waitingApproval"));
      }

      if (status === "expired") {
        this.setStatus(I18n.t("auth.qr.expired"));
      }

    }, Math.max(2, Number(pollIntervalSeconds || 3)) * 1000);
  },

  toFriendlyQrError(rawError) {
    const message = String(rawError || "").toLowerCase();
    if (!message) {
      return I18n.t("auth.qr.unavailable");
    }
    if (message.includes("invalid tv login redirect base url")) {
      return I18n.t("auth.qr.invalidRedirect");
    }
    if (message.includes("start_tv_login_session") && message.includes("could not find the function")) {
      return I18n.t("auth.qr.missingFunction");
    }
    if (message.includes("gen_random_bytes") && message.includes("does not exist")) {
      return I18n.t("auth.qr.missingExtension");
    }
    if (message.includes("network") || message.includes("failed to fetch")) {
      return I18n.t("auth.qr.networkError");
    }
    return I18n.t("auth.qr.unavailableWithReason", { reason: rawError });
  },

  setStatus(text) {
    const statusNode = document.getElementById("qr-status");
    if (!statusNode) {
      return;
    }
    statusNode.innerText = text;
  },

  getLeftDescription() {
    if (this.isSignedIn) {
      return I18n.t("auth.qr.leftDescriptionSignedIn");
    }
    return I18n.t("auth.qr.leftDescriptionSignedOut");
  },

  getCardSubtitle() {
    if (this.isSignedIn) {
      return I18n.t("auth.qr.cardSubtitleSignedIn");
    }
    return I18n.t("auth.qr.cardSubtitleSignedOut");
  },

  getBackButtonLabel() {
    if (this.hasBackDestination) {
      return I18n.t("auth.qr.back");
    }
    if (this.isSignedIn) {
      return I18n.t("auth.qr.continue");
    }
    return I18n.t("auth.qr.continueWithoutAccount");
  },

  onKeyDown(event) {
    if (ScreenUtils.handleDpadNavigation(event, this.container)) {
      return;
    }
    if (Number(event?.keyCode || 0) !== 13) {
      return;
    }

    const current = this.container?.querySelector(".focusable.focused");
    if (!current) {
      return;
    }

    const action = current.dataset.action;
    if (action === "refresh") {
      this.startQr();
      return;
    }
    if (action === "back") {
      current.click();
    }
  },

  stopIntervals() {
    if (pollInterval) clearInterval(pollInterval);
    if (countdownInterval) clearInterval(countdownInterval);
    pollInterval = null;
    countdownInterval = null;
  },

  cleanup() {
    this.stopIntervals();
    ScreenUtils.hide(this.container);
    this.container = null;
  }
};
