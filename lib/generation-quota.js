export const DEFAULT_DAILY_VIDEO_LIMIT = 2;
export const QUOTA_TIME_ZONE = 'Asia/Kolkata';

export function indiaDateKey(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: QUOTA_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function quotaError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export async function getGenerationUsage(db, uid, {
  now = new Date(),
  limit = DEFAULT_DAILY_VIDEO_LIMIT
} = {}) {
  if (!uid) throw new TypeError('A verified Firebase UID is required.');
  const date = indiaDateKey(now);
  const ref = db.collection('users').doc(uid).collection('dailyUsage').doc(date);
  const snapshot = await ref.get();
  const data = snapshot.exists ? snapshot.data() : {};
  const used = Number.isInteger(data.count) && data.count >= 0 ? data.count : 0;
  const activeJobId = typeof data.activeJobId === 'string' ? data.activeJobId : null;
  return {
    date,
    limit,
    used,
    remaining: Math.max(0, limit - used),
    activeJobId,
    canStart: used < limit && !activeJobId
  };
}

export async function reserveGenerationSlot(db, {
  uid,
  jobId,
  now = new Date(),
  limit = DEFAULT_DAILY_VIDEO_LIMIT,
  serverTimestamp = () => new Date()
}) {
  if (!uid || !jobId) throw new TypeError('Verified UID and job ID are required.');
  const date = indiaDateKey(now);
  const userRef = db.collection('users').doc(uid);
  const usageRef = userRef.collection('dailyUsage').doc(date);
  const jobRef = db.collection('jobs').doc(jobId);

  return db.runTransaction(async (transaction) => {
    const [usageSnapshot, jobSnapshot] = await Promise.all([
      transaction.get(usageRef),
      transaction.get(jobRef)
    ]);

    if (jobSnapshot.exists) {
      throw quotaError('JOB_ALREADY_EXISTS', 'This generation job ID already exists.');
    }

    const usage = usageSnapshot.exists ? usageSnapshot.data() : {};
    const used = Number.isInteger(usage.count) && usage.count >= 0 ? usage.count : 0;
    if (usage.activeJobId) {
      throw quotaError('ACTIVE_JOB_EXISTS', 'A video generation is already active for this account.');
    }
    if (used >= limit) {
      throw quotaError('DAILY_LIMIT_REACHED', 'The daily video generation limit has been reached.');
    }

    const timestamp = serverTimestamp();
    transaction.set(usageRef, {
      uid,
      date,
      count: used + 1,
      activeJobId: jobId,
      updatedAt: timestamp
    }, { merge: true });
    transaction.create(jobRef, {
      uid,
      status: 'processing',
      quotaDate: date,
      quotaReserved: true,
      createdAt: timestamp,
      updatedAt: timestamp
    });

    return { date, used: used + 1, remaining: Math.max(0, limit - used - 1), jobId };
  });
}

export async function finishGeneration(db, {
  uid,
  jobId,
  succeeded,
  now = new Date(),
  serverTimestamp = () => new Date(),
  failureCode = null
}) {
  if (!uid || !jobId || typeof succeeded !== 'boolean') {
    throw new TypeError('Verified UID, job ID and a boolean result are required.');
  }

  const jobRef = db.collection('jobs').doc(jobId);
  return db.runTransaction(async (transaction) => {
    const jobSnapshot = await transaction.get(jobRef);
    if (!jobSnapshot.exists) throw quotaError('JOB_NOT_FOUND', 'Generation job was not found.');

    const job = jobSnapshot.data();
    if (job.uid !== uid) throw quotaError('JOB_OWNER_MISMATCH', 'Generation job does not belong to this account.');
    if (job.status === 'completed' || job.status === 'failed') return false;

    const usageRef = db.collection('users').doc(uid).collection('dailyUsage').doc(job.quotaDate);
    const usageSnapshot = await transaction.get(usageRef);
    const usage = usageSnapshot.exists ? usageSnapshot.data() : {};
    const used = Number.isInteger(usage.count) && usage.count >= 0 ? usage.count : 0;
    const timestamp = serverTimestamp();

    const usageUpdate = {
      uid,
      date: job.quotaDate,
      activeJobId: usage.activeJobId === jobId ? null : (usage.activeJobId || null),
      updatedAt: timestamp
    };
    if (!succeeded && job.quotaReserved === true) {
      usageUpdate.count = Math.max(0, used - 1);
    } else {
      usageUpdate.count = used;
    }

    transaction.set(usageRef, usageUpdate, { merge: true });
    transaction.update(jobRef, {
      status: succeeded ? 'completed' : 'failed',
      quotaReserved: false,
      failureCode: succeeded ? null : failureCode,
      finishedAt: timestamp,
      updatedAt: timestamp
    });
    return true;
  });
}
