# AI Animation Studio

A work-in-progress project builder for story-led 2D and realistic 3D animation.

## Current status

The responsive project-builder shell is available at `public/index.html`, with external `public/styles.css` and `public/app.js` assets. It can prepare a brief from a text prompt, a full story, or a reference photo plus story; add up to eight local character profiles; choose 2D or realistic 3D, 9:16 or 16:9, a target length up to five minutes, Hindi voice direction, music, lip-sync, and character-continuity settings.

Project briefs are saved in the current browser's local storage and can be exported as JSON. They are not yet synced to a user account or server. A selected reference photo is stored separately in this browser's IndexedDB and is restored when the same saved brief is reopened. It is not uploaded to a server and is never embedded in a JSON export. A server-side upload API exists as a backend foundation but is not connected to this UI.

## Local project brief import/export

- Export saved briefs as JSON and import a single brief, an array, or a `drafts` wrapper.
- Imports are limited to 1 MiB and 20 projects per file; imported briefs receive new local IDs.
- Existing local briefs are preserved first; only available slots up to 20 are filled. Additional imported items are reported as skipped.
- Reference photos are not embedded in exported JSON. Photo-story projects require the photo to be selected again after import.
- Imported JSON is normalized to allowed modes, styles, aspect ratios, durations and field-length limits. Unknown fields (including photo data) are discarded.

## Browser-local reference photo storage

- `public/local-photo-store.js` stores the selected JPEG, PNG or WebP as a Blob in IndexedDB, keyed by the local project ID. The size limit is 8 MiB per selected image.
- Reopening the project in the same browser restores the preview without reading the image into localStorage. Deleting a project also attempts to remove its stored image.
- Photos are not uploaded, are not synced to the user's account, and are excluded from JSON exports/imports. Moving a project to another browser/device requires selecting the reference photo again.

## Browser-local character reference library

- Each local project can store up to eight character profiles with a name, story role and visual-continuity description (up to 1,000 characters).
- Each character may have one optional JPEG, PNG or WebP reference photo up to 8 MiB. Character photo blobs are stored in a separate IndexedDB database, scoped by project ID and character ID.
- Character descriptions and photo filenames are included in project brief JSON; image bytes are never exported. Importing a project creates fresh project IDs, so any character photos must be selected again on the destination browser.
- Removing a character or deleting/evicting a project attempts to remove its local character photo. Browser data clearing, private-browsing restrictions or storage eviction can still remove local photos.
- This is a local character bible only. Scene-by-scene character assignment, server sync and video-model identity conditioning are not implemented yet; the scene planner and worker do not consume these photos at this stage.
- Browser site-data clearing, private-browsing restrictions, quota limits or browser storage eviction can remove local photos. The project brief remains text-only and can still be exported as JSON.
- If IndexedDB is unavailable or a write fails, a photo-story brief is not reported as saved; text-only briefs remain usable.


## Account and quota foundation

- `public/auth.js` provides Firebase email/password sign-up, sign-in, password reset, auth-state handling, and sign-out.
- The browser obtains Firebase Web configuration from `/api/config`; no Admin service-account credential is exposed to the browser.
- Express verifies Firebase ID tokens for private account and generation endpoints.
- Firestore quota reservations are transactional: two reservations are allowed per user per Asia/Kolkata calendar day; a terminal failure refunds the reservation once.
- A user-level `activeGenerationJobId` lock prevents a second job while the previous job remains active, including across midnight.
- Firestore rules keep quota writes, job creation/state changes, admin actions, and audit logs server-only. Admin role checks use Firebase custom claims.

This foundation still needs a real Firebase project, Email/Password sign-in enablement, Web app configuration, and server-side Firebase Admin credentials before live account features can work. Follow [FIREBASE_SETUP.md](./FIREBASE_SETUP.md).

## Durable queue foundation

- New reservations are stored as `queued` jobs with a validated creative brief.
- `lib/generation-queue.js` provides FIFO queue discovery, transactional worker claims, expiring leases, heartbeats, stale-worker protection, and recovery of jobs whose worker lease expired.
- A worker cannot complete or refund a job after its lease expires; it must reclaim the job first. This prevents a paused process from publishing a late result after its ownership window has ended.
- `GET /api/generation/jobs/:jobId` returns the authenticated owner's job status.
- `POST /api/generation/jobs` is guarded by `GENERATION_QUEUE_ENABLED=false` by default. Keep it disabled until a real worker is deployed and tested.
- The old synchronous `POST /api/video` Veo endpoint is retired with HTTP 410. No synchronous paid video request is sent.

A separate worker runner and process entrypoint now exist in `worker/`. The runner polls and claims jobs, renews leases, validates MP4 output metadata, and completes or fails jobs. The process refuses to start unless a trusted video adapter module is configured. There is still no provider/GPU adapter, private storage integration, or authenticated download endpoint. Do not turn on `GENERATION_QUEUE_ENABLED` until a real adapter and private storage are deployed and smoke-tested.

