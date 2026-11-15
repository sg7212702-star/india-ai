import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { GoogleGenAI } from '@google/genai';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { applicationDefault, cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import {
  getGenerationUsage,
  indiaDateKey,
  reserveGenerationSlot
} from './lib/generation-quota.js';
import { getGenerationJob } from './lib/generation-queue.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3000);
const publicDir = path.join(__dirname, 'public');
const generatedDir = path.join(publicDir, 'generated');
await fs.mkdir(generatedDir, { recursive: true });

const geminiApiEnabled = process.env.ENABLE_GEMINI_API === 'true';
const generationQueueEnabled = process.env.GENERATION_QUEUE_ENABLED === 'true';
const ai = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;

function initializeFirebaseAdmin() {
  const existing = getApps()[0];
  if (existing) return existing;

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

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.K_SERVICE) {
    return initializeApp({
      credential: applicationDefault(),
      ...(process.env.FIREBASE_PROJECT_ID ? { projectId: process.env.FIREBASE_PROJECT_ID } : {})
    });
  }

  return null;
}

const firebaseApp = initializeFirebaseAdmin();
const firebaseAuth = firebaseApp ? getAuth(firebaseApp) : null;
const firestore = firebaseApp ? getFirestore(firebaseApp) : null;

app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: {
    directives: {
      "script-src": ["'self'", "https://www.gstatic.com"],
      "connect-src": [
        "'self'",
        "https://identitytoolkit.googleapis.com",
        "https://securetoken.googleapis.com",
        "https://www.googleapis.com",
        "https://firebaseinstallations.googleapis.com"
      ],
      "frame-src": ["'self'", "https://*.firebaseapp.com"]
    }
  }
}));
app.use(morgan('tiny'));
app.use(express.json({ limit: '2mb' }));
app.use(express.static(publicDir));

const daily = new Map();
const limits = {
  text: Number(process.env.DAILY_TEXT_LIMIT || 20),
  image: Number(process.env.DAILY_IMAGE_LIMIT || 3),
  video: 2
};
const globalLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });
app.use('/api/', globalLimiter);

function identity(req) {
  return (req.ip || 'anonymous').toString();
}
function today() {
  return indiaDateKey();
}
function spend(ip, kind) {
  const key = `${ip}:${today()}`;
  const row = daily.get(key) || { text: 0, image: 0 };
  if (row[kind] >= limits[kind]) return false;
  row[kind] += 1;
  daily.set(key, row);
  return true;
}
function requireKey(res) {
  if (!ai) {
    res.status(500).json({ error: 'GEMINI_API_KEY is not configured on the server.' });
    return false;
  }
  return true;
}
function requireGeminiEnabled(res) {
  if (!geminiApiEnabled) {
    res.status(503).json({ error: 'Gemini API routes are disabled by default. Set ENABLE_GEMINI_API=true only after reviewing API costs and limits.' });
    return false;
  }
  return requireKey(res);
}
async function requireFirebaseUser(req, res, next) {
  if (!firebaseAuth) {
    return res.status(503).json({
      error: 'Firebase Admin is not configured. Set FIREBASE_SERVICE_ACCOUNT_JSON or configure Google Application Default Credentials.'
    });
  }
  const authorization = req.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return res.status(401).json({ error: 'Sign in first and send a Firebase ID token.' });
  try {
    req.firebaseUser = await firebaseAuth.verifyIdToken(match[1], true);
    return next();
  } catch {
    return res.status(401).json({ error: 'Your sign-in token is invalid or expired. Sign in again.' });
  }
}

app.get('/api/config', (_req, res) => {
  const firebase = {
    apiKey: process.env.FIREBASE_WEB_API_KEY || '',
    authDomain: process.env.FIREBASE_AUTH_DOMAIN || '',
    projectId: process.env.FIREBASE_PROJECT_ID || '',
    appId: process.env.FIREBASE_WEB_APP_ID || ''
  };
  const ready = Object.values(firebase).every(Boolean);
  res.set('Cache-Control', 'no-store');
  res.json({ firebase: ready ? firebase : null, firebaseWebConfigured: ready });
});

app.get('/api/health', (_req, res) => res.json({
  ok: true,
  name: 'AI Animation Studio',
  limits: { videoPerUserPerIndiaDay: limits.video, maxActiveVideoJobsPerUser: 1 },
  features: {
    geminiApiEnabled,
    generationQueueEnabled,
    firebaseAdminConfigured: Boolean(firebaseApp),
    videoGenerationReady: false
  }
}));

app.get('/api/limits', (req, res) => {
  const row = daily.get(`${identity(req)}:${today()}`) || { text: 0, image: 0 };
  res.json({
    date: today(),
    limits: { text: limits.text, image: limits.image },
    used: row,
    remaining: {
      text: Math.max(0, limits.text - row.text),
      image: Math.max(0, limits.image - row.image)
    }
  });
});

app.get('/api/auth/me', requireFirebaseUser, (req, res) => {
  res.json({
    uid: req.firebaseUser.uid,
    email: req.firebaseUser.email || null,
    emailVerified: req.firebaseUser.email_verified === true,
    admin: req.firebaseUser.admin === true
  });
});

app.get('/api/generation/quota', requireFirebaseUser, async (req, res) => {
  if (!firestore) return res.status(503).json({ error: 'Firestore Admin is not configured.' });
  try {
    const usage = await getGenerationUsage(firestore, req.firebaseUser.uid);
    res.json(usage);
  } catch (error) {
    console.error('Could not read generation quota:', error);
    res.status(500).json({ error: 'Could not read your generation quota.' });
  }
});

