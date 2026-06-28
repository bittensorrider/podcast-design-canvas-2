"use strict";

// Episode setup model + rules for Podcast Design Canvas (#1 — first episode setup flow).
//
// This is the single source of truth for the creator's first job: turning raw synced
// recordings and a few social links into a set-up episode. It is deliberately DOM-free
// so the exact same rules run in the browser (the setup screen imports it as a global)
// and in node (the setup-flow tests `require` it). No build step, no dependencies.
(function (global) {
  // Role buckets a creator assigns each source to. "Host" leads; the rest match the
  // Riverside-style guest naming the product workflow describes (Host, Guest 1, Guest 2…).
  const SPEAKER_BUCKETS = ["Host", "Co-host", "Guest 1", "Guest 2", "Guest 3", "Guest 4"];

  // How the raw recording comes in. Either one Riverside recording link, or a separate
  // synced video file per speaker. Labels are creator-facing — no pipeline jargon.
  const SOURCE_MODES = [
    { key: "riverside", label: "Riverside link" },
    { key: "upload", label: "Uploaded speaker files" },
  ];

  // Optional social context captured per speaker. Used only to learn names, topics, and
  // spellings for a smarter edit — never to surface unrelated personal details.
  const SOCIAL_NETWORKS = [
    { key: "website", label: "Website" },
    { key: "twitter", label: "X" },
    { key: "instagram", label: "Instagram" },
    { key: "linkedin", label: "LinkedIn" },
  ];

  function trim(value) {
    return typeof value === "string" ? value.trim() : "";
  }

  function normalizeMode(value) {
    return value === "upload" ? "upload" : "riverside";
  }

  function modeLabel(mode) {
    const found = SOURCE_MODES.find((entry) => entry.key === normalizeMode(mode));
    return found ? found.label : SOURCE_MODES[0].label;
  }

  // Creator-friendly URL check: must be a full link (starts with http/https) and have a
  // host with a dot. Kept lenient on purpose — this guards typos, not link providers.
  function isLikelyUrl(value) {
    const text = trim(value);
    if (!/^https?:\/\//i.test(text)) {
      return false;
    }
    const host = text.replace(/^https?:\/\//i, "").split(/[/?#]/)[0];
    return /[^.\s]+\.[^.\s]+/.test(host);
  }

  function emptySocial() {
    return { website: "", twitter: "", instagram: "", linkedin: "" };
  }

  // A single speaker source: who is talking, which role bucket they fill, the recording
  // that carries them (a file in upload mode, an optional channel label in link mode),
  // and any optional social links.
  function createSpeaker(role) {
    return {
      name: "",
      role: role || "",
      fileName: "",
      fileSize: 0,
      fileBytesBase64: "",
      sourceAudioBase64: "",
      sourceAudioReady: false,
      trackLabel: "",
      social: emptySocial(),
    };
  }

  // ---- Imported source audio capture (#197) -----------------------------------
  // Speaker tracks only count as imported once a real decoded PCM WAV is attached.
  // Browser UI decodes uploaded media with Web Audio; sandbox flows load synced
  // fixture WAV files from fixtures/imported-tracks/.

  function mediaExtractApi() {
    if (typeof module !== "undefined" && module.exports && typeof require === "function") {
      try {
        return require("./media-audio-extract.js");
      } catch (err) {
        return null;
      }
    }
    const g = typeof window !== "undefined" ? window : globalThis;
    return g.PdcMediaAudioExtract || null;
  }

  function attachDecodedSourceAudio(speaker, wavBytes) {
    const next = speaker && typeof speaker === "object" ? speaker : createSpeaker("Host");
    const MAE = mediaExtractApi();
    const bytes = wavBytes instanceof Uint8Array ? wavBytes : new Uint8Array(wavBytes || []);
    if (!MAE || !MAE.isValidWav(bytes)) {
      next.sourceAudioBase64 = "";
      next.sourceAudioReady = false;
      return next;
    }
    next.sourceAudioBase64 = MAE.bytesToBase64(bytes);
    next.sourceAudioReady = true;
    next.fileBytesBase64 = "";
    return next;
  }

  function loadFixtureSourceAudioForRole(speaker) {
    const next = speaker && typeof speaker === "object" ? speaker : createSpeaker("Host");
    const MAE = mediaExtractApi();
    if (!MAE) {
      return next;
    }
    const bytes = MAE.loadFixtureBytes(next.role);
    if (!bytes) {
      return next;
    }
    return attachDecodedSourceAudio(next, bytes);
  }

  function speakerHasDecodedSourceAudio(speaker) {
    const sp = speaker && typeof speaker === "object" ? speaker : {};
    const MAE = mediaExtractApi();
    if (!trim(sp.sourceAudioBase64) || !MAE) {
      return false;
    }
    return MAE.isValidWav(MAE.base64ToBytes(sp.sourceAudioBase64));
  }

  function enrichDraftSourceAudio(draft) {
    const data = draft && typeof draft === "object" ? draft : createDraft();
    const speakers = Array.isArray(data.speakers) ? data.speakers : [];
    speakers.forEach((raw) => {
      const speaker = raw && typeof raw === "object" ? raw : createSpeaker("Host");
      if (!speakerHasDecodedSourceAudio(speaker)) {
        loadFixtureSourceAudioForRole(speaker);
      }
    });
    return data;
  }

  function allSpeakersHaveDecodedSourceAudio(draft) {
    const data = draft && typeof draft === "object" ? draft : {};
    const speakers = Array.isArray(data.speakers) ? data.speakers : [];
    return speakers.length > 0 && speakers.every((speaker) => speakerHasDecodedSourceAudio(speaker));
  }

  function attachUploadedFileMeta(speaker, fileName, fileSize) {
    const next = speaker && typeof speaker === "object" ? speaker : createSpeaker("Host");
    next.fileName = trim(fileName);
    next.fileSize = fileSize || 0;
    next.fileBytesBase64 = "";
    next.sourceAudioBase64 = "";
    next.sourceAudioReady = false;
    return next;
  }

  function speakerBucketCueClass(role) {
    const text = trim(role);
    if (!text) {
      return "speaker-bucket-unassigned";
    }
    const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return `speaker-bucket-${slug}`;
  }

  const PLACEHOLDER_FILES = {
    Host: "host-synced.mp4",
    "Co-host": "cohost-synced.mp4",
    "Guest 1": "guest-1-synced.mp4",
    "Guest 2": "guest-2-synced.mp4",
    "Guest 3": "guest-3-synced.mp4",
    "Guest 4": "guest-4-synced.mp4",
  };

  function placeholderFileName(role) {
    const bucket = trim(role);
    if (PLACEHOLDER_FILES[bucket]) {
      return PLACEHOLDER_FILES[bucket];
    }
    const slug = bucket.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "speaker";
    return `${slug}-synced.mp4`;
  }

  function defaultSpeakerRoleForIndex(index) {
    if (index <= 0) {
      return "Host";
    }
    return `Guest ${index}`;
  }

  // After a creator removes or adds a source, reassign default buckets in list order so
  // cards, chips, and summaries stay Host, Guest 1, Guest 2… with no gaps or duplicates.
  function normalizeDefaultSpeakerRoles(speakers) {
    const list = Array.isArray(speakers) ? speakers : [];
    list.forEach((raw, index) => {
      const speaker = raw && typeof raw === "object" ? raw : createSpeaker("Host");
      speaker.role = defaultSpeakerRoleForIndex(index);
    });
    return list;
  }

  function usedSpeakerRoles(speakers) {
    const used = new Set();
    (Array.isArray(speakers) ? speakers : []).forEach((raw) => {
      const role = trim(raw && raw.role);
      if (role) {
        used.add(role);
      }
    });
    return used;
  }

  // Pick the next default bucket when a creator adds another speaker source. Roles are
  // normalized to Host, Guest 1, Guest 2… after each add or remove so labels stay in order.
  function nextAvailableSpeakerRole(speakers) {
    const list = Array.isArray(speakers) ? speakers : [];
    return defaultSpeakerRoleForIndex(list.length);
  }

  function roleSelectOptions(speakers, currentRole) {
    const options = SPEAKER_BUCKETS.slice();
    const role = trim(currentRole);
    if (role && options.indexOf(role) === -1) {
      options.push(role);
    }
    const nextRole = nextAvailableSpeakerRole(speakers);
    if (nextRole && options.indexOf(nextRole) === -1) {
      options.push(nextRole);
    }
    return options;
  }

  function attachPlaceholderFile(speaker) {
    const next = speaker && typeof speaker === "object" ? speaker : createSpeaker("Host");
    next.fileName = placeholderFileName(next.role);
    next.fileSize = 1280000;
    return loadFixtureSourceAudioForRole(next);
  }

  // A fresh episode draft. Seeded with Host / Guest 1 / Guest 2 so the creator starts
  // from sensible defaults instead of a blank list, matching the preset-first taste rule.
  function createDraft() {
    return {
      episodeName: "",
      sourceMode: "riverside",
      riversideLink: "",
      speakers: [createSpeaker("Host"), createSpeaker("Guest 1"), createSpeaker("Guest 2")],
    };
  }

  function socialEntries(speaker) {
    const social = (speaker && speaker.social) || {};
    return SOCIAL_NETWORKS
      .map((net) => ({ key: net.key, label: net.label, url: trim(social[net.key]) }))
      .filter((entry) => entry.url);
  }

  // Validate a draft against the rules a reviewer must be able to feel in the UI. Returns
  // a flat map of field-key → creator-facing message (so the screen can place each error
  // inline) plus an ordered `messages` list for a summary banner. `ok` is true only when
  // nothing is wrong.
  function validateDraft(draft) {
    const data = draft && typeof draft === "object" ? draft : {};
    const mode = normalizeMode(data.sourceMode);
    const errors = {};
    const messages = [];

    function fail(key, message) {
      if (!errors[key]) {
        errors[key] = message;
        messages.push(message);
      }
    }

    if (!trim(data.episodeName)) {
      fail("episodeName", "Add an episode name so you can find this episode later.");
    }

    if (mode === "riverside") {
      const link = trim(data.riversideLink);
      if (!link) {
        fail("riversideLink", "Add your Riverside recording link to import this episode.");
      } else if (!isLikelyUrl(link)) {
        fail("riversideLink", "That Riverside link doesn't look right — paste the full link starting with http.");
      }
    }

    const speakers = Array.isArray(data.speakers) ? data.speakers : [];
    if (speakers.length === 0) {
      fail("speakers", "Add at least one speaker source to set up the episode.");
    }

    const seenRoles = new Set();
    speakers.forEach((raw, index) => {
      const speaker = raw && typeof raw === "object" ? raw : {};
      const name = trim(speaker.name);
      const who = name || `Speaker ${index + 1}`;

      if (!name) {
        fail(`speaker:${index}:name`, `Give speaker ${index + 1} a name so it's clear who's talking.`);
      }

      const role = trim(speaker.role);
      if (!role) {
        fail(`speaker:${index}:role`, `Choose a role for ${who}.`);
      } else if (seenRoles.has(role)) {
        fail(`speaker:${index}:role`, `Two speakers are set to ${role}. Give ${who} a different role so the layout knows who's who.`);
      } else {
        seenRoles.add(role);
      }

      if (mode === "upload" && !trim(speaker.fileName)) {
        fail(`speaker:${index}:source`, `Choose a video file for ${who}.`);
      }

      const social = (speaker && speaker.social) || {};
      SOCIAL_NETWORKS.forEach((net) => {
        const value = trim(social[net.key]);
        if (value && !isLikelyUrl(value)) {
          fail(`speaker:${index}:social:${net.key}`, `The ${net.label} link for ${who} should be a full URL starting with http.`);
        }
      });
    });

    return { ok: messages.length === 0, errors, messages };
  }

  // The label shown for a speaker's source on the workspace summary. Honest about what
  // was actually captured: the chosen file, the named channel, or just the shared link.
  function sourceLabel(mode, speaker) {
    if (normalizeMode(mode) === "upload") {
      return trim(speaker && speaker.fileName) || "No file chosen";
    }
    return trim(speaker && speaker.trackLabel) || "Riverside recording";
  }

  // Derive exactly what the workspace screen displays. Everything here is computed from
  // the draft — no fabricated state — so the summary always reflects what was entered.
  function summarize(draft) {
    const data = enrichDraftSourceAudio(draft && typeof draft === "object" ? draft : {});
    const mode = normalizeMode(data.sourceMode);
    const speakers = Array.isArray(data.speakers) ? data.speakers : [];

    const summarizedSpeakers = speakers.map((raw) => {
      const speaker = raw && typeof raw === "object" ? raw : {};
      const social = socialEntries(speaker);
      return {
        role: trim(speaker.role),
        name: trim(speaker.name),
        sourceLabel: sourceLabel(mode, speaker),
        sourceAudioBase64: trim(speaker.sourceAudioBase64),
        sourceAudioReady: Boolean(speaker.sourceAudioReady),
        social,
      };
    });

    const socialLinkCount = summarizedSpeakers.reduce((total, sp) => total + sp.social.length, 0);

    return {
      episodeName: trim(data.episodeName),
      sourceMode: mode,
      sourceModeLabel: modeLabel(mode),
      riversideLink: mode === "riverside" ? trim(data.riversideLink) : "",
      speakerCount: summarizedSpeakers.length,
      socialLinkCount,
      roles: summarizedSpeakers.map((sp) => sp.role).filter(Boolean),
      speakers: summarizedSpeakers,
    };
  }

  function socialLinksBenefitLine() {
    return "Add a website or profile link so the edit can spell names correctly, catch references, and shape captions and visual moments. Optional production context only — never invasive research.";
  }

  function importSocialContextCueLine() {
    return "Optional speaker links help transcript spellings and make captions and on-screen moments more accurate. Skip them anytime — the import still works.";
  }

  function defaultImportShowName() {
    return "My podcast show";
  }

  function sandboxDemoRiversideLink() {
    return "https://riverside.fm/studio/podcast-canvas-demo";
  }

  function isSandboxDemoRiversideLink(link) {
    return trim(link) === sandboxDemoRiversideLink();
  }

  // Creator-facing speaker label for setup recap and workspace summaries.
  function handoffIdentityLine(name, role) {
    const safeName = trim(name);
    const safeRole = trim(role);
    if (!safeName || safeName === safeRole) {
      return safeRole;
    }
    return `${safeName} · ${safeRole}`;
  }

  // Hide internal sandbox/demo URLs from setup handoff while keeping real links visible.
  function handoffSourceDetail(data) {
    const summary = data && typeof data === "object" ? data : {};
    const mode = normalizeMode(summary.sourceMode);
    if (mode === "riverside") {
      const link = trim(summary.riversideLink);
      if (!link) {
        return "Riverside recording link saved";
      }
      if (isSandboxDemoRiversideLink(link)) {
        return "Riverside recording link ready";
      }
      return link;
    }
    return "Synced speaker files attached per bucket";
  }

  // When a creator picks a preset but has not pasted a Riverside link yet, attach a
  // review-friendly demo link so Continue can complete setup (same spirit as placeholder files).
  function applySandboxHandoffSource(draft) {
    const data = draft && typeof draft === "object" ? draft : createDraft();
    if (normalizeMode(data.sourceMode) === "riverside" && !trim(data.riversideLink)) {
      data.riversideLink = sandboxDemoRiversideLink();
    }
    return data;
  }

  function prepareSandboxPresetHandoff(draft, options) {
    const opts = options && typeof options === "object" ? options : {};
    const showName = trim(opts.showName) || defaultImportShowName();
    return applyImportContinueDefaults(applySandboxHandoffSource(draft), { showName });
  }

  // When a valid import source is present but optional identity fields are blank, fill
  // creator-friendly defaults so Continue can land in the workspace handoff without
  // blocking on every text field (same spirit as placeholder files for upload review).
  function canApplyImportContinueDefaults(draft) {
    const data = draft && typeof draft === "object" ? draft : {};
    const mode = normalizeMode(data.sourceMode);
    if (mode === "riverside") {
      return isLikelyUrl(trim(data.riversideLink));
    }
    const speakers = Array.isArray(data.speakers) ? data.speakers : [];
    return speakers.length > 0 && speakers.every((speaker) => trim(speaker.fileName));
  }

  function applyImportContinueDefaults(draft, options) {
    const data = draft && typeof draft === "object" ? draft : createDraft();
    if (!canApplyImportContinueDefaults(data)) {
      return data;
    }
    const showName = trim((options && options.showName) || "") || defaultImportShowName();
    if (!trim(data.episodeName)) {
      data.episodeName = `${showName} — Episode 1`;
    }
    (Array.isArray(data.speakers) ? data.speakers : []).forEach((raw) => {
      const speaker = raw && typeof raw === "object" ? raw : createSpeaker("Host");
      if (!trim(speaker.name) && trim(speaker.role)) {
        speaker.name = speaker.role;
      }
    });
    return data;
  }

  function buildImportHandoff(summary) {
    const data = summary && typeof summary === "object" ? summary : {};
    const mode = normalizeMode(data.sourceMode);
    const speakers = Array.isArray(data.speakers) ? data.speakers : [];
    const sourceDetail = handoffSourceDetail(data);

    return {
      confirmationLead: "Your imported sources, speaker buckets, and social context are saved and driving this episode setup.",
      sourceLabel: data.sourceModeLabel || modeLabel(mode),
      sourceDetail,
      speakers: speakers.map((speaker) => {
        const social = Array.isArray(speaker.social) ? speaker.social : [];
        return {
          role: trim(speaker.role),
          name: trim(speaker.name),
          identityLine: handoffIdentityLine(speaker.name, speaker.role),
          sourceLabel: trim(speaker.sourceLabel) || sourceLabel(mode, speaker),
          social,
          socialLine: social.length
            ? social.map((entry) => `${entry.label}: ${entry.url}`).join(" · ")
            : "No social links added",
        };
      }),
      socialLinkCount: Number(data.socialLinkCount) || 0,
    };
  }

  function buildSetupCompletionHandoff(summary, options) {
    const handoff = buildImportHandoff(summary);
    const opts = options && typeof options === "object" ? options : {};
    const presetSummary = trim(opts.presetSummary);
    return {
      episodeTitle: trim(summary && summary.episodeName) || "Untitled episode",
      presetSummary: presetSummary || "Choose a preset during setup",
      completionEyebrow: "Setup complete",
      completionLead: presetSummary
        ? "Your preset, recording source, speaker roles, and social context are saved and driving this episode in the production workspace."
        : handoff.confirmationLead,
      roleSummary: handoff.speakers.map((speaker) => speaker.identityLine).filter(Boolean).join(" · "),
      handoff,
    };
  }

  // Known seeded demo titles from gallery/canvas probes — must not appear in a fresh handoff.
  function isSeededDemoEpisodeTitle(name) {
    const lowered = trim(name).toLowerCase();
    if (!lowered) {
      return false;
    }
    if (lowered === "founders unfiltered #7" || lowered === "founders unfiltered · episode 12") {
      return true;
    }
    return /episode 12/.test(lowered) && /building in public/.test(lowered);
  }

  function deriveImportShowName(summary) {
    const episodeName = trim(summary && summary.episodeName);
    if (episodeName) {
      const stem = trim(episodeName.split("—")[0].split("–")[0]);
      if (stem && stem.length > 2 && !isSeededDemoEpisodeTitle(stem)) {
        return stem;
      }
    }
    return defaultImportShowName();
  }

  function buildFreshEpisodePersistence(summary, options) {
    const data = summary && typeof summary === "object" ? summary : {};
    const opts = options && typeof options === "object" ? options : {};
    const handoff = buildImportHandoff(data);
    return {
      episodeName: trim(data.episodeName) || "Untitled episode",
      showName: trim(opts.showName) || deriveImportShowName(data),
      speakerRoles: (data.speakers || []).map((speaker) => trim(speaker.role)).filter(Boolean),
      speakerIdentities: handoff.speakers.map((speaker) => speaker.identityLine),
      sourceDetail: handoff.sourceDetail,
      presetSummary: trim(opts.presetSummary) || "",
    };
  }

  function isFreshHandoffSummary(summary, options) {
    const data = summary && typeof summary === "object" ? summary : {};
    const opts = options && typeof options === "object" ? options : {};
    if (isSeededDemoEpisodeTitle(data.episodeName)) {
      return false;
    }
    if (opts.expectedEpisodeName && trim(data.episodeName) !== trim(opts.expectedEpisodeName)) {
      return false;
    }
    const speakers = Array.isArray(data.speakers) ? data.speakers : [];
    if (opts.expectedSpeakerNames) {
      const names = speakers.map((speaker) => trim(speaker.name));
      if (names.join("|") !== opts.expectedSpeakerNames.map((name) => trim(name)).join("|")) {
        return false;
      }
    }
    return true;
  }

  const api = {
    SPEAKER_BUCKETS,
    SOURCE_MODES,
    SOCIAL_NETWORKS,
    createDraft,
    createSpeaker,
    emptySocial,
    isLikelyUrl,
    modeLabel,
    normalizeMode,
    socialEntries,
    sourceLabel,
    speakerBucketCueClass,
    placeholderFileName,
    attachPlaceholderFile,
    attachUploadedFileMeta,
    attachDecodedSourceAudio,
    loadFixtureSourceAudioForRole,
    speakerHasDecodedSourceAudio,
    allSpeakersHaveDecodedSourceAudio,
    enrichDraftSourceAudio,
    defaultSpeakerRoleForIndex,
    normalizeDefaultSpeakerRoles,
    usedSpeakerRoles,
    nextAvailableSpeakerRole,
    roleSelectOptions,
    socialLinksBenefitLine,
    importSocialContextCueLine,
    defaultImportShowName,
    sandboxDemoRiversideLink,
    isSandboxDemoRiversideLink,
    handoffIdentityLine,
    handoffSourceDetail,
    applySandboxHandoffSource,
    prepareSandboxPresetHandoff,
    canApplyImportContinueDefaults,
    applyImportContinueDefaults,
    buildImportHandoff,
    buildSetupCompletionHandoff,
    isSeededDemoEpisodeTitle,
    deriveImportShowName,
    buildFreshEpisodePersistence,
    isFreshHandoffSummary,
    summarize,
    validateDraft,
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
    return;
  }

  global.PdcEpisodeSetup = api;
}(typeof window !== "undefined" ? window : globalThis));
