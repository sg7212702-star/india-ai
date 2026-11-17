import 'dotenv/config';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  applicationDefault,
  cert,
  getApps,
  initializeApp
} from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createGenerationWorker } from './runner.js';

function initializeFirebase() {
  if (getApps().length) return getApps()[0];

  const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (rawServiceAccount) {
    const serviceAccount = JSON.parse(rawServiceAccount);
    if (serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }
    return initializeApp({
      credential: cert(serviceAccount),
      projectId: process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id
    });
  }

  return initializeApp({
    credential: applicationDefault(),
    ...(process.env.FIREBASE_PROJECT_ID ? { projectId: process.env.FIREBASE_PROJECT_ID } : {})
  });
}

async function loadVideoAdapter() {
  const modulePath = process.env.VIDEO_ADAPTER_MODULE;
  if (!modulePath) {
    throw new Error('VIDEO_ADAPTER_MODULE is not configured. The worker will not claim or consume jobs.');
  }

  const absolutePath = path.resolve(process.cwd(), modulePath);
  const adapterModule = await import(pathToFileURL(absolutePath).href);
  if (typeof adapterModule.createVideoAdapter !== 'function') {
    throw new Error('The configured adapter module must export createVideoAdapter({ env }).');
  }

  const adapter = await adapterModule.createVideoAdapter({ env: process.env });
  if (!adapter || adapter.available !== true
    || typeof adapter.generate !== 'function'
    || typeof adapter.verifyOutput !== 'function') {
    throw new Error('The configured video adapter must be available and implement generate() plus verifyOutput(). The worker will not start.');
  }
  return adapter;
}

const adapter = await loadVideoAdapter();
const firebaseApp = initializeFirebase();
const db = getFirestore(firebaseApp);
const worker = createGenerationWorker({
  db,
  adapter,
  workerId: process.env.WORKER_ID || `${os.hostname()}-${process.pid}`,
  leaseMs: Number(process.env.WORKER_LEASE_MS || 120_000),
  pollIntervalMs: Number(process.env.WORKER_POLL_INTERVAL_MS || 5_000),
  maxAttempts: Number(process.env.WORKER_MAX_ATTEMPTS || 3),
  batchSize: Number(process.env.WORKER_BATCH_SIZE || 10)
});

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info('Generation worker shutdown requested.');
  worker.stop();
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

console.info('AI Animation Studio worker started. A compatible adapter is configured.');
await worker.start();
console.info('AI Animation Studio worker stopped.');
