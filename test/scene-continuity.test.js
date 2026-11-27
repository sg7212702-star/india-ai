import test from "node:test";
import assert from "node:assert/strict";
import { applySceneContinuity, normalizeSceneDialogue } from "../public/scene-continuity.js";

const assignments = {
  "scene-01": ["char-dadaji"],
  "scene-02": ["char-dadaji", "char-pigeon"],
  "scene-03": ["char-pigeon"]
};

const plan = {
  schemaVersion: 1,
  warnings: [],
  renderReady: true,
  characterContinuityRequested: true,
  scenes: [
    {
      sceneId: "scene-01",
      order: 1,
      sourceText: "Dadaji enters the temple.",
      shotDirection: "Establish the temple.",
      characterIds: ["char-dadaji"],
      characterRefs: [{
        characterId: "char-dadaji",
        name: "Dadaji",
        role: "Main character",
        visualDescription: "Grey moustache, white kurta",
        referencePhotoDeclared: true,
        referencePhotoIncluded: false
      }],
      lipSyncRequested: true
    },
    {
      sceneId: "scene-02",
      order: 2,
      sourceText: "The white pigeon lands beside Dadaji.",
      shotDirection: "Follow the pigeon.",
      characterIds: ["char-dadaji", "char-pigeon"],
      characterRefs: [
        {
          characterId: "char-dadaji",
          name: "Dadaji",
          role: "Main character",
          visualDescription: "Grey moustache, white kurta",
          referencePhotoDeclared: true,
          referencePhotoIncluded: false
        },
        {
          characterId: "char-pigeon",
          name: "White pigeon",
          role: "Companion",
          visualDescription: "Pure white feathers",
          referencePhotoDeclared: false,
          referencePhotoIncluded: false
        }
      ],
      lipSyncRequested: true
    },
    {
      sceneId: "scene-03",
      order: 3,
      sourceText: "The pigeon flies towards the river.",
      shotDirection: "Track the flight.",
      characterIds: ["char-pigeon"],
      characterRefs: [{
        characterId: "char-pigeon",
        name: "White pigeon",
        role: "Companion",
        visualDescription: "Pure white feathers",
        referencePhotoDeclared: false,
        referencePhotoIncluded: false
      }],
      lipSyncRequested: false
    }
  ],
  sceneCharacterAssignments: assignments
};

test("normalizes Hindi dialogue only for characters assigned to that scene", () => {
  const result = normalizeSceneDialogue({
    "scene-01": [
      { id: "line-1", speakerCharacterId: "char-dadaji", text: "  बेटा, मंदिर चलो।  " },
      { id: "line-2", speakerCharacterId: "char-pigeon", text: "यह पात्र इस दृश्य में नहीं है।" },
      { id: "line-3", speakerCharacterId: "char-dadaji", text: "   " }
    ],
    "scene-99": [{ speakerCharacterId: "char-dadaji", text: "पुराना दृश्य" }]
  }, assignments);
  assert.deepEqual(result, {
    "scene-01": [{ id: "line-1", speakerCharacterId: "char-dadaji", text: "बेटा, मंदिर चलो।" }]
  });
});

test("drops malformed lines and trims dialogue to the supported length", () => {
  const longText = "क".repeat(600);
  const result = normalizeSceneDialogue({
    "scene-02": [
      null,
      { speakerCharacterId: "char-dadaji", text: longText },
      { speakerCharacterId: "char-pigeon", text: longText }
    ]
  }, assignments);
  assert.equal(result["scene-02"].length, 2);
  assert.equal(result["scene-02"][0].text.length, 500);
  assert.equal(result["scene-02"][1].text.length, 500);
});

test("rejects non-object dialogue maps and more than sixty scene entries", () => {
  assert.throws(() => normalizeSceneDialogue([], assignments), /must be an object/);
  const tooMany = Object.fromEntries(Array.from({ length: 61 }, (_, index) => [
    "scene-" + String(index + 1).padStart(2, "0"),
    []
  ]));
  assert.throws(() => normalizeSceneDialogue(tooMany, assignments), /at most 60 scenes/);
});

