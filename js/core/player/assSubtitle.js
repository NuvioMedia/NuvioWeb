import { getSubtitleAssAlignment, getSubtitleAssAlignmentSettings } from "./subtitleCueLayout.js";

const ASS_CONTENT_TYPES = ["text/x-ssa", "application/x-ssa", "text/x-ass", "application/x-ass"];

const ASS_SECTION_HEADERS = [
  "[Script Info]",
  "[V4+ Styles]",
  "[V4+ Styles+]",
  "[V4 Styles]",
  "[V4 Styles+]",
  "[Events]"
];

function normalizeBody(body) {
  return String(body || "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n");
}

function looksLikeSrtOrVtt(normalized) {
  return (
    /^\s*WEBVTT/i.test(normalized) ||
    /^\s*\d+\s*\n\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->/m.test(normalized)
  );
}

function hasAssSectionHeaders(normalized) {
  const head = normalized.slice(0, 4096);
  // Headers must be alone on their line; incidental bracketed prose such
  // as "[Events] tonight" inside subtitle dialogue must not match.
  return ASS_SECTION_HEADERS.some((header) =>
    new RegExp(`^${header.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m").test(head)
  );
}

function hasAssDialogueEvents(normalized) {
  return /^\s*Dialogue\s*:/im.test(normalized) && /^\s*Format\s*:/im.test(normalized);
}

// Headerless ASS still carries real event rows: an optional Layer followed by
// Start and End timestamps. Prose transcripts that merely contain the words
// "Dialogue:"/"Format:" must not be classified as ASS.
function hasAssTimestampedDialogue(normalized) {
  return /^\s*Dialogue\s*:\s*(?:(?:\d+|Marked\s*=\s*\d+)\s*,)?\s*\d+:\d{1,2}:\d{1,2}[.,]\d{1,3}\s*,\s*\d+:\d{1,2}:\d{1,2}[.,]\d{1,3}/im.test(
    normalized
  );
}

/**
 * Detect ASS/SSA subtitle bodies from content and metadata.
 *
 * A body is ASS when it carries standard section headers on their own lines
 * together with Dialogue/Format event lines, when URL/content-type
 * indicates ASS (.ass/.ssa, text/x-ass), or when it contains timestamped
 * Dialogue rows (headerless, incl. Marked=). SRT and VTT bodies are always
 * rejected, as is incidental ASS-like text inside a larger non-ASS body.
 */
export function isAssSubtitle(body, { sourceUrl = "", contentType = "" } = {}) {
  const normalized = normalizeBody(body);
  if (!normalized.trim()) {
    return false;
  }
  const fromMetadata =
    /\.(ass|ssa)(\?|#|$)/i.test(String(sourceUrl || "")) ||
    ASS_CONTENT_TYPES.some((type) =>
      String(contentType || "")
        .toLowerCase()
        .includes(type)
    );
  // Prefer an unambiguous body signature over a stale or incorrect URL/MIME
  // hint. This matches Android's body-first sniffing and keeps a VTT/SRT
  // response usable even when an addon labels the download as `.ass`.
  if (looksLikeSrtOrVtt(normalized)) {
    return false;
  }
  if (fromMetadata) {
    return true;
  }
  if (hasAssSectionHeaders(normalized) && hasAssDialogueEvents(normalized)) {
    return true;
  }
  // Some proxy/AVPlay paths strip ASS section headers but preserve event rows.
  // Require actual ASS timing on headerless bodies so non-ASS text that merely
  // mentions "Dialogue:" is not routed away from the plain-text path.
  return hasAssTimestampedDialogue(normalized);
}

const DEFAULT_ASS_DIALOGUE_FORMAT = [
  "layer",
  "start",
  "end",
  "style",
  "name",
  "marginl",
  "marginr",
  "marginv",
  "effect",
  "text"
];

function isAssEventFormat(fields) {
  return fields.includes("start") && fields.includes("end") && fields.includes("text");
}

function inferHeaderlessAssFormat(rest) {
  const fields = String(rest || "").split(",");
  if (
    Number.isFinite(parseAssTimestamp(fields[0])) &&
    Number.isFinite(parseAssTimestamp(fields[1]))
  ) {
    return ["start", "end", "text"];
  }
  if (
    /^(?:\d+|Marked\s*=\s*\d+)$/i.test(String(fields[0] || "").trim()) &&
    Number.isFinite(parseAssTimestamp(fields[1])) &&
    Number.isFinite(parseAssTimestamp(fields[2]))
  ) {
    return DEFAULT_ASS_DIALOGUE_FORMAT;
  }
  return null;
}

function parseAssTimestamp(value) {
  const match = String(value || "")
    .trim()
    .match(/^(\d+):(\d{1,2}):(\d{2})[.,](\d{1,3})$/);
  if (!match) {
    return NaN;
  }
  const milliseconds = Number(String(match[4] || "0").padEnd(3, "0"));
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + milliseconds / 1000;
}

function formatVttTimestamp(totalSeconds) {
  const total = Math.max(0, totalSeconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = Math.floor(total % 60);
  const milliseconds = Math.round((total - Math.floor(total)) * 1000) % 1000;
  const pad = (value, width = 2) => String(value).padStart(width, "0");
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}.${pad(milliseconds, 3)}`;
}

function trimAssOverrideTail(text) {
  return String(text || "").replace(/\{\s*\\[A-Za-z1-4][^}]*$/, "");
}

// Track drawing mode across blocks. Only top-level tags change the mode;
// transform arguments are not immediate drawing commands.
function sanitizePlainTextAssCue(text) {
  var source = trimAssOverrideTail(text);
  var drawing = false;
  var output = "";
  var offset = 0;
  var blocks = /\{([^}]*)\}/g;
  var match;
  while ((match = blocks.exec(source))) {
    if (!drawing) output += source.slice(offset, match.index);
    var block = match[1];
    var depth = 0;
    for (var index = 0; index < block.length; index += 1) {
      var character = block[index];
      if (character === "(") depth += 1;
      else if (character === ")") depth = Math.max(0, depth - 1);
      else if (character === "\\" && depth === 0) {
        var tag = block.slice(index + 1);
        var mode = /^p(-?\d+)(?=\\|\s|$)/.exec(tag);
        if (mode) drawing = Number(mode[1]) > 0;
        else if (tag[0] === "r") drawing = false;
      }
    }
    offset = blocks.lastIndex;
  }
  if (!drawing) output += source.slice(offset);
  return output
    .replace(/\\[Nn]/g, "\n")
    .replace(/\\h/g, " ")
    .trim();
}

function sanitizeAssDialogueText(text) {
  return sanitizePlainTextAssCue(text);
}

const ASS_POSITION_RE = /\\pos\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/i;
const ASS_MOVE_RE =
  /\\move\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)(?:\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?))?\s*\)/i;
