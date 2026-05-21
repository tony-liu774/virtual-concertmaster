/**
 * ──────────────────────────────────────────────────────────────────
 *  server/index.js  —  Virtual Concertmaster OMR API server
 *
 *  POST /api/omr-scan   →  image → open-source OMR engine → MusicXML
 *  GET  /api/health     →  liveness + engine availability check
 *
 *  Run alongside Vite:
 *    npm run dev:full     (concurrently starts both)
 *    npm run dev:api      (API server only)
 *
 *  Optional env vars (set in server/.env):
 *    OEMER_CLI       — path/name of the oemer command   (default: "oemer")
 *    AUDIVERIS_CLI   — path/name of audiveris command   (default: "audiveris")
 *    OMR_ENDPOINT    — URL of a hosted remote OMR service
 *    API_PORT        — override the default port 3001
 * ──────────────────────────────────────────────────────────────────
 */

import 'dotenv/config';
import express                             from 'express';
import fs                                  from 'fs';
import path                                from 'path';
import os                                  from 'os';
import { processOMR, getAvailableEngines } from './omrProcessor.js';

const PORT = process.env.API_PORT ?? 3001;
const app  = express();

app.use(express.json({ limit: '25mb' }));

// ── CORS (allow Vite dev server + Tauri webview) ──────────────────
app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});
app.options('*', (_req, res) => res.sendStatus(204));

// ── GET /api/health ───────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  const engines      = getAvailableEngines();
  const anyAvailable = engines.oemer || engines.audiveris || engines.remote;
  res.json({ ok: true, engines, anyAvailable, version: '3.0.0' });
});

// ── POST /api/omr-scan ────────────────────────────────────────────
//
//  Body (JSON):
//    base64     {string}  Raw base64-encoded image (no data-URL prefix)
//    mediaType  {string}  'image/png' | 'image/jpeg' | 'image/webp'
//    filename   {string}  Original filename (optional, used for logging)
//
//  Response (JSON):
//    { success: true,  musicXmlString: string, engine: string }
//    { success: false, error: string }

app.post('/api/omr-scan', async (req, res) => {
  const { base64, mediaType, filename } = req.body ?? {};

  // ── Validate ────────────────────────────────────────────────
  if (!base64 || typeof base64 !== 'string' || base64.length < 100) {
    return res.status(400).json({ success: false, error: 'Missing or empty base64 image data.' });
  }
  const ALLOWED = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  if (!ALLOWED.includes(mediaType)) {
    return res.status(400).json({
      success: false,
      error: `Unsupported type "${mediaType}". Upload a PNG, JPG, or WebP image.`,
    });
  }

  // ── Write temp file ─────────────────────────────────────────
  const ext     = mediaType.split('/')[1].replace('jpeg', 'jpg');
  const tmpPath = path.join(os.tmpdir(), `vc_omr_${Date.now()}.${ext}`);
  try {
    fs.writeFileSync(tmpPath, Buffer.from(base64, 'base64'));
  } catch (err) {
    return res.status(500).json({ success: false, error: `Failed to write temp file: ${err.message}` });
  }

  const kb = (base64.length * 0.75 / 1024).toFixed(0);
  console.log(`[/api/omr-scan] Processing "${filename ?? 'image'}" (${kb} KB)…`);

  // ── Run OMR engine ──────────────────────────────────────────
  let result;
  try {
    result = await processOMR({ imagePath: tmpPath, base64, mediaType });
  } catch (err) {
    console.error('[/api/omr-scan] Unexpected error:', err);
    return res.status(500).json({ success: false, error: `Internal server error: ${err.message}` });
  } finally {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
  }

  if (!result.success) {
    console.warn('[/api/omr-scan] All engines failed.');
    return res.status(422).json(result);
  }

  console.log(`[/api/omr-scan] ✓ ${result.engine} — ${result.musicXmlString.length} chars`);
  return res.status(200).json({
    success:        true,
    musicXmlString: result.musicXmlString,
    engine:         result.engine,
  });
});

// ── Start ─────────────────────────────────────────────────────────
app.listen(PORT, () => {
  const engines = getAvailableEngines();
  const found   = Object.entries(engines).filter(([, v]) => v).map(([k]) => k);
  console.log(`[VC OMR Server] http://localhost:${PORT}`);
  console.log(`[VC OMR Server] Engines: ${found.length ? found.join(', ') : 'none — install oemer (pip install oemer)'}`);
});
