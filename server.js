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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 3000);
const publicDir = path.join(__dirname, 'public');
const generatedDir = path.join(publicDir, 'generated');
await fs.mkdir(generatedDir, { recursive: true });

const geminiApiEnabled = process.env.ENABLE_GEMINI_API === 'true';
const paidVideoApiEnabled = process.env.ENABLE_PAID_VIDEO_API === 'true';

if (!process.env.GEMINI_API_KEY) console.warn('GEMINI_API_KEY is not set. Add it only if you explicitly enable a Google API.');
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(morgan('tiny'));
app.use(express.json({ limit: '2mb' }));
app.use(express.static(publicDir));

const daily = new Map();
const limits = {
  text: Number(process.env.DAILY_TEXT_LIMIT || 20),
  image: Number(process.env.DAILY_IMAGE_LIMIT || 3),
  video: Number(process.env.DAILY_VIDEO_LIMIT || 1)
};
const globalLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });
app.use('/api/', globalLimiter);

function identity(req) {
  return (req.headers['x-forwarded-for'] || req.ip || 'anonymous').toString().split(',')[0].trim();
}
function today() { return new Date().toISOString().slice(0, 10); }
function spend(ip, kind) {
  const key = `${ip}:${today()}`;
  const row = daily.get(key) || { text: 0, image: 0, video: 0 };
  if (row[kind] >= limits[kind]) return false;
  row[kind] += 1;
  daily.set(key, row);
  return true;
}
function requireKey(res) {
  if (!process.env.GEMINI_API_KEY) {
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

app.get('/api/health', (_req, res) => res.json({
  ok: true,
  name: 'AI Animation Studio',
  limits,
  features: {
    geminiApiEnabled,
    paidVideoApiEnabled,
    videoGenerationReady: false
  }
}));
app.get('/api/limits', (req, res) => {
  const row = daily.get(`${identity(req)}:${today()}`) || { text: 0, image: 0, video: 0 };
  res.json({ date: today(), limits, used: row, remaining: { text: Math.max(0, limits.text-row.text), image: Math.max(0, limits.image-row.image), video: Math.max(0, limits.video-row.video) } });
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

app.post('/api/video', async (req, res) => {
  if (!paidVideoApiEnabled) {
    return res.status(503).json({ error: 'Paid video generation is disabled by default. No Veo request was sent. Enable ENABLE_PAID_VIDEO_API=true only after explicitly accepting the provider cost.' });
  }
  if (!requireKey(res)) return;
  const prompt = String(req.body?.prompt || '').trim();
  const aspectRatio = req.body?.aspectRatio === '9:16' ? '9:16' : '16:9';
  if (!prompt || prompt.length > 6000) return res.status(400).json({ error: 'Enter a video prompt up to 6000 characters.' });
  if (!spend(identity(req), 'video')) return res.status(429).json({ error: 'Daily video limit reached.' });
  try {
    let operation = await ai.models.generateVideos({
      model: 'veo-3.1-generate-preview',
      prompt,
      config: { aspectRatio, numberOfVideos: 1, resolution: '720p' }
    });
    while (!operation.done) {
      await new Promise(r => setTimeout(r, 10000));
      operation = await ai.operations.getVideosOperation({ operation });
    }
    const video = operation.response?.generatedVideos?.[0]?.video;
    if (!video) throw new Error('Veo completed without a video result.');
    const filename = `${crypto.randomUUID()}.mp4`;
    const output = path.join(generatedDir, filename);
    await ai.files.download({ file: video, downloadPath: output });
    res.json({ url: `/generated/${filename}` });
  } catch (e) { res.status(500).json({ error: e?.message || 'Video generation failed.' }); }
});

app.get(/.*/, (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));
app.listen(port, () => console.log(`AI Animation Studio running on port ${port}`));