const ASS_FONT_SIZE_RE = /\\fs(\d+(?:\.\d+)?)/i;

function getAssPlayRes(normalized) {
  const width = normalized.match(/^\s*PlayResX\s*:\s*(\d+(?:\.\d+)?)\s*$/im);
  const height = normalized.match(/^\s*PlayResY\s*:\s*(\d+(?:\.\d+)?)\s*$/im);
  return {
    x: width ? Number(width[1]) : 0,
    y: height ? Number(height[1]) : 0
  };
}

/**
 * Build a map of style name -> Fontsize from the `[V4+ Styles]` section.
 * Returns an empty map when the section or its Format line is missing.
 */
function getAssStyleFontSizes(normalized) {
  const sizes = {};
  let fields = null;
  normalized.split("\n").forEach((line) => {
    const trimmed = line.trim();
    if (/^\[V4\+?\sStyles/i.test(trimmed) || /^\[V4\sStyles/i.test(trimmed)) {
      return;
    }
    if (
      /^Format\s*:/i.test(trimmed) &&
      !fields &&
      /^\s*Name\b/i.test(trimmed.slice(trimmed.indexOf(":") + 1))
    ) {
      fields = trimmed
        .slice(trimmed.indexOf(":") + 1)
        .split(",")
        .map((field) => field.trim().toLowerCase());
      return;
    }
    if (!/^Style\s*:/i.test(trimmed) || !fields) {
      return;
    }
    const values = trimmed.slice(trimmed.indexOf(":") + 1).split(",");
    const record = {};
    fields.forEach((field, index) => {
      record[field] =
        index < fields.length - 1
          ? (values[index] || "").trim()
          : values.slice(index).join(",").trim();
    });
    const name = String(record.name || "").trim();
    const size = Number(record.fontsize);
    if (name && Number.isFinite(size) && size > 0) {
      sizes[name.toLowerCase()] = size;
    }
  });
  return sizes;
}

/**
 * Pick the reference dialogue size: the largest Fontsize among the common
 * dialogue styles. Falls back to the largest declared size so the ratio is
 * always computable for files that rename their styles.
 */
function getAssBaseFontSize(styleFontSizes) {
  const preferred = ["main", "default"];
  let best = 0;
  let fallbackBest = 0;
  Object.keys(styleFontSizes).forEach((name) => {
    const size = styleFontSizes[name];
    if (size > fallbackBest) {
      fallbackBest = size;
    }
    if (preferred.indexOf(name) >= 0 && size > best) {
      best = size;
    }
  });
  return best > 0 ? best : fallbackBest;
}

/**
 * Project an ASS y coordinate (top-origin, PlayResY units) onto a VTT `line`
 * percentage. Clamped away from the edges so a centered cue is not clipped.
 * Returns null when the projection is not computable.
 */
function assYToVttLine(y, playResY) {
  const raw = Number(y);
  const scale = Number(playResY);
  if (!Number.isFinite(raw) || !Number.isFinite(scale) || scale <= 0) {
    return null;
  }
  // -20..120 instead of 5..95: \move endpoints often sit off-screen, and
  // clamping would flatten the travel of a stepping fallback.
  return Math.round(Math.min(120, Math.max(-20, (raw / scale) * 100)));
}

/**
 * Project an ASS x coordinate (left-origin, PlayResX units) onto a continuous
 * VTT `position` percentage (0-100, left-origin). Clamped away from the edges
 * so a centered cue is not clipped. Returns null when not computable.
 */
function assXToVttPosition(x, playResX) {
  const raw = Number(x);
  const scale = Number(playResX);
  if (!Number.isFinite(raw) || !Number.isFinite(scale) || scale <= 0) {
    return null;
  }
  return Math.round(Math.min(95, Math.max(5, (raw / scale) * 100)));
}

/**
 * Split a `\move` cue's time span into sequential slices with interpolated
 * coordinates, so a stepped fallback render tracks camera pans instead of
 * freezing at one endpoint. Slices tile the original span exactly; timing
 * coverage is unchanged. Returns null when the move is not animatable
 * (missing/zero-length window) or the travel distance is negligible.
 */
function getAssMoveTrack(rawText, start, end, playRes) {
  const match = String(rawText || "").match(ASS_MOVE_RE);
  if (!match || !Number.isFinite(start) || !Number.isFinite(end)) {
    return null;
  }
  const x1 = Number(match[1]);
  const y1 = Number(match[2]);
  const x2 = Number(match[3]);
  const y2 = Number(match[4]);
  if (![x1, y1, x2, y2].every(Number.isFinite)) {
    return null;
  }
  const durationMs = Math.max(0, (end - start) * 1000);
  const requestedStartMs = match[5] == null ? 0 : Number(match[5]);
  const requestedEndMs = match[6] == null ? durationMs : Number(match[6]);
  if (
    !Number.isFinite(requestedStartMs) ||
    !Number.isFinite(requestedEndMs) ||
    requestedEndMs <= requestedStartMs
  ) {
    return null;
  }
  // ASS move offsets are relative to the dialogue. Clamp malformed or
  // producer-rounded offsets to the cue so the fallback never emits cues
  // outside the original timing window.
  const moveStartMs = clampNumber(requestedStartMs, 0, durationMs);
  const moveEndMs = clampNumber(requestedEndMs, 0, durationMs);
  if (moveEndMs <= moveStartMs) {
    return null;
  }
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (Math.sqrt(dx * dx + dy * dy) < 24) {
    return null;
  }
  const moveStart = start + moveStartMs / 1000;
  const moveEnd = start + moveEndMs / 1000;
  const slices = [];
  const appendSlice = (sliceStart, sliceEnd, x, y) => {
    if (!(sliceEnd > sliceStart)) {
      return;
    }
    const line = assYToVttLine(y, playRes.y);
    const position = assXToVttPosition(x, playRes.x);
    if (line == null || position == null) {
      return;
    }
    const previous = slices[slices.length - 1];
    if (
      previous &&
      previous.line === line &&
      previous.position === position &&
      Math.abs(previous.end - sliceStart) < 0.001
    ) {
      previous.end = sliceEnd;
      return;
    }
    slices.push({ start: sliceStart, end: sliceEnd, line, position });
  };
  appendSlice(start, moveStart, x1, y1);
  // A slice every roughly 60ms keeps the timer-driven fallback close to the
  // source motion without producing an unbounded number of VTT cues.
  const steps = Math.max(2, Math.min(96, Math.ceil(((moveEnd - moveStart) * 1000) / 60)));
  for (let index = 0; index < steps; index += 1) {
    const from = index / steps;
    const to = (index + 1) / steps;
    const sliceStart = moveStart + (moveEnd - moveStart) * from;
    const sliceEnd = moveStart + (moveEnd - moveStart) * to;
    const cx = x1 + dx * to;
    const cy = y1 + dy * to;
    appendSlice(sliceStart, sliceEnd, cx, cy);
  }
  appendSlice(moveEnd, end, x2, y2);
  if (slices.length < 2) {
    return null;
  }
  return { slices };
}

function clampNumber(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number(value)));
}
/**
 * Derive VTT layout from a cue's ASS override tags. `\an` is authoritative
 * (exact line/align); otherwise a static `\pos` or the end point of a `\move`
 * maps to a vertical `line`, a horizontal `position`, and center align.
 */
