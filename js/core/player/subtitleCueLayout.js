export function getSubtitleAssAlignment(content) {
  const match = String(content || "").match(/\{[^}]*[\\/]an([1-9])\b[^}]*\}/i);
  return match ? Number(match[1]) : 0;
}

export function getSubtitleAssAlignmentSettings(alignment) {
  const value = Number(alignment || 0);
  if (value < 1 || value > 9) {
    return null;
  }
  const column = ((value - 1) % 3) + 1;
  const row = Math.ceil(value / 3);
  return {
    line: row === 3 ? 10 : (row === 2 ? 50 : 90),
    align: column === 1 ? "start" : (column === 3 ? "end" : "center")
  };
}

export function parseVttCueLayout(timingLine) {
  const value = String(timingLine || "");
  const lineMatch = value.match(/(?:^|\s)line:([+-]?(?:\d+(?:\.\d+)?|\.\d+))%/i);
  const alignMatch = value.match(/(?:^|\s)align:(start|center|end|left|right)\b/i);
  const rawLine = lineMatch ? Number(lineMatch[1]) : NaN;
  const rawAlign = String(alignMatch?.[1] || "").toLowerCase();
  const align = rawAlign === "left" ? "start" : (rawAlign === "right" ? "end" : rawAlign);
  return {
    line: Number.isFinite(rawLine) ? Math.min(100, Math.max(0, rawLine)) : null,
    align: align === "start" || align === "end" || align === "center" ? align : "center"
  };
}
