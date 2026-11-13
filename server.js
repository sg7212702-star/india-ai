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
  finishGeneration,
  getGenerationUsage,
  indiaDateKey,
  reserveGenerationSlot
} from './lib/generation-quota.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3000);
const publicDir = path.join(__dirname, 'public');
const generatedDir = path.join(publicDir, 'generated');
await fs.mkdir(generatedDir, { recursive: true });

const geminiApiEnabled = process.env.ENABLE_GEMINI_API === 'true';
const paidVideoApiEnabled = process.env.ENABLE_PAID_VIDEO_API === 'true';
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
    paidVideoApiEnabled,
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

app.post('/api/video', requireFirebaseUser, async (req, res) => {
  if (!paidVideoApiEnabled) {
    return res.status(503).json({ error: 'Paid video generation is disabled by default. No Veo request was sent.' });
  }
  if (!requireKey(res)) return;
  if (!firestore) return res.status(503).json({ error: 'Firestore Admin is required for per-user video limits.' });

  const prompt = String(req.body?.prompt || '').trim();
  const aspectRatio = req.body?.aspectRatio === '9:16' ? '9:16' : '16:9';
  if (!prompt || prompt.length > 6000) return res.status(400).json({ error: 'Enter a video prompt up to 6000 characters.' });

  const jobId = crypto.randomUUID();
  try {
    await reserveGenerationSlot(firestore, {
      uid: req.firebaseUser.uid,
      jobId,
      serverTimestamp: () => FieldValue.serverTimestamp()
    });
  } catch (error) {
    if (error.code === 'ACTIVE_JOB_EXISTS') return res.status(409).json({ error: error.message });
    if (error.code === 'DAILY_LIMIT_REACHED') return res.status(429).json({ error: error.message });
    console.error('Could not reserve generation quota:', error);
    return res.status(500).json({ error: 'Could not reserve a video generation slot.' });
  }

  try {
    let operation = await ai.models.generateVideos({
      model: 'veo-3.1-generate-preview',
      prompt,
      config: { aspectRatio, numberOfVideos: 1, resolution: '720p' }
    });
    while (!operation.done) {
      await new Promise((resolve) => setTimeout(resolve, 10000));
      operation = await ai.operations.getVideosOperation({ operation });
    }
    const video = operation.response?.generatedVideos?.[0]?.video;
    if (!video) throw new Error('Veo completed without a video result.');

    const filename = `${crypto.randomUUID()}.mp4`;
    const output = path.join(generatedDir, filename);
    await ai.files.download({ file: video, downloadPath: output });
    await finishGeneration(firestore, {
      uid: req.firebaseUser.uid,
      jobId,
      succeeded: true,
      serverTimestamp: () => FieldValue.serverTimestamp()
    });
    return res.json({ url: `/generated/${filename}`, jobId });
  } catch (error) {
    try {
      await finishGeneration(firestore, {
        uid: req.firebaseUser.uid,
        jobId,
        succeeded: false,
        failureCode: 'VIDEO_PROVIDER_ERROR',
        serverTimestamp: () => FieldValue.serverTimestamp()
      });
    } catch (quotaError) {
      console.error('Could not release failed generation reservation:', quotaError);
    }
    console.error('Video generation failed:', error);
    return res.status(500).json({ error: error?.message || 'Video generation failed.' });
  }
});

app.get(/.*/, (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));
app.listen(port, () => console.log(`AI Animation Studio running on port ${port}`));
