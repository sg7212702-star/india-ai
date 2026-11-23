const ALLOWED_MODES = new Set(["prompt", "story", "photo-story"]);
const ALLOWED_DURATIONS = new Set([30, 60, 120, 180, 300]);
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_DRAFTS = 20;

function importError(message) {
  const error = new Error(message);
  error.code = "INVALID_DRAFT_IMPORT";
  return error;
}

function cleanString(value, maxLength, fallback = "") {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : fallback;
}

function normalizeDraft(source, { idFactory, now }) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw importError("Each imported project must be a JSON object.");
  }
  const mode = source.mode;
  if (!ALLOWED_MODES.has(mode)) throw importError("A project has an unsupported input mode.");
  const prompt = cleanString(source.prompt, 2000);
  const story = cleanString(source.story, 12000);
  if (mode === "prompt" && !prompt) throw importError("A prompt project is missing its prompt text.");
  if ((mode === "story" || mode === "photo-story") && !story) {
    throw importError("A story project is missing its story text.");
  }
  const durationSeconds = Number(source.durationSeconds);
  if (!ALLOWED_DURATIONS.has(durationSeconds)) {
    throw importError("A project contains an unsupported duration. Allowed: 30, 60, 120, 180 or 300 seconds.");
  }
  const rawDate = typeof source.updatedAt === "string" ? Date.parse(source.updatedAt) : NaN;
  const referencePhotoName = cleanString(source.referencePhotoName, 180)
    .split(/[\\/]/u).pop().replace(/[\\/:*?"<>|]/gu, "_");
  return {
    id: idFactory(),
    name: cleanString(source.name, 80, "Untitled animation project") || "Untitled animation project",
    mode,
    style: source.style === "2D Animation" ? "2D Animation" : "3D Realistic",
    format: source.format === "16:9" ? "16:9" : "9:16",
    durationSeconds,
    prompt,
    story,
    referencePhotoName,
    voice: cleanString(source.voice, 120, "Deep, warm Hindi storyteller") || "Deep, warm Hindi storyteller",
    music: cleanString(source.music, 120, "Cinematic background score") || "Cinematic background score",
    lipSync: source.lipSync !== false,
    characterContinuity: source.characterContinuity !== false,
    updatedAt: Number.isFinite(rawDate) ? new Date(rawDate).toISOString() : now().toISOString()
  };
}

export function parseDraftImport(text, {
  idFactory = () => { const uuid = globalThis.crypto?.randomUUID?.(); return uuid ? "import-" + uuid : "import-" + Date.now() + "-" + Math.random().toString(36).slice(2); },
  now = () => new Date(),
  maxBytes = MAX_FILE_BYTES,
  maxDrafts = MAX_DRAFTS
} = {}) {
  if (typeof text !== "string") throw importError("The selected file must be text JSON.");
  if (new TextEncoder().encode(text).byteLength > maxBytes) {
    throw importError("Import file is too large. Maximum size is 1 MB.");
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw importError("The selected file is not valid JSON.");
  }
  const drafts = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.drafts) ? parsed.drafts : [parsed]);
  if (!drafts.length) throw importError("The import file contains no projects.");
  if (drafts.length > maxDrafts) throw importError(`Import up to ${maxDrafts} projects at a time.`);
  const normalized = drafts.map((draft) => normalizeDraft(draft, { idFactory, now }));
  return {
    drafts: normalized,
    photoReferenceCount: normalized.filter((draft) => draft.mode === "photo-story").length
  };
}
