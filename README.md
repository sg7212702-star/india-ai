# AI Animation Studio

A work-in-progress project builder for story-led 2D and realistic 3D animation.

## Current status

The responsive project-builder shell is available at `public/index.html`, with external `public/styles.css` and `public/app.js` assets. It can prepare a brief from a text prompt, a full story, or a reference photo plus story; choose 2D or realistic 3D, 9:16 or 16:9, a target length up to five minutes, Hindi voice direction, music, lip-sync, and character-continuity settings.

Project briefs are saved in the current browser's local storage and can be exported as JSON. They are not yet synced to a user account or server. A selected reference photo is previewed locally only and must be selected again after reopening a saved brief.

## Account and quota foundation

- `public/auth.js` provides Firebase email/password sign-up, sign-in, password reset, auth-state handling, and sign-out.
- The browser obtains Firebase Web configuration from `/api/config`; no Admin service-account credential is exposed to the browser.
- Express verifies Firebase ID tokens for `/api/auth/me` and `/api/generation/quota`.
- Firestore quota reservations are transactional: two successful video generations are allowed per user per Asia/Kolkata calendar day, and failed reservations are refunded once.
- A user-level `activeGenerationJobId` lock now prevents a second job from starting while the previous job is still active, including when a job crosses midnight.
- Firestore rules keep quota writes, job creation/state changes, admin actions, and audit logs server-only. Admin role checks use Firebase custom claims.

This foundation still needs a real Firebase project, Email/Password sign-in enablement, Web app configuration, and server-side Firebase Admin credentials before live account features can work. Follow [FIREBASE_SETUP.md](./FIREBASE_SETUP.md).

## Video generation status

**Real video generation is intentionally disabled by default.** The Generate control remains unavailable and `/api/health` reports `videoGenerationReady: false`. No slideshow is substituted for a real motion-video result.

The repository does not yet include a durable queue, GPU worker, multi-scene video pipeline, Hindi TTS/lip-sync integration, asset storage, FFmpeg assembly, or admin dashboard. The current optional Veo route is a synchronous provider integration guarded by `ENABLE_PAID_VIDEO_API=true`; keep it disabled. Do not enable it for this zero-budget project.

## Run locally

Requirements: Node.js 20+

1. Clone this repository.
2. Copy `.env.example` to `.env`.
3. Keep `ENABLE_GEMINI_API=false` and `ENABLE_PAID_VIDEO_API=false`.
4. Run `npm install`.
5. Run `npm run check`.
6. Run `npm test`.
7. Run `npm start` and open `http://localhost:3000`.

Never put API keys or Firebase Admin credentials in frontend code or commit a real `.env` file.

The legacy text/image limits are in-memory and IP-based. They are not production user quotas. Free CPU hosting can serve the website and lightweight API work, but it cannot reliably run modern video-generation models. A genuine video worker requires compatible GPU compute; no free hosted GPU is assumed.

See [FIREBASE_SETUP.md](./FIREBASE_SETUP.md) and [AI_ANIMATION_STUDIO_BUILD_PLAN.md](./AI_ANIMATION_STUDIO_BUILD_PLAN.md) for setup, security, and the implementation roadmap.
