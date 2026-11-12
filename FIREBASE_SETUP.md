# Firebase foundation setup

This repository now has a Firestore security baseline plus server-side Firebase ID-token verification and a transactional per-user video quota service. It still does **not** include a browser sign-in screen, a durable worker queue, or a free video-generation engine.

## 1. Create or select a Firebase project

1. Open https://console.firebase.google.com/.
2. Create a project for AI Animation Studio (or select the intended project).
3. Register a Web app in Project settings.
4. In **Authentication → Sign-in method**, enable Email/Password.
5. In **Firestore Database**, create the database in production mode.
6. Keep billing disabled for the zero-budget phase. Check the current Firebase plan and product-specific limits before enabling any storage or paid service.

The Firebase Web config (apiKey, authDomain, projectId, appId) identifies the project; it is not an Admin SDK credential. Never place a service-account private key in browser code or commit it to GitHub.

## 2. Configure Firebase Admin on the server

The Express server verifies Firebase ID tokens with the Admin SDK. Configure exactly one server-side credential method:

- Local development: set `GOOGLE_APPLICATION_CREDENTIALS` to the path of a service-account JSON file outside the public folder and excluded from Git.
- A supported Google Cloud runtime: use its attached service account / Application Default Credentials.
- Another host: store the minified service-account JSON in that host's encrypted secret manager and inject it as `FIREBASE_SERVICE_ACCOUNT_JSON`. Also set `FIREBASE_PROJECT_ID`.

Never add the service-account JSON to `.env.example`, browser JavaScript, GitHub commits, or a public deployment variable. Restrict the service account to the minimum required Firebase Authentication and Firestore permissions. Keep `ENABLE_PAID_VIDEO_API=false`.

## 3. Deploy the Firestore rules and indexes

Install the Firebase CLI locally, sign in, select the project, then deploy only the database configuration:

```bash
npm install -g firebase-tools
firebase login
firebase use --add
firebase deploy --only firestore:rules,firestore:indexes
```

The repository's `firebase.json` points to `firestore.rules` and `firestore.indexes.json`.

## 4. Server endpoints added

- `GET /api/auth/me`: verifies a Bearer Firebase ID token and returns the authenticated UID, email and Admin custom-claim status.
- `GET /api/generation/quota`: returns the user's usage for the current India calendar day.
- `GET /api/health`: reports whether Firebase Admin credentials are configured. It continues to report `videoGenerationReady: false`.

Private endpoints require `Authorization: Bearer <Firebase ID token>`. The server verifies the token and revocation state; it never trusts a UID supplied in JSON, query parameters, or a custom header.

## 5. Daily generation quota service

`lib/generation-quota.js` implements a Firestore transaction with these rules:

- Maximum two successful/reserved generation attempts per user per day, using the `Asia/Kolkata` calendar date.
- Only one active generation per user at a time.
- A reservation increments the daily count and records the active job atomically.
- A successful generation remains counted.
- A terminal failure refunds the reservation exactly once and clears the active-job lock.
- Repeated completion/failure callbacks are idempotent.

The quota module has unit tests using Node's built-in test runner. These tests validate the service logic; they are not a substitute for Firebase Emulator transaction/rules tests or a real multi-request concurrency test.

## 6. Paid video route remains opt-in and incomplete

The legacy `POST /api/video` route is now protected by Firebase ID-token verification and the transactional quota. It still calls the paid Veo API synchronously, creates only one provider clip, and is disabled unless `ENABLE_PAID_VIDEO_API=true`. Do not enable it for the zero-budget product. It is not the planned multi-scene queue and does not produce a five-minute story film.

There is no durable worker, lease/heartbeat recovery, scene planner, multi-clip assembly, Hindi voice pipeline, lip-sync pipeline, or MP4 export workflow yet. Do not set `ENABLE_PAID_VIDEO_API=true` merely to test the site.

## 7. Admin bootstrap

Do not add an admin email or password to source code. After the authenticated backend is deployed, use a one-time private server-side bootstrap command to set the custom claim `admin: true` on the owner's UID. The command should run locally with a private service-account credential excluded by `.gitignore`, then be removed or disabled. The Admin SDK bypasses Firestore rules, so every admin endpoint must independently verify the `admin` custom claim.

## Current limitation

These changes add backend token verification, quota reading and a tested transactional quota service. They do not create the Firebase project, enable Authentication in the console, add browser login/signup UI, implement a durable worker queue, or generate a video. Test the Firestore rules in the Firebase Emulator before opening the database to real users.
