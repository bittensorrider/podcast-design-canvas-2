"use strict";

// Transcript and caption correction smoke suite for Podcast Design Canvas (#63).
// Run with: `node tests/transcript-correction.test.js`.

const assert = require("assert");
const setup = require("../app/episode-setup.js");
const style = require("../app/episode-style.js");
const audio = require("../app/audio-polish.js");
const moments = require("../app/visual-moments.js");
const context = require("../app/social-context.js");
const publishPackage = require("../app/publish-package.js");
const exportApi = require("../app/episode-export.js");
const correction = require("../app/transcript-correction.js");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok ${name}`);
}

function draftWithSocial() {
  const draft = setup.createDraft();
  draft.episodeName = "Founders Unfiltered #7";
  draft.sourceMode = "upload";
  draft.speakers = [
    Object.assign(setup.createSpeaker("Host"), {
      name: "Sam Rivera",
      fileName: "sam.mp4",
      social: { website: "https://samrivera.show", twitter: "https://x.com/samrivera" },
    }),
    Object.assign(setup.createSpeaker("Guest 1"), {
      name: "Dana Kim",
      fileName: "dana.mp4",
      social: { linkedin: "https://linkedin.com/in/danakim" },
    }),
  ];
  return draft;
}

function buildBoard(episode) {
  let board = moments.createBoard(episode);
  board = moments.addMoment(board, "caption", {
    time: "1:00",
    text: "Welcome back, this is Sam Rivira",
    speakerRole: "Host",
    speakerName: "Sam Rivera",
  });
  board = moments.addMoment(board, "title", {
    time: "2:30",
    text: "Building in public",
    speakerRole: "Host",
    speakerName: "Sam Rivera",
  });
  return board;
}

test("createCorrectionReview populates lines from social context and visual moments", () => {
  const episode = setup.summarize(draftWithSocial());
  const contextReview = context.approveReview(context.createReview(episode));
  const board = buildBoard(episode);
  const review = correction.createCorrectionReview(episode, {
    contextReview: contextReview,
    momentsBoard: board,
  });

  assert.ok(review.lines.length >= 2);
  assert.ok(review.speakers.some((speaker) => speaker.label === "Sam Rivera"));
  assert.ok(review.lines.some((line) => line.kind === "caption"));
  assert.ok(review.lines.some((line) => line.kind === "transcript"));
});

test("hour-plus moment lines keep their place and hour in the review order (#266)", () => {
  const episode = setup.summarize(draftWithSocial());
  const contextReview = context.approveReview(context.createReview(episode));
  let board = moments.createBoard(episode);
  board = moments.addMoment(board, "title", {
    time: "2:30",
    text: "Building in public",
    speakerRole: "Host",
    speakerName: "Sam Rivera",
  });
  board = moments.addMoment(board, "caption", {
    time: "01:30:00",
    text: "Closing thoughts",
    speakerRole: "Host",
    speakerName: "Sam Rivera",
  });

  const review = correction.createCorrectionReview(episode, {
    contextReview: contextReview,
    momentsBoard: board,
  });

  const hourLine = review.lines.find((line) => line.momentId && line.originalText === "Closing thoughts");
  const earlyLine = review.lines.find((line) => line.momentId && line.originalText === "Building in public");
  assert.strictEqual(hourLine.time, "01:30:00", "hour-plus moment keeps its hour in review");
  assert.ok(
    review.lines.indexOf(hourLine) > review.lines.indexOf(earlyLine),
    "hour-plus moment sorts after the 2:30 moment rather than collapsing to 30:00",
  );
});

test("createCorrectionReview keeps already-correct speaker names exact", () => {
  const episode = setup.summarize(draftWithSocial());
  const contextReview = context.approveReview(context.createReview(episode));
  let board = moments.createBoard(episode);
  board = moments.addMoment(board, "caption", {
    time: "0:20",
    text: "Welcome Sam Rivera",
    speakerRole: "Host",
    speakerName: "Sam Rivera",
  });

  const review = correction.createCorrectionReview(episode, {
    contextReview: contextReview,
    momentsBoard: board,
  });
  const captionLine = review.lines.find((line) => line.kind === "caption");
  const transcriptLine = review.lines.find((line) => line.kind === "transcript" && line.speakerRole === "Host");

  assert.strictEqual(captionLine.text, "Welcome Sam Rivera");
  assert.ok(!captionLine.text.includes("Riveraa"));
  assert.ok(transcriptLine.text.includes("Sam Rivera"));
  assert.ok(!transcriptLine.text.includes("Riveraa"));
});

test("updateSpeaker and updateLine let creators edit labels and key text", () => {
  const episode = setup.summarize(draftWithSocial());
  let review = correction.createCorrectionReview(episode, { momentsBoard: buildBoard(episode) });
  review = correction.updateSpeaker(review, "Host", {
    label: "Sam R. Rivera",
    brand: "Rivera Media",
    topicTerms: "founders, SaaS",
  });
  const captionLine = review.lines.find((line) => line.kind === "caption");
  review = correction.updateLine(review, captionLine.id, {
    text: "Welcome back, this is Sam R. Rivera",
  });

  assert.strictEqual(review.speakers[0].label, "Sam R. Rivera");
  assert.strictEqual(review.lines.find((line) => line.id === captionLine.id).text, "Welcome back, this is Sam R. Rivera");
});

test("applyCorrectionReview updates captions, titles, publish package, and canvas copy", () => {
  const episode = setup.summarize(draftWithSocial());
  let review = correction.createCorrectionReview(episode, { momentsBoard: buildBoard(episode) });
  review = correction.updateSpeaker(review, "Host", { label: "Sam R. Rivera", brand: "Rivera Media" });
  const titleLine = review.lines.find((line) => line.kind === "title");
  review = correction.updateLine(review, titleLine.id, { text: "Building in Public" });
  review = correction.approveCorrection(review);

  const pkg = publishPackage.createPackage(episode, {
    appliedStyle: style.summarizeStyle(style.createSelection(), episode.speakerCount),
  });
  const applied = correction.applyCorrectionReview(review, {
    momentsBoard: buildBoard(episode),
    canvasDoc: { captionText: "Sam Rivira welcomes you", titleText: "Building in public", speakerFrames: [{ role: "Host", name: "Sam Rivera" }] },
    publishPackage: pkg,
    speakers: draftWithSocial().speakers,
  });

  const caption = applied.momentsBoard.moments.find((moment) => moment.type === "caption");
  assert.ok(caption.text.includes("Sam R. Rivera") || caption.speakerName === "Sam R. Rivera");
  assert.strictEqual(applied.canvasDoc.titleText, "Building in Public");
  assert.strictEqual(applied.speakers[0].name, "Sam R. Rivera");
  assert.ok(applied.publishPackage.description.includes("Sam R. Rivera") || applied.publishPackage.speakerCredits[0].name === "Sam R. Rivera");
});

test("summarizeCorrection feeds export metadata after approval", () => {
  const episode = setup.summarize(draftWithSocial());
  let review = correction.createCorrectionReview(episode, { momentsBoard: buildBoard(episode) });
  const captionLine = review.lines.find((line) => line.kind === "caption");
  review = correction.updateLine(review, captionLine.id, { text: "Welcome back, this is Sam R. Rivera" });
  review = correction.approveCorrection(review);
  const summary = correction.summarizeCorrection(review);

  const exportSummary = exportApi.buildFinalSummary(episode, {
    audioPolish: audio.applyPolishForEpisode(episode).applied,
    appliedStyle: style.summarizeStyle(style.createSelection(), episode.speakerCount),
    correctionSummary: summary,
  }, exportApi.createExport(episode));

  assert.ok(summary.reviewLine.includes("Transcript corrections"));
  assert.ok(exportSummary.lines.some((line) => /Transcript corrections/.test(line)));
});

test("ACCEPTANCE: edit transcript lines, apply corrections, and see updates across outputs", () => {
  const draft = draftWithSocial();
  const episode = setup.summarize(draft);
  const contextReview = context.approveReview(context.updateSpeaker(context.createReview(episode), 0, {
    displayName: "Sam R. Rivera",
    brand: "Rivera Media",
    spellingHints: "Sam Rivira, Sam River",
  }));
  let board = buildBoard(episode);
  let review = correction.createCorrectionReview(episode, {
    contextReview: contextReview,
    momentsBoard: board,
  });

  const captionLine = review.lines.find((line) => line.kind === "caption");
  review = correction.updateLine(review, captionLine.id, {
    text: "Sam R. Rivera: Welcome back to Founders Unfiltered",
  });
  review = correction.approveCorrection(review);

  const applied = correction.applyCorrectionReview(review, {
    momentsBoard: board,
    canvasDoc: { captionText: "Sam Rivira welcomes you", titleText: "Building in public" },
    publishPackage: publishPackage.createPackage(episode, {}),
    speakers: draft.speakers,
  });

  board = applied.momentsBoard;
  const caption = board.moments.find((moment) => moment.type === "caption");
  assert.ok(caption.text.includes("Sam R. Rivera"));
  assert.ok(applied.canvasDoc.captionText.includes("Sam R. Rivera"));
  assert.ok(!applied.publishPackage.description.includes("Riveraa"));
  assert.ok(applied.publishPackage.speakerCredits.some((credit) => credit.name === "Sam R. Rivera"));
  assert.strictEqual(applied.speakers[0].name, "Sam R. Rivera");
});

console.log(`\ntranscript correction: ${passed} assertions passed`);
