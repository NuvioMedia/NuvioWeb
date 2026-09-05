// Regression tests for preserving literal dialogue and separating plain-text
// fallback sanitation from complete ASS override rendering.
// Run: node ./scripts/test-ass-plaintext-fallback.mjs
//
// Covered units:
// - js/core/player/assSubtitle.js (external-file VTT fallback)
// - services/webos/src/bitmapSubtitles.js (embedded VTT and reconstructed ASS)
// Drawing mode is stateful. Numeric prefixes and bare commands remain literal.
// Unfinished override tails are removed without dropping their readable heads.

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { convertAssDialogueToVttCues } = await import(
  path.join(rootDir, "js/core/player/assSubtitle.js")
);
const service = require(path.join(rootDir, "services/webos/src/bitmapSubtitles.js"))._test;

let failures = 0;

function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) {
    failures += 1;
  }
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) {
    console.log(`  expected: ${JSON.stringify(expected)}`);
    console.log(`  actual:   ${JSON.stringify(actual)}`);
  }
}

function vttCueTexts(body) {
  return convertAssDialogueToVttCues(body).map((cue) => cue.text);
}

function assBody(textLines) {
  return [
    "[Script Info]",
    "Title: t",
    "[V4+ Styles]",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...textLines.map(
      (text, index) =>
        `Dialogue: 0,0:00:${String(10 + index).padStart(2, "0")}.00,0:00:${String(11 + index).padStart(2, "0")}.00,Default,,0,0,0,,${text}`
    )
  ].join("\n");
}

// --- Drawings carry no dialogue, adjacent dialogue survives. ---
check(
  "drawing-only event yields no cue",
  JSON.stringify(vttCueTexts(assBody(["{\\p1}m 64.89 68.77 l 64.17 67.11 l 63.09 66.4{\\p0}"]))),
  JSON.stringify([])
);

check(
  "open-close in one block keeps following dialogue",
  JSON.stringify(vttCueTexts(assBody(["{\\p1\\p0}Hello"]))),
  JSON.stringify(["Hello"])
);

check(
  "chained drawings resolve to final dialogue",
  JSON.stringify(vttCueTexts(assBody(["{\\p1}m 0 0 l 1 1{\\p0\\p1}m 2 2 l 3 3{\\p0}Hello"]))),
  JSON.stringify(["Hello"])
);

check(
  "dialogue before unclosed drawing is preserved",
  JSON.stringify(vttCueTexts(assBody(["Sign {\\p1}m 0 0 l 10 10"]))),
  JSON.stringify(["Sign"])
);

// Unbraced commands are literal text, not evidence of corruption.
check(
  "numeric prefix and commands preserve literal dialogue",
  JSON.stringify(
    vttCueTexts(assBody(["320,820,640)\\frz358.4\\org(1889.15,82.92)\\c&H1B1516&}Menacing"]))
  ),
  JSON.stringify(["320,820,640)\\frz358.4\\org(1889.15,82.92)\\c&H1B1516&}Menacing"])
);

check(
  "numeric prefix without braces remains literal",
  JSON.stringify(vttCueTexts(assBody(["11.12,955.26,-783.88)\\fsp0.0"]))),
  JSON.stringify(["11.12,955.26,-783.88)\\fsp0.0"])
);

// --- Legitimate text is never dropped. ---
check(
  "positioned dialogue is preserved",
  JSON.stringify(vttCueTexts(assBody(["{\\an8\\pos(1011.12,955.26)\\fsp0}The Culling Game"]))),
  JSON.stringify(["The Culling Game"])
);

check(
  "windows path with stray brace is preserved",
  JSON.stringify(vttCueTexts(assBody(["Path C:\\temp} ready"]))),
  JSON.stringify(["Path C:\\temp} ready"])
);

check(
  "backslash prose with brace is preserved",
  JSON.stringify(vttCueTexts(assBody(["a\\b}c"]))),
  JSON.stringify(["a\\b}c"])
);

check(
  "bare positioning command is preserved literally",
  JSON.stringify(vttCueTexts(assBody(["\\pos(10,20)"]))),
  JSON.stringify(["\\pos(10,20)"])
);

