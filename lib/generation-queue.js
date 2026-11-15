function queueError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function toMillis(value) {
  if (value instanceof Date) return value.getTime();
  if (value && typeof value.toMillis === 'function') return value.toMillis();
  if (value && typeof value.toDate === 'function') return value.toDate().getTime();
  return 0;
}

function validateWorker(workerId) {
  if (typeof workerId !== 'string' || !/^[a-zA-Z0-9._:-]{3,100}$/.test(workerId)) {
    throw new TypeError('A worker ID of 3–100 safe characters is required.');
  }
}

export async function getClaimableGenerationJobIds(db, {
  now = new Date(),
  limit = 10
} = {}) {
  const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
  const jobs = db.collection('jobs');
  const [queuedSnapshot, expiredSnapshot] = await Promise.all([
    jobs.where('status', '==', 'queued').limit(safeLimit).get(),
    jobs.where('status', '==', 'processing')
      .where('leaseExpiresAt', '<=', now)
      .limit(safeLimit)
      .get()
  ]);

  const queued = queuedSnapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
  const expired = expiredSnapshot.docs
    .map((doc) => ({ id: doc.id, data: doc.data() }))
    .filter(({ data }) => toMillis(data.leaseExpiresAt) > 0 && toMillis(data.leaseExpiresAt) <= now.getTime());

  return [...queued, ...expired]
    .sort((a, b) => toMillis(a.data.createdAt) - toMillis(b.data.createdAt))
    .slice(0, safeLimit)
    .map(({ id }) => id);
}

export async function claimGenerationJob(db, {
  jobId,
  workerId,
  now = new Date(),
  leaseMs = 120_000,
  serverTimestamp = () => new Date()
}) {
  validateWorker(workerId);
  if (typeof jobId !== 'string' || !jobId) throw new TypeError('A job ID is required.');
  if (!Number.isFinite(leaseMs) || leaseMs < 10_000 || leaseMs > 900_000) {
    throw new RangeError('Worker lease must be between 10 seconds and 15 minutes.');
  }

  const jobRef = db.collection('jobs').doc(jobId);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(jobRef);
    if (!snapshot.exists) throw queueError('JOB_NOT_FOUND', 'Generation job was not found.');

    const job = snapshot.data();
    if (job.status === 'completed' || job.status === 'failed') {
      throw queueError('JOB_TERMINAL', 'This generation job is already finished.');
    }
    if (job.status === 'processing' && toMillis(job.leaseExpiresAt) > now.getTime()) {
      throw queueError('JOB_LEASE_ACTIVE', 'Another worker currently owns this generation job.');
    }
    if (job.status !== 'queued' && job.status !== 'processing') {
      throw queueError('JOB_NOT_CLAIMABLE', 'This generation job is not ready to be claimed.');
    }

    const timestamp = serverTimestamp();
    const attempts = (Number.isInteger(job.attempts) && job.attempts >= 0 ? job.attempts : 0) + 1;
    transaction.update(jobRef, {
      status: 'processing',
      workerId,
      attempts,
      leaseStartedAt: timestamp,
      heartbeatAt: timestamp,
      leaseExpiresAt: new Date(now.getTime() + leaseMs),
      updatedAt: timestamp
    });
    return { jobId, workerId, attempts, leaseExpiresAt: new Date(now.getTime() + leaseMs), request: job.request || {} };
  });
}

export async function renewGenerationLease(db, {
  jobId,
  workerId,
  now = new Date(),
  leaseMs = 120_000,
  serverTimestamp = () => new Date()
}) {
  validateWorker(workerId);
  if (!Number.isFinite(leaseMs) || leaseMs < 10_000 || leaseMs > 900_000) {
    throw new RangeError('Worker lease must be between 10 seconds and 15 minutes.');
  }

  const jobRef = db.collection('jobs').doc(jobId);
  return db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(jobRef);
    if (!snapshot.exists) throw queueError('JOB_NOT_FOUND', 'Generation job was not found.');
    const job = snapshot.data();
    if (job.status !== 'processing' || job.workerId !== workerId) {
      throw queueError('WORKER_OWNERSHIP_LOST', 'This worker no longer owns the generation job.');
    }
    if (toMillis(job.leaseExpiresAt) <= now.getTime()) {
      throw queueError('WORKER_LEASE_EXPIRED', 'The worker lease expired; claim the job again.');
    }

    const timestamp = serverTimestamp();
    const leaseExpiresAt = new Date(now.getTime() + leaseMs);
    transaction.update(jobRef, { heartbeatAt: timestamp, leaseExpiresAt, updatedAt: timestamp });
    return { jobId, leaseExpiresAt };
  });
}

export async function getGenerationJob(db, { uid, jobId }) {
  if (!uid || !jobId) throw new TypeError('Verified UID and job ID are required.');
  const snapshot = await db.collection('jobs').doc(jobId).get();
  if (!snapshot.exists || snapshot.data().uid !== uid) {
    throw queueError('JOB_NOT_FOUND', 'Generation job was not found.');
  }
  const job = snapshot.data();
  return {
    jobId,
    status: job.status,
    createdAt: job.createdAt || null,
    updatedAt: job.updatedAt || null,
    finishedAt: job.finishedAt || null,
    failureCode: job.failureCode || null,
    attempts: Number.isInteger(job.attempts) ? job.attempts : 0,
    request: job.request || {}
  };
}
