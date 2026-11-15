# AI Animation Studio

A work-in-progress project builder for story-led 2D and realistic 3D animation.

## Current status

The responsive project-builder shell is available at `public/index.html`, with external `public/styles.css` and `public/app.js` assets. It can prepare a brief from a text prompt, a full story, or a reference photo plus story; choose 2D or realistic 3D, 9:16 or 16:9, a target length up to five minutes, Hindi voice direction, music, lip-sync, and character-continuity settings.

Project briefs are saved in the current browser's local storage and can be exported as JSON. They are not yet synced to a user account or server. A selected reference photo is previewed locally only and must be selected again after reopening a saved brief.

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
- `GET /api/generation/jobs/:jobId` returns the authenticated owner's job status.
- `POST /api/generation/jobs` is guarded by `GENERATION_QUEUE_ENABLED=false` by default. Keep it disabled until a real worker is deployed and tested.
- The old synchronous `POST /api/video` Veo endpoint is retired with HTTP 410. No synchronous paid video request is sent.

The queue is a backend foundation, not a running worker. There is currently no process polling and claiming jobs, no GPU model adapter, and no automatic job completion. Do not turn on `GENERATION_QUEUE_ENABLED` until those pieces are deployed.

## Video generation status

**Real video generation is intentionally disabled.** The Generate control remains unavailable and `/api/health` reports `videoGenerationReady: false`. No slideshow is substituted for a real motion-video result.

The repository still does not include a GPU worker, multi-scene video pipeline, Hindi TTS/lip-sync integration, private image storage, FFmpeg assembly, or admin dashboard.

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

The legacy text/image limits are in-memory and IP-based. They are not production user quotas. Free CPU hosting can serve the website and lightweight API work, but it cannot reliably run modern video-generation models. A genuine video worker requires compatible GPU compute; no free hosted GPU is assumed.

See [FIREBASE_SETUP.md](./FIREBASE_SETUP.md) and [AI_ANIMATION_STUDIO_BUILD_PLAN.md](./AI_ANIMATION_STUDIO_BUILD_PLAN.md) for setup, security, and the implementation roadmap.