## Text-to-scene planning preview

- `lib/scene-planner.js` converts a prompt or Hindi/English story into ordered scene beats without calling an AI provider.
- `POST /api/scene-plan` returns a downloadable JSON manifest. It does not create a generation job, consume the two-video quota, upload the reference photo, or claim that a video was rendered.
- Scene density is capped at an eight-second planning target. If the supplied text is too short for the selected duration, the response reports the supported planned duration and asks for more real story beats instead of inventing filler.
- `public/scene-planner.js` renders the scene breakdown and exports the manifest from the project builder.

## Read-only admin console

- `/admin.html` is a role-gated monitoring page; the server requires a verified Firebase token and the `admin: true` custom claim for every admin endpoint.
- `GET /api/admin/overview` returns a sampled user count (up to 1,000 Auth records) and status counts for the latest 100 jobs; these are samples, not billing totals.
- `GET /api/admin/users` paginates sanitized Firebase Auth records. Password hashes, salts and custom claims are not returned.
- `GET /api/admin/jobs` filters the latest 100 scanned jobs and returns a limited sanitized summary; prompt/story text, worker metadata and private Storage paths are omitted.
- The admin console is read-only for this phase. It does not disable users, grant roles, retry jobs, modify quota or access video files.

## Scene-wise character assignment preview

- The project builder lets users select which saved character profiles appear in each planned scene.
- Scene-plan JSON includes selected character IDs, names, roles, visual-continuity descriptions, and a boolean indicating whether a local reference photo was declared.
- Character image bytes and local filenames are not included in the scene manifest or sent to the planning API. The manifest explicitly remains `renderReady: false` and `referenceImageIncluded: false`.
- Assignments are saved with the local project brief and survive JSON export/import; stale scene IDs and character IDs are discarded when the plan or character list changes.
- This is a planning contract only. No video model receives the references until a future authenticated asset-transfer and GPU-worker adapter is implemented.

## Video generation status

**Real video generation is intentionally disabled.** The Generate control remains unavailable and `/api/health` reports `videoGenerationReady: false`. No slideshow is substituted for a real motion-video result.

The worker orchestration is present. An authenticated private MP4 streaming/download route and an authenticated private reference-photo upload API have been added; both require a configured Storage bucket and security controls. The photo-upload API is not yet wired to the browser UI, and photo-story generation still rejects requests. The repository still does not include a GPU model adapter, multi-scene video pipeline, Hindi TTS/lip-sync integration, FFmpeg assembly, or a deployed admin dashboard.

## Run locally

Requirements: Node.js 20+

1. Clone this repository.
2. Copy `.env.example` to `.env`.
3. Keep `ENABLE_GEMINI_API=false` and `GENERATION_QUEUE_ENABLED=false`.
4. Run `npm install`.
5. Run `npm run check`.
6. Run `npm test`.
7. Run `npm start` and open `http://localhost:3000`.

Never put API keys or Firebase Admin credentials in frontend code or commit a real `.env` file.

The legacy text/image limits are in-memory and IP-based. They are not production user quotas. Free CPU hosting can serve the website and lightweight API/worker orchestration, but it cannot reliably run modern video-generation models. A genuine video adapter requires compatible GPU compute; no free hosted GPU is assumed. See [worker documentation](./worker/README.md) for the adapter contract and safety gate.

See [FIREBASE_SETUP.md](./FIREBASE_SETUP.md) and [AI_ANIMATION_STUDIO_BUILD_PLAN.md](./AI_ANIMATION_STUDIO_BUILD_PLAN.md) for setup, security, and the implementation roadmap.


## Private reference-photo upload API (backend only)

- `POST /api/assets/reference-photo` requires a verified Firebase ID token and `REFERENCE_IMAGE_UPLOAD_ENABLED=true` (false by default).
- Accepts base64 JSON for JPEG, PNG or WebP images up to 5 MiB and checks MIME against basic file signatures.
- Stores under a server-derived `users/{uid}/references/{assetId}.{ext}` path and creates a server-only Firestore asset record.
- The response returns only an asset ID, MIME type and size; no Storage path or public URL.
- Requires `FIREBASE_STORAGE_BUCKET`, Uniform Bucket-Level Access, and Public Access Prevention enforced. The route refuses uploads unless the opt-in flag is enabled.
- This endpoint is not yet wired into the browser builder; photo-story job creation remains unavailable.
- Firebase Storage access requires the Blaze billing plan as of February 3, 2026. Zero-budget users should not configure this bucket or attach billing merely to test the endpoint.

The helper unit tests validate supported signatures, base64, MIME mismatch, size limit and UID-scoped object paths. Full image decoding/dimension validation and the end-to-end Firebase Storage smoke test are still outstanding.
