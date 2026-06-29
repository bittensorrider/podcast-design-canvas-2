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
      sourceMedia: null,
      trackLabel: "",
      social: emptySocial(),
    };
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
    next.sourceMedia = null;
    return next;
  }

  function sourceMediaId(fileName, role) {
    const source = trim(fileName) || trim(role) || "speaker-source";
    const slug = source.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "speaker-source";
    return `${slug}-${Date.now()}`;
  }

  function normalizeSourceMediaAsset(asset, speaker) {
    const data = asset && typeof asset === "object" ? asset : {};
    const fileName = trim(data.fileName || data.name || (speaker && speaker.fileName));
    const byteLength = Math.max(
      0,
      Number(data.byteLength || data.fileSize || data.size || (speaker && speaker.fileSize) || 0) || 0,
    );
    const assetId = trim(data.assetId || data.id);
    const dataUrl = trim(data.dataUrl);
    if (!fileName || byteLength <= 0 || (!assetId && !dataUrl)) {
      return null;
    }
    return {
      assetId: assetId || sourceMediaId(fileName, speaker && speaker.role),
      fileName,
      mimeType: trim(data.mimeType || data.type) || "application/octet-stream",
      byteLength,
      storage: trim(data.storage) || (dataUrl ? "inline" : "browser"),
      dataUrl,
      storedAt: Number(data.storedAt || data.capturedAt) || Date.now(),
    };
  }

  function attachSourceMediaAsset(speaker, asset) {
    const next = speaker && typeof speaker === "object" ? speaker : createSpeaker("Host");
    const sourceMedia = normalizeSourceMediaAsset(asset, next);
    if (!sourceMedia) {
      next.sourceMedia = null;
      return next;
    }
    next.fileName = sourceMedia.fileName;
    next.fileSize = sourceMedia.byteLength;
    next.sourceMedia = sourceMedia;
    return next;
  }

  function hasSourceMedia(speaker) {
    return Boolean(normalizeSourceMediaAsset(speaker && speaker.sourceMedia, speaker));
  }

  function summarizeSourceMedia(speaker) {
    const sourceMedia = normalizeSourceMediaAsset(speaker && speaker.sourceMedia, speaker);
    if (!sourceMedia) {
      return null;
    }
    return {
      assetId: sourceMedia.assetId,
      fileName: sourceMedia.fileName,
      mimeType: sourceMedia.mimeType,
      byteLength: sourceMedia.byteLength,
      storage: sourceMedia.storage,
      dataUrl: sourceMedia.dataUrl,
      storedAt: sourceMedia.storedAt,
    };
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

      if (mode === "upload") {
        if (!trim(speaker.fileName)) {
          fail(`speaker:${index}:source`, `Choose an audio or video file for ${who}.`);
        } else if (!hasSourceMedia(speaker)) {
          fail(`speaker:${index}:source`, `Save the real media bytes for ${who} before continuing.`);
        }
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
    const data = draft && typeof draft === "object" ? draft : {};
    const mode = normalizeMode(data.sourceMode);
    const speakers = Array.isArray(data.speakers) ? data.speakers : [];

    const summarizedSpeakers = speakers.map((raw) => {
      const speaker = raw && typeof raw === "object" ? raw : {};
      const social = socialEntries(speaker);
      return {
        role: trim(speaker.role),
        name: trim(speaker.name),
        sourceLabel: sourceLabel(mode, speaker),
        sourceMedia: mode === "upload" ? summarizeSourceMedia(speaker) : null,
        hasSourceMedia: mode === "upload" ? hasSourceMedia(speaker) : false,
        social,
      };
    });

    const socialLinkCount = summarizedSpeakers.reduce((total, sp) => total + sp.social.length, 0);
    const sourceMediaCount = summarizedSpeakers.reduce((total, sp) => total + (sp.hasSourceMedia ? 1 : 0), 0);

    return {
      episodeName: trim(data.episodeName),
      sourceMode: mode,
      sourceModeLabel: modeLabel(mode),
      riversideLink: mode === "riverside" ? trim(data.riversideLink) : "",
      speakerCount: summarizedSpeakers.length,
      socialLinkCount,
      sourceMediaCount,
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
    return speakers.length > 0 && speakers.every((speaker) => trim(speaker.fileName) && hasSourceMedia(speaker));
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
      sourceMediaCount: Number(data.sourceMediaCount) || 0,
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

  // ---- Riverside track discovery (#225) --------------------------------------
  // When a creator pastes a Riverside recording link, surface the speaker tracks the
  // session contains so buckets can be assigned without manual guesswork. There is no
  // Riverside backend in the sandbox, so a valid riverside.fm link yields a deterministic
  // session preview (stable for a given link) that simulates what a real import returns.

  function riversideHost(url) {
    const text = trim(url);
    if (!/^https?:\/\//i.test(text)) {
      return "";
    }
    return text.replace(/^https?:\/\//i, "").split(/[/?#]/)[0].toLowerCase();
  }

  function isRiversideUrl(url) {
    if (!isLikelyUrl(url)) {
      return false;
    }
    const host = riversideHost(url);
    return host === "riverside.fm" || host.endsWith(".riverside.fm");
  }

  function hashString(value) {
    // FNV-1a 32-bit — used only to make the simulated session preview deterministic.
    let h = 0x811c9dc5;
    const text = String(value);
    for (let i = 0; i < text.length; i += 1) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }

  function formatTrackDuration(totalSeconds) {
    const secs = Math.max(0, Math.round(Number(totalSeconds) || 0));
    const hours = Math.floor(secs / 3600);
    const minutes = Math.floor((secs % 3600) / 60);
    const seconds = secs % 60;
    const mm = hours ? String(minutes).padStart(2, "0") : String(minutes);
    const ss = String(seconds).padStart(2, "0");
    return hours ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
  }

  // The fixed, friendly track preview for the built-in sandbox demo link.
  function sandboxDemoTracks() {
    return [
      { speakerLabel: "Studio mic 1", durationSeconds: 3725 },
      { speakerLabel: "Studio mic 2", durationSeconds: 3718 },
      { speakerLabel: "Studio mic 3", durationSeconds: 3702 },
    ];
  }

  // Discover the speaker tracks a Riverside session contains. Deterministic for a given
  // link. Returns { ok:false, error } for empty, malformed, or non-Riverside URLs (never
  // throws, never mutates the draft) so the setup form can show a clear inline error.
  function discoverRiversideTracks(url) {
    const link = trim(url);
    if (!link) {
      return { ok: false, error: "Paste your Riverside recording link first." };
    }
    if (!isLikelyUrl(link)) {
      return { ok: false, error: "That doesn't look like a full link — paste the Riverside URL starting with http." };
    }
    if (!isRiversideUrl(link)) {
      return { ok: false, error: "That link isn't a Riverside recording — paste a riverside.fm session link." };
    }

    const seed = hashString(link);
    const isDemo = isSandboxDemoRiversideLink(link);
    let raw;
    if (isDemo) {
      raw = sandboxDemoTracks();
    } else {
      const count = 2 + (seed % 2); // 2 or 3 tracks
      const baseDuration = 1800 + (seed % 2400); // 30–70 min base, long-form
      raw = [];
      for (let i = 0; i < count; i += 1) {
        const jitter = (hashString(link + ":" + i) % 120) - 60; // +/- 60s per track
        raw.push({
          speakerLabel: `Studio mic ${i + 1}`,
          durationSeconds: Math.max(60, baseDuration + jitter),
        });
      }
    }

    const tracks = raw.map((track, index) => ({
      id: `track-${index + 1}`,
      trackNumber: index + 1,
      speakerLabel: track.speakerLabel,
      suggestedRole: defaultSpeakerRoleForIndex(index),
      durationSeconds: track.durationSeconds,
      durationLabel: formatTrackDuration(track.durationSeconds),
      syncStatus: "In sync",
    }));

    return {
      ok: true,
      sessionId: seed.toString(16).padStart(8, "0"),
      sessionLabel: isDemo ? "Podcast Canvas demo session" : "Riverside session",
      isDemo: isDemo,
      trackCount: tracks.length,
      tracks: tracks,
    };
  }

  // Map discovered tracks onto speaker buckets in order (Host, Guest 1, Guest 2…),
  // resizing the speaker list to match and recording each track's channel label while
  // keeping any names the creator already entered. Returns the updated draft.
  function applyDiscoveryToBuckets(draft, discovery) {
    const data = draft && typeof draft === "object" ? draft : createDraft();
    if (!discovery || discovery.ok !== true || !Array.isArray(discovery.tracks) || !discovery.tracks.length) {
      return data;
    }
    const existing = Array.isArray(data.speakers) ? data.speakers : [];
    data.sourceMode = "riverside";
    data.speakers = discovery.tracks.map((track, index) => {
      const prior = existing[index] && typeof existing[index] === "object"
        ? existing[index]
        : createSpeaker("Host");
      prior.trackLabel = track.speakerLabel || prior.trackLabel || `Track ${index + 1}`;
      return prior;
    });
    normalizeDefaultSpeakerRoles(data.speakers);
    return data;
  }

  // A creator-facing recap of a successful discovery for the setup summary/banner.
  function summarizeDiscovery(discovery) {
    if (!discovery || discovery.ok !== true) {
      return "";
    }
    const count = discovery.trackCount || (discovery.tracks ? discovery.tracks.length : 0);
    const roles = (discovery.tracks || []).map((track) => track.suggestedRole).filter(Boolean).join(", ");
    return `${count} track${count === 1 ? "" : "s"} discovered · ${roles} · all in sync`;
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
    attachSourceMediaAsset,
    hasSourceMedia,
    summarizeSourceMedia,
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
    isRiversideUrl,
    formatTrackDuration,
    discoverRiversideTracks,
    applyDiscoveryToBuckets,
    summarizeDiscovery,
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
