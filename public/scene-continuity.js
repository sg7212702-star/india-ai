const MAX_SCENES = 60;
const MAX_DIALOGUE_LINES_PER_SCENE = 8;
const MAX_DIALOGUE_LENGTH = 500;
const SCENE_ID_PATTERN = /^scene-(?:0[1-9]|[1-5]\d|60)$/u;
const LINE_ID_PATTERN = /^[A-Za-z0-9_-]{1,80}$/u;

export const CAMERA_PRESETS = Object.freeze([
  { angle: "wide establishing", movement: "slow dolly-in", framing: "full environment and subject" },
  { angle: "eye-level medium", movement: "lateral tracking", framing: "character action and surroundings" },
  { angle: "close-up", movement: "gentle push-in", framing: "face or important story detail" },
  { angle: "over-the-shoulder", movement: "subtle rack-focus move", framing: "foreground shoulder and subject" },
  { angle: "low-angle", movement: "controlled upward tilt", framing: "heroic or threatening perspective" },
  { angle: "high-angle", movement: "slow crane drift", framing: "scene geography and character position" },
  { angle: "side-profile tracking", movement: "parallel follow", framing: "character moving through the setting" },
  { angle: "three-quarter medium", movement: "small controlled orbit", framing: "character and relevant background" }
]);

function cleanDialogueText(value) {
  return typeof value === "string"
    ? value.replace(/\r\n?/gu, "\n").replace(/\s+/gu, " ").trim().slice(0, MAX_DIALOGUE_LENGTH)
    : "";
}

export function normalizeSceneDialogue(value, sceneCharacterAssignments = {}) {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Scene dialogue must be an object keyed by scene ID.");
  }
  if (typeof sceneCharacterAssignments !== "object" || sceneCharacterAssignments === null || Array.isArray(sceneCharacterAssignments)) {
    throw new Error("Scene character assignments must be an object.");
  }

  const entries = Object.entries(value);
  if (entries.length > MAX_SCENES) {
    throw new Error("Scene dialogue can contain at most " + MAX_SCENES + " scenes.");
  }

  const normalized = {};
  for (const [sceneId, requestedLines] of entries) {
    if (!SCENE_ID_PATTERN.test(sceneId) || !Array.isArray(requestedLines)) continue;
    if (requestedLines.length > MAX_DIALOGUE_LINES_PER_SCENE) {
      throw new Error("A scene can contain at most " + MAX_DIALOGUE_LINES_PER_SCENE + " dialogue lines.");
    }
    const allowedSpeakers = new Set(
      Array.isArray(sceneCharacterAssignments[sceneId])
        ? sceneCharacterAssignments[sceneId].filter((id) => typeof id === "string")
        : []
    );
    const usedIds = new Set();
    const lines = [];

    for (let index = 0; index < requestedLines.length; index += 1) {
      const source = requestedLines[index];
      if (!source || typeof source !== "object" || Array.isArray(source)) continue;
      const text = cleanDialogueText(source.text);
      const speakerCharacterId = source.speakerCharacterId;
      if (!text || !allowedSpeakers.has(speakerCharacterId)) continue;

      let id = typeof source.id === "string" && LINE_ID_PATTERN.test(source.id)
        ? source.id
        : sceneId + "-line-" + String(index + 1).padStart(2, "0");
      if (usedIds.has(id)) id = sceneId + "-line-" + String(index + 1).padStart(2, "0");
      if (usedIds.has(id)) continue;
      usedIds.add(id);
      lines.push({ id, speakerCharacterId, text });
    }

    if (lines.length) normalized[sceneId] = lines;
  }
  return normalized;
}

