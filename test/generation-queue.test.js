import test from 'node:test';
import assert from 'node:assert/strict';
import { claimGenerationJob, getClaimableGenerationJobIds, renewGenerationLease } from '../lib/generation-queue.js';
import { finishGeneration, reserveGenerationSlot } from '../lib/generation-quota.js';

class FakeFirestore {
  constructor() { this.data = new Map(); }
  collection(name) { return new FakeCollection(this, name); }
  async runTransaction(callback) {
    const writes = [];
    const transaction = {
      get: async (ref) => {
        const value = this.data.get(ref.path);
        return { exists: value !== undefined, data: () => value ? structuredClone(value) : undefined };
      },
      set: (ref, value, options = {}) => writes.push({ type: 'set', ref, value, merge: options.merge === true }),
      create: (ref, value) => writes.push({ type: 'create', ref, value }),
      update: (ref, value) => writes.push({ type: 'update', ref, value })
    };
    const result = await callback(transaction);
    for (const write of writes) {
      const oldValue = this.data.get(write.ref.path);
      if (write.type === 'create' && oldValue !== undefined) throw new Error('already exists');
      const next = write.merge || write.type === 'update'
        ? { ...(oldValue || {}), ...write.value }
        : { ...write.value };
      this.data.set(write.ref.path, next);
    }
    return result;
  }
}
class FakeCollection {
  constructor(db, path) { this.db = db; this.path = path; }
  doc(id) { return new FakeDocument(this.db, `${this.path}/${id}`); }
  where(field, operator, value) { return new FakeQuery(this.db, this.path, [{ field, operator, value }]); }
}
class FakeQuery {
  constructor(db, path, filters, count = 10, orders = []) {
    Object.assign(this, { db, path, filters, count, orders });
  }
  where(field, operator, value) {
    return new FakeQuery(this.db, this.path, [...this.filters, { field, operator, value }], this.count, this.orders);
  }
  orderBy(field, direction = 'asc') { return new FakeQuery(this.db, this.path, this.filters, this.count, [...this.orders, { field, direction }]); }
  limit(count) { return new FakeQuery(this.db, this.path, this.filters, count, this.orders); }
  async get() {
    const prefix = `${this.path}/`;
    const matches = (data, filter) => {
      const actual = data[filter.field];
      if (filter.operator === '==') return actual === filter.value;
      if (filter.operator === '<=') {
        const left = actual instanceof Date ? actual.getTime() : actual?.toMillis?.() ?? 0;
        const right = filter.value instanceof Date ? filter.value.getTime() : filter.value?.toMillis?.() ?? 0;
        return left > 0 && left <= right;
      }
      return false;
    };
    const entries = [...this.db.data.entries()]
      .filter(([path, data]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/') && this.filters.every((filter) => matches(data, filter)));
    for (const order of [...this.orders].reverse()) {
      const direction = order.direction === 'desc' ? -1 : 1;
      entries.sort((a, b) => {
        const left = a[1][order.field] instanceof Date ? a[1][order.field].getTime() : a[1][order.field]?.toMillis?.() ?? 0;
        const right = b[1][order.field] instanceof Date ? b[1][order.field].getTime() : b[1][order.field]?.toMillis?.() ?? 0;
        return (left - right) * direction;
      });
    }
    const docs = entries
      .slice(0, this.count)
      .map(([path, data]) => ({ id: path.slice(prefix.length), data: () => structuredClone(data) }));
    return { docs };
  }
}
class FakeDocument {
  constructor(db, path) { this.db = db; this.path = path; }
  collection(name) { return new FakeCollection(this.db, `${this.path}/${name}`); }
  async get() {
    const value = this.db.data.get(this.path);
    return { exists: value !== undefined, data: () => value ? structuredClone(value) : undefined };
  }
}

const now = new Date('2026-11-15T05:00:00Z');
const stamp = () => new Date(now);

async function createQueuedJob(db, jobId = 'job-queue-1', uid = 'user-queue') {
  await reserveGenerationSlot(db, {
    uid,
    jobId,
    now,
    serverTimestamp: stamp,
    request: { title: 'Test scene', style: '3D Realistic', aspectRatio: '9:16', durationSeconds: 30 }
  });
}

test('new generation reservations enter the durable queue as queued', async () => {
  const db = new FakeFirestore();
  await createQueuedJob(db);
  const job = await db.collection('jobs').doc('job-queue-1').get();
  assert.equal(job.data().status, 'queued');
  assert.equal(job.data().attempts, 0);
  assert.equal(job.data().request.title, 'Test scene');
});

test('only one worker can own an unexpired lease', async () => {
  const db = new FakeFirestore();
  await createQueuedJob(db);
  const claimed = await claimGenerationJob(db, { jobId: 'job-queue-1', workerId: 'worker-a', now, leaseMs: 60_000, serverTimestamp: stamp });
  assert.equal(claimed.attempts, 1);
  await assert.rejects(
    claimGenerationJob(db, { jobId: 'job-queue-1', workerId: 'worker-b', now: new Date(now.getTime() + 1_000) }),
    (error) => error.code === 'JOB_LEASE_ACTIVE'
  );
});

test('only the owning worker can renew its lease', async () => {
  const db = new FakeFirestore();
  await createQueuedJob(db);
  await claimGenerationJob(db, { jobId: 'job-queue-1', workerId: 'worker-a', now, leaseMs: 60_000, serverTimestamp: stamp });
  await assert.rejects(
    renewGenerationLease(db, { jobId: 'job-queue-1', workerId: 'worker-b', now }),
    (error) => error.code === 'WORKER_OWNERSHIP_LOST'
  );
  const renewed = await renewGenerationLease(db, { jobId: 'job-queue-1', workerId: 'worker-a', now: new Date(now.getTime() + 10_000), leaseMs: 90_000, serverTimestamp: stamp });
  assert.equal(renewed.leaseExpiresAt.getTime(), now.getTime() + 100_000);
});

test('an expired worker lease can be reclaimed and increments attempts', async () => {
  const db = new FakeFirestore();
  await createQueuedJob(db);
  await claimGenerationJob(db, { jobId: 'job-queue-1', workerId: 'worker-a', now, leaseMs: 10_000, serverTimestamp: stamp });
  const recovered = await claimGenerationJob(db, { jobId: 'job-queue-1', workerId: 'worker-b', now: new Date(now.getTime() + 11_000), leaseMs: 60_000, serverTimestamp: stamp });
  assert.equal(recovered.workerId, 'worker-b');
  assert.equal(recovered.attempts, 2);
});

test('a worker whose lease was replaced cannot finish the job', async () => {
  const db = new FakeFirestore();
  await createQueuedJob(db);
  await claimGenerationJob(db, { jobId: 'job-queue-1', workerId: 'worker-old', now, leaseMs: 10_000, serverTimestamp: stamp });
  await claimGenerationJob(db, { jobId: 'job-queue-1', workerId: 'worker-new', now: new Date(now.getTime() + 11_000), leaseMs: 60_000, serverTimestamp: stamp });

  await assert.rejects(
    finishGeneration(db, { uid: 'user-queue', jobId: 'job-queue-1', workerId: 'worker-old', succeeded: true, now: new Date(now.getTime() + 12_000), serverTimestamp: stamp }),
    (error) => error.code === 'WORKER_OWNERSHIP_LOST'
  );
});

test('queue discovery returns queued jobs and only expired processing jobs', async () => {
  const db = new FakeFirestore();
  await createQueuedJob(db, 'job-queued', 'user-queued');
  await createQueuedJob(db, 'job-to-claim', 'user-processing');
  await claimGenerationJob(db, { jobId: 'job-to-claim', workerId: 'worker-a', now, leaseMs: 10_000, serverTimestamp: stamp });
  const ids = await getClaimableGenerationJobIds(db, { now: new Date(now.getTime() + 11_000), limit: 10 });
  assert.deepEqual(new Set(ids), new Set(['job-queued', 'job-to-claim']));
});

test('terminal completion releases worker lease metadata', async () => {
  const db = new FakeFirestore();
  await createQueuedJob(db);
  await claimGenerationJob(db, { jobId: 'job-queue-1', workerId: 'worker-a', now, serverTimestamp: stamp });
  await finishGeneration(db, { uid: 'user-queue', jobId: 'job-queue-1', workerId: 'worker-a', succeeded: true, now, serverTimestamp: stamp });
  const job = (await db.collection('jobs').doc('job-queue-1').get()).data();
  assert.equal(job.status, 'completed');
  assert.equal(job.workerId, null);
  assert.equal(job.leaseExpiresAt, null);
});
