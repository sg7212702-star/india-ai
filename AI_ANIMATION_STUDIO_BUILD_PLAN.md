# AI Animation Studio — Build Plan and Technical Audit

Updated: 2026-11-10

## Product requirements to preserve

- Input: text prompt, story, uploaded photo, or photo + story.
- Output: real generated motion video (not a slideshow), with 2D and realistic 3D styles.
- Hindi narration/dialogue, lip-sync where supported, background music, and repeatable character identity.
- Build longer projects from generated scenes/clips; target up to about 5 minutes.
- Export MP4 in 9:16 and 16:9.
- Accounts, user dashboard, and admin panel.
- Initial quota: 2 video generations per user per day; only 1 active generation per user at a time.
- Budget: zero. Do not silently call paid video APIs or assume a free GPU.

## Repository audit

Repository inspected: `sg7212702-star/india-ai` (default branch `main`).

The current `server.js` is a small Express starter. It exposes `/api/text`, `/api/image`, `/api/video`, `/api/limits`, and `/api/health`. The video endpoint calls Google Veo 3.1 directly and returns one downloaded MP4 after polling the provider.

Important gaps before this can be called AI Animation Studio:

1. The video route accepts only a text prompt and aspect ratio. It does not accept a reference photo, story, scene list, or character references.
2. It creates one provider clip; there is no multi-scene planner, clip stitching, FFmpeg assembly, 5-minute project workflow, or export pipeline.
3. The current video quota defaults to 1, is keyed by IP, and lives in an in-memory Map. It is not the required 2-per-user daily quota and resets on server restart.
4. There is no active-job lock or durable queue. The HTTP request stays open while the provider is polled.
5. There is no Firebase Authentication, persistent user/usage data, admin role, or admin panel.
6. Generated media is written to local server disk, which may be ephemeral on a hosted service.
7. The original README referred to `.env.example`, but that file was not present. The server expects `public/index.html`; the frontend has now been added at that path.

The API key is correctly kept on the server rather than in browser code. Preserve that security boundary.

## Implementation progress — 2026-11-10

Added `public/index.html`, a responsive dark-glass project-builder shell. It currently provides:

- Input modes for text prompt, full story, and photo + story.
- Local image selection, drag/drop and preview (JPG/PNG/WebP, up to 8 MB).
- 2D Animation and Realistic 3D style selection.
- 9:16 and 16:9 format choices; target durations from 30 seconds to 5 minutes.
- Hindi voice direction, background-music choice, lip-sync and character-continuity options.
- Local-only project brief saving, reopening, deletion, and JSON export.

Important limitations are displayed in the UI: saved briefs remain in the current browser/device; selected photo bytes are only previewed in the current session and must be selected again after reopening; no user account sync exists; and the Generate button is deliberately disabled. This UI does not call Veo or pretend to render video.

This is a frontend shell, not a completed studio. It still needs browser/device testing and the identity, persistent queue, worker, storage, and admin layers below.

## Zero-budget decision

**Do not use Veo 3.1 as the default generation engine.** Google's official Gemini API pricing table lists Veo 3.1 as unavailable on the free tier; video is billed on the paid tier. Keep any paid provider behind an explicit, disabled-by-default adapter and never launch it accidentally.

An open-weight model does not make hosted inference free:

- Hugging Face's official Spaces documentation lists free CPU Basic hardware (2 vCPU, 16 GB RAM, no GPU); GPU hardware is billed by the hour.
- LTX-2.5 is a candidate for a local worker, but its official open-source system requirements currently call for an NVIDIA GPU with at least 32 GB VRAM, 32 GB system RAM, and 100 GB free storage. That is not a free cloud deployment.
- Wan 2.2 is another candidate to evaluate on a compatible GPU. Verify the exact model variant, license, memory requirement, and commercial-use terms before enabling it.

Therefore the zero-budget release can build the studio UI, authentication, storyboard/job workflow, quota enforcement, asset management, and an honest waiting/worker status. Real video generation should be enabled only when a local/donated GPU worker is actually connected, or when the owner explicitly enables a paid provider. Do not fake video generation with still-image slideshows.

