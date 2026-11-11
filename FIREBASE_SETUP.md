# Firebase foundation setup

This repository now includes a Firestore security baseline. It does **not** yet connect the website to a Firebase project or implement sign-in screens/API token verification.

## 1. Create or select a Firebase project

1. Open https://console.firebase.google.com/.
2. Create a project for AI Animation Studio (or select the intended project).
3. Register a Web app in Project settings.
4. In **Authentication → Sign-in method**, enable Email/Password.
5. In **Firestore Database**, create the database in production mode.
6. Keep billing disabled for the zero-budget phase. Check the current Firebase plan and product-specific limits before enabling any storage or paid service.

The Firebase Web config (apiKey, authDomain, projectId, appId) identifies the project; it is not an Admin SDK credential. Never place a service-account private key in the browser or commit it to GitHub.

## 2. Deploy the Firestore rules and indexes

Install the Firebase CLI locally, sign in, select the project, then deploy only the database configuration:

```bash
npm install -g firebase-tools
firebase login
firebase use --add
firebase deploy --only firestore:rules,firestore:indexes
```

The repository's `firebase.json` points to `firestore.rules` and `firestore.indexes.json`.

## 3. Security model

- A signed-in user can read their own profile and update only display name/photo URL.
- Users cannot assign themselves an admin role or change account-disabled status.
- Daily usage records are readable by their owner but never writable from the browser.
- Jobs and scene records are read-only to the owning user.
- Job creation, quota reservation/refund, job state changes, asset metadata writes and audit logging must happen in trusted server/worker code using the Firebase Admin SDK.
- Admin access uses the Firebase custom claim `admin: true`, set only by trusted server-side code. Never trust a role value supplied by a browser.
- Unmatched collections are denied by default.

## 4. Required backend work before turning on generation

The Express API still needs to:
1. Verify Firebase ID tokens on every private route.
2. Read the authenticated UID from the verified token, never from a request body or user-supplied header.
3. Use a Firestore transaction to reserve one of two daily generation slots and reject a second active job.
4. Create the job and its initial scene records in the same transaction.
5. Release/refund a reservation exactly once on a terminal failure.
6. Use a durable worker/lease so a process restart cannot create duplicate jobs.
7. Keep provider keys and Admin SDK credentials on the server only.

Do not enable the current legacy `/api/video` route for public users: its existing IP-based in-memory quota is not the required per-user protection.

## 5. Admin bootstrap

Do not add an admin email or password to source code. After the authenticated backend is implemented, use a one-time private server-side bootstrap command to set the custom claim on the owner's UID. The command should run locally with a private service-account credential that is excluded by `.gitignore`, then be removed or disabled. The Admin SDK bypasses Firestore rules, so every admin endpoint must independently verify the `admin` custom claim.

## Current limitation

These files establish database rules and deployment configuration only. They do not create the Firebase project, enable Authentication, add login UI, verify tokens in Express, create a queue, or generate videos. Test the rules in the Firebase Emulator before opening the database to real users.
