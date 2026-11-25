import test from "node:test";
import assert from "node:assert/strict";
import { parseDraftImport, mergeImportedDrafts } from "../public/draft-import.js";

const validPrompt = {
  name: "River story",
  mode: "prompt",
  style: "2D Animation",
  format: "16:9",
  durationSeconds: 60,
  prompt: "A quiet river scene",
  story: "",
  voice: "Natural conversational Hindi",
  music: "Emotional orchestral",
  lipSync: true,
  characterContinuity: true,
  updatedAt: "2026-11-22T09:00:00.000Z"
};

function mergeForTest(existing, imported) { return mergeImportedDrafts(existing, imported); }

function parse(text, options = {}) {
  let counter = 0;
  return parseDraftImport(text, {
    idFactory: () => `import-test-${++counter}`,
    now: () => new Date("2026-11-23T00:00:00.000Z"),
    ...options
  });
}

test("imports one project and assigns a fresh ID", () => {
  const result = parse(JSON.stringify(validPrompt));
  assert.equal(result.drafts.length, 1);
  assert.equal(result.drafts[0].id, "import-test-1");
  assert.equal(result.drafts[0].name, "River story");
  assert.equal(result.drafts[0].style, "2D Animation");
});

test("imports exported arrays and reports photo projects that need reselect", () => {
  const photo = { ...validPrompt, mode: "photo-story", story: "A short story", referencePhotoName: "hero.png" };
  const result = parse(JSON.stringify([validPrompt, photo]));
  assert.equal(result.drafts.length, 2);
  assert.equal(result.photoReferenceCount, 1);
  assert.equal(result.drafts[1].referencePhotoName, "hero.png");
});

test("imports character descriptions while excluding image bytes", () => {
  const project = { ...validPrompt, characters: [{ id: "char-dadaji", name: "Dadaji", role: "Main", visualDescription: "White kurta and grey moustache", photoName: "dadaji.png", photoData: "private-image-bytes" }] };
  const result = parse(JSON.stringify(project));
  assert.equal(result.drafts[0].characters.length, 1);
  assert.equal(result.drafts[0].characters[0].name, "Dadaji");
  assert.equal(result.characterPhotoCount, 1);
  assert.equal("photoData" in result.drafts[0].characters[0], false);
});

test("rejects more than eight imported characters", () => {
  const characters = Array.from({ length: 9 }, (_, index) => ({ id: "char-" + index, name: "Character " + index }));
  assert.throws(() => parse(JSON.stringify({ ...validPrompt, characters })), /at most 8 characters/);
});

test("accepts drafts wrapper", () => {
  const result = parse(JSON.stringify({ drafts: [validPrompt] }));
  assert.equal(result.drafts.length, 1);
});

test("rejects malformed JSON", () => {
  assert.throws(() => parse("{bad json"), /valid JSON/);
});

test("rejects files above 1 MB", () => {
  assert.throws(() => parse(" ".repeat(1024 * 1024 + 1)), /1 MB/);
});

test("rejects more than 20 projects", () => {
  assert.throws(() => parse(JSON.stringify(Array(21).fill(validPrompt))), /up to 20/);
});

test("rejects empty prompt/story and invalid duration", () => {
  assert.throws(() => parse(JSON.stringify({ ...validPrompt, prompt: "" })), /missing its prompt/);
  assert.throws(() => parse(JSON.stringify({ ...validPrompt, mode: "story", story: "" })), /missing its story/);
  assert.throws(() => parse(JSON.stringify({ ...validPrompt, durationSeconds: 42 })), /unsupported duration/);
});

test("normalizes optional settings and ignores embedded photo data", () => {
  const result = parse(JSON.stringify({ ...validPrompt, style: "unexpected", format: "square", lipSync: false, photoData: "data:image/png;base64,secret" }));
  assert.equal(result.drafts[0].style, "3D Realistic");
  assert.equal(result.drafts[0].format, "9:16");
  assert.equal(result.drafts[0].lipSync, false);
  assert.equal("photoData" in result.drafts[0], false);
});

test("merge appends imported projects without replacing saved drafts", () => {
  const existing = Array.from({ length: 19 }, (_, i) => ({ id: `saved-${i}` }));
  const imported = [{ id: "new-a" }, { id: "new-b" }, { id: "new-c" }];
  const merged = (mergeForTest(existing, imported));
  assert.equal(merged.drafts.length, 20);
  assert.equal(merged.drafts[0].id, "saved-0");
  assert.equal(merged.drafts[19].id, "new-a");
  assert.equal(merged.importedCount, 1);
  assert.equal(merged.skippedCount, 2);
});

test("keeps all saved drafts when the local list is already full", () => {
  const existing = Array.from({ length: 20 }, (_, i) => ({ id: `saved-${i}` }));
  const merged = mergeForTest(existing, [{ id: "new" }]);
  assert.equal(merged.drafts.length, 20);
  assert.equal(merged.drafts[19].id, "saved-19");
  assert.equal(merged.importedCount, 0);
  assert.equal(merged.skippedCount, 1);
});