check(
  "backslash path with digits is preserved",
  JSON.stringify(vttCueTexts(assBody(["C:\\fs2"]))),
  JSON.stringify(["C:\\fs2"])
);

check(
  "backslash path with parens is preserved",
  JSON.stringify(vttCueTexts(assBody(["C:\\path (x86)\\app"]))),
  JSON.stringify(["C:\\path (x86)\\app"])
);

check(
  "plain dialogue untouched",
  JSON.stringify(vttCueTexts(assBody(["Just text", "1, 2, 3, 4, 5, 6"]))),
  JSON.stringify(["Just text", "1, 2, 3, 4, 5, 6"])
);

check(
  "truncated tail block is cut, head preserved",
  JSON.stringify(vttCueTexts(assBody(["Tail {\\fad(200,200"]))),
  JSON.stringify(["Tail"])
);

// --- Service VTT window: same guarantees end to end. ---
const track = { codecId: "S_TEXT/ASS" };
const toPayload = (line) => Buffer.from(line, "utf8");
const drawingLine = "0,0,Default,,0,0,0,,{\\p1}m 64.89 68.77 l 64.17 67.11{\\p0}";
const fragmentLine =
  "1,0,Default,,0,0,0,,320,820,640)\\frz358.4\\org(1889.15,82.92)\\c&H1B1516&}Menacing";
const taggedLine = "2,0,Default,,0,0,0,,{\\an8\\pos(1011.12,955.26)}Placed";
const normalLine = "3,0,Default,,0,0,0,,Normal line";
const pathLine = "4,0,Default,,0,0,0,,Path C:\\temp} ready";
const tailLine = "5,0,Default,,0,0,0,,Tail {\\fad(200,200";
const window = service.buildTextSubtitleWindowPayload(
  track,
  [
    { payload: toPayload(drawingLine), timestampMs: 15000, durationMs: 2000 },
    { payload: toPayload(fragmentLine), timestampMs: 12000, durationMs: 2000 },
    { payload: toPayload(taggedLine), timestampMs: 13000, durationMs: 1000 },
    { payload: toPayload(normalLine), timestampMs: 18000, durationMs: 2000 },
    { payload: toPayload(pathLine), timestampMs: 21000, durationMs: 2000 },
    { payload: toPayload(tailLine), timestampMs: 22000, durationMs: 2000 }
  ],
  0,
  60000,
  { includeAssBody: true }
);

check("VTT body has no drawing coordinates", window.body.includes("64.89"), false);
check("VTT preserves unbraced literal command text", window.body.includes("frz358"), true);
check("VTT body keeps readable cue", window.body.includes("Normal line"), true);
check("VTT body keeps placed cue text", window.body.includes("Placed"), true);
check("VTT body has no override braces", window.body.includes("{\\an8"), false);
check("VTT body keeps windows path", window.body.includes("Path C:\\temp} ready"), true);
check("VTT body cuts truncated tail, keeps head", window.body.includes("Tail"), true);
check("VTT body has no tail residue", window.body.includes("fad(200,200"), false);
check(
  "ASS body keeps drawing payload for ass.js",
  window.assBody.includes("{\\p1}m 64.89 68.77 l 64.17 67.11{\\p0}"),
  true
);
check(
  "ASS body preserves extracted text regardless of numeric signature",
  window.assBody.includes("frz358"),
  true
);
check(
  "ASS body keeps tagged event intact",
  window.assBody.includes("{\\an8\\pos(1011.12,955.26)}Placed"),
  true
);
check("ASS body keeps windows path event", window.assBody.includes("Path C:\\temp} ready"), true);

