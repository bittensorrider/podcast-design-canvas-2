"use strict";

// Guided end-to-end episode workspace for Podcast Design Canvas (#40).
//
// Connects setup, style, audio, moments, template, review, and export into one
// creator-facing production flow with plain-language stage status and summaries.
// DOM-free so the workspace screen and tests share one source of truth.
(function (global) {
  const STAGE_ORDER = ["setup", "style", "audio", "moments", "template", "review", "export"];

  const ACTION_TARGETS = {
    setup: "setup",
    style: "style",
    audio: "audio",
    moments: "moments",
    template: "canvas",
    review: "review",
    export: "export",
  };

  const STATUS = {
    PENDING: "pending",
    ACTIVE: "active",
    ATTENTION: "attention",
    COMPLETE: "complete",
  };

  function setupApi() {
    if (typeof module !== "undefined" && module.exports && typeof require === "function") {
      return require("./episode-setup.js");
    }
    const g = typeof window !== "undefined" ? window : globalThis;
    return g.PdcEpisodeSetup;
  }

  function audioPolishApi() {
    if (typeof module !== "undefined" && module.exports && typeof require === "function") {
      return require("./audio-polish.js");
    }
    const g = typeof window !== "undefined" ? window : globalThis;
    return g.PdcAudioPolish;
  }

  function isAudioPolishApplied(context) {
    const AP = audioPolishApi();
    if (AP) {
      return AP.isPolishReady(context && context.audioPolish);
    }
    return Boolean(context && context.audioPolish && context.audioPolish.presetName);
  }

  function stage(id, label, status, summary, actionLabel, actionTarget) {
    return {
      id: id,
      label: label,
      status: status,
      summary: summary,
      actionLabel: actionLabel,
      actionTarget: actionTarget || ACTION_TARGETS[id] || id,
    };
  }

  function buildStages(episodeSummary, ctx) {
    const episode = episodeSummary || {};
    const context = ctx || {};
    const setup = setupApi();
    const stages = [];

    // Setup -------------------------------------------------------------------
    const setupComplete = Boolean(episode.episodeName) && (episode.speakerCount || 0) > 0;
    let setupSummary = "Add your episode name, sources, and speaker roles.";
    if (setupComplete) {
      const parts = [];
      if (episode.riversideLink) {
        const sourceDetail = setup && setup.handoffSourceDetail
          ? setup.handoffSourceDetail(episode)
          : episode.riversideLink;
        parts.push(`${episode.sourceModeLabel || "Riverside link"}: ${sourceDetail}`);
      } else if (episode.sourceModeLabel) {
        parts.push(episode.sourceModeLabel);
      }
      const identities = (episode.speakers || []).map(function (speaker) {
        if (setup && setup.handoffIdentityLine) {
          return setup.handoffIdentityLine(speaker.name, speaker.role);
        }
        return speaker.name ? `${speaker.name} (${speaker.role})` : speaker.role;
      }).filter(Boolean);
      if (identities.length) {
        parts.push(identities.join(" · "));
      }
      if (episode.socialLinkCount > 0) {
        parts.push(`${episode.socialLinkCount} social link${episode.socialLinkCount === 1 ? "" : "s"} saved`);
        parts.push(context.contextApproved ? "context approved" : "context ready to review");
      }
      setupSummary = parts.join(" · ");
    }
    stages.push(stage(
      "setup",
      "Episode setup",
      setupComplete ? STATUS.COMPLETE : STATUS.ACTIVE,
      setupSummary,
      setupComplete ? "Edit setup" : "Continue setup",
      ACTION_TARGETS.setup,
    ));

    // Style -------------------------------------------------------------------
    const styleApplied = context.appliedStyle && context.appliedStyle.presetName;
    stages.push(stage(
      "style",
      "Visual style",
      styleApplied
        ? STATUS.COMPLETE
        : setupComplete ? STATUS.ACTIVE : STATUS.PENDING,
      styleApplied
        ? `${context.appliedStyle.presetName} · ${context.appliedStyle.layoutLabel || "layout"}`
        : "Pick a preset look and pacing for your speakers.",
      styleApplied ? "Change style" : "Choose style",
      ACTION_TARGETS.style,
    ));

    // Audio -------------------------------------------------------------------
    const audioApplied = isAudioPolishApplied(context);
    stages.push(stage(
      "audio",
      "Audio polish",
      audioApplied
        ? STATUS.COMPLETE
        : setupComplete ? STATUS.ACTIVE : STATUS.PENDING,
      audioApplied
        ? `${context.audioPolish.presetName} — ${context.audioPolish.polishedTrackCount || 0} polished track${(context.audioPolish.polishedTrackCount || 0) === 1 ? "" : "s"} · ${context.audioPolish.treatmentLine || "treatment applied"}`
        : "Choose a sound quality preset for every speaker track.",
      audioApplied ? "Change audio" : "Polish audio",
      ACTION_TARGETS.audio,
    ));

    // Visual moments ----------------------------------------------------------
    const ms = context.momentsSummary || {};
    const momentTotal = ms.total || 0;
    const momentVisible = ms.visibleCount || 0;
    stages.push(stage(
      "moments",
      "Visual moments",
      momentTotal > 0
        ? STATUS.COMPLETE
        : styleApplied && audioApplied ? STATUS.ATTENTION : STATUS.PENDING,
      momentTotal > 0
        ? `${momentVisible} of ${momentTotal} moment${momentTotal === 1 ? "" : "s"} live`
        : "Add captions, titles, b-roll, and callouts at key points.",
      momentTotal > 0 ? "Edit moments" : "Add moments",
      ACTION_TARGETS.moments,
    ));

    // Show template -----------------------------------------------------------
    const templateName = context.templateName || "";
    stages.push(stage(
      "template",
      "Show template",
      templateName
        ? STATUS.COMPLETE
        : styleApplied ? STATUS.ATTENTION : STATUS.PENDING,
      templateName
        ? `"${templateName}" saved for reuse`
        : "Personalize the canvas and save a reusable show identity.",
      templateName ? "Edit canvas" : "Open canvas editor",
      ACTION_TARGETS.template,
    ));

    // Publish review ----------------------------------------------------------
    const exportReady = Boolean(context.exportReady);
    const reviewApproved = Boolean(context.publishReviewApproved);
    let reviewStatus = STATUS.PENDING;
    if (reviewApproved) {
      reviewStatus = STATUS.COMPLETE;
    } else if (exportReady) {
      reviewStatus = STATUS.ACTIVE;
    }
    stages.push(stage(
      "review",
      "Publish review",
      reviewStatus,
      reviewApproved
        ? "Episode approved — ready to export."
        : exportReady
          ? "Run the full-episode confidence check before exporting."
          : "Complete audio and style before reviewing.",
      reviewApproved ? "View review" : "Review episode",
      ACTION_TARGETS.review,
    ));

    // Export ------------------------------------------------------------------
    const exportDone = context.exportStatus === "ready";
    let exportStatus = STATUS.PENDING;
    if (exportDone) {
      exportStatus = STATUS.COMPLETE;
    } else if (reviewApproved && exportReady) {
      exportStatus = STATUS.ACTIVE;
    }
    stages.push(stage(
      "export",
      "Export & publish",
      exportStatus,
      exportDone
        ? `Ready to download${context.exportDownloadName ? `: ${context.exportDownloadName}` : ""}`
        : reviewApproved
          ? "Choose platform, resolution, and caption options."
          : "Approve the publish review to unlock export.",
      exportDone ? "View export" : "Export episode",
      ACTION_TARGETS.export,
    ));

    return stages;
  }

  function pickCurrentStage(stages) {
    const list = Array.isArray(stages) ? stages : [];
    // Surface canvas editor before audio polish when a show template is the recommended next step (#190).
    const templateAttention = list.find((item) => item.id === "template" && item.status === STATUS.ATTENTION);
    if (templateAttention) {
      return templateAttention;
    }
    return list.find((item) => item.status === STATUS.ACTIVE)
      || list.find((item) => item.status === STATUS.ATTENTION)
      || list[list.length - 1];
  }

  function buildWorkspace(episodeSummary, ctx) {
    const stages = buildStages(episodeSummary, ctx);
    const completeCount = stages.filter((item) => item.status === STATUS.COMPLETE).length;
    const attentionCount = stages.filter((item) => item.status === STATUS.ATTENTION).length;
    const activeStage = pickCurrentStage(stages);

    return {
      episodeName: (episodeSummary && episodeSummary.episodeName) || "",
      stages: stages,
      completeCount: completeCount,
      totalStages: stages.length,
      attentionCount: attentionCount,
      currentStageId: activeStage ? activeStage.id : STAGE_ORDER[0],
      progressLine: `${completeCount} of ${stages.length} stages complete${attentionCount ? ` · ${attentionCount} recommended` : ""}`,
    };
  }

  function getStage(workspace, id) {
    const stages = workspace && Array.isArray(workspace.stages) ? workspace.stages : [];
    return stages.find((item) => item.id === id) || null;
  }

  function summarizeWorkspace(workspace) {
    const ws = workspace || buildWorkspace({}, {});
    const current = getStage(ws, ws.currentStageId);
    return {
      progressLine: ws.progressLine,
      completeCount: ws.completeCount,
      totalStages: ws.totalStages,
      currentStageId: ws.currentStageId,
      currentStageLabel: current ? current.label : "",
      workspaceLine: current
        ? `Next: ${current.label} — ${current.summary}`
        : ws.progressLine,
    };
  }

  const api = {
    STAGE_ORDER,
    ACTION_TARGETS,
    STATUS,
    buildStages,
    buildWorkspace,
    getStage,
    summarizeWorkspace,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
    return;
  }

  global.PdcEpisodeWorkspace = api;
}(typeof window !== "undefined" ? window : globalThis));