References:
- Google Gemini API pricing: https://ai.google.dev/gemini-api/docs/pricing
- Hugging Face Spaces hardware: https://huggingface.co/docs/hub/spaces-overview
- LTX-2.5 system requirements: https://docs.ltx.io/open-source-model/getting-started/system-requirements
- LTX-2.5 model capabilities: https://docs.ltx.io/models/ltx-2-5/

## Target architecture

- Frontend: React + TypeScript, responsive dark transparent-glass UI, with clear stages and no fake progress. The first static HTML shell is now in place; it can be migrated to React only if the next implementation needs justify it.
- API: Node.js/Express; verify Firebase ID tokens on every private route.
- Identity/data: Firebase Authentication + Firestore. Store role claims for admin access.
- Media storage: a pluggable object-storage adapter with signed upload/download URLs; do not depend on ephemeral server disk for final assets.
- Queue: durable job documents in Firestore. A separate worker claims jobs transactionally; one worker per user at a time.
- Video provider: adapter interface (local LTX/Wan worker first; optional paid providers only by explicit admin configuration).
- Assembly: FFmpeg in the worker to concatenate actual generated clips, normalize audio, add narration/music, and export MP4.
- Observability: durable stage timestamps, progress events, failure reasons, retry count, and audit log.

## Firestore data model

- `users/{uid}`: display name, email, role (`user` or `admin`), disabled flag, createdAt.
- `users/{uid}/dailyUsage/{YYYY-MM-DD}`: reserved, completed, failed, and refunded counts.
- `jobs/{jobId}`: uid, inputMode, prompt, story, aspectRatio, style, targetDuration, status, stage, progress, provider, createdAt, updatedAt, error, outputAssetId.
- `jobs/{jobId}/scenes/{sceneId}`: order, scenePrompt, characterRefs, inputFrameAssetId, outputClipAssetId, status.
- `assets/{assetId}`: uid, jobId, type, storageKey, mimeType, sizeBytes, createdAt.
- `settings/public`: allowed styles, max duration, daily quota, maintenance mode.
- `auditLogs/{logId}`: admin/user action, actor uid, target, timestamp.

## Job states and enforcement

Use explicit states: `queued → planning → generating_scenes → generating_audio → assembling → completed`; failures go to `failed`, user cancellation to `cancelled`.

When a user submits a generation, a Firestore transaction must:
1. Verify the account is active.
2. Check today's reserved + completed usage against the limit of 2.
3. Check that the user has no job in an active state.
4. Reserve one daily slot and create the queued job atomically.

On success, mark the reservation completed. On a terminal failure before usable output, refund the reservation exactly once. Never enforce quota only in the browser or by IP.

## Remaining implementation order

1. **Test the shell:** load the page on mobile and desktop; check upload preview, mode switching, local draft persistence, JSON export, and responsive layout.
2. **Identity and quotas:** Firebase Auth, Firestore user profiles, admin claim, daily two-generation transaction, one-active-job rule.
3. **Durable job API:** submit/status/cancel endpoints and a worker claim/heartbeat protocol. Return a job ID immediately instead of holding an HTTP request open.
4. **Scene planner:** turn story/prompt into ordered scene records; store character bibles, reference images, voice settings, and continuity frame references.
5. **Real video worker:** connect a tested local/donated GPU model behind the provider interface. Start with a short test clip; do not promise five-minute output until scene generation is stable.
6. **Audio and assembly:** Hindi TTS/dialogue, lip-sync stage where the chosen model supports it, background music, FFmpeg render, 9:16 and 16:9 MP4 exports.
7. **Admin and deployment:** user/job controls, usage view, maintenance switch, audit trail, and persistent media storage.

## First acceptance test

A signed-in user can submit a short photo+prompt test, see a real queued job and honest stage updates, and download a genuine MP4 produced by the connected worker. A second simultaneous job for the same user is rejected; the third daily request is rejected after two reservations/completions. No paid API is called in zero-budget mode.
