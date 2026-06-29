"use strict";

// Fresh episode setup creates the real workspace (#195).
// Run with: `node tests/fresh-episode-workspace.test.js`.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const setup = require("../app/episode-setup.js");
const style = require("../app/episode-style.js");
const audio = require("../app/audio-polish.js");
const workspace = require("../app/episode-workspace.js");
const library = require("../app/show-library.js");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok ${name}`);
}

const ui = fs.readFileSync(path.join(__dirname, "../app/episode-setup.ui.js"), "utf8");

function completeFreshDraft() {
  const draft = setup.createDraft();
  draft.episodeName = "Indie Makers Weekly — Episode 3";
  draft.riversideLink = "https://riverside.fm/studio/indie-makers-ep3";
  draft.speakers[0].name = "Jordan Lee";
  draft.speakers[0].social.twitter = "https://x.com/jordanlee";
  draft.speakers[1].name = "Priya Shah";
  draft.speakers[2].name = "Chris Ortiz";
  draft.speakers[2].social.linkedin = "https://linkedin.com/in/chrisortiz";
  return draft;
}

test("isSeededDemoEpisodeTitle flags gallery demo titles", () => {
  assert.strictEqual(setup.isSeededDemoEpisodeTitle("Founders Unfiltered #7"), true);
  assert.strictEqual(setup.isSeededDemoEpisodeTitle("Episode 12 — Building in Public"), true);
  assert.strictEqual(setup.isSeededDemoEpisodeTitle("Indie Makers Weekly — Episode 3"), false);
});

test("buildFreshEpisodePersistence carries creator-entered source, speakers, and preset", () => {
  const summary = setup.summarize(completeFreshDraft());
  const selection = style.applyPresetToSelection(style.createSelection(), "split-stage", false);
  const presetSummary = style.summarizeStyle(selection, summary.speakerCount).presetName;
  const record = setup.buildFreshEpisodePersistence(summary, { presetSummary, showName: "Indie Makers Weekly" });

  assert.strictEqual(record.episodeName, "Indie Makers Weekly — Episode 3");
  assert.strictEqual(record.showName, "Indie Makers Weekly");
  assert.ok(record.sourceDetail.includes("riverside.fm/studio/indie-makers-ep3"));
  assert.deepStrictEqual(record.speakerIdentities, ["Jordan Lee · Host", "Priya Shah · Guest 1", "Chris Ortiz · Guest 2"]);
  assert.ok(record.presetSummary.length > 0);
  assert.ok(!setup.isSeededDemoEpisodeTitle(record.episodeName));
});

test("ACCEPTANCE: fresh handoff summary rejects seeded demo episode titles", () => {
  const fresh = setup.summarize(completeFreshDraft());
  assert.strictEqual(
    setup.isFreshHandoffSummary(fresh, {
      expectedEpisodeName: "Indie Makers Weekly — Episode 3",
      expectedSpeakerNames: ["Jordan Lee", "Priya Shah", "Chris Ortiz"],
    }),
    true,
  );

  const demo = setup.createDraft();
  demo.episodeName = "Episode 12 — Building in Public";
  demo.riversideLink = "https://riverside.fm/studio/demo";
  demo.speakers.forEach((speaker, index) => {
    speaker.name = ["Sam Rivera", "Dana Kim", "Alex Chen"][index];
  });
  assert.strictEqual(setup.isFreshHandoffSummary(setup.summarize(demo)), false);
});

test("ACCEPTANCE: riverside-only setup does not fake-complete audio polish without uploaded bytes", () => {
  const summary = setup.summarize(completeFreshDraft());
  const polish = audio.applyPolishForEpisode(summary).applied;
  assert.strictEqual(polish.polishComplete, false);
  assert.ok(polish.exportAudioTracks.every((track) => !track.usesPolishedAudio));
});

test("ACCEPTANCE: workspace checklist and audio tracks reflect the fresh setup summary", () => {
  const summary = setup.summarize(completeFreshDraft());
  const selection = style.applyPresetToSelection(style.createSelection(), "studio-spotlight", false);
  const appliedStyle = style.summarizeStyle(selection, summary.speakerCount);
  const polish = audio.applyPolishForEpisode(summary).applied;

  const ws = workspace.buildWorkspace(summary, {
    appliedStyle: appliedStyle,
    audioPolish: polish,
    contextApproved: false,
  });
  const setupStage = workspace.getStage(ws, "setup");
  assert.ok(setupStage.summary.includes("Jordan Lee · Host"));
  assert.ok(setupStage.summary.includes("indie-makers-ep3"));
  assert.ok(setupStage.summary.includes("2 social links saved"));

  assert.deepStrictEqual(
    polish.exportAudioTracks.map((track) => track.name),
    ["Jordan Lee", "Priya Shah", "Chris Ortiz"],
  );
  assert.ok(!polish.exportAudioTracks.some((track) => /founders unfiltered|building in public|episode 12/i.test(track.name)));
});

test("ACCEPTANCE: setup handoff persists a new library episode instead of reusing show identity start", () => {
  assert.ok(ui.includes("function ensureFreshEpisodeRecord"));
  assert.ok(ui.includes("function refreshProductionArtifactsForFreshEpisode"));
  assert.ok(ui.includes("ensureFreshEpisodeRecord(summary)"));

  const handoffBlock = ui.slice(ui.indexOf("function tryCompleteSetupHandoff"), ui.indexOf("function onContinue()"));
  assert.ok(handoffBlock.includes("ensureFreshEpisodeRecord"));

  const finalizeBlock = ui.slice(ui.indexOf("function finalizePendingShowCreation"), ui.indexOf("function renderFirstEpisodeImport"));
  assert.ok(!finalizeBlock.includes("applyEpisodeStart"));

  const startBlock = ui.slice(ui.indexOf("function startEpisodeFromShow"), ui.indexOf("function resumeEpisodeFromShow"));
  assert.ok(startBlock.includes("activeEpisodeId = null"));
  assert.ok(!startBlock.includes("LIB.createEpisode"));
});

test("ACCEPTANCE: persisted library episode record matches fresh setup data", () => {
  const summary = setup.summarize(completeFreshDraft());
  const selection = style.applyPresetToSelection(style.createSelection(), "split-stage", false);
  const presetName = style.summarizeStyle(selection, summary.speakerCount).presetName;
  let lib = library.createLibrary();
  const show = library.createShow("Indie Makers Weekly", {});
  lib = library.addShow(lib, show);
  const episode = library.createEpisode(show.id, summary.episodeName, {
    presetName: presetName,
    speakerRoles: summary.speakers.map((speaker) => speaker.role),
    status: library.EPISODE_STATUS.IN_PROGRESS,
  });
  lib = library.addEpisode(lib, show.id, episode);

  const stored = library.getShow(lib, show.id);
  const storedEpisode = library.listEpisodes(lib, show.id)[0];
  assert.strictEqual(storedEpisode.name, "Indie Makers Weekly — Episode 3");
  assert.strictEqual(storedEpisode.presetName, presetName);
  assert.deepStrictEqual(storedEpisode.speakerRoles, ["Host", "Guest 1", "Guest 2"]);
  assert.ok(stored.episodes.length === 1);
});

console.log(`\nfresh episode workspace: ${passed} assertions passed`);
