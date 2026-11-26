import test from "node:test";
import assert from "node:assert/strict";
import { applySceneCharacterAssignments, normalizeSceneCharacterAssignments } from "../public/scene-character-assignment.js";

const characters = [
  { id: "char-dadaji", name: "Dadaji", role: "Main character", visualDescription: "Grey moustache, white kurta", photoName: "dadaji.png" },
  { id: "char-pigeon", name: "White pigeon", role: "Companion", visualDescription: "Pure white feathers", photoName: "" }
];

test("normalizes assignments to unique characters known to the project", () => {
  const result = normalizeSceneCharacterAssignments({
    "scene-01": ["char-dadaji", "char-dadaji", "char-unknown", "char-pigeon"],
    "scene-02": ["char-pigeon"]
  }, characters);
  assert.deepEqual(result, {
    "scene-01": ["char-dadaji", "char-pigeon"],
    "scene-02": ["char-pigeon"]
  });
});

test("drops stale scene keys and ignores malformed per-scene values", () => {
  const result = normalizeSceneCharacterAssignments({
    "scene-01": ["char-dadaji"],
    "scene-99": ["char-pigeon"],
    "not-a-scene": ["char-dadaji"],
    "scene-02": "char-pigeon"
  }, characters);
  assert.deepEqual(result, { "scene-01": ["char-dadaji"] });
});

test("rejects a non-object assignment map and more than sixty scene entries", () => {
  assert.throws(() => normalizeSceneCharacterAssignments(["char-dadaji"], characters), /must be an object/);
  const tooMany = Object.fromEntries(Array.from({ length: 61 }, (_, index) => [
    "scene-" + String(index + 1).padStart(2, "0"),
    []
  ]));
  assert.throws(() => normalizeSceneCharacterAssignments(tooMany, characters), /at most 60 scenes/);
});

test("adds selected character identity metadata to the correct scene only", () => {
  const plan = {
    warnings: [],
    renderReady: true,
    referenceImageIncluded: true,
    scenes: [
      { sceneId: "scene-01", order: 1, sourceText: "Dadaji enters the temple." },
      { sceneId: "scene-02", order: 2, sourceText: "A pigeon lands nearby." }
    ]
  };
  const result = applySceneCharacterAssignments(plan, characters, {
    "scene-01": ["char-dadaji"],
    "scene-02": ["char-pigeon"],
    "scene-03": ["char-dadaji"]
  });

  assert.deepEqual(result.scenes[0].characterIds, ["char-dadaji"]);
  assert.deepEqual(result.scenes[0].characterRefs[0], {
    characterId: "char-dadaji",
    name: "Dadaji",
    role: "Main character",
    visualDescription: "Grey moustache, white kurta",
    referencePhotoDeclared: true,
    referencePhotoIncluded: false
  });
  assert.deepEqual(result.scenes[1].characterIds, ["char-pigeon"]);
  assert.deepEqual(result.sceneCharacterAssignments, {
    "scene-01": ["char-dadaji"],
    "scene-02": ["char-pigeon"]
  });
  assert.equal(result.renderReady, false);
  assert.equal(result.referenceImageIncluded, false);
  assert.equal(result.warnings.length, 1);
  assert.equal("photoName" in result.scenes[0].characterRefs[0], false);
  assert.equal("blob" in result.scenes[0].characterRefs[0], false);
  assert.equal(plan.renderReady, true);
});

test("returns an explicit empty character list for unassigned scenes", () => {
  const result = applySceneCharacterAssignments({
    warnings: [],
    scenes: [{ sceneId: "scene-01", order: 1 }]
  }, characters, {});
  assert.deepEqual(result.scenes[0].characterIds, []);
  assert.deepEqual(result.scenes[0].characterRefs, []);
  assert.deepEqual(result.sceneCharacterAssignments, {});
});

test("rejects a missing or malformed scene plan", () => {
  assert.throws(() => applySceneCharacterAssignments(null, characters, {}), /valid scene plan/);
  assert.throws(() => applySceneCharacterAssignments({ scenes: "not-an-array" }, characters, {}), /valid scene plan/);
});
