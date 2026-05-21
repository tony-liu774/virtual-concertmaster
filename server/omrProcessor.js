/**
 * omrProcessor.js — Open-source OMR engine integration layer.
 *
 * Tries each engine in priority order and returns the first that succeeds.
 * The server never calls OpenAI — all processing is deterministic.
 *
 * Engine priority:
 *   1. Oemer CLI          (pip install oemer)
 *   2. Audiveris CLI      (brew install audiveris  OR  manual .jar install)
 *   3. Remote OMR service (any HTTP endpoint set via OMR_ENDPOINT env var)
 *
 * If none are available a detailed installation-guide error is returned.
 *
 * Environment variables (all optional, set in server/.env):
 *   OEMER_CLI       — command name or full path to oemer       (default: "oemer")
 *   AUDIVERIS_CLI   — command name or full path to audiveris   (default: "audiveris")
 *   OMR_ENDPOINT    — URL of a hosted OMR REST service
 *                     Expects POST { image: "<base64>", mediaType: "image/png" }
 *                     Returns     { musicXmlString: "<?xml …" }
 */

import { exec, execSync } from 'child_process';
import { promisify }      from 'util';
import fs                 from 'fs';
import path               from 'path';
import os                 from 'os';

const execAsync = promisify(exec);

// ── Command availability (cached per process lifetime) ─────────────────────

const _cmdCache = {};

function isCommandAvailable(cmd) {
  if (cmd in _cmdCache) return _cmdCache[cmd];
  try {
    const probe = process.platform === 'win32'
      ? `where "${cmd}"`
      : `which "${cmd}"`;
    execSync(probe, { stdio: 'ignore', timeout: 3000 });
    _cmdCache[cmd] = true;
  } catch {
    _cmdCache[cmd] = false;
  }
  return _cmdCache[cmd];
}

// ── Engine 1: Oemer ────────────────────────────────────────────────────────
// Install:  pip install oemer
// Docs:     https://github.com/BreezeWhite/oemer

