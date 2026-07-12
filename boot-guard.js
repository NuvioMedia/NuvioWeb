(function installNuvioBootGuard(window, document) {
  "use strict";

  if (typeof window.globalThis === "undefined") {
    window.globalThis = window;
  }

  if (window.NuvioBootGuard) {
    return;
  }

  var OVERLAY_ID = "nuvio-boot-error";
  var WATCHDOG_MS = 25000;
  var active = true;
  var lastStage = "Loading startup files";
  var watchdogId = 0;

  function scheduleWatchdog() {
    if (!active) {
      return;
    }
    if (watchdogId) {
      window.clearTimeout(watchdogId);
    }
    watchdogId = window.setTimeout(function onBootTimeout() {
      watchdogId = 0;
      if (active) {
        showError(
          "The application is taking too long to start.",
          "Restart the app. If the problem continues, photograph this screen and report the code and stage.",
          "BOOT-TIMEOUT"
        );
      }
    }, WATCHDOG_MS);
  }

  function text(value) {
    if (value === undefined || value === null || value === "") {
      return "Unavailable";
    }
    return String(value);
  }

  function removeOverlay() {
    var overlay = document.getElementById(OVERLAY_ID);
    if (overlay && overlay.parentNode) {
      overlay.parentNode.removeChild(overlay);
    }
  }

  function showError(message, details, code) {
    if (!active || !document.body) {
      return;
    }

    removeOverlay();

    var overlay = document.createElement("div");
    overlay.id = OVERLAY_ID;
    overlay.setAttribute("role", "alert");
    overlay.style.cssText =
      "position:fixed;z-index:2147483647;left:0;top:0;width:100%;height:100%;" +
      "box-sizing:border-box;background:#0d0d0d;color:#f5f5f5;font-family:Arial,sans-serif;" +
      "display:flex;align-items:center;justify-content:center;padding:64px;";

    var card = document.createElement("div");
    card.style.cssText = "width:100%;max-width:1120px;text-align:center;";

    var title = document.createElement("div");
    title.style.cssText = "font-size:44px;line-height:1.15;font-weight:700;margin-bottom:22px;";
    title.textContent = "Nuvio TV could not start";

    var description = document.createElement("div");
    description.style.cssText =
      "font-size:25px;line-height:1.45;color:#c9c9c9;margin:0 auto 30px;max-width:920px;";
    description.textContent = text(message);

    var diagnostic = document.createElement("div");
    diagnostic.style.cssText =
      "box-sizing:border-box;text-align:left;white-space:pre-wrap;word-break:break-word;" +
      "font-family:monospace;font-size:19px;line-height:1.45;color:#dddddd;background:#181818;" +
      "border:1px solid #343434;border-radius:14px;padding:22px 26px;margin:0 auto 32px;max-width:980px;";
    diagnostic.textContent =
      "Code: " + text(code || "BOOT-ERROR") + "\n" +
      "Stage: " + text(lastStage) + "\n" +
      "Details: " + text(details);

    var retry = document.createElement("button");
    retry.type = "button";
    retry.textContent = "Retry";
    retry.style.cssText =
      "min-width:190px;padding:17px 30px;border:2px solid #ffffff;border-radius:12px;" +
      "background:#ffffff;color:#111111;font-size:23px;font-weight:700;";
    retry.onclick = function retryBoot() {
      window.location.reload();
    };
    retry.onkeydown = function retryBootWithRemote(event) {
      var keyCode = Number(event && event.keyCode);
      var key = String((event && event.key) || "");
      if (key === "Enter" || key === "OK" || keyCode === 13) {
        window.location.reload();
      }
    };

    card.appendChild(title);
    card.appendChild(description);
    card.appendChild(diagnostic);
    card.appendChild(retry);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    try {
      retry.focus();
    } catch (ignored) {}
  }

  function formatRuntimeError(message, source, line, column, error) {
    var parts = [];
    var errorText = error && (error.stack || error.message);
    if (errorText) {
      parts.push(String(errorText));
    } else if (message) {
      parts.push(String(message));
    }
    if (source) {
      parts.push(String(source) + ":" + Number(line || 0) + ":" + Number(column || 0));
    }
    return parts.join("\n");
  }

  var guard = {
    stage: function stage(name) {
      if (active && name) {
        lastStage = String(name);
        scheduleWatchdog();
      }
    },

    fail: function fail(message, details, code) {
      showError(message, details, code);
    },

    scriptFailed: function scriptFailed(source) {
      showError(
        "A required startup file could not be loaded.",
        text(source),
        "BOOT-ASSET"
      );
    },

    ready: function ready() {
      active = false;
      if (watchdogId) {
        window.clearTimeout(watchdogId);
        watchdogId = 0;
      }
      removeOverlay();
    },

    isActive: function isActive() {
      return active;
    }
  };

  window.NuvioBootGuard = guard;

  var previousOnError = window.onerror;
  window.onerror = function onBootError(message, source, line, column, error) {
    if (active) {
      showError(
        "Something went wrong while the application was starting.",
        formatRuntimeError(message, source, line, column, error),
        "BOOT-RUNTIME"
      );
    }
    if (typeof previousOnError === "function") {
      return previousOnError.apply(window, arguments);
    }
    return false;
  };

  if (typeof window.addEventListener === "function") {
    window.addEventListener("unhandledrejection", function onBootRejection(event) {
      var reason = event && event.reason;
      if (active) {
        showError(
          "Something went wrong while the application was starting.",
          reason && (reason.stack || reason.message) ? reason.stack || reason.message : reason,
          "BOOT-PROMISE"
        );
      }
    });
  }

  scheduleWatchdog();
})(window, document);