test("caps each scene at eight dialogue lines", () => {
  const lines = Array.from({ length: 9 }, () => ({
    speakerCharacterId: "char-dadaji",
    text: "नमस्ते।"
  }));
  assert.throws(() => normalizeSceneDialogue({ "scene-01": lines }, assignments), /at most 8 dialogue lines/);
});

test("links each later scene to the previous final frame without claiming the frame exists", () => {
  const result = applySceneContinuity(plan);
  assert.equal(result.scenes[0].continuity.previousSceneId, null);
  assert.equal(result.scenes[0].continuity.usePreviousSceneEndFrameAsOpeningReference, false);
  assert.equal(result.scenes[1].continuity.previousSceneId, "scene-01");
  assert.equal(result.scenes[1].continuity.openingFramePolicy, "use_previous_scene_final_frame_as_exact_first_frame");
  assert.equal(result.scenes[1].continuity.previousSceneEndFrame.available, false);
  assert.equal(result.scenes[1].continuity.previousSceneEndFrame.requiredBeforeRender, true);
  assert.equal(result.continuityReady, false);
  assert.equal(result.renderReady, false);
});

test("suggests different camera angles and movements for adjacent scenes", () => {
  const result = applySceneContinuity(plan);
  assert.notEqual(result.scenes[0].cameraPlan.angle, result.scenes[1].cameraPlan.angle);
  assert.notEqual(result.scenes[0].cameraPlan.movement, result.scenes[1].cameraPlan.movement);
  assert.equal(result.scenes[1].cameraPlan.changesFromPreviousScene, true);
});

test("creates character locks from assigned metadata without exporting photo bytes or filenames", () => {
  const result = applySceneContinuity(plan);
  const lock = result.scenes[0].characterLocks[0];
  assert.deepEqual(lock, {
    characterId: "char-dadaji",
    name: "Dadaji",
    role: "Main character",
    appearanceDescription: "Grey moustache, white kurta",
    referencePhotoDeclared: true,
    referencePhotoIncluded: false
  });
  assert.equal("photoName" in lock, false);
  assert.equal("blob" in lock, false);
});

test("attaches Hindi dialogue to the selected character and carries the lip-sync requirement", () => {
  const result = applySceneContinuity(plan, {
    dialogueByScene: {
      "scene-01": [{ id: "line-1", speakerCharacterId: "char-dadaji", text: "प्रभु, मेरी रक्षा कीजिए।" }]
    }
  });
  assert.deepEqual(result.scenes[0].dialogue[0], {
    id: "line-1",
    speakerCharacterId: "char-dadaji",
    text: "प्रभु, मेरी रक्षा कीजिए।",
    speakerName: "Dadaji",
    language: "hi-IN",
    lipSyncRequested: true,
    audioGenerationReady: false
  });
  assert.equal(result.dialogueAudioReady, false);
});

test("keeps frame-to-frame continuity when character identity locking is disabled", () => {
  const result = applySceneContinuity(plan, { characterContinuity: false });
  assert.equal(result.scenes[1].continuity.usePreviousSceneEndFrameAsOpeningReference, true);
  assert.equal(result.scenes[1].continuity.preserveCharacterIdentity, false);
  assert.deepEqual(result.scenes[1].continuity.preserveCharacterIds, []);
  assert.deepEqual(result.scenes[1].characterLocks, []);
});

test("keeps quota and reference-image state uncharged and unavailable", () => {
  const result = applySceneContinuity(plan);
  assert.equal(result.generationQuotaCharged, false);
  assert.equal(result.referenceImageIncluded, false);
  assert.equal(result.renderReady, false);
});

test("rejects a malformed scene plan", () => {
  assert.throws(() => applySceneContinuity(null), /valid scene plan/);
  assert.throws(() => applySceneContinuity({ scenes: "bad" }), /valid scene plan/);
});
