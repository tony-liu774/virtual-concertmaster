/**
 * omrClient.js — Browser-side client for the local OMR API server.
 *
 * Sends a sheet-music image to the Express server (localhost:3001),
 * which runs it through an open-source OMR engine (Oemer / Audiveris).
 * The server returns a raw MusicXML string; this module parses it
 * client-side and builds the internal piece object.
 *
 * No OpenAI, no prompt engineering, no token streams.
 * All notation data comes from the OMR engine — deterministic and exact.
 *
 * Usage:
 *   import { checkServerHealth, scanSheetMusicImage } from './omrClient.js';
 */

import { parseMusicXml } from './musicXmlParser.js';

const SERVER_URL = 'http://localhost:3001';

// ── Server health check ───────────────────────────────────────────

/**
 * Ping the OMR server and return its health payload.
 * Returns { ok: false } if the server is not running.
 *
 * @returns {Promise<{ ok: boolean, engines?: object, anyAvailable?: boolean }>}
 */
export async function checkServerHealth() {
  try {
    const res = await fetch(`${SERVER_URL}/api/health`, {
      signal: AbortSignal.timeout(3000),
    });
    return await res.json();
  } catch {
    return { ok: false, engines: {}, anyAvailable: false };
  }
}

// ── Image → piece ─────────────────────────────────────────────────

/**
 * Send a sheet-music image to the OMR server, receive MusicXML,
 * parse it, and return a fully assembled piece object.
 *
 * @param {object} opts
 * @param {string} opts.base64     Raw base64 image (no data-URL prefix)
 * @param {string} opts.mediaType  'image/png' | 'image/jpeg' | 'image/webp'
 * @param {string} [opts.filename] Original filename (title fallback)
 * @returns {Promise<{ success: boolean, piece?: object, error?: string }>}
 */
export async function scanSheetMusicImage({ base64, mediaType, filename = '' }) {
  // ── 1. POST image to OMR server ───────────────────────────────
  let response;
  try {
    response = await fetch(`${SERVER_URL}/api/omr-scan`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ base64, mediaType, filename }),
      signal:  AbortSignal.timeout(300_000),   // 5 min — OMR can be slow
    });
  } catch (err) {
    const isOffline = err.name === 'TypeError' || err.name === 'AbortError';
    return {
      success: false,
      error: isOffline
        ? 'OMR server is not running. Start it with:  npm run dev:api\n\nMake sure Oemer is installed:  pip install oemer'
        : `Network error: ${err.message}`,
    };
  }

  // ── 2. Parse server response ──────────────────────────────────
  let data;
  try {
    data = await response.json();
  } catch {
    return { success: false, error: `Server returned non-JSON response (HTTP ${response.status}).` };
  }

  if (!data.success) {
    return { success: false, error: data.error ?? 'OMR processing failed.' };
  }

  const { musicXmlString, engine } = data;

  if (!musicXmlString || typeof musicXmlString !== 'string' || musicXmlString.length < 100) {
    return { success: false, error: 'Server returned an empty MusicXML document.' };
  }

  // ── 3. Parse MusicXML → metadata + note arrays (browser DOMParser) ──
  const parsed        = parseMusicXml(musicXmlString, 80);
  const titleFallback = filename
    ? filename.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ')
    : 'Scanned Score';

  // ── 4. Build piece object ─────────────────────────────────────
  return {
    success: true,
    piece: {
      id:             `upload_${Date.now()}`,
      title:          (parsed.title && parsed.title !== 'Untitled') ? parsed.title : titleFallback,
      composer:       parsed.composer     || 'Unknown',
      clef:           parsed.clef         || 'treble',
      keySignature:   parsed.keySignature || 'C',
      timeSignature:  parsed.timeSignature || '4/4',
      bpm:            parsed.bpm          || 80,
      instrument:     'all',
      difficulty:     'Beginner',
      isUploaded:     true,
      uploadedAt:     new Date().toISOString(),
      scannedBy:      engine,             // 'oemer' | 'audiveris' | 'remote'
      musicXmlString,                     // OSMD renders this directly
      measures:       parsed.measures,    // pitch-detection tick loop
    },
  };
}
