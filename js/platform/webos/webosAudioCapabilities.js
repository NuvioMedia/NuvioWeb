import { Platform } from "../index.js";
import { WebOsLunaService } from "./webosLunaService.js";

const AUDIO_CAPABILITY_TIMEOUT_MS = 1800;
const DTS_RESTORE_PROBE_PREFIX = "NUVIO_DTS_RESTORE";

// This command is intentionally fixed and read-only. It checks the runtime
// changes made by dts_restore without assuming that the install hook alone ran.
export const DTS_RESTORE_PROBE_COMMAND = [
  "init=0",
  "rank=0",
  "libav=0",
  "[ -e /var/lib/webosbrew/init.d/restore_dts ] && init=1",
  "grep -q 'avdec_dca=290' /etc/gst/gstcool.conf 2>/dev/null && rank=1",
  "grep -q ' /usr/lib/gstreamer-1.0/libgstlibav.so ' /proc/mounts 2>/dev/null && libav=1",
  `printf '${DTS_RESTORE_PROBE_PREFIX} init=%s rank=%s libav=%s\\n' "$init" "$rank" "$libav"`
].join("; ");

const EMPTY_DTS_RESTORE_STATE = Object.freeze({
  installed: false,
  decoderRankEnabled: false,
  libavMounted: false,
  active: false
});

function settleWithin(promise, timeoutMs = AUDIO_CAPABILITY_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), Math.max(250, Number(timeoutMs || 0)));
    Promise.resolve(promise).then(finish, () => finish(null));
  });
}

export function parseDtsRestoreProbeOutput(result) {
  const output = typeof result === "string"
    ? result
    : String(result?.stdoutString || "");
  const match = output.match(/NUVIO_DTS_RESTORE\s+init=([01])\s+rank=([01])\s+libav=([01])/);
  if (!match) {
    return { ...EMPTY_DTS_RESTORE_STATE };
  }
  const installed = match[1] === "1";
  const decoderRankEnabled = match[2] === "1";
  const libavMounted = match[3] === "1";
  return {
    installed,
    decoderRankEnabled,
    libavMounted,
    active: decoderRankEnabled && libavMounted
  };
}

export function deriveWebOsAudioCapabilities({ edidType = "", dtsRestore = null } = {}) {
  const normalizedEdid = String(edidType || "").toLowerCase();
  const dtsRestoreActive = Boolean(dtsRestore?.active);
  const dtsFromEdid = normalizedEdid.includes("dts");
  const trueHdFromEdid = normalizedEdid.includes("truehd");
  const unsupportedAudioCodecs = [];

  if (!dtsFromEdid && !dtsRestoreActive) {
    unsupportedAudioCodecs.push("dts");
  }
  if (!trueHdFromEdid) {
    unsupportedAudioCodecs.push("truehd");
  }

  return {
    unsupportedAudioCodecs,
    dts: {
      supported: dtsFromEdid || dtsRestoreActive,
      source: dtsFromEdid ? "edid" : dtsRestoreActive ? "dts_restore" : "none"
    },
    truehd: {
      supported: trueHdFromEdid,
      source: trueHdFromEdid ? "edid" : "none"
    },
    dtsRestore: dtsRestore ? { ...dtsRestore } : { ...EMPTY_DTS_RESTORE_STATE }
  };
}

export function applyWebOsAudioCodecOverrides(
  unsupportedAudioCodecs = [],
  { forceDtsAudio = false, forceTrueHdAudio = false } = {}
) {
  const unsupported = new Set(unsupportedAudioCodecs);
  if (forceDtsAudio) {
    unsupported.delete("dts");
  }
  if (forceTrueHdAudio) {
    unsupported.delete("truehd");
  }
  return Array.from(unsupported);
}

async function requestEdidType() {
  const result = await settleWithin(
    WebOsLunaService.request("luna://com.webos.service.config", {
      method: "getConfigs",
      parameters: {
        configNames: ["tv.model.edidType"]
      }
    })
  );
  return String(result?.configs?.["tv.model.edidType"] || "");
}

async function requestDtsRestoreState() {
  const result = await settleWithin(
    WebOsLunaService.request("luna://org.webosbrew.hbchannel.service", {
      method: "exec",
      parameters: {
        command: DTS_RESTORE_PROBE_COMMAND
      }
    })
  );
  return parseDtsRestoreProbeOutput(result);
}

let detectionPromise = null;

export function detectWebOsAudioCapabilities({ forceRefresh = false } = {}) {
  if (!Platform.isWebOS() || !WebOsLunaService.isAvailable()) {
    return Promise.resolve(deriveWebOsAudioCapabilities());
  }
  if (detectionPromise && !forceRefresh) {
    return detectionPromise;
  }

  detectionPromise = Promise.all([
    requestEdidType(),
    requestDtsRestoreState()
  ]).then(([edidType, dtsRestore]) => (
    deriveWebOsAudioCapabilities({ edidType, dtsRestore })
  )).catch(() => deriveWebOsAudioCapabilities());

  return detectionPromise;
}
