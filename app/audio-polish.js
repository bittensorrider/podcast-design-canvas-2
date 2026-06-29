"use strict";

// Creator-facing audio polish model for Podcast Design Canvas (#15).
//
// Presents noise cleanup, leveling, speech clarity, and enhancement as simple quality
// choices tied to each imported speaker track — not technical audio processing settings.
// DOM-free so the polish step and tests share one source of truth.
(function (global) {
  const QUALITY_PRESETS = [
    {
      id: "natural",
      name: "Natural",
      tagline: "Light touch — keeps the room feel with gentle cleanup.",
    },
    {
      id: "clean",
      name: "Clean",
      tagline: "Balanced polish for most podcast conversations.",
    },
    {
      id: "studio",
      name: "Studio",
      tagline: "Broadcast-ready clarity and presence.",
    },
  ];

  const CONTROLS = [
    {
      id: "noiseCleanup",
      label: "Noise cleanup",
      hint: "Reduce background hum, fan noise, and room rumble.",
    },
    {
      id: "leveling",
      label: "Voice leveling",
      hint: "Even out volume between speakers and moments.",
    },
    {
      id: "speechClarity",
      label: "Speech clarity",
      hint: "Bring forward consonants and vocal presence.",
    },
    {
      id: "enhancement",
      label: "Overall enhancement",
      hint: "Add warmth and polish without sounding overprocessed.",
    },
  ];

  const LEVELS = [
    { id: "light", label: "Light" },
    { id: "balanced", label: "Balanced" },
    { id: "strong", label: "Strong" },
  ];

  const PRESET_LEVELS = {
    natural: {
      noiseCleanup: "light",
      leveling: "light",
      speechClarity: "light",
      enhancement: "light",
    },
    clean: {
      noiseCleanup: "balanced",
      leveling: "balanced",
      speechClarity: "balanced",
      enhancement: "balanced",
    },
    studio: {
      noiseCleanup: "strong",
      leveling: "strong",
      speechClarity: "strong",
      enhancement: "strong",
    },
  };

  function defaultPreset() {
    return QUALITY_PRESETS[1];
  }

  function getPreset(id) {
    return QUALITY_PRESETS.find((preset) => preset.id === id) || defaultPreset();
  }

  function getLevel(id) {
    return LEVELS.find((level) => level.id === id) || LEVELS[1];
  }

  function getControl(id) {
    return CONTROLS.find((control) => control.id === id) || CONTROLS[0];
  }

  function buildSpeakerTracks(episodeSummary) {
    const sourceMode = episodeSummary && episodeSummary.sourceMode ? episodeSummary.sourceMode : "";
    const speakers = episodeSummary && Array.isArray(episodeSummary.speakers)
      ? episodeSummary.speakers
      : [];
    return speakers.map((speaker, index) => {
      const sourceMedia = speaker && speaker.sourceMedia && typeof speaker.sourceMedia === "object"
        ? speaker.sourceMedia
        : null;
      const byteLength = sourceMedia ? Number(sourceMedia.byteLength) || 0 : 0;
      const assetId = sourceMedia ? sourceMedia.assetId || sourceMedia.id || "" : "";
      return {
        role: (speaker && speaker.role) || "Speaker",
        name: (speaker && speaker.name) || "Unnamed speaker",
        sourceLabel: (speaker && speaker.sourceLabel) || "Source track",
        sourceMode: sourceMode,
        sourceMedia: sourceMedia,
        hasSourceMedia: Boolean(sourceMedia && assetId && byteLength > 0),
        trackIndex: index + 1,
      };
    });
  }

  function createPolish(episodeSummary) {
    const preset = defaultPreset();
    const levels = PRESET_LEVELS[preset.id];
    return {
      presetId: preset.id,
      noiseCleanup: levels.noiseCleanup,
      leveling: levels.leveling,
      speechClarity: levels.speechClarity,
      enhancement: levels.enhancement,
      speakers: buildSpeakerTracks(episodeSummary),
    };
  }

  function applyPreset(polish, presetId) {
    const preset = getPreset(presetId);
    const levels = PRESET_LEVELS[preset.id] || PRESET_LEVELS.clean;
    return Object.assign({}, polish || createPolish({}), {
      presetId: preset.id,
      noiseCleanup: levels.noiseCleanup,
      leveling: levels.leveling,
      speechClarity: levels.speechClarity,
      enhancement: levels.enhancement,
      speakers: polish && polish.speakers ? polish.speakers.slice() : [],
    });
  }

  function updateControl(polish, controlId, levelId) {
    const next = Object.assign({}, polish || createPolish({}));
    if (CONTROLS.some((control) => control.id === controlId)) {
      next[controlId] = getLevel(levelId).id;
    }
    return next;
  }

  function speakerIndicator(polish, speaker, polishedTrack) {
    const preset = getPreset(polish && polish.presetId);
    const name = (speaker && speaker.name) || "Speaker";
    if (polishedTrack && polishedTrack.status === "complete") {
      return `${preset.name} treatment · ${name} · polished track saved`;
    }
    if (polishedTrack && polishedTrack.status === "failed") {
      return `${preset.name} treatment · ${name} · polish failed`;
    }
    if (polishedTrack && polishedTrack.status === "needs-media") {
      return `${preset.name} treatment · ${name} · upload source media to polish`;
    }
    const sourceCue = speaker && speaker.sourceMode === "upload"
      ? (speaker.hasSourceMedia ? "source media saved" : "source media pending")
      : "source media required";
    return `${preset.name} treatment · ${name} · ${sourceCue}`;
  }

  function intensityForLevel(levelId) {
    if (levelId === "light") {
      return 0.33;
    }
    if (levelId === "strong") {
      return 1;
    }
    return 0.66;
  }

  function polishSamples(samples, sampleRate, polish) {
    const input = samples instanceof Float32Array ? samples : new Float32Array(samples || []);
    const out = new Float32Array(input.length);
    out.set(input);
    const state = polish || createPolish({});
    const rate = Number(sampleRate) > 0 ? Number(sampleRate) : 44100;

    const noiseAmount = intensityForLevel(state.noiseCleanup);
    if (noiseAmount > 0 && out.length > 1) {
      const cutoff = 80 + noiseAmount * 120;
      const rc = 1 / (2 * Math.PI * cutoff);
      const dt = 1 / rate;
      const alpha = rc / (rc + dt);
      let prevIn = out[0];
      let prevOut = out[0];
      for (let i = 0; i < out.length; i += 1) {
        const x = out[i];
        const y = alpha * (prevOut + x - prevIn);
        prevIn = x;
        prevOut = y;
        out[i] = y;
      }
      const threshold = 0.002 + (1 - noiseAmount) * 0.008;
      for (let i = 0; i < out.length; i += 1) {
        if (Math.abs(out[i]) < threshold) {
          out[i] *= 0.1;
        }
      }
    }

    const levelAmount = intensityForLevel(state.leveling);
    if (levelAmount > 0 && out.length > 0) {
      let sum = 0;
      for (let i = 0; i < out.length; i += 1) {
        sum += out[i] * out[i];
      }
      const rms = Math.sqrt(sum / out.length) || 0.0001;
      const targetRms = 0.08 + levelAmount * 0.07;
      const gain = Math.min(4, targetRms / rms);
      const appliedGain = 1 + (gain - 1) * levelAmount;
      for (let i = 0; i < out.length; i += 1) {
        out[i] *= appliedGain;
      }
    }

    const clarityAmount = intensityForLevel(state.speechClarity);
    if (clarityAmount > 0 && out.length > 1) {
      let prev = out[0];
      for (let i = 0; i < out.length; i += 1) {
        const high = out[i] - prev;
        prev = out[i];
        out[i] = out[i] + high * clarityAmount * 0.4;
      }
    }

    const enhanceAmount = intensityForLevel(state.enhancement);
    if (enhanceAmount > 0) {
      const drive = 1 + enhanceAmount * 0.8;
      const norm = Math.tanh(drive);
      for (let i = 0; i < out.length; i += 1) {
        out[i] = Math.tanh(out[i] * drive) / norm;
      }
    }

    for (let i = 0; i < out.length; i += 1) {
      out[i] = Math.max(-0.99, Math.min(0.99, out[i]));
    }
    return out;
  }

  function encodeWav(samples, sampleRate) {
    const pcm = samples instanceof Float32Array ? samples : new Float32Array(samples || []);
    const rate = Number(sampleRate) > 0 ? Number(sampleRate) : 44100;
    const dataSize = pcm.length * 2;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    function writeString(offset, text) {
      for (let i = 0; i < text.length; i += 1) {
        view.setUint8(offset + i, text.charCodeAt(i));
      }
    }
    writeString(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, "data");
    view.setUint32(40, dataSize, true);
    let offset = 44;
    for (let i = 0; i < pcm.length; i += 1) {
      const clamped = Math.max(-1, Math.min(1, pcm[i]));
      const intSample = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
    return new Uint8Array(buffer);
  }

  function decodeWav(bytes) {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    if (data.length < 44) {
      throw new Error("WAV data is too short.");
    }
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const sampleRate = view.getUint32(24, true);
    const bitsPerSample = view.getUint16(34, true);
    if (bitsPerSample !== 16) {
      throw new Error("Only 16-bit PCM WAV is supported.");
    }
    let dataOffset = 44;
    for (let i = 12; i + 8 <= data.length; i += 1) {
      const chunkId = String.fromCharCode(data[i], data[i + 1], data[i + 2], data[i + 3]);
      if (chunkId === "data") {
        dataOffset = i + 8;
        break;
      }
    }
    const sampleCount = Math.floor((data.length - dataOffset) / 2);
    const samples = new Float32Array(sampleCount);
    for (let i = 0; i < sampleCount; i += 1) {
      const intSample = view.getInt16(dataOffset + i * 2, true);
      samples[i] = intSample < 0 ? intSample / 0x8000 : intSample / 0x7fff;
    }
    return { samples, sampleRate };
  }

  function rmsOfSamples(samples) {
    const pcm = samples instanceof Float32Array ? samples : new Float32Array(samples || []);
    if (!pcm.length) {
      return 0;
    }
    let sum = 0;
    for (let i = 0; i < pcm.length; i += 1) {
      sum += pcm[i] * pcm[i];
    }
    return Math.sqrt(sum / pcm.length);
  }

  function peakOfSamples(samples) {
    const pcm = samples instanceof Float32Array ? samples : new Float32Array(samples || []);
    let peak = 0;
    for (let i = 0; i < pcm.length; i += 1) {
      const abs = Math.abs(pcm[i]);
      if (abs > peak) {
        peak = abs;
      }
    }
    return peak;
  }

  function toDecibels(value) {
    return value > 0 ? 20 * Math.log10(value) : -Infinity;
  }

  function measureTransform(inputSamples, outputSamples, sampleRate) {
    const inputRms = rmsOfSamples(inputSamples);
    const outputRms = rmsOfSamples(outputSamples);
    const inputPeak = peakOfSamples(inputSamples);
    const outputPeak = peakOfSamples(outputSamples);
    const rate = Number(sampleRate) > 0 ? Number(sampleRate) : 44100;
    const length = inputSamples instanceof Float32Array ? inputSamples.length : (inputSamples || []).length;
    const gainDb = toDecibels(outputRms) - toDecibels(inputRms);
    return {
      inputRms: Number(inputRms.toFixed(4)),
      outputRms: Number(outputRms.toFixed(4)),
      inputPeak: Number(inputPeak.toFixed(4)),
      outputPeak: Number(outputPeak.toFixed(4)),
      gainDb: Number.isFinite(gainDb) ? Number(gainDb.toFixed(2)) : 0,
      durationSec: Number((length / rate).toFixed(3)),
      sampleRate: rate,
      changed: inputRms !== outputRms || inputPeak !== outputPeak,
    };
  }

  function polishedAssetId(track, polish) {
    const role = (track && track.role) || "speaker";
    const slug = role.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "speaker";
    const preset = (polish && polish.presetId) || "clean";
    return `polished-${slug}-${preset}-${Date.now()}`;
  }

  function buildPolishedAsset(track, wavBytes, polish) {
    const sourceLabel = (track && track.sourceLabel) || "track";
    const stem = sourceLabel.replace(/\.[^.]+$/, "") || "track";
    const bytes = wavBytes instanceof Uint8Array ? wavBytes : new Uint8Array(wavBytes || []);
    return {
      assetId: polishedAssetId(track, polish),
      fileName: `${stem}-polished.wav`,
      mimeType: "audio/wav",
      byteLength: bytes.byteLength,
      storage: "indexedDB",
      storedAt: Date.now(),
      sourceAssetId: track && track.sourceMedia ? track.sourceMedia.assetId || "" : "",
      presetId: polish && polish.presetId ? polish.presetId : "clean",
      kind: "polished-audio",
    };
  }

  function sampleRecordingsApi() {
    if (typeof module !== "undefined" && module.exports && typeof require === "function") {
      return require("./sample-recordings.js");
    }
    const g = typeof window !== "undefined" ? window : globalThis;
    return g.PdcSampleRecordings;
  }

  function decodeDataUrlWav(dataUrl) {
    const text = typeof dataUrl === "string" ? dataUrl : "";
    const base64 = text.split(",")[1] || "";
    const decode = typeof atob === "function"
      ? atob
      : (value) => Buffer.from(value, "base64").toString("binary");
    const binary = decode(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return decodeWav(bytes);
  }

  // Default loader for DOM-free contexts (tests, Node): decode the track's own inline
  // recording when present, otherwise fall back to a bundled real sample recording.
  // This processes genuine WAV media rather than synthesizing audio from track identity.
  function defaultSampleLoader(track) {
    const inline = track && track.sourceMedia && track.sourceMedia.dataUrl;
    if (inline) {
      return decodeDataUrlWav(inline);
    }
    const SR = sampleRecordingsApi();
    const rec = SR ? SR.sampleRecording((track && track.trackIndex ? track.trackIndex - 1 : 0)) : null;
    if (!rec) {
      throw new Error("No sample recording is available to decode.");
    }
    return decodeDataUrlWav(rec.dataUrl);
  }

  function computePolishCompletion(speakers, polishedTracks) {
    const list = Array.isArray(speakers) ? speakers : [];
    const results = Array.isArray(polishedTracks) ? polishedTracks : [];
    if (!list.length) {
      return false;
    }
    if (results.some((track) => track.status === "failed")) {
      return false;
    }
    if (results.length !== list.length) {
      return false;
    }
    return results.every((track) => track.status === "complete");
  }

  function needsMediaTrackResult(track) {
    return {
      trackIndex: track.trackIndex,
      role: track.role,
      name: track.name,
      status: "needs-media",
      polishedAsset: null,
      usesOriginal: true,
      error: "Upload speaker media to polish this track.",
    };
  }

  function failedTrackResult(track, err) {
    return {
      trackIndex: track.trackIndex,
      role: track.role,
      name: track.name,
      status: "failed",
      error: err && err.message ? err.message : "Processing failed",
      polishedAsset: null,
      usesOriginal: true,
    };
  }

  function completeTrackResult(track, state, loaded) {
    if (!loaded || !loaded.samples || !loaded.sampleRate) {
      throw new Error("Track samples are missing.");
    }
    const polished = polishSamples(loaded.samples, loaded.sampleRate, state);
    const wavBytes = encodeWav(polished, loaded.sampleRate);
    const polishedAsset = buildPolishedAsset(track, wavBytes, state);
    const metrics = measureTransform(loaded.samples, polished, loaded.sampleRate);
    return {
      trackIndex: track.trackIndex,
      role: track.role,
      name: track.name,
      status: "complete",
      polishedAsset,
      wavBytes,
      byteLength: wavBytes.byteLength,
      metrics,
      usesOriginal: false,
    };
  }

  function buildPolishOutcome(state, speakers, results) {
    return {
      polish: Object.assign({}, state, { polishedTracks: results }),
      results,
      complete: computePolishCompletion(speakers, results),
      failed: results.some((track) => track.status === "failed"),
    };
  }

  function processPolishTracks(polish, loadTrackSamples) {
    const state = polish || createPolish({});
    const speakers = Array.isArray(state.speakers) ? state.speakers : [];
    const results = speakers.map((track) => {
      if (!track.hasSourceMedia) {
        return needsMediaTrackResult(track);
      }
      try {
        return completeTrackResult(track, state, loadTrackSamples(track));
      } catch (err) {
        return failedTrackResult(track, err);
      }
    });
    return buildPolishOutcome(state, speakers, results);
  }

  async function runPolish(polish, loadTrackSamples) {
    const state = polish || createPolish({});
    const speakers = Array.isArray(state.speakers) ? state.speakers : [];
    const results = [];
    for (let index = 0; index < speakers.length; index += 1) {
      const track = speakers[index];
      if (!track.hasSourceMedia) {
        results.push(needsMediaTrackResult(track));
        continue;
      }
      try {
        const loaded = await Promise.resolve(loadTrackSamples(track));
        results.push(completeTrackResult(track, state, loaded));
      } catch (err) {
        results.push(failedTrackResult(track, err));
      }
    }
    return buildPolishOutcome(state, speakers, results);
  }

  function applyPolishForEpisode(episodeSummary, polishState, loadTrackSamples) {
    const polish = polishState || createPolish(episodeSummary);
    const loader = loadTrackSamples || defaultSampleLoader;
    const outcome = processPolishTracks(polish, loader);
    const applied = summarizePolish(outcome.polish, { polishedTracks: outcome.results });
    return { polish: outcome.polish, applied, outcome };
  }

  function polishedTrackForSpeaker(polishedTracks, trackIndex) {
    const list = Array.isArray(polishedTracks) ? polishedTracks : [];
    return list.find((track) => track.trackIndex === trackIndex) || null;
  }

  function resolveExportAudioTracks(polishSummary) {
    const summary = polishSummary || {};
    const tracks = Array.isArray(summary.polishedTracks) ? summary.polishedTracks : [];
    return tracks.map((track) => ({
      trackIndex: track.trackIndex,
      role: track.role,
      name: track.name,
      status: track.status,
      assetId: track.polishedAsset ? track.polishedAsset.assetId : "",
      fileName: track.polishedAsset ? track.polishedAsset.fileName : "",
      metrics: track.metrics || null,
      usesPolishedAudio: track.status === "complete",
      usesOriginal: Boolean(track.usesOriginal),
    }));
  }

  function isPolishReady(summary) {
    if (!summary || !summary.presetName) {
      return false;
    }
    return Boolean(summary.polishComplete || summary.allTracksPolished);
  }

  function summarizePolish(polish, options) {
    const state = polish || createPolish({});
    const opts = options || {};
    const preset = getPreset(state.presetId);
    const controlSummary = CONTROLS.map((control) => {
      const level = getLevel(state[control.id]);
      return `${control.label}: ${level.label}`;
    });
    const speakers = Array.isArray(state.speakers) ? state.speakers : [];
    const polishedTracks = Array.isArray(opts.polishedTracks)
      ? opts.polishedTracks
      : (Array.isArray(state.polishedTracks) ? state.polishedTracks : []);
    const sourceMediaCount = speakers.reduce((total, speaker) => total + (speaker && speaker.hasSourceMedia ? 1 : 0), 0);
    const polishedTrackCount = polishedTracks.filter((track) => track.status === "complete").length;
    const allTracksPolished = computePolishCompletion(speakers, polishedTracks);
    const exportAudioTracks = resolveExportAudioTracks({ polishedTracks });
    return {
      presetId: preset.id,
      presetName: preset.name,
      tagline: preset.tagline,
      noiseCleanup: state.noiseCleanup,
      noiseCleanupLabel: getLevel(state.noiseCleanup).label,
      leveling: state.leveling,
      levelingLabel: getLevel(state.leveling).label,
      speechClarity: state.speechClarity,
      speechClarityLabel: getLevel(state.speechClarity).label,
      enhancement: state.enhancement,
      enhancementLabel: getLevel(state.enhancement).label,
      speakerCount: speakers.length,
      sourceMediaCount,
      sourceMediaReady: speakers.length > 0 && sourceMediaCount === speakers.length,
      polishedTracks,
      polishedTrackCount,
      allTracksPolished,
      polishComplete: allTracksPolished,
      exportAudioTracks,
      treatmentLine: controlSummary.join(" · "),
    };
  }

  // Episode review / export path — rolls audio treatment up with other episode choices.
  function buildReviewSummary(episodeSummary, polishSummary, extras) {
    const episode = episodeSummary || {};
    const audio = polishSummary || {};
    const options = extras || {};
    const lines = [];
    if (audio.presetName) {
      lines.push(`Audio: ${audio.presetName} (${audio.treatmentLine})`);
      if (audio.polishedTrackCount > 0) {
        lines.push(`Polished tracks: ${audio.polishedTrackCount} of ${audio.speakerCount}`);
      }
    }
    if (options.styleName) {
      lines.push(`Visual style: ${options.styleName}`);
    }
    if (options.templateName) {
      lines.push(`Show template: ${options.templateName}`);
    }
    return {
      episodeName: episode.episodeName || "",
      speakerCount: episode.speakerCount || 0,
      audioPreset: audio.presetName || "",
      audioTreatment: audio.treatmentLine || "",
      styleName: options.styleName || "",
      templateName: options.templateName || "",
      readyForExport: isPolishReady(audio),
      summaryLines: lines,
    };
  }

  const api = {
    QUALITY_PRESETS,
    CONTROLS,
    LEVELS,
    defaultPreset,
    getPreset,
    getLevel,
    getControl,
    buildSpeakerTracks,
    createPolish,
    applyPreset,
    updateControl,
    speakerIndicator,
    intensityForLevel,
    polishSamples,
    encodeWav,
    decodeWav,
    rmsOfSamples,
    peakOfSamples,
    measureTransform,
    buildPolishedAsset,
    defaultSampleLoader,
    processPolishTracks,
    runPolish,
    applyPolishForEpisode,
    polishedTrackForSpeaker,
    resolveExportAudioTracks,
    isPolishReady,
    summarizePolish,
    buildReviewSummary,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
    return;
  }

  global.PdcAudioPolish = api;
}(typeof window !== "undefined" ? window : globalThis));
