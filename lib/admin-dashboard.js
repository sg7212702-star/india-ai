const VALID_STATUSES = new Set(['queued', 'processing', 'completed', 'failed']);
const STATUS_KEYS = ['queued', 'processing', 'completed', 'failed', 'unknown'];

export function normalizeAdminStatus(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !VALID_STATUSES.has(value)) {
    const error = new Error('Choose queued, processing, completed or failed as the job status.');
    error.status = 400;
    throw error;
  }
  return value;
}

export function normalizeAdminLimit(value, fallback = 25, maximum = 100) {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(maximum, Math.floor(parsed));
}

function isoDate(value) {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value.toDate === 'function') {
    const date = value.toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
  }
  if (typeof value === 'string') {
    const date = new Date(value);
    return !Number.isNaN(date.getTime()) ? date.toISOString() : null;
  }
  return null;
}

export function sanitizeAdminUser(user = {}) {
  const providers = Array.isArray(user.providerData) ? user.providerData : [];
  return {
    uid: typeof user.uid === 'string' ? user.uid : '',
    email: typeof user.email === 'string' ? user.email : null,
    displayName: typeof user.displayName === 'string' ? user.displayName : null,
    emailVerified: user.emailVerified === true,
    disabled: user.disabled === true,
    createdAt: isoDate(user.metadata?.creationTime),
    lastSignInAt: isoDate(user.metadata?.lastSignInTime),
    providerIds: providers.map((provider) => provider?.providerId).filter((id) => typeof id === 'string').slice(0, 10)
  };
}

export function sanitizeAdminJob(jobId, data = {}) {
  const request = data.request || {};
  const output = data.output || null;
  const status = VALID_STATUSES.has(data.status) ? data.status : 'unknown';
  return {
    jobId: typeof jobId === 'string' ? jobId : '',
    uid: typeof data.uid === 'string' ? data.uid : '',
    status,
    createdAt: isoDate(data.createdAt),
    updatedAt: isoDate(data.updatedAt),
    finishedAt: isoDate(data.finishedAt),
    attempts: Number.isInteger(data.attempts) && data.attempts >= 0 ? data.attempts : 0,
    failureCode: typeof data.failureCode === 'string' && /^[A-Z0-9_]{3,64}$/.test(data.failureCode) ? data.failureCode : null,
    request: {
      title: typeof request.title === 'string' ? request.title.slice(0, 80) : 'Untitled animation',
      style: request.style === '2D Animation' ? '2D Animation' : '3D Realistic',
      aspectRatio: request.aspectRatio === '16:9' ? '16:9' : '9:16',
      durationSeconds: Number.isInteger(request.durationSeconds) ? request.durationSeconds : null
    },
    output: output ? {
      mimeType: typeof output.mimeType === 'string' ? output.mimeType : null,
      durationSeconds: Number.isFinite(output.durationSeconds) ? output.durationSeconds : null,
      width: Number.isInteger(output.width) ? output.width : null,
      height: Number.isInteger(output.height) ? output.height : null,
      sizeBytes: Number.isSafeInteger(output.sizeBytes) ? output.sizeBytes : null,
      aspectRatio: typeof output.aspectRatio === 'string' ? output.aspectRatio : null
    } : null
  };
}

function summarizeStatuses(items) {
  const counts = Object.fromEntries(STATUS_KEYS.map((key) => [key, 0]));
  for (const item of items) counts[item.status] = (counts[item.status] || 0) + 1;
  return counts;
}

async function recentJobsSnapshot(db, scanLimit) {
  return db.collection('jobs').orderBy('createdAt', 'desc').limit(scanLimit).get();
}

export async function getAdminOverview(auth, db, { scanLimit = 100 } = {}) {
  const safeScanLimit = normalizeAdminLimit(scanLimit, 100, 100);
  const [usersPage, jobsSnapshot] = await Promise.all([
    auth.listUsers(1000),
    recentJobsSnapshot(db, safeScanLimit)
  ]);
  const jobs = jobsSnapshot.docs.map((doc) => sanitizeAdminJob(doc.id, doc.data()));
  return {
    users: {
      sampledCount: usersPage.users.length,
      sampleLimit: 1000,
      moreAvailable: Boolean(usersPage.pageToken)
    },
    jobs: {
      scannedCount: jobsSnapshot.size,
      scanLimit: safeScanLimit,
      scanLimitReached: jobsSnapshot.size === safeScanLimit,
      counts: summarizeStatuses(jobs)
    }
  };
}

export async function listAdminJobs(db, { status = null, limit = 25, scanLimit = 100 } = {}) {
  const normalizedStatus = normalizeAdminStatus(status);
  const safeLimit = normalizeAdminLimit(limit, 25, 100);
  const safeScanLimit = normalizeAdminLimit(scanLimit, 100, 100);
  const snapshot = await recentJobsSnapshot(db, safeScanLimit);
  const all = snapshot.docs.map((doc) => sanitizeAdminJob(doc.id, doc.data()));
  const filtered = normalizedStatus ? all.filter((job) => job.status === normalizedStatus) : all;
  return {
    items: filtered.slice(0, safeLimit),
    status: normalizedStatus,
    scannedCount: snapshot.size,
    scanLimit: safeScanLimit,
    scanLimitReached: snapshot.size === safeScanLimit
  };
}
