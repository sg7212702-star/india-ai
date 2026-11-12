import test from 'node:test';
import assert from 'node:assert/strict';
import {
  finishGeneration,
  getGenerationUsage,
  indiaDateKey,
  reserveGenerationSlot
} from '../lib/generation-quota.js';

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
}
class FakeDocument {
  constructor(db, path) { this.db = db; this.path = path; }
  collection(name) { return new FakeCollection(this.db, `${this.path}/${name}`); }
  async get() {
    const value = this.db.data.get(this.path);
    return { exists: value !== undefined, data: () => value ? structuredClone(value) : undefined };
  }
}

const fixedNow = new Date('2026-11-12T10:00:00+05:30');
const timestamp = () => 'SERVER_TIMESTAMP';

test('uses the India calendar date for quota reset', () => {
  assert.equal(indiaDateKey(new Date('2026-11-12T18:45:00Z')), '2026-11-13');
});

test('reserves one slot and blocks a second simultaneous job', async () => {
  const db = new FakeFirestore();
  const first = await reserveGenerationSlot(db, { uid: 'user-1', jobId: 'job-1', now: fixedNow, serverTimestamp: timestamp });
  assert.equal(first.used, 1);
  await assert.rejects(
    reserveGenerationSlot(db, { uid: 'user-1', jobId: 'job-2', now: fixedNow, serverTimestamp: timestamp }),
    (error) => error.code === 'ACTIVE_JOB_EXISTS'
  );
  const usage = await getGenerationUsage(db, 'user-1', { now: fixedNow });
  assert.equal(usage.used, 1);
  assert.equal(usage.activeJobId, 'job-1');
  assert.equal(usage.canStart, false);
});

test('refunds a failed generation once and clears the active lock', async () => {
  const db = new FakeFirestore();
  await reserveGenerationSlot(db, { uid: 'user-2', jobId: 'job-fail', now: fixedNow, serverTimestamp: timestamp });
  assert.equal(await finishGeneration(db, { uid: 'user-2', jobId: 'job-fail', succeeded: false, now: fixedNow, serverTimestamp: timestamp, failureCode: 'PROVIDER_ERROR' }), true);
  assert.equal(await finishGeneration(db, { uid: 'user-2', jobId: 'job-fail', succeeded: false, now: fixedNow, serverTimestamp: timestamp }), false);
  const usage = await getGenerationUsage(db, 'user-2', { now: fixedNow });
  assert.equal(usage.used, 0);
  assert.equal(usage.activeJobId, null);
  assert.equal(usage.canStart, true);
});

test('keeps successful generations counted and enforces two per India day', async () => {
  const db = new FakeFirestore();
  for (const jobId of ['job-a', 'job-b']) {
    await reserveGenerationSlot(db, { uid: 'user-3', jobId, now: fixedNow, serverTimestamp: timestamp });
    await finishGeneration(db, { uid: 'user-3', jobId, succeeded: true, now: fixedNow, serverTimestamp: timestamp });
  }
  const usage = await getGenerationUsage(db, 'user-3', { now: fixedNow });
  assert.equal(usage.used, 2);
  assert.equal(usage.remaining, 0);
  assert.equal(usage.canStart, false);
  await assert.rejects(
    reserveGenerationSlot(db, { uid: 'user-3', jobId: 'job-c', now: fixedNow, serverTimestamp: timestamp }),
    (error) => error.code === 'DAILY_LIMIT_REACHED'
  );
});
