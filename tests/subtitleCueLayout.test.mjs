import test from "node:test";
import assert from "node:assert/strict";

import {
  buildHtmlSubtitleCue,
  getSubtitleAssAlignment,
  getSubtitleAssAlignmentSettings,
  parseVttCueLayout
} from "../js/core/player/subtitleCueLayout.js";

test("keeps Android-style percentage positioning for HTML subtitle cues", () => {
  const cue = {
    startTime: 12,
    endTime: 15,
    text: "  Hello  ",
    snapToLines: false,
    line: 90,
    align: "right"
  };

  assert.deepEqual(buildHtmlSubtitleCue(cue), {
    start: 12,
    end: 15,
    text: "Hello",
    line: 90,
    align: "end"
  });
});

test("uses original cue timing so subtitle delay is applied only once", () => {
  const delayedCue = {
    startTime: 13.5,
    endTime: 16.5,
    text: "Delayed",
    snapToLines: true,
    line: -1,
    align: "center"
  };
  const originalState = {
    startTime: 12,
    endTime: 15,
    snapToLines: true,
    line: -1
  };

  assert.deepEqual(buildHtmlSubtitleCue(delayedCue, originalState), {
    start: 12,
    end: 15,
    text: "Delayed",
    line: null,
    align: "center"
  });
});

test("rejects invalid cues and preserves existing ASS/VTT layout behavior", () => {
  assert.equal(buildHtmlSubtitleCue({ startTime: 4, endTime: 3, text: "Invalid" }), null);
  assert.equal(getSubtitleAssAlignment("{\\an7}Top left"), 7);
  assert.deepEqual(getSubtitleAssAlignmentSettings(7), { line: 10, align: "start" });
  assert.deepEqual(parseVttCueLayout("00:00:01.000 --> 00:00:02.000 line:120% align:left"), {
    line: 100,
    align: "start"
  });
});
