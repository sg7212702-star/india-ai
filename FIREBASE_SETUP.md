# Firebase and generation queue setup

This repository includes a Firestore security baseline, Firebase email/password browser sign-in, server-side Firebase ID-token verification, a transactional daily quota, and durable queue/lease primitives. It does **not** include a running GPU worker or a video-generation model.

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

Never add the service-account JSON to `.env.example`, browser JavaScript, GitHub commits, or a public deployment variable. Restrict the service account to the minimum required Firebase Authentication and Firestore permissions. Keep `GENERATION_QUEUE_ENABLED=false` until the worker is deployed.

## 3. Configure the browser sign-in panel

Set these Firebase Web app values in the server environment:

- `FIREBASE_WEB_API_KEY`
- `FIREBASE_AUTH_DOMAIN`
- `FIREBASE_PROJECT_ID` (also used by Firebase Admin)
- `FIREBASE_WEB_APP_ID`

The browser account panel supports email/password account creation, sign-in, password reset, and sign-out. The server returns only the public Firebase Web app identifiers from `GET /api/config`. Configure Firebase Authentication's authorized domains for the deployed hostname.

The quota display also needs Firebase Admin credentials and Firestore access on the server. A successful browser sign-in alone does not prove that server-side account services are ready.

## 4. Deploy Firestore rules and indexes

Install the Firebase CLI locally, sign in, select the project, then deploy:

```bash
npm install -g firebase-tools
firebase login
firebase use --add
firebase deploy --only firestore:rules,firestore:indexes
```

The repository's `firebase.json` points to `firestore.rules` and `firestore.indexes.json`. Test rules in the Firebase Emulator before using real accounts.

## 5. Private API endpoints

All private endpoints require `Authorization: Bearer <Firebase ID token>`. The server verifies the token and revocation state; it never trusts a UID supplied in JSON, query parameters, or a custom header.

- `GET /api/auth/me`: authenticated UID, email, and Admin custom-claim status.
- `GET /api/generation/quota`: current Asia/Kolkata day usage and active-job lock.
- `POST /api/generation/jobs`: validates and reserves a job, but returns HTTP 503 while `GENERATION_QUEUE_ENABLED=false`.
- `GET /api/generation/jobs/:jobId`: returns the authenticated owner's job status.
- `GET /api/health`: reports Firebase setup and queue flags; `videoGenerationReady` remains false.

The old synchronous `POST /api/video` endpoint is retired and returns HTTP 410. It no longer calls Veo.

## 6. Daily quota and job reservation

`lib/generation-quota.js` uses a Firestore transaction:

- Maximum two reserved generations per user per Asia/Kolkata calendar day.
- Only one active job per user at a time, even across midnight.
- A reservation increments the day's count and creates a job document with status `queued`.
- A successful generation remains counted.
- A terminal failure refunds the reservation exactly once.
- Repeated terminal callbacks are idempotent.

These rules are service-level unit tested. They are not a substitute for Firestore Emulator tests or a real multi-request concurrency test.

## 7. Queue leases and recovery

`lib/generation-queue.js` provides the primitives a separate worker process will use:

- `getClaimableGenerationJobIds`: discovers queued jobs in FIFO order and processing jobs with expired leases.
- `claimGenerationJob`: transactionally claims a queued job or takes over an expired lease.
- `renewGenerationLease`: heartbeat that only the current worker owner can renew.
- `finishGeneration`: requires the current worker ID, so a worker whose lease was replaced cannot finish or refund another worker's job.
- `getGenerationJob`: reads a job only when its UID matches the verified account.

Worker leases default to two minutes and may be configured between 10 seconds and 15 minutes. A worker must heartbeat before its lease expires. If it stops, another worker can reclaim the job. The worker must make output writes idempotent so a retry does not publish duplicate assets.

**Important:** the repository now includes a separate worker runner and process entrypoint, but it still has no provider/GPU adapter or private storage integration. Keep `GENERATION_QUEUE_ENABLED=false` in every environment until a real adapter, private storage, and an end-to-end smoke test are deployed. Enabling job intake before that could reserve a user's daily quota for a job that never produces a video.

## 8. Worker process and adapter gate

The worker runs separately from Express:

```bash
npm run worker
```

It requires a trusted module path in `VIDEO_ADAPTER_MODULE`. That module must export `createVideoAdapter({ env })` and return `{ available: true, generate() }`. If the setting is missing or the adapter is unavailable, the process exits before it can claim a job.

The runner handles FIFO discovery, transactional claims, lease heartbeats, retryable failures, maximum attempts, output validation, and quota release/refund. A successful adapter must upload a real MP4 to private object storage and return metadata under `users/{uid}/jobs/{jobId}/`. The owner-facing job-status API exposes safe metadata only; it does not expose the private storage path.

Configure these only on the separate worker host: `FIREBASE_PROJECT_ID`, Firebase Admin credentials, `VIDEO_ADAPTER_MODULE`, and optionally `WORKER_ID`, `WORKER_LEASE_MS`, `WORKER_POLL_INTERVAL_MS`, `WORKER_MAX_ATTEMPTS`, and `WORKER_BATCH_SIZE`. See [worker/README.md](./worker/README.md) for the full adapter contract.

There is no adapter or GPU model included yet. Do not enable queue intake or describe jobs as generated videos until a real adapter and private storage are available and tested.

## 9. Admin bootstrap

## 8. Admin bootstrap

Do not add an admin email or password to source code. Use a one-time private server-side command to set the Firebase custom claim `admin: true` on the owner's UID. Run it locally with a private service-account credential excluded by `.gitignore`, then remove or disable the bootstrap command. The Admin SDK bypasses Firestore rules, so every future admin endpoint must independently verify the `admin` custom claim. An admin dashboard and admin API routes are not implemented yet.

## 10. Zero-budget and generation limitations

- Keep `ENABLE_GEMINI_API=false` and `GENERATION_QUEUE_ENABLED=false`.
- The project builder and account UI can be hosted on a free CPU web tier, subject to that host's current limits.
- Free CPU hosting cannot reliably run current high-quality video-generation models.
- A genuine motion-video worker needs compatible GPU compute. No free hosted GPU is assumed.
- Private reference-image storage, multi-scene planning, Hindi TTS, lip-sync, background audio mixing, FFmpeg MP4 assembly, and the admin dashboard remain future work.

Never represent a queued brief as a generated video. Do not substitute still-image slideshows for motion video.