function getAssCueLayout(rawText, playRes) {
  const raw = String(rawText || "");
  const settings = getSubtitleAssAlignmentSettings(getSubtitleAssAlignment(raw));
  const posMatch = raw.match(ASS_POSITION_RE);
  if (settings) {
    // \an wins for line/align, but a co-present \pos still refines the
    // horizontal position instead of discarding it.
    const position = posMatch ? assXToVttPosition(posMatch[1], playRes.x) : null;
    return { line: settings.line, align: settings.align, position };
  }
  if (posMatch) {
    const line = assYToVttLine(posMatch[2], playRes.y);
    const position = assXToVttPosition(posMatch[1], playRes.x);
    if (line == null || position == null) {
      return null;
    }
    return { line, position, align: "center" };
  }
  const moveMatch = raw.match(ASS_MOVE_RE);
  if (moveMatch) {
    const line = assYToVttLine(moveMatch[4], playRes.y);
    const position = assXToVttPosition(moveMatch[3], playRes.x);
    if (line == null || position == null) {
      return null;
    }
    return { line, position, align: "center" };
  }
  return null;
}

/**
 * Resolve a cue's effective font size in PlayRes units: the style's Fontsize,
 * overridden by an inline `\fs`. Returns null when nothing is known.
 */
function getAssCueFontSize(styleName, rawText, styleFontSizes) {
  const inlineMatch = String(rawText || "").match(ASS_FONT_SIZE_RE);
  if (inlineMatch) {
    const inline = Number(inlineMatch[1]);
    if (Number.isFinite(inline) && inline > 0) {
      return inline;
    }
  }
  return (
    styleFontSizes[
      String(styleName || "")
        .trim()
        .toLowerCase()
    ] || null
  );
}

