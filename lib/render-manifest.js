const MAX_SCENES = 60;
const MAX_CHARACTERS = 8;
const MAX_DIALOGUE_LINES_PER_SCENE = 8;
const MAX_DIALOGUE_LENGTH = 500;
const MAX_MANIFEST_BYTES = 750_000;
const ALLOWED_DURATIONS = new Set([30, 60, 120, 180, 300]);
const SCENE_ID_PATTERN = /^scene-(?:0[1-9]|[1-5]\\d|60)$/u;
const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]{1,120}$/u;

const CAMERA_PRESETS = Object.freeze([
  { angle: "wide establishing", movement: "slow dolly-in", framing: "full environment and subject" },
  { angle: "eye-level medium", movement: "lateral tracking", framing: "character action and surroundings" },
  { angle: "close-up", movement: "gentle push-in", framing: "face or important story detail" },
  { angle: "over-the-shoulder", movement: "subtle rack-focus move", framing: "foreground shoulder and subject" },
  { angle: "low-angle", movement: "controlled upward tilt", framing: "heroic or threatening perspective" },
  { angle: "high-angle", movement: "slow crane drift", framing: "scene geography and character position" },
  { angle: "side-profile tracking", movement: "parallel follow", framing: "character moving through the setting" },
  { angle: "three-quarter medium", movement: "small controlled orbit", framing: "character and relevant background" }
]);

function manifestError(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function cleanText(value, maxLength, fallback = "") {
  return typeof value === "string"
    ? value.replace(/\\r\\n?/gu, "\\n").replace(/\\s+/gu, " ").trim().slice(0, maxLength)
    : fallback;
}

function normalizeCharacters(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw manifestError("INVALID_RENDER_MANIFEST", "Project characters must be a list.");
  }
  if (value.length > MAX_CHARACTERS) {
    throw manifestError("INVALID_RENDER_MANIFEST", `A render manifest can contain at most ${MAX_CHARACTERS} characters.`);
  }

  const ids = new Set();
  return value.map((source) => {
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      throw manifestError("INVALID_RENDER_MANIFEST", "Each character must be an object.");
    }
    const characterId = source.id;
    const name = cleanText(source.name, 60);
    if (typeof characterId !== "string" || !SAFE_ID_PATTERN.test(characterId) || !name) {
      throw manifestError("INVALID_RENDER_MANIFEST", "Each character needs a safe ID and a name.");
    }
    if (ids.has(characterId)) {
      throw manifestError("INVALID_RENDER_MANIFEST", "Character IDs must be unique.");
    }
    ids.add(characterId);

    const referencePhotoDeclared = Boolean(
      (typeof source.photoName === "string" && source.photoName.trim())
      || source.referencePhotoDeclared === true
    );
    return {
      characterId,
      name,
      role: cleanText(source.role, 60, "Character") || "Character",
      appearanceDescription: cleanText(source.visualDescription ?? source.appearanceDescription, 1_000),
      referencePhotoDeclared,
      referencePhotoIncluded: false,
      referencePhotoStatus: referencePhotoDeclared ? "local_only_not_transferred" : "not_provided"
    };
  });
}

function normalizeAssignments(value, characters, scenes) {
  if (value == null) value = {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw manifestError("INVALID_RENDER_MANIFEST", "Scene character assignments must be an object.");
  }
  const entries = Object.entries(value);
  if (entries.length > MAX_SCENES) {
    throw manifestError("INVALID_RENDER_MANIFEST", `Assignments can cover at most ${MAX_SCENES} scenes.`);
  }

  const sceneIds = new Set(scenes.map((scene) => scene.sceneId));
  const characterIds = new Set(characters.map((character) => character.characterId));
  const result = {};

  for (const [sceneId, requestedIds] of entries) {
    if (!SCENE_ID_PATTERN.test(sceneId) || !sceneIds.has(sceneId)) {
      throw manifestError("INVALID_RENDER_MANIFEST", "A character assignment refers to an unknown scene.");
    }
    if (!Array.isArray(requestedIds) || requestedIds.length > MAX_CHARACTERS) {
      throw manifestError("INVALID_RENDER_MANIFEST", "Each scene can assign up to eight characters.");
    }
    const selected = [];
    for (const id of requestedIds) {
      if (typeof id !== "string" || !characterIds.has(id)) {
        throw manifestError("INVALID_RENDER_MANIFEST", "A scene assignment refers to an unknown character.");
      }
      if (!selected.includes(id)) selected.push(id);
    }
    if (selected.length) result[sceneId] = selected;
  }
  return result;
}

