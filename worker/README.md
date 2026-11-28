# Generation worker

The worker is a separate Node.js process. It polls Firestore, transactionally claims one job, renews its lease while a provider is running, validates the final MP4 metadata, and then completes or fails the job. A process handles one job at a time; multiple processes can share the queue because claims are transactional.

## Safety gate

The process refuses to start unless `VIDEO_ADAPTER_MODULE` points to a trusted local ES module that exports `createVideoAdapter({ env })` and returns an adapter with `available: true` plus `generate()` and `verifyOutput()` functions. It does not claim jobs when that adapter is missing or unavailable.

Before the adapter is called, the runner also validates `request.renderManifest` with `assertRenderManifestForWorker()`. A missing, malformed or planning-only manifest fails safely before provider execution and refunds the quota reservation. A ready manifest is passed to `generate({ uid, jobId, request, renderManifest, attempt, signal })`.

No provider adapter or GPU model is included in this repository yet. Do not create a fake adapter that returns still images or marks a job complete without a real MP4. Keep `GENERATION_QUEUE_ENABLED=false` on the web/API server until a real adapter, private object storage, and a smoke test are deployed.

## Adapter contract

The trusted module must export the following shape. This is an interface example, not a working provider: the sample metadata is illustrative, and the verification placeholder deliberately throws until real storage and media checks are implemented:

```js
export async function createVideoAdapter({ env }) {
  // Load/check a real provider and its private-storage client here.
  return {
    available: true,
    async generate({ uid, jobId, request, attempt, signal }) {
      // Generate motion video, assemble it, and upload the MP4 privately.
      // Honour signal for shutdown/lease-loss cancellation.
      // Throw { retryable: true, code: 'UPSTREAM_TIMEOUT' } for retryable faults.
      return {
        output: {
          assetId: 'a-unique-safe-id',
          storagePath: `users/${uid}/jobs/${jobId}/final.mp4`,
          mimeType: 'video/mp4',
          durationSeconds: request.durationSeconds,
          width: 576,
          height: 1024,
          sizeBytes: 123456
        }
      };
    },
    async verifyOutput({ uid, jobId, output, signal }) {
      // Confirm the private object exists, its bytes/MP4 signature are valid,
      // and ffprobe (or an equivalent probe) confirms duration and dimensions.
      // Also verify the object is not public and belongs to uid/jobId.
      throw new Error('Implement private-object and MP4 verification before enabling this adapter.');
    }
  };
}
```

Before a job is marked completed, `verifyOutput()` must confirm the object exists in private storage and that its actual MP4 bytes, duration, and dimensions match the metadata. Returning `false` fails the job. The output validator also enforces:
- MP4 MIME type, a positive duration no longer than five minutes or the requested duration (with a two-second tolerance), and a file size up to 2 GB.
- Dimensions that match the requested 9:16 or 16:9 format.
- A private object path beneath `users/{uid}/jobs/{jobId}/`; public URLs and paths belonging to another user/job are rejected.

The adapter must upload to the deterministic private object path `users/{uid}/jobs/{jobId}/final.mp4`. The path is not stored in Firestore; a future authenticated download endpoint can derive it from the verified UID and job ID. The owner-facing job-status API returns only safe output metadata. A separate authenticated download/signing endpoint and storage rules still need to be implemented.

## Worker environment

Set these only on the worker host:

- `FIREBASE_PROJECT_ID`
- `FIREBASE_SERVICE_ACCOUNT_JSON` or supported Application Default Credentials
- `VIDEO_ADAPTER_MODULE` (trusted module path on the worker host)
- Optional: `WORKER_ID`, `WORKER_LEASE_MS` (default 120000), `WORKER_POLL_INTERVAL_MS` (default 5000), `WORKER_MAX_ATTEMPTS` (default 3), `WORKER_BATCH_SIZE` (default 10)

Run with `npm run worker`. The worker host must be able to reach Firestore and the provider/storage services. The web/API process and worker are deployed separately.

Retryable provider errors leave the job in processing until its lease expires; a later poll can reclaim it. After the configured maximum attempts, the worker fails the job and refunds the reservation. A permanent provider or output-validation error fails immediately and refunds once. If the worker shuts down or loses its lease, it does not complete or refund the job; lease recovery owns the next attempt.

## Zero-budget limitation

The worker orchestration is lightweight Node.js code, but it does not generate video by itself. A real 2D/3D motion-video adapter needs a compatible model and compute. Free CPU hosting is not a substitute for GPU inference, and no free GPU is assumed. Hindi TTS, lip-sync, multi-scene continuity, private storage, and FFmpeg assembly must be implemented in the real adapter/pipeline before the product can advertise generated MP4s.


## Authenticated MP4 retrieval

The Express API now exposes `GET /api/generation/jobs/:jobId/download` for the verified owner of a completed job. The endpoint derives `users/{uid}/jobs/{jobId}/final.mp4` server-side and streams the object with single-range support for seeking. It does not expose a public URL or storage path.

The API host must set `FIREBASE_STORAGE_BUCKET`. The bucket must have Uniform Bucket-Level Access enabled and Public Access Prevention enforced. The endpoint rejects Firebase download-token metadata and public ACLs, checks the object content type and byte size against the job metadata, and returns `private, no-store`. The adapter's `verifyOutput()` must upload the object without download tokens and verify the actual MP4 contents before the worker completes the job. This route is not production-ready until the bucket configuration and real adapter are deployed and smoke-tested.
