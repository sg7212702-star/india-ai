# AI Animation Studio

A work-in-progress project builder for story-led 2D and realistic 3D animation.

## Current status

The responsive project-builder shell is available at `public/index.html`. It lets you prepare a brief using a text prompt, story, or photo + story; choose 2D/realistic 3D, 9:16/16:9, target length up to five minutes, Hindi voice direction, music, lip-sync, and character-continuity settings.

Project briefs are saved in the current browser's local storage and can be exported as JSON. They are not synced to an account or server. A selected reference photo is previewed locally only and must be selected again after reopening a saved brief.

**Real video generation is intentionally disabled in the UI.** The repository does not yet have the required authenticated user system, durable job queue, GPU worker, multi-scene pipeline, FFmpeg assembly, or admin panel. The interface does not create a slideshow or pretend that a video was rendered.

## Run locally

Requirements: Node.js 20+

1. Clone this repository.
2. Run `npm install`.
3. Run `npm start`.
4. Open `http://localhost:3000`.

The current server still contains experimental Gemini/Veo API routes. The frontend does not call those routes. Do not expose paid generation to users until provider billing, authentication, quota enforcement, and queue safety have been implemented.

## Zero-budget policy

Do not assume a free hosted GPU. Free CPU hosting is suitable for the website shell and lightweight API work, not reliable inference for modern video-generation models. A real video worker must be connected and tested before the Generate action is enabled. Paid providers must remain explicitly opt-in.

## Planned features

- Firebase Authentication, Firestore profiles, user dashboard and admin panel.
- Two video-generation reservations per user per day, with only one active job per user.
- Durable scene/job queue and asset storage.
- Genuine multi-clip video generation, Hindi narration, lip-sync where supported, background music, character continuity, and FFmpeg MP4 export.
- 9:16 and 16:9 exports, with projects targeting up to approximately five minutes.

See [AI Animation Studio Build Plan](./AI_ANIMATION_STUDIO_BUILD_PLAN.md) for the technical audit, data model, zero-budget constraints, and implementation sequence.
