import { Router } from "../../navigation/router.js";
import { QrLoginService } from "../../../core/auth/qrLoginService.js";
import { LocalStore } from "../../../core/storage/localStore.js";
import { ScreenUtils } from "../../navigation/screen.js";
import { AuthManager } from "../../../core/auth/authManager.js";

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
            <h1 class="qr-title">Sign In With QR</h1>
            <p id="qr-description" class="qr-description">${this.getLeftDescription()}</p>
          </div>
        </section>

        <section class="qr-card-panel" aria-label="Account Login">
          <div class="qr-card">
            <header class="qr-card-header">
              <h2 class="qr-card-title">Account Login</h2>
              <p id="qr-card-subtitle" class="qr-card-subtitle">${this.getCardSubtitle()}</p>
            </header>

            <div id="qr-container" class="qr-code-frame"></div>
            <div id="qr-code-text" class="qr-code-text"></div>
            <div id="qr-status" class="qr-status">Waiting for approval on your phone...</div>
            <div class="qr-actions">
              <button id="qr-refresh-btn" class="qr-action-btn qr-action-btn-primary focusable" data-action="refresh">Refresh QR</button>
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
    this.setStatus("Preparing QR login...");

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
    this.setStatus("Scan QR and sign in on your phone");
    this.startPolling(result.code, result.deviceNonce, result.pollIntervalSeconds || 3, sessionId);
  },

  renderQr({ qrImageUrl, code }) {
    const qrContainer = document.getElementById("qr-container");
    const codeText = document.getElementById("qr-code-text");

    if (!qrContainer || !codeText) {
      return;
    }

    qrContainer.innerHTML = `
      <img src="${qrImageUrl}" class="qr-image" alt="QR code" />
    `;

    codeText.innerText = `Code: ${code}`;
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
        this.setStatus("Approved. Finishing login...");
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
        this.setStatus("Waiting for approval on your phone...");
      }

      if (status === "expired") {
        this.setStatus("QR expired. Refresh to retry.");
      }

    }, Math.max(2, Number(pollIntervalSeconds || 3)) * 1000);
  },

  toFriendlyQrError(rawError) {
    const message = String(rawError || "").toLowerCase();
    if (!message) {
      return "QR unavailable. Try again.";
    }
    if (message.includes("invalid tv login redirect base url")) {
      return "QR backend redirect URL is invalid. Check TV login SQL setup.";
    }
    if (message.includes("start_tv_login_session") && message.includes("could not find the function")) {
      return "QR backend function is missing. Re-run TV login SQL setup.";
    }
    if (message.includes("gen_random_bytes") && message.includes("does not exist")) {
      return "QR backend missing extension. Re-run SQL setup for TV login.";
    }
    if (message.includes("network") || message.includes("failed to fetch")) {
      return "Network error while generating QR.";
    }
    return `QR unavailable: ${rawError}`;
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
      return "Account linked on this TV.";
    }
    return "Use your phone to sign in with email/password. TV stays QR-only for faster login.";
  },

  getCardSubtitle() {
    if (this.isSignedIn) {
      return "Your synced data";
    }
    return "Scan QR, approve in browser, then return here.";
  },

  getBackButtonLabel() {
    if (this.hasBackDestination) {
      return "Back";
    }
    if (this.isSignedIn) {
      return "Continue";
    }
    return "Continue without account";
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
