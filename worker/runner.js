import {
  claimGenerationJob,
  getClaimableGenerationJobIds,
  renewGenerationLease
} from '../lib/generation-queue.js';
import { finishGeneration } from '../lib/generation-quota.js';
import { validateWorkerOutput } from './output-contract.js';

const CLAIM_RACE_CODES = new Set([
  'JOB_NOT_FOUND',
  'JOB_TERMINAL',
  'JOB_LEASE_ACTIVE',
  'JOB_NOT_CLAIMABLE'
]);

function safeFailureCode(error) {
  return typeof error?.code === 'string' && /^[A-Z0-9_]{3,64}$/.test(error.code)
    ? error.code
    : 'GENERATION_FAILED';
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createGenerationWorker({
  db,
  adapter,
  workerId,
  leaseMs = 120_000,
  pollIntervalMs = 5_000,
  maxAttempts = 3,
  batchSize = 10,
  now = () => new Date(),
  sleep = defaultSleep,
  logger = console
}) {
  if (!db || typeof db.collection !== 'function' || typeof db.runTransaction !== 'function') {
    throw new TypeError('A Firestore-compatible database is required.');
  }
  if (!adapter || adapter.available !== true || typeof adapter.generate !== 'function') {
    throw new Error('A working video adapter is required. No job will be claimed without one.');
  }
  if (typeof workerId !== 'string' || !/^[a-zA-Z0-9._:-]{3,100}$/.test(workerId)) {
    throw new TypeError('A worker ID of 3–100 safe characters is required.');
  }
  if (!Number.isFinite(leaseMs) || leaseMs < 10_000 || leaseMs > 900_000) {
    throw new RangeError('Worker lease must be between 10 seconds and 15 minutes.');
  }
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs < 1_000 || pollIntervalMs > 60_000) {
    throw new RangeError('Worker poll interval must be between 1 and 60 seconds.');
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
    throw new RangeError('Maximum attempts must be between 1 and 10.');
  }
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 50) {
    throw new RangeError('Worker batch size must be between 1 and 50.');
  }

  let stopped = false;
  let running = null;
  let activeController = null;

  async function processJob(jobId) {
    let claim;
    try {
      claim = await claimGenerationJob(db, {
        jobId,
        workerId,
        now: now(),
        leaseMs
      });
    } catch (error) {
      if (CLAIM_RACE_CODES.has(error.code)) return false;
      throw error;
    }

    if (claim.attempts > maxAttempts) {
      await finishGeneration(db, {
        uid: claim.uid,
        jobId,
        workerId,
        succeeded: false,
        failureCode: 'MAX_ATTEMPTS_EXCEEDED',
        now: now()
      });
      logger.warn?.(`Generation job ${jobId} failed after ${maxAttempts} attempts.`);
      return true;
    }

    const controller = new AbortController();
    activeController = controller;
    let leaseLost = false;
    let heartbeatBusy = false;
    let heartbeatPromise = Promise.resolve();
    let heartbeatTimer;

    const heartbeatMs = Math.max(1_000, Math.floor(leaseMs / 3));
    heartbeatTimer = setInterval(() => {
      if (heartbeatBusy || leaseLost || controller.signal.aborted) return;
      heartbeatBusy = true;
      heartbeatPromise = renewGenerationLease(db, {
        jobId,
        workerId,
        now: now(),
        leaseMs
      }).catch((error) => {
        leaseLost = true;
        controller.abort(error);
        logger.error?.(`Worker lease lost for job ${jobId}:`, error);
      }).finally(() => {
        heartbeatBusy = false;
      });
    }, heartbeatMs);
    heartbeatTimer.unref?.();

    const stopHeartbeat = async () => {
      clearInterval(heartbeatTimer);
      await heartbeatPromise;
    };

    try {
      const generated = await adapter.generate({
        uid: claim.uid,
        jobId,
        request: claim.request,
        attempt: claim.attempts,
        signal: controller.signal
      });

      await stopHeartbeat();
      if (leaseLost || controller.signal.aborted || stopped) {
        throw Object.assign(new Error('Worker ownership was lost before completion.'), {
          code: 'WORKER_OWNERSHIP_LOST'
        });
      }

      const output = validateWorkerOutput(generated?.output, {
        uid: claim.uid,
        jobId,
        request: claim.request
      });

      await finishGeneration(db, {
        uid: claim.uid,
        jobId,
        workerId,
        succeeded: true,
        output,
        now: now()
      });
      logger.info?.(`Generation job ${jobId} completed.`);
    } catch (error) {
      await stopHeartbeat();
      if (leaseLost || stopped || controller.signal.aborted) {
        logger.warn?.(`Generation job ${jobId} was left for lease recovery.`);
      } else if (error?.retryable === true) {
        // Do not release the job. Its lease expires and another poll can reclaim it.
        logger.warn?.(`Generation job ${jobId} will be retried after its lease expires.`, error);
      } else {
        try {
          await finishGeneration(db, {
            uid: claim.uid,
            jobId,
            workerId,
            succeeded: false,
            failureCode: safeFailureCode(error),
            now: now()
          });
        } catch (finishError) {
          logger.error?.(`Could not finalize failed job ${jobId}; lease recovery will handle it.`, finishError);
        }
        logger.error?.(`Generation job ${jobId} failed.`, error);
      }
    } finally {
      await stopHeartbeat();
      if (activeController === controller) activeController = null;
    }

    return true;
  }

  async function runOnce() {
    if (stopped) return false;
    const jobIds = await getClaimableGenerationJobIds(db, { now: now(), limit: batchSize });
    for (const jobId of jobIds) {
      if (stopped) break;
      const processed = await processJob(jobId);
      if (processed) return true;
    }
    return false;
  }

  async function start() {
    if (running) return running;
    stopped = false;
    running = (async () => {
      while (!stopped) {
        try {
          const processed = await runOnce();
          if (!processed && !stopped) await sleep(pollIntervalMs);
        } catch (error) {
          logger.error?.('Generation worker loop error:', error);
          if (!stopped) await sleep(pollIntervalMs);
        }
      }
    })();
    return running;
  }

  function stop() {
    stopped = true;
    activeController?.abort(new Error('Worker shutdown requested.'));
  }

  return { runOnce, start, stop };
}