const adversarialCases = [
  ["Use \\fs2, please", "Use \\fs2, please"],
  ["Path C:\\fs2, ready}", "Path C:\\fs2, ready}"],
  ["{\\pos(10,20)}Hello, world", "Hello, world"],
  ["{\\p1}m 0 0 l 1 1{\\p0\\bord2}Hello", "Hello"],
  ["{\\p0\\p1}m 0 0 l 1 1{\\p0}Hello", "Hello"],
  ["{\\p1}m 0 0{\\rDefault}Hello", "Hello"],
  ["{\\t(0,100,\\p1)}Hello", "Hello"],
  ["Set {unfinished", "Set {unfinished"]
];
for (const [input, expected] of adversarialCases) {
  check(
    `external preserves ${input}`,
    JSON.stringify(vttCueTexts(assBody([input]))),
    JSON.stringify([expected])
  );
  const result = service.buildTextSubtitleWindowPayload(
    track,
    [{ payload: toPayload(`0,2,Default,,0,0,0,,${input}`), timestampMs: 1000, durationMs: 1000 }],
    0,
    3000,
    { includeAssBody: true }
  );
  check(
    `embedded preserves ${input}`,
    result.body.split("\n").slice(4).join("\n").trim(),
    expected
  );
  check(`styled preserves ${input}`, result.assBody.includes(input), true);
}
check(
  "styled event excludes unfinished override tail",
  window.assBody.includes("fad(200,200"),
  false
);
check("window preserves advanced styling signal", window.hasAdvancedAssOverrideTags, true);
const plainWindow = service.buildTextSubtitleWindowPayload(
  { codecId: "S_TEXT/UTF8" },
  [{ payload: toPayload("Set {one}, use \\fs2, please"), timestampMs: 1000, durationMs: 1000 }],
  0,
  3000,
  {}
);
check(
  "non ASS prose keeps braces and commands",
  plainWindow.body.includes("Set {one}, use \\fs2, please"),
  true
);
const layeredWindow = service.buildTextSubtitleWindowPayload(
  track,
  [
    {
      payload: toPayload("533,2,Onscreen1,Screen,0,0,0,Banner,Hello"),
      timestampMs: 1000,
      durationMs: 1000
    }
  ],
  0,
  3000,
  {}
);
check(
  "Matroska read order is not layer",
  layeredWindow.assBody.includes(
    "Dialogue: 2,0:00:01.00,0:00:02.00,Onscreen1,Screen,0,0,0,Banner,Hello"
  ),
  true
);

check(
  "timestamp-like plain text is not an event",
  service.normalizeTextSubtitlePayload(
    { codecId: "S_TEXT/UTF8" },
    toPayload("0,0:00:01.00,0:00:02.00,A,B,C,D,E,F,Hello")
  ),
  "0,0:00:01.00,0:00:02.00,A,B,C,D,E,F,Hello"
);
const commaWindow = service.buildTextSubtitleWindowPayload(
  track,
  [
    {
      payload: toPayload("1,2,Default,,10,20,30,Banner,Hello, one, two"),
      timestampMs: 1000,
      durationMs: 500
    }
  ],
  0,
  3000,
  {}
);
check(
  "positional text retains commas and block duration",
  commaWindow.assBody.includes(
    "Dialogue: 2,0:00:01.00,0:00:01.50,Default,,10,20,30,Banner,Hello, one, two"
  ),
  true
);

// The renderer receives every balanced tag; only plain-text fallback removes
// drawing paths and override syntax. Embedded input uses Matroska packets.
const animatedText =
  "{\\move(10,20,30,40,0,500)\\t(0,500,\\fscx120)}{\\p1}m 0 0 l 10 10{\\p0}{\\k20}Hello, {\\kf30}world";
{
  const payload = `7,2,Default,,0,0,0,,${animatedText}`;
  const animatedWindow = service.buildTextSubtitleWindowPayload(
    track,
    [{ payload: toPayload(payload), timestampMs: 1000, durationMs: 1000 }],
    0,
    3000,
    {}
  );
  check(
    "ASS preserves animation, drawing, karaoke and commas",
    animatedWindow.assBody
      .split("\n")
      .filter((line) => line.startsWith("Dialogue:"))
      .join("\n"),
    `Dialogue: 2,0:00:01.00,0:00:02.00,Default,,0,0,0,,${animatedText}`
  );
  check(
    "VTT renders only readable animated dialogue",
    animatedWindow.body,
    "WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\nHello, world\n\n"
  );
}

