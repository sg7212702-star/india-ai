import { normalizeCharacterList } from "./character-library.js";

const MAX_SCENES = 60;
const MAX_CHARACTERS_PER_SCENE = 8;
const SCENE_ID_PATTERN = /^scene-\d{2}$/u;

export function normalizeSceneCharacterAssignments(value, characters = []) {
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Scene character assignments must be an object keyed by scene ID.");
  }

  const entries = Object.entries(value);
  if (entries.length > MAX_SCENES) {
    throw new Error(`A project can contain assignments for at most ${MAX_SCENES} scenes.`);
  }

  const knownCharacterIds = new Set(normalizeCharacterList(characters).map((character) => character.id));
  const normalized = {};

  for (const [sceneId, requestedIds] of entries) {
    // Ignore stale or malformed scene keys when a story has been replanned.
    if (!SCENE_ID_PATTERN.test(sceneId) || !Array.isArray(requestedIds)) continue;
    const selected = [];
    for (const characterId of requestedIds) {
      if (typeof characterId !== "string" || !knownCharacterIds.has(characterId) || selected.includes(characterId)) continue;
      selected.push(characterId);
      if (selected.length >= MAX_CHARACTERS_PER_SCENE) break;
    }
    if (selected.length) normalized[sceneId] = selected;
  }

  return normalized;
}

export function applySceneCharacterAssignments(plan, characters = [], assignments = {}) {
  if (!plan || typeof plan !== "object" || !Array.isArray(plan.scenes)) {
    throw new Error("A valid scene plan is required.");
  }

  const normalizedCharacters = normalizeCharacterList(characters);
  const characterById = new Map(normalizedCharacters.map((character) => [character.id, character]));
  const requested = normalizeSceneCharacterAssignments(assignments, normalizedCharacters);
  const validSceneIds = new Set(plan.scenes.map((scene) => scene.sceneId).filter((id) => SCENE_ID_PATTERN.test(id)));
  const sceneCharacterAssignments = Object.fromEntries(
    Object.entries(requested).filter(([sceneId]) => validSceneIds.has(sceneId))
  );

  const scenes = plan.scenes.map((scene) => {
    const characterIds = sceneCharacterAssignments[scene.sceneId] || [];
    const characterRefs = characterIds.map((characterId) => {
      const character = characterById.get(characterId);
      return {
        characterId: character.id,
        name: character.name,
        role: character.role,
        visualDescription: character.visualDescription,
        referencePhotoDeclared: Boolean(character.photoName),
        referencePhotoIncluded: false
      };
    });
    return { ...scene, characterIds: [...characterIds], characterRefs };
  });

  const photoWarning = "Scene character assignments are planning metadata only. Reference photo files stay in this browser and are not uploaded or sent to a video model.";
  const warnings = (Array.isArray(plan.warnings) ? plan.warnings : []).filter((warning) => warning !== photoWarning);
  if (scenes.some((scene) => scene.characterRefs.length)) warnings.push(photoWarning);

  return {
    ...plan,
    scenes,
    sceneCharacterAssignments,
    referenceImageIncluded: false,
    renderReady: false,
    warnings
  };
}