/**
 * Quantize a size ratio to a coarse percentage step so many diagram labels
 * collapse onto few classes instead of one per distinct Fontsize.
 */
function assSizeToVttPercent(fontSize, baseFontSize) {
  const size = Number(fontSize);
  const base = Number(baseFontSize);
  if (!Number.isFinite(size) || !Number.isFinite(base) || size <= 0 || base <= 0) {
    return null;
  }
  return Math.round(((size / base) * 100) / 5) * 5;
}

/**
 * Convert ASS/SSA `Dialogue:` events to VTT cues: timestamps become
 * `HH:MM:SS.mmm` ranges, dialogue text keeps line breaks and drops styling
 * tags. Static alignment is preserved approximately: `\an` maps to VTT
 * `line`/`align`, and a `\pos`/`\move` point maps to a vertical `line` plus
 * a horizontal `position`. `\move` animation is represented by bounded
 * stepped cues; rotation and fades are not represented. Malformed events
 * are dropped.
 */
export function convertAssDialogueToVttCues(body) {
  const normalized = normalizeBody(body);
  const playRes = getAssPlayRes(normalized);
  const styleFontSizes = getAssStyleFontSizes(normalized);
  const baseFontSize = getAssBaseFontSize(styleFontSizes);
  let formatFields = null;
  const cues = [];
  normalized.split("\n").forEach((line) => {
    const trimmed = line.trim();
    if (/^Format\s*:/i.test(trimmed)) {
      const section = trimmed.slice(trimmed.indexOf(":") + 1);
      const candidateFields = section.split(",").map((field) => field.trim().toLowerCase());
      // ASS style sections also contain a `Format:` line. Keep only an event
      // format here so a headerless body can still be inferred safely.
      if (isAssEventFormat(candidateFields)) {
        formatFields = candidateFields;
      }
      return;
    }
    if (!/^Dialogue\s*:/i.test(trimmed)) {
      return;
    }
    let rest = trimmed.slice(trimmed.indexOf(":") + 1);
    const eventFormatFields = formatFields || inferHeaderlessAssFormat(rest);
    if (!eventFormatFields) {
      return;
    }
    const values = [];
    const textIndex = eventFormatFields.indexOf("text");
    const headCount = textIndex >= 0 ? textIndex : eventFormatFields.length;
    for (let index = 0; index < headCount; index += 1) {
      const commaIndex = rest.indexOf(",");
      if (commaIndex < 0) {
        return;
      }
      values.push(rest.slice(0, commaIndex));
      rest = rest.slice(commaIndex + 1);
    }
    values.push(rest);
    const record = {};
    eventFormatFields.forEach((field, index) => {
      record[field] = values[index];
    });
    const start = parseAssTimestamp(record.start);
    const end = parseAssTimestamp(record.end);
    const text = sanitizeAssDialogueText(record.text);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !text) {
      return;
    }
    const rawText = String(record.text || "");
    const layout = getAssCueLayout(rawText, playRes);
    let sizePercent = null;
    if (layout) {
      const fontSize = getAssCueFontSize(record.style, record.text, styleFontSizes);
      sizePercent = assSizeToVttPercent(fontSize, baseFontSize);
    }
    // A \move with real travel becomes stepped slices that track the motion;
    // everything else stays a single cue.
    const moveTrack =
      layout && !getSubtitleAssAlignment(rawText)
        ? getAssMoveTrack(rawText, start, end, playRes)
        : null;
    if (!moveTrack) {
      const cue = layout
        ? {
            start,
            end,
            text,
            line: layout.line,
            position: layout.position,
            align: layout.align
          }
        : { start, end, text };
      if (sizePercent != null && sizePercent < 100) {
        cue.size = sizePercent;
      }
      cues.push(cue);
      return;
    }
    for (const slice of moveTrack.slices) {
      if (!slice || slice.line == null || slice.position == null || !(slice.end > slice.start)) {
        continue;
      }
      const cue = {
        start: slice.start,
        end: slice.end,
        text,
        line: slice.line,
        position: slice.position,
        align: "center"
      };
      if (sizePercent != null && sizePercent < 100) {
        cue.size = sizePercent;
      }
      cues.push(cue);
    }
  });
  return cues.sort((left, right) => left.start - right.start || left.end - right.end);
}

