"use strict";

// Imported speaker-track audio extraction helpers for Podcast Design Canvas (#197).
//
// Shared, DOM-free utilities for validating/decoding WAV speaker tracks and mapping
// role buckets to the synced fixture files used in sandbox import flows. Browser UI
// uses Web Audio to decode uploaded media into the same PCM WAV format before polish.
(function (global) {
  const ROLE_FIXTURE_FILES = {
    Host: "host-synced.wav",
    "Co-host": "cohost-synced.wav",
    "Guest 1": "guest-1-synced.wav",
    "Guest 2": "guest-2-synced.wav",
    "Guest 3": "guest-3-synced.wav",
    "Guest 4": "guest-4-synced.wav",
  };

  const BASE64_CHARS =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

  function trim(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function readAscii(bytes, offset, length) {
    let out = "";
    for (let i = 0; i < length; i += 1) {
      out += String.fromCharCode(bytes[offset + i]);
    }
    return out;
  }

  function writeAscii(bytes, offset, text) {
    for (let i = 0; i < text.length; i += 1) {
      bytes[offset + i] = text.charCodeAt(i);
    }
  }

  function writeUint32LE(bytes, offset, value) {
    bytes[offset] = value & 0xff;
    bytes[offset + 1] = (value >>> 8) & 0xff;
    bytes[offset + 2] = (value >>> 16) & 0xff;
    bytes[offset + 3] = (value >>> 24) & 0xff;
  }

  function writeUint16LE(bytes, offset, value) {
    bytes[offset] = value & 0xff;
    bytes[offset + 1] = (value >>> 8) & 0xff;
  }

  function bytesToBase64(bytes) {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    let out = "";
    for (let i = 0; i < data.length; i += 3) {
      const b0 = data[i];
      const hasB1 = i + 1 < data.length;
      const hasB2 = i + 2 < data.length;
      const b1 = hasB1 ? data[i + 1] : 0;
      const b2 = hasB2 ? data[i + 2] : 0;
      const triplet = (b0 << 16) | (b1 << 8) | b2;
      out += BASE64_CHARS[(triplet >> 18) & 0x3f];
      out += BASE64_CHARS[(triplet >> 12) & 0x3f];
      out += hasB1 ? BASE64_CHARS[(triplet >> 6) & 0x3f] : "=";
      out += hasB2 ? BASE64_CHARS[triplet & 0x3f] : "=";
    }
    return out;
  }

  function base64ToBytes(base64) {
    const text = String(base64 || "").replace(/=+$/, "");
    const out = [];
    for (let i = 0; i < text.length; i += 4) {
      const c0 = BASE64_CHARS.indexOf(text[i]);
      const c1 = BASE64_CHARS.indexOf(text[i + 1]);
      const c2 = text[i + 2] === "=" ? -1 : BASE64_CHARS.indexOf(text[i + 2]);
      const c3 = text[i + 3] === "=" ? -1 : BASE64_CHARS.indexOf(text[i + 3]);
      const triplet = (c0 << 18) | (c1 << 12) | ((c2 < 0 ? 0 : c2) << 6) | (c3 < 0 ? 0 : c3);
      out.push((triplet >> 16) & 0xff);
      if (c2 >= 0) out.push((triplet >> 8) & 0xff);
      if (c3 >= 0) out.push(triplet & 0xff);
    }
    return new Uint8Array(out);
  }

  function fixtureFileNameForRole(role) {
    const bucket = trim(role);
    if (ROLE_FIXTURE_FILES[bucket]) {
      return ROLE_FIXTURE_FILES[bucket];
    }
    const slug = bucket.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "speaker";
    return `${slug}-synced.wav`;
  }

  function roleFixturePath(role) {
    return `fixtures/imported-tracks/${fixtureFileNameForRole(role)}`;
  }

  function isValidWav(bytes) {
    if (!bytes || bytes.length < 44) {
      return false;
    }
    return readAscii(bytes, 0, 4) === "RIFF" && readAscii(bytes, 8, 4) === "WAVE";
  }

  function decodeWav(bytes) {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    if (!isValidWav(data)) {
      throw new Error("Imported speaker track is not a valid WAV file.");
    }
    let offset = 12;
    let audioFormat = 1;
    let channels = 1;
    let sampleRate = 22050;
    let bitsPerSample = 16;
    let pcmBytes = null;
    while (offset + 8 <= data.length) {
      const chunkId = readAscii(data, offset, 4);
      const chunkSize = data[offset + 4]
        | (data[offset + 5] << 8)
        | (data[offset + 6] << 16)
        | (data[offset + 7] << 24);
      const chunkStart = offset + 8;
      if (chunkId === "fmt ") {
        audioFormat = data[chunkStart] | (data[chunkStart + 1] << 8);
        channels = data[chunkStart + 2] | (data[chunkStart + 3] << 8);
        sampleRate = data[chunkStart + 4]
          | (data[chunkStart + 5] << 8)
          | (data[chunkStart + 6] << 16)
          | (data[chunkStart + 7] << 24);
        bitsPerSample = data[chunkStart + 14] | (data[chunkStart + 15] << 8);
      } else if (chunkId === "data") {
        pcmBytes = data.subarray(chunkStart, chunkStart + chunkSize);
      }
      offset = chunkStart + chunkSize + (chunkSize % 2);
    }
    if (!pcmBytes || !pcmBytes.length) {
      throw new Error("Imported speaker track WAV is missing PCM sample data.");
    }
    if (audioFormat !== 1) {
      throw new Error("Only PCM WAV speaker tracks are supported in this prototype.");
    }
    let samples;
    if (bitsPerSample === 16) {
      samples = new Int16Array(pcmBytes.length / 2);
      for (let i = 0; i < samples.length; i += 1) {
        const base = i * 2;
        const value = pcmBytes[base] | (pcmBytes[base + 1] << 8);
        samples[i] = value > 0x7fff ? value - 0x10000 : value;
      }
    } else if (bitsPerSample === 8) {
      samples = new Int16Array(pcmBytes.length);
      for (let i = 0; i < pcmBytes.length; i += 1) {
        samples[i] = Math.round(((pcmBytes[i] - 128) / 128) * 32767);
      }
    } else {
      throw new Error(`Unsupported WAV bit depth: ${bitsPerSample}`);
    }
    return {
      samples,
      sampleRate: sampleRate || 22050,
      channels: channels || 1,
      bitsPerSample,
    };
  }

  function encodePcm16MonoWav(samples, sampleRate) {
    const pcm = samples instanceof Int16Array ? samples : Int16Array.from(samples || []);
    const rate = sampleRate || 22050;
    const headerSize = 44;
    const dataSize = pcm.length * 2;
    const out = new Uint8Array(headerSize + dataSize);
    writeAscii(out, 0, "RIFF");
    writeUint32LE(out, 4, 36 + dataSize);
    writeAscii(out, 8, "WAVE");
    writeAscii(out, 12, "fmt ");
    writeUint32LE(out, 16, 16);
    writeUint16LE(out, 20, 1);
    writeUint16LE(out, 22, 1);
    writeUint32LE(out, 24, rate);
    writeUint32LE(out, 28, rate * 2);
    writeUint16LE(out, 32, 2);
    writeUint16LE(out, 34, 16);
    writeAscii(out, 36, "data");
    writeUint32LE(out, 40, dataSize);
    for (let i = 0; i < pcm.length; i += 1) {
      const value = pcm[i];
      const base = headerSize + i * 2;
      out[base] = value & 0xff;
      out[base + 1] = (value >> 8) & 0xff;
    }
    return out;
  }

  function encodeAudioBufferAsWav(audioBuffer) {
    const buffer = audioBuffer || {};
    const channels = buffer.numberOfChannels || 1;
    const length = buffer.length || 0;
    const sampleRate = buffer.sampleRate || 22050;
    const mono = new Int16Array(length);
    for (let i = 0; i < length; i += 1) {
      let mixed = 0;
      for (let ch = 0; ch < channels; ch += 1) {
        const channel = buffer.getChannelData(ch);
        mixed += channel[i] || 0;
      }
      mixed /= channels;
      mono[i] = Math.max(-32768, Math.min(32767, Math.round(mixed * 32767)));
    }
    return encodePcm16MonoWav(mono, sampleRate);
  }

  function loadFixtureBytes(role) {
    if (typeof require !== "function" || typeof module === "undefined" || !module.exports) {
      return null;
    }
    try {
      const fs = require("fs");
      const path = require("path");
      const filePath = path.join(__dirname, "..", roleFixturePath(role));
      return new Uint8Array(fs.readFileSync(filePath));
    } catch (err) {
      return null;
    }
  }

  function loadFixtureBase64(role) {
    const bytes = loadFixtureBytes(role);
    return bytes ? bytesToBase64(bytes) : "";
  }

  const api = {
    ROLE_FIXTURE_FILES,
    fixtureFileNameForRole,
    roleFixturePath,
    isValidWav,
    decodeWav,
    encodePcm16MonoWav,
    encodeAudioBufferAsWav,
    bytesToBase64,
    base64ToBytes,
    loadFixtureBytes,
    loadFixtureBase64,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
    return;
  }

  global.PdcMediaAudioExtract = api;
})(typeof window !== "undefined" ? window : globalThis);
