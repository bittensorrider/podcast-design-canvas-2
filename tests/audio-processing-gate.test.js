"use strict";

// Cross-module audio-processing gate suite for Podcast Design Canvas (#197).
// Confirms that episode-workspace, episode-export, and publish-review all require
// every speaker track to be actually polished — not just a preset chosen — before
// treating audio as complete / export-ready. Run with: `node tests/audio-processing-gate.test.js`.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const setup = require("../app/episode-setup.js");
const audio = require("../app/audio-polish.js");
const workspace = require("../app/episode-workspace.js");
const exportModel = require("../app/episode-export.js");
const review = require("../app/publish-review.js");
const mae = require("../app/media-audio-extract.js");

const uiSource = fs.readFileSync(path.join(__dirname, "../app/episode-setup.ui.js"), "utf8");
const stylesSource = fs.readFileSync(path.join(__dirname, "../app/styles.css"), "utf8");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok ${name}`);
}

function readyEpisode() {
  const draft = setup.createDraft();
  draft.episodeName = "Founders Unfiltered #7";
  draft.sourceMode = "upload";
  draft.speakers = [
    Object.assign(setup.createSpeaker("Host"), { name: "Sam Rivera", fileName: "sam.mp4" }),
    Object.assign(setup.createSpeaker("Guest 1"), { name: "Dana Kim", fileName: "dana.mp4" }),
  ];
  return setup.summarize(draft);
}

function styleContext() {
  return { presetName: "Studio Spotlight", layoutLabel: "Side by side", pacingLabel: "Brisk" };
}

test("episode-workspace: audio stage stays ACTIVE when a preset is chosen but tracks aren't processed", () => {
  const episode = readyEpisode();
  const pendingPolish = audio.summarizePolish(audio.createPolish(episode));
  const ws = workspace.buildWorkspace(episode, { appliedStyle: styleContext(), audioPolish: pendingPolish });
  const audioStage = workspace.getStage(ws, "audio");
  assert.strictEqual(audioStage.status, "active");
  assert.ok(/chosen — apply it/.test(audioStage.summary));
});

test("episode-workspace: audio stage becomes COMPLETE only once every track is polished", () => {
  const episode = readyEpisode();
  const polished = audio.summarizePolish(audio.processTracks(audio.createPolish(episode)));
  const ws = workspace.buildWorkspace(episode, { appliedStyle: styleContext(), audioPolish: polished });
  const audioStage = workspace.getStage(ws, "audio");
  assert.strictEqual(audioStage.status, "complete");
  assert.ok(audioStage.summary.includes("2/2 tracks polished"));
});

test("episode-export: validateReadiness blocks export until every track is polished", () => {
  const episode = readyEpisode();
  const pendingPolish = audio.summarizePolish(audio.createPolish(episode));
  const blocked = exportModel.validateReadiness({ audioPolish: pendingPolish, appliedStyle: styleContext() });
  assert.strictEqual(blocked.ok, false);
  assert.ok(blocked.missing.includes("audio"));

  const polished = audio.summarizePolish(audio.processTracks(audio.createPolish(episode)));
  const ready = exportModel.validateReadiness({ audioPolish: polished, appliedStyle: styleContext() });
  assert.strictEqual(ready.ok, true);
});

test("episode-export: final summary carries the polished track references forward, not raw sources", () => {
  const episode = readyEpisode();
  const polished = audio.summarizePolish(audio.processTracks(audio.createPolish(episode)));
  const ctx = { audioPolish: polished, appliedStyle: styleContext() };
  const job = exportModel.createExport(episode, {});
  const finalSummary = exportModel.buildFinalSummary(episode, ctx, job);
  assert.strictEqual(finalSummary.polishedAudioTracks.length, 2);
  finalSummary.polishedAudioTracks.forEach((track) => assert.ok(track.outputRef));
  assert.ok(finalSummary.lines.some((line) => line.includes("2/2 tracks polished")));
});

test("REGRESSION (#197): export's polished track list carries the real audio asset, not a placeholder", () => {
  const episode = readyEpisode();
  const polished = audio.summarizePolish(audio.processTracks(audio.createPolish(episode)));
  const ctx = { audioPolish: polished, appliedStyle: styleContext() };
  const job = exportModel.createExport(episode, {});
  const finalSummary = exportModel.buildFinalSummary(episode, ctx, job);

  finalSummary.polishedAudioTracks.forEach((track) => {
    assert.ok(track.assetBase64, "export must hand off the real polished bytes for each track, not just a reference string");
    const url = audio.audioDataUrl(track);
    assert.ok(url && url.indexOf("data:audio/wav;base64,") === 0, "export-ready tracks must be playable, proving they are real assets");
  });
});

test("publish-review: blocks approval with 'incomplete' messaging when preset chosen but not applied", () => {
  const episode = readyEpisode();
  const pendingPolish = audio.summarizePolish(audio.createPolish(episode));
  const r = review.createReview(episode, { audioPolish: pendingPolish, appliedStyle: styleContext() });
  const audioCheck = r.checks.find((item) => item.sectionId === "audio");
  assert.strictEqual(audioCheck.id, "audio-incomplete");
  assert.strictEqual(audioCheck.passed, false);
  assert.strictEqual(review.canApprove(r), false);
});

test("publish-review: approves audio section and unlocks export readiness once tracks are polished", () => {
  const episode = readyEpisode();
  const polished = audio.summarizePolish(audio.processTracks(audio.createPolish(episode)));
  const r = review.createReview(episode, { audioPolish: polished, appliedStyle: styleContext() });
  const audioCheck = r.checks.find((item) => item.sectionId === "audio");
  assert.strictEqual(audioCheck.id, "audio-ready");
  assert.strictEqual(audioCheck.passed, true);
  const exportCheck = r.checks.find((item) => item.id === "export-ready");
  assert.ok(exportCheck, "export should be marked ready once audio and style are both fully set");
});

test("REGRESSION (PR #249 review): the style-preset explore/preview shortcut must not fabricate pre-processed audio", () => {
  const fnMatch = uiSource.match(/function openStylePickerDemo\(\)\s*\{[\s\S]*?\n  \}/);
  assert.ok(fnMatch, "expected to find openStylePickerDemo() in episode-setup.ui.js");
  assert.ok(
    !fnMatch[0].includes("AP.processTracks"),
    "this explore-only shortcut must not call processTracks — only the real Apply audio & continue action may mark speaker tracks as polished",
  );
  assert.ok(
    fnMatch[0].includes("AP.createPolish"),
    "the shortcut should still seed an (unprocessed) polish object so the audio step renders normally if visited",
  );
});

test("REGRESSION (#197 PR #251): episode summarize loads decoded fixture speaker tracks", () => {
  const episode = readyEpisode();
  episode.speakers.forEach((speaker) => {
    assert.ok(speaker.sourceAudioBase64, "import must attach decoded speaker-track audio before polish runs");
    assert.ok(mae.isValidWav(mae.base64ToBytes(speaker.sourceAudioBase64)));
  });
});

test("REGRESSION (#197 PR #251): polish transforms decoded fixture PCM — not metadata synthesis", () => {
  const episode = readyEpisode();
  const polish = audio.createPolish(episode);
  const source = mae.decodeWav(mae.base64ToBytes(polish.speakers[0].sourceAudioBase64)).samples;
  const processed = audio.processTracks(polish);
  const polished = mae.decodeWav(mae.base64ToBytes(processed.speakers[0].assetBase64)).samples;
  assert.notDeepStrictEqual(Array.from(source.slice(0, 64)), Array.from(polished.slice(0, 64)));
});

test("REGRESSION (#197 PR #249 follow-up): Apply audio & continue renders a visible, one-time completion confirmation", () => {
  assert.ok(uiSource.includes("audioPolishJustApplied"), "a transient just-applied flag should drive a completion banner after Apply");
  assert.ok(uiSource.includes("audio-polish-applied-banner"), "the workspace should render a dedicated completion banner after Apply");
  assert.ok(stylesSource.includes(".audio-polish-applied-banner"), "the completion banner needs its own visible styling, not the default warning-banner look");
});

console.log(`\naudio processing gate: ${passed} assertions passed`);
