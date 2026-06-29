"use strict";

// Audio polish smoke suite for Podcast Design Canvas (#15, #257).
// Guards quality presets, per-speaker tracks, DSP outputs, and review summary.
// Run with: `node tests/audio-polish.test.js`.

const assert = require("assert");
const setup = require("../app/episode-setup.js");
const audio = require("../app/audio-polish.js");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok ${name}`);
}

function completeUploadDraft() {
  const draft = setup.createDraft();
  draft.episodeName = "Founders Unfiltered #7";
  draft.sourceMode = "upload";
  draft.speakers = [
    Object.assign(setup.createSpeaker("Host"), { name: "Sam Rivera" }),
    Object.assign(setup.createSpeaker("Guest 1"), { name: "Dana Kim" }),
    Object.assign(setup.createSpeaker("Guest 2"), { name: "Marco Vidal" }),
  ];
  draft.speakers.forEach((speaker, index) => {
    const fileName = ["sam.mp4", "dana.mp4", "marco.mp4"][index];
    setup.attachSourceMediaAsset(speaker, {
      assetId: `source-media-${index + 1}`,
      fileName,
      fileSize: 4096,
      mimeType: "video/mp4",
      storage: "indexedDB",
    });
  });
  return draft;
}

function appliedPolishForEpisode(episode, polishState) {
  return audio.applyPolishForEpisode(episode, polishState || audio.createPolish(episode)).applied;
}

test("offers Natural, Clean, and Studio quality presets", () => {
  assert.strictEqual(audio.QUALITY_PRESETS.length, 3);
  const ids = audio.QUALITY_PRESETS.map((preset) => preset.id);
  assert.deepStrictEqual(ids, ["natural", "clean", "studio"]);
  audio.QUALITY_PRESETS.forEach((preset) => {
    assert.ok(preset.name && preset.tagline, `${preset.id} is described for creators`);
  });
});

test("createPolish seeds speaker tracks from the episode summary", () => {
  const episode = setup.summarize(completeUploadDraft());
  const polish = audio.createPolish(episode);
  assert.strictEqual(polish.presetId, "clean");
  assert.strictEqual(polish.speakers.length, 3);
  assert.deepStrictEqual(polish.speakers.map((track) => track.role), ["Host", "Guest 1", "Guest 2"]);
  assert.strictEqual(polish.speakers[0].sourceLabel, "sam.mp4");
  assert.strictEqual(polish.speakers[0].sourceMode, "upload");
});

test("createPolish preserves imported source media references for downstream processing", () => {
  const draft = setup.createDraft();
  draft.episodeName = "Founders Unfiltered #7";
  draft.sourceMode = "upload";
  draft.speakers = [
    Object.assign(setup.createSpeaker("Host"), { name: "Sam Rivera" }),
    Object.assign(setup.createSpeaker("Guest 1"), { name: "Dana Kim", fileName: "dana.mp4" }),
    Object.assign(setup.createSpeaker("Guest 2"), { name: "Marco Vidal", fileName: "marco.mp4" }),
  ];
  setup.attachSourceMediaAsset(draft.speakers[0], {
    assetId: "source-media-sam",
    fileName: "sam.wav",
    fileSize: 8192,
    mimeType: "audio/wav",
    storage: "indexedDB",
    storedAt: 1760000000000,
  });
  const episode = setup.summarize(draft);
  const polish = audio.createPolish(episode);
  assert.strictEqual(polish.speakers[0].hasSourceMedia, true);
  assert.deepStrictEqual(polish.speakers[0].sourceMedia, episode.speakers[0].sourceMedia);
  assert.strictEqual(polish.speakers[1].hasSourceMedia, false);

  const summary = audio.summarizePolish(polish);
  assert.strictEqual(summary.sourceMediaCount, 1);
  assert.strictEqual(summary.sourceMediaReady, false);
  assert.strictEqual(summary.polishComplete, false);
});

test("applyPreset updates all polish controls", () => {
  const episode = setup.summarize(completeUploadDraft());
  let polish = audio.createPolish(episode);
  polish = audio.applyPreset(polish, "studio");
  assert.strictEqual(polish.presetId, "studio");
  assert.strictEqual(polish.noiseCleanup, "strong");
  assert.strictEqual(polish.leveling, "strong");
  assert.strictEqual(polish.speechClarity, "strong");
  assert.strictEqual(polish.enhancement, "strong");
});

test("updateControl changes a single polish dimension", () => {
  const episode = setup.summarize(completeUploadDraft());
  let polish = audio.createPolish(episode);
  polish = audio.updateControl(polish, "noiseCleanup", "light");
  assert.strictEqual(polish.noiseCleanup, "light");
  assert.strictEqual(polish.leveling, "balanced");
});

test("summarizePolish reflects the chosen treatment", () => {
  const episode = setup.summarize(completeUploadDraft());
  const polish = audio.applyPreset(audio.createPolish(episode), "natural");
  const summary = audio.summarizePolish(polish);
  assert.strictEqual(summary.presetName, "Natural");
  assert.strictEqual(summary.noiseCleanupLabel, "Light");
  assert.ok(summary.treatmentLine.includes("Noise cleanup: Light"));
  assert.strictEqual(summary.speakerCount, 3);
  assert.strictEqual(summary.polishComplete, false);
});

function decodeSampleRecording(index) {
  const rec = require("../app/sample-recordings.js").sampleRecording(index || 0);
  const base64 = rec.dataUrl.split(",")[1];
  const bytes = Uint8Array.from(Buffer.from(base64, "base64"));
  return audio.decodeWav(bytes);
}

test("ships real sample recordings that decode to 16-bit PCM audio", () => {
  const recordings = require("../app/sample-recordings.js").SAMPLE_RECORDINGS;
  assert.ok(recordings.length >= 2);
  recordings.forEach((rec) => {
    assert.ok(rec.dataUrl.indexOf("data:audio/wav;base64,") === 0);
    assert.ok(rec.byteLength > 44);
  });
  const decoded = decodeSampleRecording(0);
  assert.ok(decoded.sampleRate > 0);
  assert.ok(decoded.samples.length > 0);
});

test("polishSamples transforms audio and encodeWav round-trips in Node", () => {
  const { samples, sampleRate } = decodeSampleRecording(0);
  const before = audio.rmsOfSamples(samples);
  const polished = audio.polishSamples(samples, sampleRate, {
    noiseCleanup: "strong",
    leveling: "strong",
    speechClarity: "strong",
    enhancement: "strong",
  });
  const after = audio.rmsOfSamples(polished);
  assert.notStrictEqual(before, after);

  const wav = audio.encodeWav(polished, sampleRate);
  assert.ok(wav.byteLength > 44);
  const decoded = audio.decodeWav(wav);
  assert.strictEqual(decoded.sampleRate, sampleRate);
  assert.strictEqual(decoded.samples.length, polished.length);
});

test("riverside-only episodes do not fake-complete polish without uploaded speaker media", () => {
  const draft = setup.createDraft();
  draft.episodeName = "Indie Makers Weekly — Episode 3";
  draft.riversideLink = "https://riverside.fm/studio/indie-makers-ep3";
  const episode = setup.summarize(draft);
  const applied = audio.applyPolishForEpisode(episode).applied;
  assert.strictEqual(applied.polishComplete, false);
  assert.strictEqual(applied.allTracksPolished, false);
  assert.strictEqual(applied.polishedTrackCount, 0);
  assert.ok(applied.exportAudioTracks.every((track) => !track.usesPolishedAudio));
  assert.ok(applied.polishedTracks.every((track) => track.status === "needs-media"));
});

test("processPolishTracks creates polished outputs for every source track", () => {
  const episode = setup.summarize(completeUploadDraft());
  const polish = audio.createPolish(episode);
  const outcome = audio.processPolishTracks(polish, audio.defaultSampleLoader);
  assert.strictEqual(outcome.complete, true);
  assert.strictEqual(outcome.results.length, 3);
  outcome.results.forEach((track) => {
    assert.strictEqual(track.status, "complete");
    assert.ok(track.polishedAsset && track.polishedAsset.assetId);
    assert.ok(track.byteLength > 44);
    assert.ok(track.metrics && typeof track.metrics.inputRms === "number");
    assert.ok(track.metrics.outputRms >= 0);
  });
  const applied = audio.summarizePolish(outcome.polish, { polishedTracks: outcome.results });
  assert.strictEqual(applied.polishedTrackCount, 3);
  assert.strictEqual(applied.allTracksPolished, true);
  assert.strictEqual(applied.polishComplete, true);
  assert.strictEqual(applied.exportAudioTracks.length, 3);
  assert.strictEqual(applied.exportAudioTracks[0].usesPolishedAudio, true);
});

test("buildReviewSummary includes audio in the export path when polish is complete", () => {
  const episode = setup.summarize(completeUploadDraft());
  const applied = appliedPolishForEpisode(episode);
  const review = audio.buildReviewSummary(episode, applied, {
    styleName: "Studio Spotlight",
    templateName: "Founders Unfiltered",
  });
  assert.strictEqual(review.episodeName, "Founders Unfiltered #7");
  assert.strictEqual(review.audioPreset, "Clean");
  assert.strictEqual(review.styleName, "Studio Spotlight");
  assert.strictEqual(review.readyForExport, true);
  assert.ok(review.summaryLines.some((line) => line.indexOf("Audio:") === 0));
  assert.ok(review.summaryLines.some((line) => line.indexOf("Polished tracks:") === 0));
});

test("ACCEPTANCE: episode setup flows into audio polish and saves a review summary", () => {
  const draft = completeUploadDraft();
  assert.strictEqual(setup.validateDraft(draft).ok, true);

  const episode = setup.summarize(draft);
  let polish = audio.createPolish(episode);
  assert.strictEqual(polish.speakers.length, episode.speakerCount);

  polish = audio.applyPreset(polish, "clean");
  polish = audio.updateControl(polish, "speechClarity", "strong");
  const applied = audio.applyPolishForEpisode(episode, polish).applied;
  assert.strictEqual(applied.presetName, "Clean");
  assert.strictEqual(applied.speechClarityLabel, "Strong");
  assert.strictEqual(applied.polishedTrackCount, 3);
  assert.strictEqual(applied.polishComplete, true);

  const review = audio.buildReviewSummary(episode, applied, {});
  assert.strictEqual(review.readyForExport, true);
  assert.ok(review.audioTreatment.includes("Speech clarity: Strong"));
});

console.log(`\naudio polish: ${passed} assertions passed`);