/**
 * Render converted cues as a complete VTT document. Returns "" when no
 * cues remain.
 */
export function buildVttFromAssCues(cues) {
  if (!Array.isArray(cues) || !cues.length) {
    return "";
  }
  const blocks = cues.map((cue) => {
    const rawLine = cue.line;
    const line = rawLine == null ? NaN : Number(rawLine);
    const align = String(cue.align || "");
    const rawPos = cue.position;
    const pos = rawPos == null ? NaN : Number(rawPos);
    const parts = [];
    if (Number.isFinite(line)) {
      parts.push(`line:${line}%`);
    }
    if (Number.isFinite(pos)) {
      parts.push(`position:${Math.round(pos)}%`);
    }
    if (["start", "end", "center"].indexOf(align) >= 0) {
      parts.push(`align:${align}`);
    }
    const rawSize = cue.size;
    const size = rawSize == null ? NaN : Number(rawSize);
    if (Number.isFinite(size) && size > 0 && size < 100 && Number.isFinite(line)) {
      parts.push(`size:${Math.round(size)}%`);
    }
    const settings = parts.length ? ` ${parts.join(" ")}` : "";
    return `${formatVttTimestamp(cue.start)} --> ${formatVttTimestamp(cue.end)}${settings}\n${cue.text}`;
  });
  return `WEBVTT\n\n${blocks.join("\n\n")}\n`;
}

export function convertAssBodyToVtt(body) {
  return buildVttFromAssCues(convertAssDialogueToVttCues(body));
}
