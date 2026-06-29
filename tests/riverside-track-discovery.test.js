"use strict";

// Riverside track discovery suite for Podcast Design Canvas (#225).
// Guards: recognizing a riverside.fm session link, surfacing a deterministic track list
// (speaker labels, durations, sync status), mapping tracks onto Host / Guest buckets in
// order, persisting through the setup summary/handoff, and showing a clear error for
// invalid or non-Riverside URLs without breaking the draft.
// Run with: `node tests/riverside-track-discovery.test.js`.

const assert = require("assert");
const setup = require("../app/episode-setup.js");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok ${name}`);
}

const DEMO = setup.sandboxDemoRiversideLink();

test("isRiversideUrl accepts riverside.fm links (incl. the sandbox demo) and rejects others", () => {
  assert.strictEqual(setup.isRiversideUrl(DEMO), true);
  assert.strictEqual(setup.isRiversideUrl("https://riverside.fm/studio/my-episode"), true);
  assert.strictEqual(setup.isRiversideUrl("https://app.riverside.fm/x/abc"), true);
  assert.strictEqual(setup.isRiversideUrl("https://zoom.us/rec/123"), false);
  assert.strictEqual(setup.isRiversideUrl("not a url"), false);
  assert.strictEqual(setup.isRiversideUrl(""), false);
});

test("discoverRiversideTracks returns a track list with labels, durations, and sync status", () => {
  const result = setup.discoverRiversideTracks(DEMO);
  assert.strictEqual(result.ok, true);
  assert.ok(result.trackCount >= 2);
  assert.strictEqual(result.tracks.length, result.trackCount);
  result.tracks.forEach((track, index) => {
    assert.ok(track.speakerLabel, "each track is labeled");
    assert.strictEqual(track.suggestedRole, setup.defaultSpeakerRoleForIndex(index));
    assert.ok(track.durationSeconds > 0);
    assert.ok(/^\d+:\d{2}(:\d{2})?$/.test(track.durationLabel), "human-readable duration");
    assert.ok(track.syncStatus, "each track reports a sync status");
  });
  // First three demo tracks map to Host, Guest 1, Guest 2 in order.
  assert.deepStrictEqual(
    result.tracks.slice(0, 3).map((t) => t.suggestedRole),
    ["Host", "Guest 1", "Guest 2"],
  );
});

test("discovery is deterministic for a given link and varies by link", () => {
  const a = setup.discoverRiversideTracks("https://riverside.fm/studio/show-one");
  const b = setup.discoverRiversideTracks("https://riverside.fm/studio/show-one");
  assert.deepStrictEqual(a.tracks, b.tracks);
  assert.strictEqual(a.sessionId, b.sessionId);

  const c = setup.discoverRiversideTracks("https://riverside.fm/studio/some-other-session");
  assert.notStrictEqual(a.sessionId, c.sessionId);
});

test("invalid or non-Riverside URLs return a clear error and never throw", () => {
  const empty = setup.discoverRiversideTracks("");
  assert.strictEqual(empty.ok, false);
  assert.ok(empty.error);

  const malformed = setup.discoverRiversideTracks("riverside.fm/studio/no-scheme");
  assert.strictEqual(malformed.ok, false);
  assert.ok(/full link|http/i.test(malformed.error));

  const wrongHost = setup.discoverRiversideTracks("https://youtube.com/watch?v=1");
  assert.strictEqual(wrongHost.ok, false);
  assert.ok(/riverside/i.test(wrongHost.error));
});

test("applyDiscoveryToBuckets maps tracks onto Host / Guest buckets in order", () => {
  const draft = setup.createDraft();
  draft.sourceMode = "riverside";
  draft.riversideLink = DEMO;
  const discovery = setup.discoverRiversideTracks(DEMO);

  const updated = setup.applyDiscoveryToBuckets(draft, discovery);
  assert.strictEqual(updated.speakers.length, discovery.trackCount);
  assert.deepStrictEqual(
    updated.speakers.map((s) => s.role),
    discovery.tracks.map((t) => t.suggestedRole),
  );
  // Each bucket records its source channel label from the discovered track.
  updated.speakers.forEach((speaker, index) => {
    assert.strictEqual(speaker.trackLabel, discovery.tracks[index].speakerLabel);
  });
});

test("applyDiscoveryToBuckets keeps names already entered and resizes the speaker list", () => {
  const draft = setup.createDraft(); // 3 default speakers
  draft.sourceMode = "riverside";
  draft.riversideLink = "https://riverside.fm/studio/two-mics";
  draft.speakers[0].name = "Sam Rivera";
  const discovery = setup.discoverRiversideTracks(draft.riversideLink);

  const updated = setup.applyDiscoveryToBuckets(draft, discovery);
  assert.strictEqual(updated.speakers.length, discovery.trackCount);
  assert.strictEqual(updated.speakers[0].name, "Sam Rivera", "kept the name the creator typed");

  // A failed discovery must not mutate the draft.
  const before = JSON.parse(JSON.stringify(updated));
  const unchanged = setup.applyDiscoveryToBuckets(updated, { ok: false, error: "bad" });
  assert.deepStrictEqual(unchanged.speakers, before.speakers);
});

test("applied tracks persist into the setup summary and handoff", () => {
  const draft = setup.createDraft();
  draft.episodeName = "Weeknight Live";
  draft.sourceMode = "riverside";
  draft.riversideLink = DEMO;
  const discovery = setup.discoverRiversideTracks(DEMO);
  const applied = setup.applyDiscoveryToBuckets(draft, discovery);

  const summary = setup.summarize(applied);
  assert.strictEqual(summary.speakerCount, discovery.trackCount);
  // The recording-source label for each speaker now reflects the discovered track channel.
  assert.strictEqual(summary.speakers[0].sourceLabel, discovery.tracks[0].speakerLabel);

  const handoff = setup.buildImportHandoff(summary);
  assert.strictEqual(handoff.speakers.length, discovery.trackCount);
  assert.strictEqual(handoff.speakers[0].sourceLabel, discovery.tracks[0].speakerLabel);
});

test("summarizeDiscovery gives a creator-facing recap", () => {
  const discovery = setup.discoverRiversideTracks(DEMO);
  const recap = setup.summarizeDiscovery(discovery);
  assert.ok(recap.indexOf(String(discovery.trackCount)) >= 0);
  assert.ok(/Host/.test(recap));
});

test("ACCEPTANCE: paste link, discover tracks, apply to buckets, continue with a valid draft", () => {
  // Riverside link mode with a valid riverside.fm URL (the sandbox demo link).
  const draft = setup.createDraft();
  draft.episodeName = "Founders Unfiltered #8";
  draft.sourceMode = "riverside";
  draft.riversideLink = DEMO;

  // Discover tracks -> a track list with labels, durations, sync status.
  const discovery = setup.discoverRiversideTracks(draft.riversideLink);
  assert.strictEqual(discovery.ok, true);
  assert.ok(discovery.tracks.every((t) => t.speakerLabel && t.durationLabel && t.syncStatus));

  // Apply to speaker buckets -> Host / Guest 1 / Guest 2 in order, recap updated.
  const applied = setup.applyDiscoveryToBuckets(draft, discovery);
  applied.speakers.forEach((speaker, index) => {
    speaker.name = speaker.name || `Speaker ${index + 1}`;
  });
  assert.deepStrictEqual(
    applied.speakers.map((s) => s.role),
    discovery.tracks.map((t) => t.suggestedRole),
  );

  // The draft is valid and ready to continue.
  assert.strictEqual(setup.validateDraft(applied).ok, true);

  // Invalid URL shows an error without breaking the draft.
  const bad = setup.discoverRiversideTracks("https://example.com/not-riverside");
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(setup.validateDraft(applied).ok, true, "draft remains intact after a failed discovery");
});

console.log(`\nriverside track discovery: ${passed} assertions passed`);