export function applySceneContinuity(plan, {
  dialogueByScene,
  characterContinuity = plan?.characterContinuityRequested !== false
} = {}) {
  if (!plan || typeof plan !== "object" || !Array.isArray(plan.scenes)) {
    throw new Error("A valid scene plan is required for continuity planning.");
  }
  if (plan.scenes.length > MAX_SCENES) {
    throw new Error("A scene plan can contain at most " + MAX_SCENES + " scenes.");
  }

  const assignments = plan.sceneCharacterAssignments || Object.fromEntries(
    plan.scenes.map((scene) => [scene.sceneId, Array.isArray(scene.characterIds) ? scene.characterIds : []])
  );
  const normalizedDialogue = normalizeSceneDialogue(
    dialogueByScene ?? plan.sceneDialogue ?? {},
    assignments
  );
  const warnings = Array.isArray(plan.warnings) ? [...plan.warnings] : [];
  const hasLinkedScenes = plan.scenes.length > 1;
  const hasDialogue = Object.keys(normalizedDialogue).length > 0;

  const scenes = plan.scenes.map((scene, index) => {
    const previousScene = index > 0 ? plan.scenes[index - 1] : null;
    const refs = Array.isArray(scene.characterRefs) ? scene.characterRefs : [];
    const assignedIds = Array.isArray(scene.characterIds) ? scene.characterIds : [];
    const nameById = new Map(refs.map((ref) => [ref.characterId, ref.name]));
    const characterLocks = characterContinuity
      ? refs.map((ref) => ({
          characterId: ref.characterId,
          name: ref.name,
          role: ref.role,
          appearanceDescription: ref.visualDescription,
          referencePhotoDeclared: ref.referencePhotoDeclared === true,
          referencePhotoIncluded: false
        }))
      : [];
    const dialogue = (normalizedDialogue[scene.sceneId] || []).map((line) => ({
      ...line,
      speakerName: nameById.get(line.speakerCharacterId) || "Assigned character",
      language: "hi-IN",
      lipSyncRequested: scene.lipSyncRequested === true,
      audioGenerationReady: false
    }));

    return {
      ...scene,
      cameraPlan: {
        ...CAMERA_PRESETS[index % CAMERA_PRESETS.length],
        presetIndex: index % CAMERA_PRESETS.length,
        changesFromPreviousScene: index > 0
      },
      characterLocks,
      dialogue,
      continuity: {
        previousSceneId: previousScene?.sceneId || null,
        usePreviousSceneEndFrameAsOpeningReference: Boolean(previousScene),
        openingFramePolicy: previousScene
          ? "use_previous_scene_final_frame_as_exact_first_frame"
          : "use_project_opening_reference_if_available",
        previousSceneEndFrame: {
          source: "previous_scene_final_frame",
          status: previousScene ? "pending_generation" : "not_applicable",
          available: false,
          requiredBeforeRender: Boolean(previousScene)
        },
        preserveCharacterIdentity: Boolean(characterContinuity),
        preserveCharacterIds: characterContinuity ? [...assignedIds] : [],
        allowCameraAngleChange: true,
        locationPolicy: "follow_the_current_scene_description; carry_location_only_when_the_story_keeps_the_same_place"
      }
    };
  });

  if (hasLinkedScenes) {
    warnings.push("Scene continuity is a render contract only: each next clip must use the previous clip's final frame as its exact first-frame reference. No generated frame exists in this preview.");
  }
  warnings.push("Camera angles are deterministic shot suggestions. A future renderer must still interpret the scene action; no motion video has been rendered.");
  if (hasDialogue) {
    warnings.push("Hindi character dialogue is saved as speaker metadata only. No Hindi audio, timing, voice synthesis or lip-sync has been generated.");
  }

  return {
    ...plan,
    schemaVersion: Math.max(2, Number(plan.schemaVersion) || 1),
    continuityContractVersion: 1,
    sceneDialogue: normalizedDialogue,
    scenes,
    continuityReady: false,
    dialogueAudioReady: false,
    renderReady: false,
    referenceImageIncluded: false,
    generationQuotaCharged: false,
    warnings: [...new Set(warnings)]
  };
}