async function runOemer(imagePath) {
  const cmd    = process.env.OEMER_CLI || 'oemer';
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc_oemer_'));

  try {
    await execAsync(`"${cmd}" "${imagePath}" --output-dir "${outDir}"`, {
      timeout: 180_000,   // 3 min — first run downloads model weights
    });

    const base    = path.basename(imagePath, path.extname(imagePath));
    const xmlPath = path.join(outDir, base + '.musicxml');

    if (!fs.existsSync(xmlPath)) {
      throw new Error(`Oemer did not produce ${xmlPath}. stderr may have details.`);
    }
    return fs.readFileSync(xmlPath, 'utf-8');
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}

// ── Engine 2: Audiveris ────────────────────────────────────────────────────
// Install:  brew install audiveris   OR   https://github.com/Audiveris/audiveris/releases
// Docs:     https://github.com/Audiveris/audiveris

async function runAudiveris(imagePath) {
  const cmd    = process.env.AUDIVERIS_CLI || 'audiveris';
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc_audiveris_'));
  const base   = path.basename(imagePath, path.extname(imagePath));

  try {
    await execAsync(
      `"${cmd}" -batch -export -output "${outDir}" "${imagePath}"`,
      { timeout: 300_000 },   // 5 min — JVM startup + heavy processing
    );

    // Audiveris creates outDir/<bookname>/<bookname>.xml  (or .mxl)
    const xmlPath = path.join(outDir, base, base + '.xml');
    const mxlPath = path.join(outDir, base, base + '.mxl');

    if (fs.existsSync(xmlPath)) {
      return fs.readFileSync(xmlPath, 'utf-8');
    }
    if (fs.existsSync(mxlPath)) {
      throw new Error(
        'Audiveris produced a compressed .mxl file. ' +
        'Add  -option org.audiveris.omr.sheet.BookManager.useCompression=false  to your Audiveris command, ' +
        'or set AUDIVERIS_CLI to a wrapper script that includes this flag.',
      );
    }
    throw new Error(`Audiveris output not found. Checked: ${xmlPath}`);
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}

// ── Engine 3: Remote OMR service ───────────────────────────────────────────
// Any HTTP service that accepts POST { image, mediaType } → { musicXmlString }
// Example Docker image: ghcr.io/audiveris/audiveris-api:latest

async function callRemoteEndpoint(base64, mediaType) {
  const endpoint = process.env.OMR_ENDPOINT;
  if (!endpoint) throw new Error('OMR_ENDPOINT not configured in server/.env');

  const response = await fetch(endpoint, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ image: base64, mediaType }),
    signal:  AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    throw new Error(`Remote OMR service returned HTTP ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();
  const xml  = data.musicXmlString ?? data.musicxml ?? data.xml;
  if (!xml) throw new Error('Remote OMR response is missing a musicXmlString field.');
  return xml;
}

// ── Installation guide ─────────────────────────────────────────────────────

function buildInstallError(engineErrors) {
  return (
    'No OMR engine is available on this system.\n\n' +
    'Install one of the following and restart the API server:\n\n' +
    '  • Oemer (Python, recommended for most scores)\n' +
    '      pip install oemer\n\n' +
    '  • Audiveris (Java, best for complex classical scores)\n' +
    '      brew install audiveris   (macOS)\n' +
    '      https://github.com/Audiveris/audiveris/releases\n\n' +
    '  • Remote service: set OMR_ENDPOINT in server/.env\n\n' +
    'Engine errors this run:\n' +
    engineErrors.map(e => `  – ${e}`).join('\n')
  );
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Returns which engines are currently detectable on this machine.
 * Used by the health endpoint so the UI can show engine status.
 */
export function getAvailableEngines() {
  return {
    oemer:      isCommandAvailable(process.env.OEMER_CLI     || 'oemer'),
    audiveris:  isCommandAvailable(process.env.AUDIVERIS_CLI || 'audiveris'),
    remote:     !!process.env.OMR_ENDPOINT,
  };
}

/**
 * Run the best available OMR engine on an image file.
 *
 * @param {object} opts
 * @param {string} opts.imagePath  Path to the temp image file on disk
 * @param {string} opts.base64     Raw base64 image (for remote fallback)
 * @param {string} opts.mediaType  MIME type (e.g. 'image/png')
 * @returns {Promise<{ success: true,  musicXmlString: string, engine: string }
 *                 | { success: false, error: string }>}
 */
export async function processOMR({ imagePath, base64, mediaType }) {
  const errors = [];
  const oemerCmd     = process.env.OEMER_CLI     || 'oemer';
  const audiverisCmd = process.env.AUDIVERIS_CLI || 'audiveris';

  // ── 1. Oemer ───────────────────────────────────────────────────
  if (isCommandAvailable(oemerCmd)) {
    try {
      console.log('[OMR] Trying Oemer…');
      const xml = await runOemer(imagePath);
      console.log('[OMR] Oemer succeeded.');
      return { success: true, musicXmlString: xml, engine: 'oemer' };
    } catch (err) {
      console.warn('[OMR] Oemer failed:', err.message);
      errors.push(`Oemer: ${err.message}`);
    }
  } else {
    errors.push('Oemer: command not found (pip install oemer)');
  }

  // ── 2. Audiveris ───────────────────────────────────────────────
  if (isCommandAvailable(audiverisCmd)) {
    try {
      console.log('[OMR] Trying Audiveris…');
      const xml = await runAudiveris(imagePath);
      console.log('[OMR] Audiveris succeeded.');
      return { success: true, musicXmlString: xml, engine: 'audiveris' };
    } catch (err) {
      console.warn('[OMR] Audiveris failed:', err.message);
      errors.push(`Audiveris: ${err.message}`);
    }
  } else {
    errors.push('Audiveris: command not found (brew install audiveris)');
  }

  // ── 3. Remote endpoint ─────────────────────────────────────────
  if (process.env.OMR_ENDPOINT) {
    try {
      console.log('[OMR] Trying remote endpoint:', process.env.OMR_ENDPOINT);
      const xml = await callRemoteEndpoint(base64, mediaType);
      console.log('[OMR] Remote endpoint succeeded.');
      return { success: true, musicXmlString: xml, engine: 'remote' };
    } catch (err) {
      console.warn('[OMR] Remote endpoint failed:', err.message);
      errors.push(`Remote (${process.env.OMR_ENDPOINT}): ${err.message}`);
    }
  }

  return { success: false, error: buildInstallError(errors) };
}
