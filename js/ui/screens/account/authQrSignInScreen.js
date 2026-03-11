import { Router } from "../../navigation/router.js";
import { QrLoginService } from "../../../core/auth/qrLoginService.js";
import { LocalStore } from "../../../core/storage/localStore.js";
import { ScreenUtils } from "../../navigation/screen.js";

let pollInterval = null;
let countdownInterval = null;

export const AuthQrSignInScreen = {

  async mount({ onboardingMode = false } = {}) {
    this.container = document.getElementById("account");
    this.onboardingMode = Boolean(onboardingMode);
    ScreenUtils.show(this.container);

    this.container.innerHTML = `
      <div class="qr-layout">
        <section class="qr-left-panel">
          <div class="qr-brand-lockup">
            <img src="assets/brand/app_logo_wordmark.png" class="qr-logo" alt="Nuvio" />
          </div>

          <div class="qr-copy-block">
            <h1 class="qr-title">Sign In With QR</h1>
            <p class="qr-description">
              Use your phone to sign in with email/password. TV stays QR-only for faster login.
            </p>
          </div>
        </section>

        <section class="qr-card-panel" aria-label="Account Login">
          <div class="qr-card">
            <header class="qr-card-header">
              <h2 class="qr-card-title">Account Login</h2>
              <p class="qr-card-subtitle">Scan QR, approve in browser, then return here.</p>
            </header>

            <div id="qr-container" class="qr-code-frame"></div>
            <div id="qr-code-text" class="qr-code-text"></div>
            <div id="qr-status" class="qr-status">Waiting for approval on your phone...</div>
            <div id="qr-expiry" class="qr-expiry"></div>

            <div class="qr-actions">
              <button id="qr-refresh-btn" class="qr-action-btn qr-action-btn-primary focusable" data-action="refresh">Refresh QR</button>
              <button id="qr-back-btn" class="qr-action-btn qr-action-btn-secondary focusable" data-action="back">${this.onboardingMode ? "Continue without account" : "Back"}</button>
            </div>
          </div>
        </section>
      </div>
    `;

    document.getElementById("qr-refresh-btn").onclick = () => this.startQr();
    document.getElementById("qr-back-btn").onclick = () => {
      this.cleanup();
      if (this.onboardingMode) {
        Router.navigate("home");
      } else {
        Router.back();
      }
    };

    ScreenUtils.indexFocusables(this.container);
    ScreenUtils.setInitialFocus(this.container);
    await this.startQr();
  },

  async startQr() {
    this.stopIntervals();
    this.setStatus("Waiting for approval on your phone...");
    this.setExpiry(null);

    const result = await QrLoginService.start();

    if (!result) {
      const raw = QrLoginService.getLastError();
      this.setStatus(this.toFriendlyQrError(raw));
      return;
    }

    this.renderQr(result);
    this.startPolling(result.code, result.deviceNonce, result.pollIntervalSeconds || 3);
    if (Number.isFinite(result.expiresAt)) {
      this.startCountdown(result.expiresAt);
    } else {
      this.setExpiry(null);
    }
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
    const expiryEl = document.getElementById("qr-expiry");
    if (!expiryEl) {
      return;
    }

    const renderRemaining = () => {
      const remaining = expiresAt - Date.now();
      if (remaining <= 0) {
        this.setExpiry("QR expires in 00:00");
        if (countdownInterval) {
          clearInterval(countdownInterval);
          countdownInterval = null;
        }
        return;
      }

      const minutes = Math.floor(remaining / 60000);
      const seconds = Math.floor((remaining % 60000) / 1000);
      this.setExpiry(`QR expires in ${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`);
    };

    renderRemaining();
    countdownInterval = setInterval(renderRemaining, 1000);
  },

  startPolling(code, deviceNonce, pollIntervalSeconds = 3) {
    pollInterval = setInterval(async () => {
      const status = await QrLoginService.poll(code, deviceNonce);

      if (status === "approved") {
        this.setStatus("Approved. Finishing login...");
        clearInterval(pollInterval);
        pollInterval = null;

        const exchange = await QrLoginService.exchange(code, deviceNonce);

        if (exchange) {
          LocalStore.set("hasSeenAuthQrOnFirstLaunch", true);
          Router.navigate("profileSelection");
        } else {
          this.setStatus(this.toFriendlyQrError(QrLoginService.getLastError()));
        }
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

  setExpiry(text) {
    const expiryNode = document.getElementById("qr-expiry");
    if (!expiryNode) {
      return;
    }
    if (!text) {
      expiryNode.innerText = "";
      expiryNode.style.display = "none";
      return;
    }
    expiryNode.style.display = "block";
    expiryNode.innerText = text;
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
