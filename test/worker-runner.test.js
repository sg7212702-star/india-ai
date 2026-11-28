import test from 'node:test';
import assert from 'node:assert/strict';
import { getGenerationJob } from '../lib/generation-queue.js';
import { getGenerationUsage, reserveGenerationSlot } from '../lib/generation-quota.js';
import { createGenerationWorker } from '../worker/runner.js';
import { createScenePlan } from '../lib/scene-planner.js';
import { createRenderManifest } from '../lib/render-manifest.js';

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
      if (write.type === 'create' && oldValue !== undefined) throw new Error('Document already exists.');
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
  where(field, operator, value) {
    return new FakeQuery(this.db, this.path, [{ field, operator, value }]);
  }
}

class FakeQuery {
  constructor(db, path, filters, count = 10, orders = []) {
    Object.assign(this, { db, path, filters, count, orders });
  }
  where(field, operator, value) {
    return new FakeQuery(this.db, this.path, [...this.filters, { field, operator, value }], this.count, this.orders);
  }
  orderBy(field, direction = 'asc') {
    return new FakeQuery(this.db, this.path, this.filters, this.count, [...this.orders, { field, direction }]);
  }
  limit(count) {
    return new FakeQuery(this.db, this.path, this.filters, count, this.orders);
  }
  async get() {
    const prefix = `${this.path}/`;
    const millis = (value) => value instanceof Date ? value.getTime() : value?.toMillis?.() ?? 0;
    const entries = [...this.db.data.entries()].filter(([path, data]) => {
      if (!path.startsWith(prefix) || path.slice(prefix.length).includes('/')) return false;
      return this.filters.every(({ field, operator, value }) => {
        if (operator === '==') return data[field] === value;
        if (operator === '<=') return millis(data[field]) > 0 && millis(data[field]) <= millis(value);
        return false;
      });
    });
    for (const order of [...this.orders].reverse()) {
      const direction = order.direction === 'desc' ? -1 : 1;
      entries.sort((a, b) => (millis(a[1][order.field]) - millis(b[1][order.field])) * direction);
    }
    return {
      docs: entries.slice(0, this.count).map(([path, data]) => ({
        id: path.slice(prefix.length),
        data: () => structuredClone(data)
      }))
    };
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

const fixedNow = new Date('2026-11-17T05:00:00Z');
const timestamp = () => new Date(fixedNow);
const quietLogger = { info() {}, warn() {}, error() {} };

function readyRenderManifest() {
  const request = {
    title: 'Worker test',
    mode: 'story',
    story: 'दादाजी सुबह गाँव के पुराने मंदिर की ओर जाते हैं। रास्ते में उन्हें एक घायल सफेद कबूतर दिखाई देता है। वे उसे पानी पिलाते हैं और मंदिर की ओर सुरक्षित लेकर चलते हैं। मंदिर की घंटियाँ बजती हैं और आकाश में दिव्य प्रकाश फैलता है। दादाजी आश्चर्य से ऊपर देखते हैं।',
    style: '3D Realistic',
    aspectRatio: '9:16',
    durationSeconds: 30,
    voiceDirection: 'Warm Hindi storyteller',
    music: 'Cinematic score',
    lipSync: true,
    characterContinuity: true
  };
  return createRenderManifest({
    request,
    scenePlan: createScenePlan(request),
    capabilities: {
      motionVideo: true,
      hindiTts: true,
      lipSync: true,
      backgroundMusic: true,
      characterConsistency: true,
      privateStorage: true,
      ffmpeg: true
    },
    now: () => new Date(fixedNow)
  });
}

async function addJob(db, jobId = 'job-worker-1', uid = 'user-worker', requestOverrides = {}) {
  await reserveGenerationSlot(db, {
    uid,
    jobId,
    now: fixedNow,
    serverTimestamp: timestamp,
    request: {
      title: 'Worker test',
      style: '3D Realistic',
      aspectRatio: '9:16',
      durationSeconds: 30,
      renderManifest: readyRenderManifest(),
      ...requestOverrides
    }
  });
}

function validOutput(uid = 'user-worker', jobId = 'job-worker-1') {
  return {
    assetId: 'asset-worker-1',
    storagePath: `users/${uid}/jobs/${jobId}/final.mp4`,
    mimeType: 'video/mp4',
    durationSeconds: 30,
    width: 576,
    height: 1024,
    sizeBytes: 123456,
    aspectRatio: '9:16'
  };
}

test('worker completes a real MP4 artifact and hides its private storage path from status API', async () => {
  const db = new FakeFirestore();
  await addJob(db);
  const worker = createGenerationWorker({
    db,
    adapter: {
      available: true,
      async generate({ uid, jobId, renderManifest }) {
        assert.equal(renderManifest.contract, 'ai-animation-render-manifest');
        assert.equal(renderManifest.workerHandoff.readyForRender, true);
        return { output: validOutput(uid, jobId) };
      },
      async verifyOutput() { return true; }
    },
    workerId: 'worker-test',
    leaseMs: 60_000,
    now: () => new Date(fixedNow),
    logger: quietLogger
  });

  assert.equal(await worker.runOnce(), true);
  const stored = (await db.collection('jobs').doc('job-worker-1').get()).data();
  assert.equal(stored.status, 'completed');
  assert.equal('storagePath' in stored.output, false);

  const visible = await getGenerationJob(db, { uid: 'user-worker', jobId: 'job-worker-1' });
  assert.equal(visible.output.assetId, 'asset-worker-1');
  assert.equal(visible.output.mimeType, 'video/mp4');
  assert.equal('storagePath' in visible.output, false);

  const usage = await getGenerationUsage(db, 'user-worker', { now: fixedNow });
  assert.equal(usage.activeJobId, null);
  assert.equal(usage.used, 1);
});

test('worker rejects a missing render manifest before calling the video adapter and refunds quota', async () => {
  const db = new FakeFirestore();
  await addJob(db, 'job-no-manifest', 'user-worker', { renderManifest: null });
  let providerCalled = false;
  const worker = createGenerationWorker({
    db,
    adapter: {
      available: true,
      async generate() {
        providerCalled = true;
        return { output: validOutput('user-worker', 'job-no-manifest') };
      },
      async verifyOutput() { return true; }
    },
    workerId: 'worker-test',
    leaseMs: 60_000,
    now: () => new Date(fixedNow),
    logger: quietLogger
  });

  await worker.runOnce();
  const job = (await db.collection('jobs').doc('job-no-manifest').get()).data();
  assert.equal(providerCalled, false);
  assert.equal(job.status, 'failed');
  assert.equal(job.failureCode, 'RENDER_MANIFEST_MISSING');
  const usage = await getGenerationUsage(db, 'user-worker', { now: fixedNow });
  assert.equal(usage.used, 0);
  assert.equal(usage.activeJobId, null);
});

test('worker rejects a planning-only manifest before provider execution', async () => {
  const db = new FakeFirestore();
  const blocked = createRenderManifest({
    request: {
      title: 'Blocked worker test',
      mode: 'story',
      story: 'दादाजी मंदिर जाते हैं।',
      style: '3D Realistic',
      aspectRatio: '9:16',
      durationSeconds: 300,
      music: 'Cinematic score'
    },
    scenePlan: createScenePlan({
      title: 'Blocked worker test',
      mode: 'story',
      story: 'दादाजी मंदिर जाते हैं।',
      style: '3D Realistic',
      aspectRatio: '9:16',
      durationSeconds: 300
    })
  });
  await addJob(db, 'job-blocked-manifest', 'user-worker', { renderManifest: blocked });
  let providerCalled = false;
  const worker = createGenerationWorker({
    db,
    adapter: {
      available: true,
      async generate() {
        providerCalled = true;
        return { output: validOutput('user-worker', 'job-blocked-manifest') };
      },
      async verifyOutput() { return true; }
    },
    workerId: 'worker-test',
    leaseMs: 60_000,
    now: () => new Date(fixedNow),
    logger: quietLogger
  });

  await worker.runOnce();
  const job = (await db.collection('jobs').doc('job-blocked-manifest').get()).data();
  assert.equal(providerCalled, false);
  assert.equal(job.status, 'failed');
  assert.equal(job.failureCode, 'RENDER_MANIFEST_NOT_READY');
  const usage = await getGenerationUsage(db, 'user-worker', { now: fixedNow });
  assert.equal(usage.used, 0);
});

test('worker refuses to start without an available video adapter and leaves jobs untouched', async () => {
  const db = new FakeFirestore();
  await addJob(db);
  assert.throws(() => createGenerationWorker({
    db,
    adapter: { available: false, async generate() {} },
    workerId: 'worker-test'
  }), /working video adapter/);

  const job = (await db.collection('jobs').doc('job-worker-1').get()).data();
  assert.equal(job.status, 'queued');
  const usage = await getGenerationUsage(db, 'user-worker', { now: fixedNow });
  assert.equal(usage.used, 1);
  assert.equal(usage.activeJobId, 'job-worker-1');
});

test('retryable provider errors leave the lease for recovery without refunding early', async () => {
  const db = new FakeFirestore();
  await addJob(db);
  const worker = createGenerationWorker({
    db,
    adapter: {
      available: true,
      async generate() {
        throw Object.assign(new Error('Temporary provider outage.'), {
          code: 'UPSTREAM_TIMEOUT',
          retryable: true
        });
      },
      async verifyOutput() { return true; }
    },
    workerId: 'worker-test',
    leaseMs: 60_000,
    now: () => new Date(fixedNow),
    logger: quietLogger
  });

  await worker.runOnce();
  const job = (await db.collection('jobs').doc('job-worker-1').get()).data();
  assert.equal(job.status, 'processing');
  const usage = await getGenerationUsage(db, 'user-worker', { now: fixedNow });
  assert.equal(usage.used, 1);
  assert.equal(usage.activeJobId, 'job-worker-1');
});

test('invalid MP4 output fails the job and refunds the reserved quota', async () => {
  const db = new FakeFirestore();
  await addJob(db);
  const worker = createGenerationWorker({
    db,
    adapter: {
      available: true,
      async generate({ uid, jobId }) {
        return { output: { ...validOutput(uid, jobId), mimeType: 'image/png' } };
      },
      async verifyOutput() { return true; }
    },
    workerId: 'worker-test',
    leaseMs: 60_000,
    now: () => new Date(fixedNow),
    logger: quietLogger
  });

  await worker.runOnce();
  const job = (await db.collection('jobs').doc('job-worker-1').get()).data();
  assert.equal(job.status, 'failed');
  assert.equal(job.failureCode, 'INVALID_OUTPUT');
  const usage = await getGenerationUsage(db, 'user-worker', { now: fixedNow });
  assert.equal(usage.used, 0);
  assert.equal(usage.activeJobId, null);
});
