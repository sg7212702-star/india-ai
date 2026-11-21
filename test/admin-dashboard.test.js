import test from 'node:test';
import assert from 'node:assert/strict';
import { getAdminOverview, listAdminJobs, normalizeAdminLimit, normalizeAdminStatus, sanitizeAdminJob, sanitizeAdminUser } from '../lib/admin-dashboard.js';

class FakeQuery {
  constructor(db, limit = 100) { this.db = db; this.limitValue = limit; }
  orderBy() { return this; }
  limit(value) { this.limitValue = value; return this; }
  async get() {
    const docs = [...this.db.jobs.entries()].slice(0, this.limitValue).map(([id, data]) => ({ id, data: () => data }));
    return { docs, size: docs.length };
  }
}
class FakeDb {
  constructor(jobs = []) { this.jobs = new Map(jobs); }
  collection(name) { assert.equal(name, 'jobs'); return new FakeQuery(this); }
}
const sampleJobs = [
  ['j3', { uid: 'u3', status: 'processing', createdAt: new Date('2026-11-21T10:00:00Z'), request: { title: 'Running', story: 'secret story' }, workerId: 'worker-secret' }],
  ['j2', { uid: 'u2', status: 'completed', createdAt: new Date('2026-11-20T10:00:00Z'), request: { title: 'Finished', style: '2D Animation', durationSeconds: 60 }, output: { mimeType: 'video/mp4', sizeBytes: 99, storagePath: 'private/path.mp4' } }],
  ['j1', { uid: 'u1', status: 'failed', createdAt: new Date('2026-11-19T10:00:00Z'), failureCode: 'MODEL_ERROR' }]
];

test('admin status accepts known statuses and rejects arbitrary input', () => {
  assert.equal(normalizeAdminStatus(undefined), null);
  assert.equal(normalizeAdminStatus('queued'), 'queued');
  assert.throws(() => normalizeAdminStatus('all-users'), { status: 400 });
});

test('admin limits use safe defaults and clamp to maximum', () => {
  assert.equal(normalizeAdminLimit(undefined), 25);
  assert.equal(normalizeAdminLimit('500'), 100);
  assert.equal(normalizeAdminLimit('0'), 25);
  assert.equal(normalizeAdminLimit('bad'), 25);
});

test('admin user serializer exposes only intended account fields', () => {
  const user = sanitizeAdminUser({
    uid: 'uid-1', email: 'admin@example.test', displayName: 'Admin', emailVerified: true, disabled: false,
    metadata: { creationTime: '2026-11-01T00:00:00Z', lastSignInTime: '2026-11-21T00:00:00Z' },
    providerData: [{ providerId: 'password' }], passwordHash: 'secret', passwordSalt: 'secret', customClaims: { admin: true }
  });
  assert.deepEqual(user, {
    uid: 'uid-1', email: 'admin@example.test', displayName: 'Admin', emailVerified: true, disabled: false,
    createdAt: '2026-11-01T00:00:00.000Z', lastSignInAt: '2026-11-21T00:00:00.000Z', providerIds: ['password']
  });
  assert.equal('passwordHash' in user, false);
  assert.equal('customClaims' in user, false);
});

test('admin job serializer omits prompt, story, storage path and worker metadata', () => {
  const job = sanitizeAdminJob('j-secret', {
    uid: 'u-1', status: 'completed', request: { title: 'Video', story: 'private script', prompt: 'secret prompt', style: '2D Animation', durationSeconds: 30 },
    output: { mimeType: 'video/mp4', sizeBytes: 123, storagePath: 'private/file.mp4' }, workerId: 'internal-worker'
  });
  assert.equal(job.request.title, 'Video');
  assert.equal(job.output.mimeType, 'video/mp4');
  assert.equal('story' in job.request, false);
  assert.equal('prompt' in job.request, false);
  assert.equal('storagePath' in job.output, false);
  assert.equal('workerId' in job, false);
});

test('admin jobs list filters recent jobs and reports scan metadata', async () => {
  const result = await listAdminJobs(new FakeDb(sampleJobs), { status: 'completed', limit: 10, scanLimit: 100 });
  assert.deepEqual(result.items.map((job) => job.jobId), ['j2']);
  assert.equal(result.status, 'completed');
  assert.equal(result.scannedCount, 3);
  assert.equal(result.scanLimitReached, false);
});

test('admin overview reports sampled users and recent status counts without claiming totals', async () => {
  const auth = { async listUsers(limit) { assert.equal(limit, 1000); return { users: [{ uid: 'u1' }], pageToken: 'next-page' }; } };
  const overview = await getAdminOverview(auth, new FakeDb(sampleJobs));
  assert.deepEqual(overview.users, { sampledCount: 1, sampleLimit: 1000, moreAvailable: true });
  assert.deepEqual(overview.jobs.counts, { queued: 0, processing: 1, completed: 1, failed: 1, unknown: 0 });
  assert.equal(overview.jobs.scannedCount, 3);
});