app.post('/api/text', async (req, res) => {
  if (!requireGeminiEnabled(res)) return;
  const prompt = String(req.body?.prompt || '').trim();
  if (!prompt || prompt.length > 8000) return res.status(400).json({ error: 'Enter a prompt up to 8000 characters.' });
  if (!spend(identity(req), 'text')) return res.status(429).json({ error: 'Daily text limit reached.' });
  try {
    const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt });
    res.json({ text: response.text || '' });
  } catch (e) { res.status(500).json({ error: e?.message || 'Text generation failed.' }); }
});

app.post('/api/image', async (req, res) => {
  if (!requireGeminiEnabled(res)) return;
  const prompt = String(req.body?.prompt || '').trim();
  if (!prompt || prompt.length > 5000) return res.status(400).json({ error: 'Enter an image prompt up to 5000 characters.' });
  if (!spend(identity(req), 'image')) return res.status(429).json({ error: 'Daily image limit reached.' });
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-image-preview',
      contents: prompt,
      config: { responseModalities: ['TEXT', 'IMAGE'] }
    });
    const parts = response.candidates?.[0]?.content?.parts || [];
    const imagePart = parts.find(p => p.inlineData?.data);
    if (!imagePart) return res.status(502).json({ error: 'The model did not return an image.' });
    const mime = imagePart.inlineData.mimeType || 'image/png';
    const ext = mime.includes('jpeg') ? 'jpg' : 'png';
    const filename = `${crypto.randomUUID()}.${ext}`;
    await fs.writeFile(path.join(generatedDir, filename), Buffer.from(imagePart.inlineData.data, 'base64'));
    res.json({ url: `/generated/${filename}` });
  } catch (e) { res.status(500).json({ error: e?.message || 'Image generation failed.' }); }
});

function normalizeGenerationRequest(body = {}) {
  const prompt = String(body.prompt || '').trim();
  const story = String(body.story || '').trim();
  const mode = ['prompt', 'story', 'photo-story'].includes(body.mode) ? body.mode : (story ? 'story' : 'prompt');
  const title = String(body.title || 'Untitled animation').trim().slice(0, 80);
  const style = body.style === '2D Animation' ? '2D Animation' : '3D Realistic';
  const aspectRatio = body.aspectRatio === '16:9' ? '16:9' : '9:16';
  const durationSeconds = Number(body.durationSeconds || 30);
  const allowedDurations = new Set([30, 60, 120, 180, 300]);

  if (mode === 'prompt' && !prompt) throw Object.assign(new Error('Enter a video prompt.'), { status: 400 });
  if (mode === 'story' && !story) throw Object.assign(new Error('Enter a story or script.'), { status: 400 });
  if (mode === 'photo-story') {
    throw Object.assign(new Error('Photo + story generation is not available until private image storage is connected.'), { status: 503 });
  }
  if (prompt.length > 6000 || story.length > 12000) {
    throw Object.assign(new Error('Prompt or story is longer than the allowed limit.'), { status: 400 });
  }
  if (!allowedDurations.has(durationSeconds)) {
    throw Object.assign(new Error('Choose a supported duration: 30, 60, 120, 180 or 300 seconds.'), { status: 400 });
  }

  return {
    title,
    mode,
    prompt,
    story,
    style,
    aspectRatio,
    durationSeconds,
    voiceDirection: String(body.voiceDirection || 'Deep, warm Hindi storyteller').slice(0, 120),
    music: String(body.music || 'Cinematic background score').slice(0, 120),
    lipSync: body.lipSync !== false,
    characterContinuity: body.characterContinuity !== false
  };
}

app.post('/api/generation/jobs', requireFirebaseUser, async (req, res) => {
  if (!generationQueueEnabled) {
    return res.status(503).json({
      error: 'Generation queue is not accepting jobs yet. The durable worker must be deployed and tested first.'
    });
  }
  if (!firestore) return res.status(503).json({ error: 'Firestore Admin is required for generation jobs.' });

  let request;
  try {
    request = normalizeGenerationRequest(req.body);
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message });
  }

  const jobId = crypto.randomUUID();
  try {
    const reservation = await reserveGenerationSlot(firestore, {
      uid: req.firebaseUser.uid,
      jobId,
      request,
      serverTimestamp: () => FieldValue.serverTimestamp()
    });
    return res.status(202).json({
      jobId,
      status: 'queued',
      quota: reservation,
      message: 'Your project brief is queued. No video is generated until a compatible worker is online.'
    });
  } catch (error) {
    if (error.code === 'ACTIVE_JOB_EXISTS') return res.status(409).json({ error: error.message });
    if (error.code === 'DAILY_LIMIT_REACHED') return res.status(429).json({ error: error.message });
    console.error('Could not enqueue generation job:', error);
    return res.status(500).json({ error: 'Could not add your project to the generation queue.' });
  }
});

app.get('/api/generation/jobs/:jobId', requireFirebaseUser, async (req, res) => {
  if (!firestore) return res.status(503).json({ error: 'Firestore Admin is not configured.' });
  try {
    const job = await getGenerationJob(firestore, {
      uid: req.firebaseUser.uid,
      jobId: req.params.jobId
    });
    return res.json(job);
  } catch (error) {
    if (error.code === 'JOB_NOT_FOUND') return res.status(404).json({ error: 'Generation job was not found.' });
    console.error('Could not read generation job:', error);
    return res.status(500).json({ error: 'Could not read generation job status.' });
  }
});

// The old synchronous Veo endpoint is deliberately retired. All future renders
// must use the durable queue and an explicitly configured worker.
app.post('/api/video', (_req, res) => res.status(410).json({
  error: 'The synchronous video endpoint has been retired. Use /api/generation/jobs after the queue worker is deployed.'
}));

app.get(/.*/, (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));
app.listen(port, () => console.log(`AI Animation Studio running on port ${port}`));
