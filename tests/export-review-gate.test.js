"use strict";

// Export requires publish review approval (#179).
// Run with: `node tests/export-review-gate.test.js`.

const assert = require("assert");
const setup = require("../app/episode-setup.js");
const style = require("../app/episode-style.js");
const audio = require("../app/audio-polish.js");
const moments = require("../app/visual-moments.js");
const contextApi = require("../app/social-context.js");
const review = require("../app/publish-review.js");
const exportApi = require("../app/episode-export.js");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok ${name}`);
}

function completeDraft() {
  const draft = setup.createDraft();
  draft.episodeName = "Founders Unfiltered #7";
  draft.sourceMode = "upload";
  draft.speakers = [
    Object.assign(setup.createSpeaker("Host"), { name: "Sam Rivera", fileName: "sam.mp4" }),
    Object.assign(setup.createSpeaker("Guest 1"), { name: "Dana Kim", fileName: "dana.mp4" }),
    Object.assign(setup.createSpeaker("Guest 2"), { name: "Alex Chen", fileName: "alex.mp4" }),
  ];
  draft.speakers.forEach((speaker, index) => {
    setup.attachSourceMediaAsset(speaker, {
      assetId: `gate-media-${index + 1}`,
      fileName: speaker.fileName,
      fileSize: 4096,
      mimeType: "video/mp4",
      storage: "indexedDB",
    });
  });
  return draft;
}

function exportContext(episode, options) {
  const opts = options || {};
  const selection = style.createSelection();
  let board = moments.createBoard(episode);
  board = moments.addMoment(board, "caption", { time: "1:00", text: "Welcome back", speakerRole: "Host" });
  let contextReview = contextApi.createReview(episode);
  contextReview = contextApi.approveReview(contextReview);
  let publishReview = review.createReview(episode, {
    audioPolish: audio.applyPolishForEpisode(episode).applied,
    appliedStyle: style.summarizeStyle(selection, episode.speakerCount),
    templateName: "Founders Look",
    hasCanvas: true,
    contextApproved: true,
    contextSummary: contextApi.summarizeReview(contextReview),
    momentsSummary: moments.summarizeBoard(board),
    momentsBoard: board,
    captionCount: review.countVisibleCaptions(board),
  });
  if (opts.approved) {
    publishReview = review.approveReview(publishReview).review;
  }
  return {
    audioPolish: audio.applyPolishForEpisode(episode).applied,
    appliedStyle: style.summarizeStyle(selection, episode.speakerCount),
    templateName: "Founders Look",
    momentsSummary: moments.summarizeBoard(board),
    contextSummary: contextApi.summarizeReview(contextReview),
    publishReviewApproved: Boolean(opts.approved),
    publishReview: publishReview,
  };
}

test("validateExportAuthorization blocks export until publish review is approved", () => {
  const episode = setup.summarize(completeDraft());
  const ctx = exportContext(episode, { approved: false });

  assert.strictEqual(exportApi.validateReadiness(ctx).ok, true);
  assert.strictEqual(exportApi.validatePublishReviewGate(ctx).ok, false);
  assert.strictEqual(exportApi.validateExportAuthorization(ctx).ok, false);
});

test("runExport stays blocked without approval even when audio and style are ready", () => {
  const episode = setup.summarize(completeDraft());
  const ctx = exportContext(episode, { approved: false });
  const job = exportApi.createExport(episode);
  const blocked = exportApi.runExport(job, episode, ctx);

  assert.strictEqual(blocked.ok, false);
  assert.ok(blocked.error.toLowerCase().includes("publish review"));
  assert.strictEqual(blocked.state.status, "draft");
});

test("runExport completes after publish review approval", () => {
  const episode = setup.summarize(completeDraft());
  const ctx = exportContext(episode, { approved: true });
  const job = exportApi.createExport(episode);
  const result = exportApi.runExport(job, episode, ctx);

  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.state.status, "ready");
  assert.ok(result.state.downloadName.endsWith(".mp4"));
});

test("ACCEPTANCE: unreviewed episode cannot export; approved review unlocks export", () => {
  const episode = setup.summarize(completeDraft());
  let ctx = exportContext(episode, { approved: false });
  let job = exportApi.createExport(episode);

  assert.strictEqual(review.validateExportGate(ctx.publishReview).ok, false);
  assert.strictEqual(exportApi.runExport(job, episode, ctx).ok, false);

  ctx = exportContext(episode, { approved: true });
  assert.strictEqual(review.validateExportGate(ctx.publishReview).ok, true);
  assert.strictEqual(exportApi.validateExportAuthorization(ctx).ok, true);

  job = exportApi.createExport(episode);
  const result = exportApi.runExport(job, episode, ctx);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(exportApi.summarizeExport(result.state).ready, true);
});

console.log(`\nexport review gate: ${passed} test(s) passed.`);
