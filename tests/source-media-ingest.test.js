"use strict";

// Guards the browser upload path that preserves imported media bytes for later audio work.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const setup = require("../app/episode-setup.js");
const audio = require("../app/audio-polish.js");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok ${name}`);
}

const uiSource = fs.readFileSync(path.join(__dirname, "../app/episode-setup.ui.js"), "utf8");

test("browser upload path stores selected media bytes before marking the source durable", () => {
  assert.ok(uiSource.includes("indexedDB.open(SOURCE_MEDIA_DB_NAME, SOURCE_MEDIA_DB_VERSION)"));
  assert.ok(uiSource.includes("tx.objectStore(SOURCE_MEDIA_STORE).put(record)"));
  assert.ok(uiSource.includes("attachImportedSourceMedia(speaker, file, index).then"));
  assert.ok(uiSource.includes("ES.attachSourceMediaAsset(speaker, metadata)"));
  assert.ok(uiSource.includes('accept: "audio/*,video/*"'));
  assert.ok(uiSource.includes("function applyAudioPolish(summary)"));
  assert.ok(uiSource.includes("AP.runPolish(audioPolish"));
  assert.ok(uiSource.includes("savePolishedMediaBlob"));
});

test("durable imported media survives session serialization into audio polish", () => {
  const draft = setup.createDraft();
  draft.episodeName = "Real media handoff";
  draft.sourceMode = "upload";
  draft.speakers = [Object.assign(setup.createSpeaker("Host"), { name: "Avery Stone" })];
  setup.attachSourceMediaAsset(draft.speakers[0], {
    assetId: "session-host-media",
    fileName: "host-source.wav",
    fileSize: 12000,
    mimeType: "audio/wav",
    storage: "indexedDB",
    storedAt: 1760000000000,
  });

  const sessionSnapshot = JSON.parse(JSON.stringify({ setupDraft: draft }));
  const episode = setup.summarize(sessionSnapshot.setupDraft);
  const polish = audio.createPolish(episode);
  assert.strictEqual(episode.sourceMediaCount, 1);
  assert.strictEqual(polish.speakers[0].sourceMedia.assetId, "session-host-media");
  assert.strictEqual(polish.speakers[0].hasSourceMedia, true);
});

console.log(`\nsource media ingest: ${passed} assertions passed`);
