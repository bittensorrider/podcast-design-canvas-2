"use strict";

// Episode export model for Podcast Design Canvas (#30).
//
// The final publish step: roll up setup, audio, style, canvas/template, and visual
// moments into a coherent export job with creator-facing platform, resolution, and
// caption choices. DOM-free so the export screen and tests share one source of truth.
(function (global) {
  const PLATFORMS = [
    { id: "youtube", name: "YouTube", tagline: "Landscape long-form publish" },
    { id: "spotify", name: "Spotify / Apple Podcasts", tagline: "Video podcast feeds" },
    { id: "download", name: "Download file", tagline: "Save locally for any platform" },
  ];

  const RESOLUTIONS = [
    { id: "1080p", label: "1080p HD", tagline: "Best for YouTube and large screens" },
    { id: "720p", label: "720p", tagline: "Smaller file, still sharp on mobile" },
  ];

  const CAPTION_MODES = [
    { id: "burn-in", label: "Burn captions in", tagline: "Captions are baked into the video" },
    { id: "sidecar", label: "Separate caption file", tagline: "Video plus .srt for flexible uploads" },
  ];

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function getPlatform(id) {
    return PLATFORMS.find((item) => item.id === id) || PLATFORMS[0];
  }

  function getResolution(id) {
    return RESOLUTIONS.find((item) => item.id === id) || RESOLUTIONS[0];
  }

  function getCaptionMode(id) {
    return CAPTION_MODES.find((item) => item.id === id) || CAPTION_MODES[0];
  }

  function createExport(episodeSummary, options) {
    const episode = episodeSummary || {};
    const opts = options || {};
    return {
      episodeName: episode.episodeName || "",
      platform: "youtube",
      resolution: "1080p",
      captionMode: "burn-in",
      templateId: opts.templateId || "",
      templateName: opts.templateName || "",
      status: "draft",
      progress: 0,
      downloadName: "",
      startedAt: null,
      completedAt: null,
    };
  }

  function missingMessage(missing) {
    const needs = [];
    if (missing.indexOf("audio") >= 0) {
      needs.push("polish your audio");
    }
    if (missing.indexOf("style") >= 0) {
      needs.push("choose a visual style");
    }
    if (missing.indexOf("review") >= 0) {
      needs.push("approve the publish review");
    }
    if (!needs.length) {
      return "";
    }
    if (needs.length === 1) {
      return `Please ${needs[0]} before exporting.`;
    }
    if (needs.length === 2) {
      return `Please ${needs[0]} and ${needs[1]} before exporting.`;
    }
    return `Please ${needs[0]}, ${needs[1]}, and ${needs[2]} before exporting.`;
  }

  function publishReviewApi() {
    if (typeof module !== "undefined" && module.exports && typeof require === "function") {
      return require("./publish-review.js");
    }
    const g = typeof window !== "undefined" ? window : globalThis;
    return g.PdcPublishReview;
  }

  function validatePublishReviewGate(context) {
    const ctx = context || {};
    const PR = publishReviewApi();
    if (ctx.publishReview && PR) {
      return PR.validateExportGate(ctx.publishReview);
    }
    if (ctx.publishReviewApproved) {
      return { ok: true };
    }
    return {
      ok: false,
      error: "Complete the publish review before exporting.",
      missing: ["review"],
    };
  }

  function validateExportAuthorization(context) {
    const readiness = validateReadiness(context);
    if (!readiness.ok) {
      return readiness;
    }
    const reviewGate = validatePublishReviewGate(context);
    if (!reviewGate.ok) {
      return reviewGate;
    }
    return { ok: true };
  }

  function audioPolishApi() {
    if (typeof module !== "undefined" && module.exports && typeof require === "function") {
      return require("./audio-polish.js");
    }
    const g = typeof window !== "undefined" ? window : globalThis;
    return g.PdcAudioPolish;
  }

  function validatePolishedAudioAssets(context) {
    const ctx = context || {};
    const AP = audioPolishApi();
    const polish = ctx.audioPolish || {};
    if (!AP || !AP.isPolishReady(polish)) {
      return { ok: false };
    }
    const tracks = AP.resolveExportAudioTracks(polish);
    const speakerCount = polish.speakerCount || 0;
    const polished = tracks.filter((track) => track.usesPolishedAudio && track.assetId);
    if (polished.length < speakerCount) {
      return {
        ok: false,
        error: "Apply audio polish to generate polished tracks before exporting.",
        missing: ["audio"],
      };
    }
    return { ok: true, audioTracks: polished };
  }

  function validateReadiness(context) {
    const ctx = context || {};
    const missing = [];
    const AP = audioPolishApi();
    const audioReady = AP ? AP.isPolishReady(ctx.audioPolish) : Boolean(ctx.audioPolish && ctx.audioPolish.presetName);
    if (!audioReady) {
      missing.push("audio");
    }
    if (!ctx.appliedStyle || !ctx.appliedStyle.presetName) {
      missing.push("style");
    }
    if (missing.length) {
      return { ok: false, error: missingMessage(missing), missing };
    }
    const audioAssets = validatePolishedAudioAssets(ctx);
    if (!audioAssets.ok) {
      return {
        ok: false,
        error: audioAssets.error || missingMessage(["audio"]),
        missing: audioAssets.missing || ["audio"],
      };
    }
    return { ok: true, audioTracks: audioAssets.audioTracks };
  }

  function updateOption(state, key, value) {
    const next = clone(state || createExport({}));
    if (key === "platform" && getPlatform(value).id === value) {
      next.platform = value;
    } else if (key === "resolution" && getResolution(value).id === value) {
      next.resolution = value;
    } else if (key === "captionMode" && getCaptionMode(value).id === value) {
      next.captionMode = value;
    } else if (key === "templateId") {
      next.templateId = typeof value === "string" ? value : "";
    } else if (key === "templateName") {
      next.templateName = typeof value === "string" ? value : "";
    }
    return next;
  }

  function buildFinalSummary(episodeSummary, context, exportState) {
    const episode = episodeSummary || {};
    const ctx = context || {};
    const job = exportState || {};
    const lines = [];

    lines.push(`${episode.speakerCount || 0} speaker${episode.speakerCount === 1 ? "" : "s"} · ${episode.sourceModeLabel || "sources"}`);

    if (ctx.audioPolish && ctx.audioPolish.presetName) {
      const polishedCount = ctx.audioPolish.polishedTrackCount || 0;
      const audioLine = polishedCount > 0
        ? `Audio: ${ctx.audioPolish.presetName} (${ctx.audioPolish.treatmentLine || "treatment applied"}) · ${polishedCount} polished track${polishedCount === 1 ? "" : "s"}`
        : `Audio: ${ctx.audioPolish.presetName} (${ctx.audioPolish.treatmentLine || "treatment applied"})`;
      lines.push(audioLine);
    }
    if (job.audioTracks && job.audioTracks.length) {
      const assetLine = job.audioTracks
        .map((track) => `${track.fileName || track.assetId} (${track.assetId})`)
        .join(", ");
      lines.push(`Audio render: ${assetLine}`);
    }
    if (ctx.appliedStyle && ctx.appliedStyle.presetName) {
      lines.push(
        `Visual style: ${ctx.appliedStyle.presetName} · ${ctx.appliedStyle.layoutLabel || "layout"} · ${ctx.appliedStyle.pacingLabel || "pacing"}`,
      );
    }
    const templateName = job.templateName || ctx.templateName || "";
    if (templateName) {
      lines.push(`Show template: ${templateName}`);
    }
    if (ctx.momentsSummary && ctx.momentsSummary.reviewLine) {
      lines.push(ctx.momentsSummary.reviewLine);
    }
    if (ctx.contextSummary && ctx.contextSummary.reviewLine) {
      lines.push(ctx.contextSummary.reviewLine);
    }
    if (ctx.brandKitSummary && ctx.brandKitSummary.reviewLine) {
      lines.push(ctx.brandKitSummary.reviewLine);
    }
    if (ctx.publishPackageSummary && ctx.publishPackageSummary.lines) {
      ctx.publishPackageSummary.lines.forEach((line) => lines.push(line));
    }
    if (ctx.correctionSummary && ctx.correctionSummary.lines) {
      ctx.correctionSummary.lines.forEach((line) => lines.push(line));
    }

    const platform = getPlatform(job.platform);
    const resolution = getResolution(job.resolution);
    const captions = getCaptionMode(job.captionMode);
    lines.push(`Export: ${platform.name} · ${resolution.label} · ${captions.label}`);

    return {
      episodeName: episode.episodeName || "",
      lines,
      platformName: platform.name,
      resolutionLabel: resolution.label,
      captionLabel: captions.label,
    };
  }

  function safeFileStem(name) {
    const trimmed = typeof name === "string" ? name.trim() : "";
    const stem = trimmed.replace(/[^\w\s-]/g, "").replace(/\s+/g, "-");
    return stem || "episode";
  }

  function startExport(state, episodeSummary, context) {
    const check = validateExportAuthorization(context);
    if (!check.ok) {
      return { ok: false, error: check.error, state: clone(state || createExport(episodeSummary)) };
    }
    const next = clone(state || createExport(episodeSummary));
    next.status = "rendering";
    next.progress = 0;
    next.startedAt = Date.now();
    next.completedAt = null;
    next.downloadName = "";
    return { ok: true, state: next };
  }

  function attachPolishedAudioToExport(state, context) {
    const next = clone(state || createExport({}));
    const ctx = context || {};
    const AP = audioPolishApi();
    const exportTracks = AP ? AP.resolveExportAudioTracks(ctx.audioPolish || {}) : [];
    const polished = exportTracks.filter((track) => track.usesPolishedAudio && track.assetId);
    next.audioTracks = polished.map((track) => ({
      trackIndex: track.trackIndex,
      role: track.role,
      name: track.name,
      assetId: track.assetId,
      fileName: track.fileName,
    }));
    next.usesPolishedAudio = polished.length > 0
      && polished.length === (ctx.audioPolish && ctx.audioPolish.speakerCount ? ctx.audioPolish.speakerCount : polished.length);
    next.audioSource = polished.length
      ? `polished-wav:${polished.map((track) => track.assetId).join(",")}`
      : "";
    return next;
  }

  function completeExport(state, episodeSummary, context) {
    const next = attachPolishedAudioToExport(state, context);
    const episode = episodeSummary || {};
    next.status = "ready";
    next.progress = 100;
    next.completedAt = Date.now();
    next.downloadName = `${safeFileStem(episode.episodeName)}-${next.resolution}.mp4`;
    return next;
  }

  function runExport(state, episodeSummary, context) {
    const started = startExport(state, episodeSummary, context);
    if (!started.ok) {
      return started;
    }
    return { ok: true, state: completeExport(started.state, episodeSummary, context) };
  }

  function summarizeExport(state) {
    const job = state || {};
    const platform = getPlatform(job.platform);
    const resolution = getResolution(job.resolution);
    const captions = getCaptionMode(job.captionMode);
    const audioTracks = Array.isArray(job.audioTracks) ? job.audioTracks : [];
    return {
      status: job.status || "draft",
      progress: job.progress || 0,
      platformName: platform.name,
      resolutionLabel: resolution.label,
      captionLabel: captions.label,
      templateName: job.templateName || "",
      downloadName: job.downloadName || "",
      audioTrackCount: audioTracks.length,
      audioAssetIds: audioTracks.map((track) => track.assetId),
      usesPolishedAudio: Boolean(job.usesPolishedAudio),
      ready: job.status === "ready",
      rendering: job.status === "rendering",
    };
  }

  const api = {
    PLATFORMS,
    RESOLUTIONS,
    CAPTION_MODES,
    getPlatform,
    getResolution,
    getCaptionMode,
    createExport,
    validateReadiness,
    validatePolishedAudioAssets,
    validatePublishReviewGate,
    validateExportAuthorization,
    updateOption,
    buildFinalSummary,
    startExport,
    completeExport,
    runExport,
    summarizeExport,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
    return;
  }

  global.PdcEpisodeExport = api;
}(typeof window !== "undefined" ? window : globalThis));
