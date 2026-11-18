const byId = (id) => document.getElementById(id);
const previewButton = byId("previewScenePlan");
const panel = byId("scenePlanPanel");
const status = byId("scenePlanStatus");
const summary = byId("scenePlanSummary");
const list = byId("scenePlanList");
const warnings = byId("scenePlanWarnings");
const downloadButton = byId("downloadScenePlan");
let latestPlan = null;

function escapeText(value) {
  return String(value ?? "");
}

function formatDuration(seconds) {
  const whole = Math.round(Number(seconds) || 0);
  const minutes = Math.floor(whole / 60);
  const remainder = whole % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

function addText(parent, tag, className, value) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = escapeText(value);
  parent.append(element);
  return element;
}

function renderPlan(plan) {
  latestPlan = plan;
  summary.textContent = `${plan.sceneCount} scene beats · ${formatDuration(plan.plannedDurationSeconds)} planned motion · ${formatDuration(plan.targetDurationSeconds)} requested`;
  list.replaceChildren();
  warnings.replaceChildren();

  for (const warning of plan.warnings) {
    addText(warnings, "li", "", warning);
  }
  warnings.hidden = plan.warnings.length === 0;

  for (const scene of plan.scenes) {
    const card = document.createElement("article");
    card.className = "scene-plan-card";
    const heading = document.createElement("div");
    heading.className = "scene-plan-card-head";
    addText(heading, "strong", "", `Scene ${scene.order}`);
    addText(heading, "span", "", `${formatDuration(scene.durationSeconds)} · ${scene.sceneId}`);
    card.append(heading);
    addText(card, "p", "scene-source", scene.sourceText);
    addText(card, "small", "scene-direction", scene.shotDirection);
    list.append(card);
  }

  downloadButton.disabled = false;
  status.textContent = "Scene plan ready. This is a text-only planning preview; no video was rendered.";
  status.dataset.state = "success";
}

function getSelectedValue(selector, attribute) {
  const selected = document.querySelector(`${selector} [aria-pressed="true"]`);
  return selected?.dataset?.[attribute] || "";
}

previewButton?.addEventListener("click", async () => {
  const mode = getSelectedValue("#inputModes", "mode") || "prompt";
  const style = getSelectedValue("#styles", "style") || "3D Realistic";
  const payload = {
    title: byId("projectName").value.trim(),
    mode,
    prompt: byId("prompt").value,
    story: byId("story").value,
    style,
    aspectRatio: byId("ratio").value,
    durationSeconds: Number(byId("duration").value),
    voiceDirection: byId("voice").value,
    music: byId("music").value,
    lipSync: byId("lipSync").checked,
    characterContinuity: byId("continuity").checked
  };

  if (mode === "prompt" && !payload.prompt.trim()) {
    status.textContent = "Enter a video prompt first.";
    status.dataset.state = "error";
    panel.hidden = false;
    return;
  }
  if ((mode === "story" || mode === "photo-story") && !payload.story.trim()) {
    status.textContent = "Enter your story first.";
    status.dataset.state = "error";
    panel.hidden = false;
    return;
  }

  previewButton.disabled = true;
  previewButton.textContent = "Planning scenes…";
  panel.hidden = false;
  status.textContent = "Splitting your text into ordered scene beats…";
  status.dataset.state = "loading";
  summary.textContent = "";
  list.replaceChildren();
  warnings.replaceChildren();
  downloadButton.disabled = true;

  try {
    const response = await fetch("/api/scene-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not create the scene plan.");
    renderPlan(result);
  } catch (error) {
    status.textContent = error?.message || "Scene planning failed. Please try again.";
    status.dataset.state = "error";
  } finally {
    previewButton.disabled = false;
    previewButton.textContent = "Preview scene breakdown";
  }
});

downloadButton?.addEventListener("click", () => {
  if (!latestPlan) return;
  const blob = new Blob([JSON.stringify(latestPlan, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "ai-animation-scene-plan.json";
  anchor.click();
  URL.revokeObjectURL(url);
});

