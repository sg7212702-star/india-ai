import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";

const $ = (id) => document.getElementById(id);
const form = $("authForm");
const status = $("authStatus");
const nameField = $("authNameField");
const nameInput = $("authName");
const emailInput = $("authEmail");
const passwordInput = $("authPassword");
const submitButton = $("authSubmit");
const modeButton = $("authModeToggle");
const forgotButton = $("authForgot");
const signedInPanel = $("authSignedIn");
const accountLabel = $("authAccount");
const quotaLabel = $("authQuota");
const roleBadge = $("authRole");
const logoutButton = $("authLogout");
const jobsPanel = $("jobsDashboard");
const jobsStatus = $("jobsStatus");
const jobsList = $("jobsList");
const refreshJobsButton = $("refreshJobs");


let auth = null;
let mode = "signin";
let busy = false;
let jobsUser = null;
let jobsTimer = null;
let jobsLoading = false;


function setStatus(message, state = "info") {
  status.textContent = message;
  status.dataset.state = state;
}

function setBusy(value) {
  busy = value;
  submitButton.disabled = value || !auth;
  modeButton.disabled = value || !auth;
  forgotButton.disabled = value || !auth;
  logoutButton.disabled = value;
  submitButton.textContent = value ? "Please wait…" : (mode === "signup" ? "Create account" : "Sign in");
}

function setMode(nextMode) {
  mode = nextMode;
  const creating = mode === "signup";
  nameField.hidden = !creating;
  nameInput.required = creating;
  passwordInput.autocomplete = creating ? "new-password" : "current-password";
  submitButton.textContent = creating ? "Create account" : "Sign in";
  modeButton.textContent = creating ? "I already have an account" : "Create account";
  forgotButton.hidden = creating;
}

function friendlyError(error) {
  const messages = {
    "auth/email-already-in-use": "An account already exists for this email. Sign in instead.",
    "auth/invalid-email": "Enter a valid email address.",
    "auth/invalid-credential": "Email or password is incorrect.",
    "auth/user-disabled": "This account is disabled. Contact the administrator.",
    "auth/weak-password": "Choose a password with at least 6 characters.",
    "auth/too-many-requests": "Too many attempts. Wait a little and try again.",
    "auth/network-request-failed": "Network error. Check your internet connection."
  };
  return messages[error?.code] || error?.message || "Authentication failed. Please try again.";
}

async function fetchJson(url, token) {
  const response = await fetch(url, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    cache: "no-store"
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
  return body;
}

function escapeJobsHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function formatJobDate(value) {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return date.toLocaleString();
}

function formatJobDuration(seconds) {
  if (!Number.isInteger(seconds) || seconds <= 0) return "Duration not set";
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m${seconds % 60 ? ` ${seconds % 60}s` : ""}`;
}

function scheduleJobsRefresh(user, active) {
  window.clearTimeout(jobsTimer);
  jobsTimer = window.setTimeout(() => refreshJobs(user), active ? 15000 : 60000);
}

function renderJobs(items) {
  if (!Array.isArray(items) || !items.length) {
    jobsList.innerHTML = '<div class="draft-empty">No generations yet. Your queued and completed videos will appear here.</div>';
    return;
  }
  const labels = { queued: "Queued", processing: "Processing", completed: "Completed", failed: "Failed", unknown: "Unknown" };
  jobsList.innerHTML = items.map((job) => {
    const title = escapeJobsHtml(job.request?.title || "Untitled animation");
    const status = labels[job.status] || labels.unknown;
    const style = escapeJobsHtml(job.request?.style || "Animation");
    const ratio = escapeJobsHtml(job.request?.aspectRatio || "—");
    const duration = formatJobDuration(job.request?.durationSeconds);
    const date = escapeJobsHtml(formatJobDate(job.createdAt));
    const detail = job.status === "queued" ? "Waiting for a compatible worker."
      : job.status === "processing" ? "Worker has claimed this job; progress is not reported as a percentage."
      : job.status === "completed" ? "Video is marked complete by the server."
      : job.status === "failed" ? "Generation failed. The server handles quota refund on final failure."
      : "Status is not recognized.";
    const download = job.status === "completed" && job.output?.mimeType === "video/mp4"
      ? `<button class="job-download" type="button" data-download="${escapeJobsHtml(job.jobId)}">Download MP4</button>`
      : "";
    return `<article class="job-card"><div class="job-card-main"><div class="job-card-title"><strong>${title}</strong><span class="job-status-pill" data-status="${escapeJobsHtml(job.status)}">${status}</span></div><small class="job-card-meta">${style} · ${ratio} · ${duration} · ${date}</small><span class="job-card-detail">${detail}</span></div>${download}</article>`;
  }).join("");
}

async function refreshJobs(user = jobsUser, manual = false) {
  if (!user || jobsLoading) return;
  jobsLoading = true;
  if (manual) jobsStatus.textContent = "Refreshing your generation history…";
  try {
    const token = await user.getIdToken();
    const response = await fetch("/api/generation/jobs?limit=10", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store"
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Could not load jobs (${response.status}).`);
    const items = Array.isArray(body.items) ? body.items : [];
    renderJobs(items);
    const active = items.some((job) => job.status === "queued" || job.status === "processing");
    jobsStatus.textContent = items.length ? `Showing ${items.length} recent generation job(s).` : "No generation jobs found.";
    jobsStatus.dataset.state = "success";
    scheduleJobsRefresh(user, active);
  } catch (error) {
    jobsStatus.textContent = error.message || "Could not load generation history.";
    jobsStatus.dataset.state = "warning";
    scheduleJobsRefresh(user, false);
  } finally {
    jobsLoading = false;
  }
}