function normalizeDialogue(value, assignments, characterById, scenes, lipSyncRequested) {
  if (value == null) value = {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw manifestError("INVALID_RENDER_MANIFEST", "Scene dialogue must be an object keyed by scene ID.");
  }
  const entries = Object.entries(value);
  if (entries.length > MAX_SCENES) {
    throw manifestError("INVALID_RENDER_MANIFEST", `Dialogue can cover at most ${MAX_SCENES} scenes.`);
  }
  const sceneIds = new Set(scenes.map((scene) => scene.sceneId));
  const result = {};

  for (const [sceneId, requestedLines] of entries) {
    if (!SCENE_ID_PATTERN.test(sceneId) || !sceneIds.has(sceneId)) {
      throw manifestError("INVALID_RENDER_MANIFEST", "Dialogue refers to an unknown scene.");
    }
    if (!Array.isArray(requestedLines) || requestedLines.length > MAX_DIALOGUE_LINES_PER_SCENE) {
      throw manifestError("INVALID_RENDER_MANIFEST", "Each scene can contain at most eight dialogue lines.");
    }
    const assigned = new Set(assignments[sceneId] || []);
    const usedIds = new Set();
    const lines = [];

    requestedLines.forEach((line, index) => {
      if (!line || typeof line !== "object" || Array.isArray(line)) {
        throw manifestError("INVALID_RENDER_MANIFEST", "Each dialogue line must be an object.");
      }
      const speakerCharacterId = line.speakerCharacterId;
      const speaker = characterById.get(speakerCharacterId);
      const text = cleanText(line.text, MAX_DIALOGUE_LENGTH);
      if (!speaker || !assigned.has(speakerCharacterId) || !text) {
        throw manifestError("INVALID_RENDER_MANIFEST", "Every dialogue speaker must be assigned to the same scene and have non-empty text.");
      }
      const candidateId = typeof line.id === "string" && SAFE_ID_PATTERN.test(line.id)
        ? line.id
        : sceneId + "-line-" + String(index + 1).padStart(2, "0");
      const id = usedIds.has(candidateId)
        ? sceneId + "-line-" + String(index + 1).padStart(2, "0")
        : candidateId;
      if (usedIds.has(id)) {
        throw manifestError("INVALID_RENDER_MANIFEST", "Dialogue line IDs must be unique within a scene.");
      }
      usedIds.add(id);
      lines.push({
        lineId: id,
        speakerCharacterId,
        speakerName: speaker.name,
        text,
        language: "hi-IN",
        voiceStatus: "pending_generation",
        lipSyncRequested: lipSyncRequested === true,
        lipSyncStatus: lipSyncRequested === true ? "pending_generation" : "not_requested"
      });
    });

    if (lines.length) result[sceneId] = lines;
  }
  return result;
}

function normalizeCapabilities(value = {}) {
  const keys = ["motionVideo", "hindiTts", "lipSync", "backgroundMusic", "characterConsistency", "privateStorage", "ffmpeg"];
  return Object.fromEntries(keys.map((key) => [key, value?.[key] === true]));
}

