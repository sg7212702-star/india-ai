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

let auth = null;
let mode = "signin";
let busy = false;

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
      if (user) {
        setBusy(true);
        await refreshAccount(user);
        setBusy(false);
      } else {
        form.hidden = false;
        signedInPanel.hidden = true;
        roleBadge.hidden = true;
        setStatus("Sign in or create an account to view your private quota.", "info");
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

boot();
