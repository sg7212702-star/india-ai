# India AI — Public Google AI Starter

A mobile/computer responsive public starter using Google's Gemini API and Veo 3.1 from a server-side Node.js backend.

## Setup
1. Copy `.env.example` to `.env` locally, or add the variables in your hosting provider's Environment Variables.
2. Set `GEMINI_API_KEY` to your Google AI Studio API key. Never put the key in frontend code or GitHub.
3. Run `npm install` then `npm start`.
4. Open `http://localhost:3000`.

## Public deployment
- Build command: `npm install`
- Start command: `npm start`
- Node 20+
- Add `GEMINI_API_KEY`, `DAILY_TEXT_LIMIT`, `DAILY_IMAGE_LIMIT`, `DAILY_VIDEO_LIMIT` as server environment variables.

## Important
The daily limits in this starter are per IP and in-memory. For a larger public launch, add real authentication, persistent database credits, object storage, abuse controls, billing/spending limits, and a job queue. Generated files are stored on the server's local disk and may be lost on hosts with ephemeral storage.

Google Veo 3.1 generation is asynchronous and requires polling until the operation completes. The current implementation uses the official Google GenAI JavaScript SDK flow.