function hasForbiddenAssetFields(value, path = "manifest") {
  if (!value || typeof value !== "object") return null;
  for (const [key, child] of Object.entries(value)) {
    if (["photoName", "storagePath", "publicUrl", "downloadUrl", "imageData", "base64", "dataUrl"].includes(key)) {
      return path + "." + key;
    }
    const found = hasForbiddenAssetFields(child, path + "." + key);
    if (found) return found;
  }
  return null;
}

export function createRenderManifest({
  request = {},
  scenePlan,
  characters: requestedCharacters = [],
  sceneCharacterAssignments = {},
  sceneDialogue = {},
  capabilities: requestedCapabilities = {},
  now = () => new Date()
} = {}) {
  if (!scenePlan || typeof scenePlan !== "object" || !Array.isArray(scenePlan.scenes)) {
    throw manifestError("INVALID_RENDER_MANIFEST", "A server-generated scene plan is required.");
  }
  if (scenePlan.scenes.length < 1 || scenePlan.scenes.length > MAX_SCENES) {
    throw manifestError("INVALID_RENDER_MANIFEST", "The scene plan must contain between one and 60 scenes.");
  }

  const title = cleanText(request.title ?? scenePlan.title, 80, "Untitled animation") || "Untitled animation";
  const mode = ["prompt", "story", "photo-story"].includes(request.mode ?? scenePlan.mode)
    ? (request.mode ?? scenePlan.mode)
    : "prompt";
  const style = (request.style ?? scenePlan.style) === "2D Animation" ? "2D Animation" : "3D Realistic";
  const aspectRatio = (request.aspectRatio ?? scenePlan.aspectRatio) === "16:9" ? "16:9" : "9:16";
  const targetDurationSeconds = Number(request.durationSeconds ?? scenePlan.targetDurationSeconds);
  const plannedDurationSeconds = Number(scenePlan.plannedDurationSeconds);
  if (!ALLOWED_DURATIONS.has(targetDurationSeconds)
    || !Number.isFinite(plannedDurationSeconds)
    || plannedDurationSeconds <= 0
    || plannedDurationSeconds > targetDurationSeconds + 0.01) {
    throw manifestError("INVALID_RENDER_MANIFEST", "The requested duration or planned scene duration is invalid.");
  }

  const scenes = scenePlan.scenes;
  const expectedDuration = scenes.reduce((total, scene) => total + Number(scene.durationSeconds || 0), 0);
  if (Math.abs(expectedDuration - plannedDurationSeconds) > 0.15) {
    throw manifestError("INVALID_RENDER_MANIFEST", "Scene durations do not match the planner's total duration.");
  }
  for (let index = 0; index < scenes.length; index += 1) {
    const scene = scenes[index];
    const expectedId = "scene-" + String(index + 1).padStart(2, "0");
    if (scene.sceneId !== expectedId || !Number.isFinite(Number(scene.durationSeconds)) || Number(scene.durationSeconds) <= 0) {
      throw manifestError("INVALID_RENDER_MANIFEST", "Scenes must have sequential IDs and positive durations.");
    }
  }

  const normalizedCharacters = normalizeCharacters(requestedCharacters);
  const characterById = new Map(normalizedCharacters.map((character) => [character.characterId, character]));
  const assignments = normalizeAssignments(sceneCharacterAssignments, normalizedCharacters, scenes);
  const lipSyncRequested = request.lipSync !== false && scenePlan.lipSyncRequested !== false;
  const dialogue = normalizeDialogue(sceneDialogue, assignments, characterById, scenes, lipSyncRequested);
  const capabilities = normalizeCapabilities(requestedCapabilities);
  const missingCharacterReferenceIds = normalizedCharacters
    .filter((character) => character.referencePhotoDeclared)
    .map((character) => character.characterId);
  const assignedCharacterCount = new Set(Object.values(assignments).flat()).size;
  const hasSpokenContent = scenes.some((scene) => Boolean(scene.narrationText))
    || Object.values(dialogue).some((lines) => lines.length > 0);
  const hasDialogue = Object.values(dialogue).some((lines) => lines.length > 0);
  const needsLipSync = lipSyncRequested && hasDialogue;
  const needsCharacterConsistency = request.characterContinuity !== false
    && scenePlan.characterContinuityRequested !== false
    && assignedCharacterCount > 0;

  const blockers = [];
  if (scenePlan.requiresStoryExpansion === true
    || Number(scenePlan.remainingDurationSeconds || 0) > 0
    || Math.abs(plannedDurationSeconds - targetDurationSeconds) > 0.15) {
    blockers.push({
      code: "STORY_EXPANSION_REQUIRED",
      message: "The supplied text does not yet support the full selected duration."
    });
  }
  if (missingCharacterReferenceIds.length) {
    blockers.push({
      code: "CHARACTER_REFERENCE_TRANSFER_REQUIRED",
      message: "Character photos are still local to the browser and have not been transferred to private server storage."
    });
  }
  if (mode === "photo-story" || request.referencePhotoDeclared === true) {
    blockers.push({
      code: "PROJECT_REFERENCE_TRANSFER_REQUIRED",
      message: "The project reference photo is still local to the browser and has not been transferred to private server storage."
    });
  }
  if (!capabilities.motionVideo) blockers.push({ code: "MOTION_VIDEO_ADAPTER_REQUIRED", message: "A real motion-video model adapter is not configured." });
  if (hasSpokenContent && !capabilities.hindiTts) blockers.push({ code: "HINDI_TTS_REQUIRED", message: "A Hindi speech-generation component is not configured." });
  if (needsLipSync && !capabilities.lipSync) blockers.push({ code: "LIP_SYNC_REQUIRED", message: "A Hindi lip-sync component is not configured." });
  if (request.music !== "" && !capabilities.backgroundMusic) blockers.push({ code: "BACKGROUND_MUSIC_MIXER_REQUIRED", message: "A background-music and audio-mixing component is not configured." });
  if (needsCharacterConsistency && !capabilities.characterConsistency) blockers.push({ code: "CHARACTER_CONSISTENCY_ADAPTER_REQUIRED", message: "A character-consistency capable video adapter is not configured." });
  if (!capabilities.privateStorage) blockers.push({ code: "PRIVATE_STORAGE_REQUIRED", message: "Private output storage is not configured." });
  if (!capabilities.ffmpeg) blockers.push({ code: "FFMPEG_ASSEMBLY_REQUIRED", message: "The multi-scene MP4 assembly stage is not configured." });

  const voiceDirection = cleanText(request.voiceDirection ?? scenePlan.voiceDirection, 120, "Deep, warm Hindi storyteller");
  const music = cleanText(request.music ?? scenePlan.music, 120, "Cinematic background score");
  const normalizedScenes = scenes.map((scene, index) => {
    const previous = index > 0 ? scenes[index - 1] : null;
    const assignedIds = assignments[scene.sceneId] || [];
    const sceneDialogueLines = dialogue[scene.sceneId] || [];
    const characterLocks = assignedIds.map((characterId) => {
      const character = characterById.get(characterId);
      return {
        characterId,
        name: character.name,
        role: character.role,
        appearanceDescription: character.appearanceDescription,
        referencePhotoIncluded: false,
        referencePhotoStatus: character.referencePhotoStatus
      };
    });
    const spokenLines = [
      ...(scene.narrationText ? [{
        kind: "narration",
        text: cleanText(scene.narrationText, 4_000),
        language: "hi-IN",
        voiceDirection,
        status: "pending_generation"
      }] : []),
      ...sceneDialogueLines.map((line) => ({ kind: "character_dialogue", ...line, voiceDirection }))
    ];

    return {
      sceneId: scene.sceneId,
      order: index + 1,
      durationSeconds: Number(Number(scene.durationSeconds).toFixed(2)),
      sourceText: cleanText(scene.sourceText, 4_000),
      visualPrompt: cleanText(scene.visualPrompt, 6_000),
      shotDirection: cleanText(scene.shotDirection, 500),
      cameraPlan: {
        ...CAMERA_PRESETS[index % CAMERA_PRESETS.length],
        presetIndex: index % CAMERA_PRESETS.length,
        changesFromPreviousScene: index > 0
      },
      characterIds: [...assignedIds],
      characterLocks,
      dialogue: sceneDialogueLines,
      audio: {
        language: "hi-IN",
        voiceDirection,
        spokenLines,
        backgroundMusic: {
          direction: music,
          status: "pending_generation"
        },
        lipSyncRequested: needsLipSync && sceneDialogueLines.length > 0,
        ready: false
      },
      continuity: {
        previousSceneId: previous?.sceneId || null,
        requiresPreviousFinalFrame: Boolean(previous),
        openingFramePolicy: previous
          ? "use_previous_scene_final_frame_as_exact_first_frame"
          : "use_project_opening_reference_if_available",
        previousFinalFrame: {
          status: previous ? "pending_generation" : "not_applicable",
          available: false,
          storageReference: null
        },
        preserveCharacterIds: request.characterContinuity === false ? [] : [...assignedIds],
        allowCameraAngleChange: true,
        locationPolicy: "carry_location_only_when_the_story_keeps_the_same_place"
      },
      requiredArtifacts: [
        "motion_video",
        "final_frame",
        ...(spokenLines.length ? ["hindi_audio_track"] : []),
        ...(needsLipSync && sceneDialogueLines.length ? ["lip_sync_track"] : [])
      ],
      renderStatus: "not_started"
    };
  });

  const createdAt = now();
  const manifest = {
    contract: "ai-animation-render-manifest",
    schemaVersion: 1,
    createdAt: createdAt instanceof Date ? createdAt.toISOString() : new Date(createdAt).toISOString(),
    project: {
      title,
      mode,
      style,
      aspectRatio,
      targetDurationSeconds,
      plannedDurationSeconds,
      voiceLanguage: "hi-IN",
      voiceDirection,
      backgroundMusicDirection: music,
      lipSyncRequested,
      characterContinuityRequested: request.characterContinuity !== false && scenePlan.characterContinuityRequested !== false
    },
    characters: normalizedCharacters,
    scenes: normalizedScenes,
    renderSequence: normalizedScenes.map((scene) => ({
      sceneId: scene.sceneId,
      order: scene.order,
      dependsOnSceneIds: scene.continuity.previousSceneId ? [scene.continuity.previousSceneId] : [],
      waitForPreviousFinalFrame: scene.continuity.requiresPreviousFinalFrame,
      requiredArtifacts: [...scene.requiredArtifacts]
    })),
    assembly: {
      format: "mp4",
      aspectRatio,
      targetDurationSeconds,
      plannedDurationSeconds,
      videoCodec: "h264",
      audioCodec: "aac",
      requiredSceneCount: normalizedScenes.length,
      requiresAllSceneClips: true,
      status: "blocked_until_real_scene_clips_exist",
      ready: false
    },
    preflight: {
      storyCoverageComplete: blockers.every((blocker) => blocker.code !== "STORY_EXPANSION_REQUIRED"),
      assignedCharacterCount,
      missingCharacterReferenceIds,
      referenceImagesIncluded: false,
      capabilities,
      blockers,
      readyForRender: blockers.length === 0
    },
    workerHandoff: {
      contractVersion: 1,
      payloadField: "request.renderManifest",
      status: blockers.length ? "blocked" : "ready_for_worker",
      readyForRender: blockers.length === 0,
      requiresRealMotionVideo: true,
      rejectStillImageSubstitution: true,
      sceneExecution: "sequential_final_frame_dependency"
    },
    warnings: [
      "This manifest is a validated render plan, not a rendered video.",
      "No reference-photo bytes, public URLs, or private storage paths are included.",
      "Every scene after the first must wait for the previous scene's real final frame.",
      "The worker must not mark a job complete until a real MP4 has been assembled and verified."
    ]
  };

  const forbiddenField = hasForbiddenAssetFields(manifest);
  if (forbiddenField) {
    throw manifestError("INVALID_RENDER_MANIFEST", "The manifest contains a forbidden asset field: " + forbiddenField);
  }
  const bytes = new TextEncoder().encode(JSON.stringify(manifest)).byteLength;
  if (bytes > MAX_MANIFEST_BYTES) {
    throw manifestError("RENDER_MANIFEST_TOO_LARGE", "The render manifest exceeds the 750 KB safety limit.");
  }
  return manifest;
}

