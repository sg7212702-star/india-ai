# AI Animation Studio

A work-in-progress project builder for story-led 2D and realistic 3D animation.

## Current status

The responsive project-builder shell is available at `public/index.html`, with external `public/styles.css` and `public/app.js` assets so the page works with the server's Helmet content-security policy. It lets you prepare a brief using a text prompt, story, or photo + story; choose 2D/realistic 3D, 9:16/16:9, target length up to five minutes, Hindi voice direction, music, lip-sync, and character-continuity settings.

Project briefs are saved in the current browser's local storage and can be exported as JSON. They are not synced to an account or server. A selected reference photo is previewed locally only and must be selected again after reopening a saved brief.

**Real video generation is intentionally disabled in the UI and on the API by default.** The repository does not yet have the required authenticated user system, durable job queue, GPU worker, multi-scene pipeline, FFmpeg assembly, or admin panel. The interface does not create a slideshow or pretend that a video was rendered.

### Firebase security foundation

Added `firebase.json`, `firestore.rules`, and `firestore.indexes.json` as a first database-security foundation. The rules allow users to read their own profile, usage, jobs, scenes and assets, but reserve job creation, quota writes, admin actions and audit logs for trusted server code. Admin access is based on a Firebase custom claim, not a browser-editable role field.

See [Firebase setup and security notes](./FIREBASE_SETUP.md). These files do not yet connect a Firebase project, add login UI, or verify Firebase ID tokens in Express.

## Run locally

Requirements: Node.js 20+

1. Clone this repository.
2. Copy `.env.example` to `.env`.
3. Leave `ENABLE_GEMINI_API=false` and `ENABLE_PAID_VIDEO_API=false` for the zero-budget preview.
4. Run `npm install`.
5. Run `npm run check` to validate server/browser JavaScript syntax.
6. Run `npm start`.
7. Open `http://localhost:3000`.

The Google Gemini text/image routes require an explicit `ENABLE_GEMINI_API=true` plus a valid server-side API key. The Veo video route additionally requires `ENABLE_PAID_VIDEO_API=true`. Do not enable paid video generation until provider billing, authentication, quota enforcement, and queue safety have been implemented and reviewed. Never put an API key in frontend code or commit a real `.env` file.

The current legacy API limits are in-memory and IP-based. They are not the required two-per-user daily quota and must not be treated as production access control.

## Zero-budget policy

Do not assume a free hosted GPU. Free CPU hosting is suitable for the website shell and lightweight API work, not reliable inference for modern video-generation models. A real video worker must be connected and tested before the Generate action is enabled. Paid providers must remain explicitly opt-in.

## Planned features

- Firebase Authentication, Firestore profiles, user dashboard and admin panel.
- Two video-generation reservations per user per day, with only one active job per user.
- Durable scene/job queue and asset storage.
- Genuine multi-clip video generation, Hindi narration, lip-sync where supported, background music, character continuity, and FFmpeg MP4 export.
- 9:16 and 16:9 exports, with projects targeting up to approximately five minutes.

See [AI Animation Studio Build Plan](./AI_ANIMATION_STUDIO_BUILD_PLAN.md) for the technical audit, data model, zero-budget constraints, and implementation sequence.