// Both outputs retain literal text; only an unfinished override tail is removed.
{
  const envelope = (text) => `7,2,Default,,0,0,0,,${text}`;
  for (const [text, expectedEvent, expectedVtt] of [
    [
      "Tail {\\fad(200,200",
      "Dialogue: 2,0:00:01.00,0:00:02.00,Default,,0,0,0,,Tail ",
      "WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\nTail\n\n"
    ],
    [
      "320,820,640)\\frz358.4\\org(1889.15,82.92)\\c&H1B1516&}Menacing",
      "Dialogue: 2,0:00:01.00,0:00:02.00,Default,,0,0,0,,320,820,640)\\frz358.4\\org(1889.15,82.92)\\c&H1B1516&}Menacing",
      "WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\n320,820,640)\\frz358.4\\org(1889.15,82.92)\\c&H1B1516&}Menacing\n\n"
    ]
  ]) {
    const result = service.buildTextSubtitleWindowPayload(
      track,
      [{ payload: toPayload(envelope(text)), timestampMs: 1000, durationMs: 1000 }],
      0,
      3000,
      {}
    );
    check(
      `ASS preserves exact extracted event: ${text}`,
      result.assBody
        .split("\n")
        .filter((line) => line.startsWith("Dialogue:"))
        .join("\n"),
      expectedEvent
    );
    check(`VTT filtering exception has exact output: ${text}`, result.body, expectedVtt);
  }
}
const customHeader = [
  "[Script Info]",
  "PlayResX: 1280",
  "PlayResY: 720",
  "[V4+ Styles]",
  "Format: Name, Fontname, Fontsize",
  "Style: Onscreen1,Arial,42",
  "[Events]",
  "Format: Start, End, Layer, Style, Name, MarginL, MarginR, MarginV, Effect, Text"
].join("\n");
const headerWindow = service.buildTextSubtitleWindowPayload(
  { codecId: "S_TEXT/ASS", codecPrivate: Buffer.from(customHeader) },
  [
    {
      payload: toPayload("533,2,Onscreen1,Screen,0,0,0,,{\\pos(320,240)}Hello, world"),
      timestampMs: 1000,
      durationMs: 1000
    }
  ],
  0,
  3000,
  {}
);
check(
  "reconstructed events match declared column order",
  JSON.stringify(
    convertAssDialogueToVttCues(headerWindow.assBody).map(({ start, end, text }) => ({
      start,
      end,
      text
    }))
  ),
  JSON.stringify([{ start: 1, end: 2, text: "Hello, world" }])
);
check(
  "header reconstruction preserves resolution and styles",
  headerWindow.assBody.slice(0, headerWindow.assBody.indexOf("[Events]")),
  customHeader.slice(0, customHeader.indexOf("[Events]"))
);

// Isolate adapter acceptance from ass.js parsing: rendered dialogue must not
// be reclassified as control data by inspecting DOM text.
const { createAssRenderer } = await import("../js/core/player/assRenderer.js");
const previousAss = Object.getOwnPropertyDescriptor(globalThis, "ASS");
const previousObserver = Object.getOwnPropertyDescriptor(globalThis, "ResizeObserver");
try {
  globalThis.ResizeObserver = class {};
  for (const renderedText of [
    "533,2,Onscreen1,Screen,0,0,0,Banner,Hello",
    "Dialogue: 0,0:00:01.00,0:00:02.00 is an example"
  ]) {
    let destroyed = false;
    const container = {
      textContent: "",
      replaceChildren() {
        this.textContent = "";
      }
    };
    globalThis.ASS = class {
      constructor() {
        container.textContent = renderedText;
      }
      destroy() {
        destroyed = true;
      }
    };
    const renderer = createAssRenderer({
      body: assBody([renderedText]),
      video: { paused: true },
      container
    });
    const result = await renderer.init();
    check("renderer accepts literal field-shaped dialogue", result.ok, true);
    check("renderer keeps field-shaped dialogue visible", container.textContent, renderedText);
    check("renderer does not destroy valid output", destroyed, false);
    renderer.destroy();
  }
} finally {
  if (previousAss) Object.defineProperty(globalThis, "ASS", previousAss);
  else delete globalThis.ASS;
  if (previousObserver) Object.defineProperty(globalThis, "ResizeObserver", previousObserver);
  else delete globalThis.ResizeObserver;
}

if (failures > 0) {
  console.error(`${failures} failing case(s)`);
  process.exit(1);
}
console.log("All ASS plain-text fallback cases pass.");
