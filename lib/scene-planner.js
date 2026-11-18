const ALLOWED_DURATIONS = new Set([30, 60, 120, 180, 300]);
const MAX_SCENES = 60;
const TARGET_SCENE_SECONDS = 8;
const WORDS_PER_SCENE = 12;

function inputError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function cleanText(value) {
  return String(value || "").replace(/\r\n?/g, "\n").replace(/\s+/gu, " ").trim();
}

function splitIntoScenes(text, count) {
  const words = text.split(" ");
  const scenes = [];
  let start = 0;

  for (let index = 0; index < count; index += 1) {
    const remainingScenes = count - index - 1;
    const maxEnd = words.length - remainingScenes;
    const idealEnd = Math.max(start + 1, Math.min(maxEnd, Math.round(((index + 1) * words.length) / count)));
    let end = idealEnd;
    let bestDistance = Number.POSITIVE_INFINITY;

    // Prefer a sentence boundary near the balanced word target, without
    // leaving too few words for the remaining scenes.
    for (let candidate = start + 1; candidate <= maxEnd; candidate += 1) {
      if (!/[.!?।॥]$/u.test(words[candidate - 1])) continue;
      const distance = Math.abs(candidate - idealEnd);
      if (distance < bestDistance) {
        bestDistance = distance;
        end = candidate;
      }
    }

    scenes.push(words.slice(start, end).join(" "));
    start = end;
  }

  return scenes;
}

function shotDirection(index, total) {
  if (total === 1) return "Establish the subject clearly, then hold on the key action in one continuous moving shot.";
  if (index === 0) return "Open with a clear establishing shot that introduces the place, atmosphere and main subject.";
  if (index === total - 1) return "Close on the key visual result of this beat; leave a deliberate final hold.";
  return "Show the action and the character's reaction in one continuous camera move.";
}

export function createScenePlan(input = {}) {
  const mode = ["prompt", "story", "photo-story"].includes(input.mode) ? input.mode : "prompt";
  const prompt = cleanText(input.prompt);
  const story = cleanText(input.story);
  const sourceText = mode === "prompt" ? prompt : story;
  const title = cleanText(input.title).slice(0, 80) || "Untitled animation";
  const style = input.style === "2D Animation" ? "2D Animation" : "3D Realistic";
  const aspectRatio = input.aspectRatio === "16:9" ? "16:9" : "9:16";
  const durationSeconds = Number(input.durationSeconds || 30);

  if (mode === "prompt" && !prompt) throw inputError("Enter a video prompt before previewing scenes.");
  if ((mode === "story" || mode === "photo-story") && !story) {
    throw inputError("Enter the story before previewing scenes.");
  }
  if (prompt.length > 6000 || story.length > 12000) {
    throw inputError("Prompt or story is longer than the allowed limit.");
  }
  if (!ALLOWED_DURATIONS.has(durationSeconds)) {
    throw inputError("Choose 30, 60, 120, 180 or 300 seconds.");
  }

  const words = sourceText.split(" ").filter(Boolean);
  const durationSceneLimit = Math.min(MAX_SCENES, Math.ceil(durationSeconds / TARGET_SCENE_SECONDS));
  const contentSceneLimit = Math.max(1, Math.ceil(words.length / WORDS_PER_SCENE));
  const sceneCount = Math.max(1, Math.min(durationSceneLimit, contentSceneLimit));
  const sceneTexts = splitIntoScenes(sourceText, sceneCount);
  const plannedDurationSeconds = Math.min(durationSeconds, sceneCount * TARGET_SCENE_SECONDS);
  const secondsPerScene = plannedDurationSeconds / sceneCount;
  let allocatedSeconds = 0;

  const voiceDirection = cleanText(input.voiceDirection).slice(0, 120) || "Deep, warm Hindi storyteller";
  const music = cleanText(input.music).slice(0, 120) || "Cinematic background score";
  const lipSync = input.lipSync !== false;
  const characterContinuity = input.characterContinuity !== false;

  const scenes = sceneTexts.map((sceneText, index) => {
    const sceneDuration = index === sceneTexts.length - 1
      ? Number((plannedDurationSeconds - allocatedSeconds).toFixed(2))
      : Number(secondsPerScene.toFixed(2));
    allocatedSeconds = Number((allocatedSeconds + sceneDuration).toFixed(2));
    const direction = shotDirection(index, sceneTexts.length);

    return {
      sceneId: `scene-${String(index + 1).padStart(2, "0")}`,
      order: index + 1,
      durationSeconds: sceneDuration,
      sourceText: sceneText,
      narrationText: mode === "prompt" ? null : sceneText,
      visualPrompt: `Create one continuous motion-video shot in ${style} style and ${aspectRatio} format. Story beat: ${sceneText}. ${direction} Do not replace motion with still-image slides.`,
      shotDirection: direction,
      voiceDirection,
      music,
      lipSyncRequested: lipSync,
      characterContinuityRequested: characterContinuity,
      continuityNotes: characterContinuity
        ? "Keep recurring faces, age, hair, clothing, proportions and key props consistent across scenes. Preserve the location, lighting and time of day unless the story explicitly changes them."
        : "Character continuity is disabled for this project."
    };
  });

  const remainingDurationSeconds = Math.max(0, Number((durationSeconds - plannedDurationSeconds).toFixed(2)));
  const warnings = [];
  if (remainingDurationSeconds > 0) {
    warnings.push(
      `The supplied text supports about ${plannedDurationSeconds} seconds at the current scene density, not the selected ${durationSeconds} seconds. Expand the story with more real actions and dialogue; this planner will not invent filler scenes.`
    );
  }
  if (mode === "prompt") {
    warnings.push("A prompt is treated as a visual brief, not a narration script. Hindi narration text is not inferred from it.");
  }
  if (mode === "photo-story") {
    warnings.push("The reference photo remains a local browser preview in this version. It was not uploaded or included in this scene plan.");
  }
  if (lipSync) {
    warnings.push("Lip-sync is recorded as a downstream requirement only. This preview does not generate Hindi audio, dialogue timing or mouth animation.");
  }

  return {
    schemaVersion: 1,
    title,
    mode,
    style,
    aspectRatio,
    targetDurationSeconds: durationSeconds,
    plannedDurationSeconds,
    remainingDurationSeconds,
    targetSceneSeconds: TARGET_SCENE_SECONDS,
    sceneCount: scenes.length,
    requiresStoryExpansion: remainingDurationSeconds > 0,
    renderReady: false,
    generationQuotaCharged: false,
    referenceImageIncluded: false,
    voiceDirection,
    music,
    lipSyncRequested: lipSync,
    characterContinuityRequested: characterContinuity,
    warnings,
    scenes
  };
}