export function assertRenderManifestForWorker(manifest) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw manifestError("RENDER_MANIFEST_MISSING", "The queued job has no render manifest.", 503);
  }
  if (manifest.contract !== "ai-animation-render-manifest" || manifest.schemaVersion !== 1
    || !Array.isArray(manifest.scenes) || manifest.scenes.length < 1 || manifest.scenes.length > MAX_SCENES
    || !Array.isArray(manifest.renderSequence)) {
    throw manifestError("RENDER_MANIFEST_INVALID", "The queued render manifest does not match the worker contract.", 503);
  }
  if (manifest.preflight?.readyForRender !== true
    || manifest.workerHandoff?.readyForRender !== true
    || !Array.isArray(manifest.preflight?.blockers)
    || manifest.preflight.blockers.length > 0) {
    throw manifestError("RENDER_MANIFEST_NOT_READY", "The render manifest still has unmet model, audio, storage, continuity or assembly requirements.", 503);
  }
  if (manifest.assembly?.ready !== false
    || manifest.assembly?.format !== "mp4"
    || manifest.assembly?.requiredSceneCount !== manifest.scenes.length
    || manifest.preflight?.referenceImagesIncluded !== false
    || manifest.workerHandoff?.rejectStillImageSubstitution !== true
    || manifest.workerHandoff?.requiresRealMotionVideo !== true
    || manifest.renderSequence.length !== manifest.scenes.length) {
    throw manifestError("RENDER_MANIFEST_INVALID", "The render manifest assembly or safety contract is invalid.", 503);
  }
  for (let index = 0; index < manifest.scenes.length; index += 1) {
    const scene = manifest.scenes[index];
    const step = manifest.renderSequence[index];
    const expectedSceneId = "scene-" + String(index + 1).padStart(2, "0");
    const expectedPrevious = index > 0 ? manifest.scenes[index - 1].sceneId : null;
    if (scene.sceneId !== expectedSceneId
      || scene.order !== index + 1
      || step.sceneId !== scene.sceneId
      || step.order !== scene.order
      || !Array.isArray(step.dependsOnSceneIds)
      || (expectedPrevious && (step.dependsOnSceneIds.length !== 1 || step.dependsOnSceneIds[0] !== expectedPrevious))
      || (!expectedPrevious && step.dependsOnSceneIds.length !== 0)
      || step.waitForPreviousFinalFrame !== Boolean(expectedPrevious)
      || scene.continuity?.previousSceneId !== expectedPrevious
      || scene.continuity?.requiresPreviousFinalFrame !== Boolean(expectedPrevious)
      || !Array.isArray(scene.requiredArtifacts)
      || !scene.requiredArtifacts.includes("motion_video")
      || !scene.requiredArtifacts.includes("final_frame")) {
      throw manifestError("RENDER_MANIFEST_INVALID", "A scene is missing its ordered render or previous-frame dependency contract.", 503);
    }
  }
  if (manifest.characters?.some((character) => character.referencePhotoIncluded !== false)) {
    throw manifestError("RENDER_MANIFEST_INVALID", "Browser-local reference photos must never be embedded in a worker manifest.", 503);
  }
  const forbiddenField = hasForbiddenAssetFields(manifest);
  if (forbiddenField) {
    throw manifestError("RENDER_MANIFEST_INVALID", "The render manifest contains a forbidden asset field.", 503);
  }
  return manifest;
}