async function downloadJob(user, jobId, button) {
  button.disabled = true;
  button.textContent = "Preparing download…";
  try {
    const token = await user.getIdToken();
    const response = await fetch(`/api/generation/jobs/${encodeURIComponent(jobId)}/download`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store"
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `Download failed (${response.status}).`);
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `animation-${jobId}.mp4`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    button.textContent = "Downloaded";
  } catch (error) {
    jobsStatus.textContent = error.message || "Download failed.";
    jobsStatus.dataset.state = "warning";
    button.textContent = "Retry download";
  } finally {
    button.disabled = false;
  }
}

async function refreshAccount(user) {
  accountLabel.textContent = user.email || user.displayName || "Signed-in account";
  signedInPanel.hidden = false;
  form.hidden = true;
  roleBadge.hidden = false;
  roleBadge.textContent = "CHECKING ROLE";
  quotaLabel.textContent = "Checking server quota…";

  try {
    const token = await user.getIdToken();
    const [profileResult, quotaResult] = await Promise.allSettled([
      fetchJson("/api/auth/me", token),
      fetchJson("/api/generation/quota", token)
    ]);
    const profile = profileResult.status === "fulfilled" ? profileResult.value : null;
    const quota = quotaResult.status === "fulfilled" ? quotaResult.value : null;

    roleBadge.textContent = profile ? (profile.admin ? "ADMIN" : "MEMBER") : "ACCOUNT";
    if (quota) {
      quotaLabel.textContent = `${quota.used} of ${quota.limit} generations used today · ${quota.remaining} remaining${quota.activeJobId ? " · one job is active" : ""}`;
    } else {
      const reason = quotaResult.status === "rejected" ? quotaResult.reason.message : "Quota service unavailable.";
      quotaLabel.textContent = `Quota unavailable: ${reason}`;
    }

    if (profile && quota) {
      setStatus("Signed in. Your account and daily quota were verified by the server.", "success");
    } else if (profile) {
      setStatus("Signed in and verified. The quota service still needs server-side Firestore configuration.", "warning");
    } else {
      const reason = profileResult.status === "rejected" ? profileResult.reason.message : "Server verification unavailable.";
      setStatus(reason, "warning");
    }
  } catch (error) {
    roleBadge.textContent = "ACCOUNT";
    quotaLabel.textContent = "Signed in; server account services are not ready.";
    setStatus(error.message, "warning");
  }
}


async function boot() {
  try {
    const configResponse = await fetchJson("/api/config");
    if (!configResponse.firebaseWebConfigured || !configResponse.firebase) {
      setStatus("Firebase Web app is not configured on the server yet. Add FIREBASE_WEB_API_KEY, FIREBASE_AUTH_DOMAIN, FIREBASE_PROJECT_ID and FIREBASE_WEB_APP_ID to enable sign-in.", "warning");
      submitButton.disabled = true;
      modeButton.disabled = true;
      forgotButton.disabled = true;
      return;
    }

    const app = initializeApp(configResponse.firebase);
    auth = getAuth(app);
    setMode("signin");
    setBusy(false);

    onAuthStateChanged(auth, async (user) => {
      window.clearTimeout(jobsTimer);
      jobsUser = user || null;
      jobsPanel.hidden = !user;
      if (user) refreshJobs(user);

      if (user) {
        setBusy(true);
        await refreshAccount(user);
        setBusy(false);
      } else {
        form.hidden = false;
        signedInPanel.hidden = true;
        roleBadge.hidden = true;
        setStatus("Sign in or create an account to view your private quota.", "info");
        jobsStatus.textContent = "Sign in to see your generation history.";
        jobsStatus.dataset.state = "info";
        jobsList.innerHTML = '<div class="draft-empty">Your private jobs will appear after sign-in.</div>';

        setBusy(false);
      }
    });
  } catch (error) {
    setStatus(`Could not load Firebase configuration: ${error.message}`, "error");
    submitButton.disabled = true;
    modeButton.disabled = true;
    forgotButton.disabled = true;
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!auth || busy) return;
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  setBusy(true);
  setStatus(mode === "signup" ? "Creating your account…" : "Signing in…");

  try {
    if (mode === "signup") {
      const displayName = nameInput.value.trim();
      if (displayName.length < 2) throw new Error("Enter a display name with at least 2 characters.");
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      await updateProfile(credential.user, { displayName });
      setStatus("Account created successfully.", "success");
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }
  } catch (error) {
    setStatus(friendlyError(error), "error");
    setBusy(false);
  }
});

modeButton.addEventListener("click", () => {
  setMode(mode === "signin" ? "signup" : "signin");
  setStatus(mode === "signup" ? "Create your account with email and password." : "Enter your email and password to sign in.");
});

forgotButton.addEventListener("click", async () => {
  if (!auth) return;
  const email = emailInput.value.trim();
  if (!email) {
    setStatus("Enter your email address first, then choose Forgot password.", "warning");
    emailInput.focus();
    return;
  }
  setBusy(true);
  try {
    await sendPasswordResetEmail(auth, email);
    setStatus("If an account exists for this email, a password reset message has been sent.", "success");
  } catch (error) {
    setStatus(friendlyError(error), "error");
  } finally {
    setBusy(false);
  }
});

logoutButton.addEventListener("click", async () => {
  if (!auth) return;
  setBusy(true);
  try {
    await signOut(auth);
  } catch (error) {
    setStatus(friendlyError(error), "error");
  } finally {
    setBusy(false);
  }
});


refreshJobsButton?.addEventListener("click", () => refreshJobs(jobsUser, true));
jobsList?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-download]");
  if (button && jobsUser) downloadJob(jobsUser, button.dataset.download, button);
});

boot();

