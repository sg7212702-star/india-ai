import test from "node:test";
import assert from "node:assert/strict";
import { createScenePlan } from "../lib/scene-planner.js";
import {
  assertRenderManifestForWorker,
  createRenderManifest
} from "../lib/render-manifest.js";

const story = "दादाजी सुबह गाँव के पुराने मंदिर की ओर धीरे धीरे चलते हैं। रास्ते में उन्हें एक घायल सफेद कबूतर दिखाई देता है। वे उसे प्यार से उठाकर पानी पिलाते हैं। तभी मंदिर की घंटियाँ अपने आप बजने लगती हैं और आकाश में तेज प्रकाश फैल जाता है। दादाजी आश्चर्य से ऊपर देखते हैं। मंदिर के द्वार पर एक दिव्य आकृति प्रकट होती है और कबूतर सुरक्षित उड़ने लगता है।";

const request = {
  title: "दादाजी और सफेद कबूतर",
  mode: "story",
  story,
  style: "3D Realistic",
  aspectRatio: "9:16",
  durationSeconds: 30,
  voiceDirection: "Warm Hindi storyteller",
  music: "Cinematic score",
  lipSync: true,
  characterContinuity: true
};

const readyCapabilities = {
  motionVideo: true,
  hindiTts: true,
  lipSync: true,
  backgroundMusic: true,
  characterConsistency: true,
  privateStorage: true,
  ffmpeg: true
};

function makeManifest(overrides = {}) {
  const scenePlan = createScenePlan(request);
  return createRenderManifest({
    request,
    scenePlan,
    characters: overrides.characters || [
      { id: "char-dada", name: "दादाजी", role: "मुख्य पात्र", visualDescription: "सफेद कुर्ता, सफेद बाल और पतली मूँछ" },
      { id: "char-pigeon", name: "सफेद कबूतर", role: "सहायक पात्र", visualDescription: "पूरी तरह सफेद पंख" }
    ],
    sceneCharacterAssignments: overrides.sceneCharacterAssignments || {
      "scene-01": ["char-dada"],
      "scene-02": ["char-dada", "char-pigeon"],
      "scene-03": ["char-pigeon"],
      "scene-04": ["char-dada", "char-pigeon"]
    },
    sceneDialogue: overrides.sceneDialogue || {
      "scene-02": [{ id: "line-pigeon-1", speakerCharacterId: "char-pigeon", text: "दादाजी, मुझे बचा लीजिए!" }]
    },
    capabilities: overrides.capabilities || readyCapabilities,
    now: () => new Date("2026-11-28T05:00:00.000Z")
  });
}

test("render manifest builds ordered scenes, camera changes and exact previous-frame dependencies", () => {
  const manifest = makeManifest();

  assert.equal(manifest.contract, "ai-animation-render-manifest");
  assert.equal(manifest.project.style, "3D Realistic");
  assert.equal(manifest.project.aspectRatio, "9:16");
  assert.equal(manifest.project.targetDurationSeconds, 30);
  assert.equal(manifest.preflight.readyForRender, true);
  assert.equal(manifest.workerHandoff.readyForRender, true);
  assert.equal(manifest.scenes.length, 4);
  assert.deepEqual(manifest.renderSequence[0].dependsOnSceneIds, []);
  assert.deepEqual(manifest.renderSequence[1].dependsOnSceneIds, ["scene-01"]);
  assert.equal(manifest.scenes[1].continuity.openingFramePolicy, "use_previous_scene_final_frame_as_exact_first_frame");
  assert.equal(manifest.scenes[1].continuity.previousFinalFrame.available, false);
  assert.equal(manifest.scenes[1].continuity.previousFinalFrame.storageReference, null);
  assert.notEqual(manifest.scenes[0].cameraPlan.angle, manifest.scenes[1].cameraPlan.angle);
  assert.equal(manifest.scenes[1].dialogue[0].speakerName, "सफेद कबूतर");
  assert.equal(manifest.scenes[1].dialogue[0].language, "hi-IN");
  assert.equal(manifest.assembly.format, "mp4");
  assert.equal(manifest.assembly.ready, false);
});

test("short story creates a blocked manifest instead of inventing filler scenes", () => {
  const shortRequest = { ...request, story: "दादाजी मंदिर जाते हैं।", durationSeconds: 300 };
  const scenePlan = createScenePlan(shortRequest);
  const manifest = createRenderManifest({
    request: shortRequest,
    scenePlan,
    capabilities: readyCapabilities
  });

  assert.equal(manifest.preflight.storyCoverageComplete, false);
  assert.ok(manifest.preflight.blockers.some((item) => item.code === "STORY_EXPANSION_REQUIRED"));
  assert.throws(() => assertRenderManifestForWorker(manifest), { code: "RENDER_MANIFEST_NOT_READY" });
});

