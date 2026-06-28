"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const mae = require("../app/media-audio-extract.js");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok ${name}`);
}

test("fixture WAV files exist and decode to PCM speaker tracks", () => {
  ["Host", "Guest 1", "Guest 2"].forEach((role) => {
    const bytes = mae.loadFixtureBytes(role);
    assert.ok(bytes && bytes.length > 44, `${role} fixture should exist`);
    const decoded = mae.decodeWav(bytes);
    assert.ok(decoded.samples.length > 1000, `${role} fixture should contain real PCM samples`);
    assert.strictEqual(decoded.bitsPerSample, 16);
  });
});

test("encodeAudioBufferAsWav round-trips through decodeWav", () => {
  const source = mae.loadFixtureBytes("Host");
  const decoded = mae.decodeWav(source);
  const reencoded = mae.encodePcm16MonoWav(decoded.samples, decoded.sampleRate);
  const again = mae.decodeWav(reencoded);
  assert.strictEqual(again.samples.length, decoded.samples.length);
  assert.strictEqual(again.samples[0], decoded.samples[0]);
});

console.log(`\nmedia audio extract: ${passed} assertions passed`);
