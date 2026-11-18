import test from "node:test";
import assert from "node:assert/strict";
import { createScenePlan } from "../lib/scene-planner.js";

test("Hindi story is split into ordered scene beats without losing words", () => {
  const story = "दादाजी पुराने पेड़ के पास पहुँचे। सफेद कबूतर उनके कंधे पर बैठा था। अचानक पेड़ की जड़ से नीली रोशनी निकली!";
  const plan = createScenePlan({
    mode: "story",
    story,
    durationSeconds: 30,
    style: "3D Realistic",
    aspectRatio: "9:16"
  });

  assert.ok(plan.sceneCount >= 1);
  assert.equal(plan.scenes.map((scene) => scene.sourceText).join(" "), story);
  assert.deepEqual(plan.scenes.map((scene) => scene.order), plan.scenes.map((_, index) => index + 1));
  assert.equal(plan.generationQuotaCharged, false);
  assert.equal(plan.renderReady, false);
});

test("short text does not pretend to fill a five-minute target", () => {
  const plan = createScenePlan({
    mode: "story",
    story: "एक बूढ़ा किसान जंगल में जाता है। वहाँ उसे एक रहस्यमयी रोशनी दिखाई देती है।",
    durationSeconds: 300
  });

  assert.equal(plan.targetDurationSeconds, 300);
  assert.ok(plan.plannedDurationSeconds < 300);
  assert.equal(plan.requiresStoryExpansion, true);
  assert.ok(plan.warnings.some((warning) => warning.includes("Expand the story")));
});

test("long story is capped to the selected duration and scene limit", () => {
  const story = Array.from({ length: 900 }, (_, index) => `word${index + 1}`).join(" ");
  const plan = createScenePlan({ mode: "story", story, durationSeconds: 300 });

  assert.equal(plan.plannedDurationSeconds, 300);
  assert.ok(plan.sceneCount <= 60);
  assert.ok(plan.sceneCount > 1);
  const total = plan.scenes.reduce((sum, scene) => sum + scene.durationSeconds, 0);
  assert.equal(Number(total.toFixed(2)), 300);
});

test("prompt mode creates visual beats without inventing narration", () => {
  const plan = createScenePlan({
    mode: "prompt",
    prompt: "A quiet village at dawn. A glowing doorway opens beside an old tree.",
    durationSeconds: 30,
    style: "2D Animation",
    aspectRatio: "16:9"
  });

  assert.equal(plan.style, "2D Animation");
  assert.equal(plan.aspectRatio, "16:9");
  assert.ok(plan.scenes.every((scene) => scene.narrationText === null));
  assert.ok(plan.warnings.some((warning) => warning.includes("visual brief")));
});

test("photo plus story can be planned without claiming the local photo was uploaded", () => {
  const plan = createScenePlan({
    mode: "photo-story",
    story: "दादी मंदिर के आँगन में दीपक जलाती हैं।",
    durationSeconds: 30
  });

  assert.equal(plan.referenceImageIncluded, false);
  assert.ok(plan.warnings.some((warning) => warning.includes("local browser preview")));
});

test("invalid or empty inputs are rejected", () => {
  assert.throws(() => createScenePlan({ mode: "story", story: "", durationSeconds: 30 }), /Enter the story/);
  assert.throws(() => createScenePlan({ mode: "prompt", prompt: "hello", durationSeconds: 45 }), /Choose 30/);
  assert.throws(() => createScenePlan({ mode: "prompt", prompt: "x".repeat(6001), durationSeconds: 30 }), /longer than/);
});