test("unknown scene character IDs are rejected", () => {
  const scenePlan = createScenePlan(request);
  assert.throws(() => createRenderManifest({
    request,
    scenePlan,
    characters: [{ id: "char-dada", name: "दादाजी" }],
    sceneCharacterAssignments: { "scene-01": ["char-missing"] },
    capabilities: readyCapabilities
  }), { code: "INVALID_RENDER_MANIFEST" });
});

test("dialogue speakers must be assigned to the same scene", () => {
  const scenePlan = createScenePlan(request);
  assert.throws(() => createRenderManifest({
    request,
    scenePlan,
    characters: [
      { id: "char-dada", name: "दादाजी" },
      { id: "char-pigeon", name: "सफेद कबूतर" }
    ],
    sceneCharacterAssignments: { "scene-01": ["char-dada"] },
    sceneDialogue: {
      "scene-01": [{ speakerCharacterId: "char-pigeon", text: "मुझे बचाइए!" }]
    },
    capabilities: readyCapabilities
  }), { code: "INVALID_RENDER_MANIFEST" });
});

test("browser-only character photo names are omitted and block worker handoff", () => {
  const manifest = makeManifest({
    characters: [
      { id: "char-dada", name: "दादाजी", photoName: "secret-reference.png" }
    ],
    sceneCharacterAssignments: { "scene-01": ["char-dada"] },
    sceneDialogue: {},
    capabilities: readyCapabilities
  });
  const serialized = JSON.stringify(manifest);

  assert.equal(manifest.characters[0].referencePhotoIncluded, false);
  assert.equal(manifest.characters[0].referencePhotoStatus, "local_only_not_transferred");
  assert.deepEqual(manifest.preflight.missingCharacterReferenceIds, ["char-dada"]);
  assert.ok(manifest.preflight.blockers.some((item) => item.code === "CHARACTER_REFERENCE_TRANSFER_REQUIRED"));
  assert.equal(serialized.includes("secret-reference.png"), false);
  assert.equal(serialized.includes("storagePath"), false);
  assert.throws(() => assertRenderManifestForWorker(manifest), { code: "RENDER_MANIFEST_NOT_READY" });
});

test("worker accepts only a ready versioned manifest and rejects missing or malformed payloads", () => {
  const manifest = makeManifest();
  assert.equal(assertRenderManifestForWorker(manifest), manifest);
  assert.throws(() => assertRenderManifestForWorker(null), { code: "RENDER_MANIFEST_MISSING" });
  assert.throws(() => assertRenderManifestForWorker({ contract: "wrong" }), { code: "RENDER_MANIFEST_INVALID" });
});

test("manifest size is bounded before it can be persisted in a queue job", () => {
  const scenePlan = createScenePlan(request);
  const largeCharacters = Array.from({ length: 8 }, (_, index) => ({
    id: "char-" + index,
    name: "Character " + index,
    visualDescription: "विवरण ".repeat(100)
  }));
  const assignments = Object.fromEntries(scenePlan.scenes.map((scene) => [scene.sceneId, largeCharacters.map((character) => character.id)]));
  const manifest = createRenderManifest({
    request,
    scenePlan,
    characters: largeCharacters,
    sceneCharacterAssignments: assignments,
    capabilities: readyCapabilities
  });
  assert.ok(Buffer.byteLength(JSON.stringify(manifest), "utf8") < 750_000);
});

test("worker rejects a manifest whose scene dependency chain was altered", () => {
  const manifest = makeManifest();
  manifest.renderSequence[1].dependsOnSceneIds = [];
  assert.throws(() => assertRenderManifestForWorker(manifest), { code: "RENDER_MANIFEST_INVALID" });
});

test("worker rejects a manifest that claims a browser reference photo was embedded", () => {
  const manifest = makeManifest();
  manifest.characters[0].referencePhotoIncluded = true;
  assert.throws(() => assertRenderManifestForWorker(manifest), { code: "RENDER_MANIFEST_INVALID" });
});

test("worker rejects a forged ready flag while preflight blockers remain", () => {
  const manifest = makeManifest();
  manifest.preflight.blockers.push({ code: "PRIVATE_STORAGE_REQUIRED", message: "Missing private storage." });
  assert.throws(() => assertRenderManifestForWorker(manifest), { code: "RENDER_MANIFEST_NOT_READY" });
});
