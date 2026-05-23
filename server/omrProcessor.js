/**
 * omrProcessor.js — Open-source OMR engine integration layer.
 *
 * Tries each engine in priority order and returns the first that succeeds.
 * The server never calls OpenAI — all processing is deterministic.
 *
 * Engine priority:
 *   1. Audiveris CLI/app  (https://github.com/Audiveris/audiveris/releases)
 *   2. Oemer CLI          (pip install oemer)
 *   3. Remote OMR service (any HTTP endpoint set via OMR_ENDPOINT env var)
 *
 * If none can produce a reliable result, a scan-guidance error is returned.
 *
 * Environment variables (all optional, set in server/.env):
 *   OEMER_CLI            — command name or full path to oemer       (default: "oemer")
 *   OEMER_ARGS           — optional extra oemer CLI args
 *   OEMER_TIMEOUT_MS     — max time for one Oemer attempt           (default: 90000)
 *   AUDIVERIS_CLI        — command name or full path to Audiveris
 *                          (auto-detects common macOS app locations)
 *   AUDIVERIS_TIMEOUT_MS — max time for one Audiveris attempt       (default: 120000)
 *   OMR_ENDPOINT         — URL of a hosted OMR REST service
 *                          Expects POST { image: "<base64>", mediaType: "image/png" }
 *                          Returns     { musicXmlString: "<?xml …" }
 */

import { execFile, execSync } from 'child_process';
import { promisify }      from 'util';
import fs                 from 'fs';
import path               from 'path';
import os                 from 'os';
import JSZip              from 'jszip';
import { makeOmrImageVariants, cleanupOmrImageVariants } from './imagePreprocessor.js';

const execFileAsync = promisify(execFile);
const DEFAULT_OEMER_TIMEOUT_MS = 90_000;
const DEFAULT_AUDIVERIS_TIMEOUT_MS = 120_000;

// ── Command availability (cached per process lifetime) ─────────────────────

const _cmdCache = {};

function isCommandAvailable(cmd) {
  if (cmd in _cmdCache) return _cmdCache[cmd];

  if (cmd.includes(path.sep)) {
    try {
      fs.accessSync(cmd, fs.constants.X_OK);
      _cmdCache[cmd] = true;
    } catch {
      _cmdCache[cmd] = false;
    }
    return _cmdCache[cmd];
  }

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

function firstAvailableCommand(commands) {
  return commands.find(cmd => cmd && isCommandAvailable(cmd)) ?? '';
}

function resolveAudiverisCommand() {
  return firstAvailableCommand([
    process.env.AUDIVERIS_CLI,
    'audiveris',
    path.join(os.homedir(), 'Applications/Audiveris.app/Contents/MacOS/Audiveris'),
    '/Applications/Audiveris.app/Contents/MacOS/Audiveris',
  ]);
}

// ── Engine 1: Oemer ────────────────────────────────────────────────────────
// Install:  pip install oemer
// Docs:     https://github.com/BreezeWhite/oemer

function mxlRootPath(containerXml) {
  const match = containerXml.match(/<rootfile\b[^>]*\bfull-path=["']([^"']+)["']/i);
  return match?.[1]?.replace(/^\/+/, '') ?? '';
}

async function readMxlMusicXml(mxlPath) {
  const zip = await JSZip.loadAsync(fs.readFileSync(mxlPath));
  const container = zip.file('META-INF/container.xml');
  const rootPath = container ? mxlRootPath(await container.async('text')) : '';

  const xmlFile = (rootPath && zip.file(rootPath)) ||
    Object.values(zip.files).find(entry =>
      !entry.dir &&
      /\.(musicxml|xml)$/i.test(entry.name) &&
      !/META-INF\/container\.xml$/i.test(entry.name),
    );

  if (!xmlFile) {
    throw new Error(`Compressed MusicXML file did not contain a readable score: ${mxlPath}`);
  }

  return xmlFile.async('text');
}

function inspectMusicXml(xml) {
  const measures = Array.from(xml.matchAll(/<measure\b[\s\S]*?<\/measure>/g), match => match[0]);
  let playableNotes = 0;
  let maxNotesInMeasure = 0;

  for (const measure of measures) {
    const notes = Array.from(measure.matchAll(/<note\b[\s\S]*?<\/note>/g), match => match[0]);
    const playable = notes.filter(note =>
      !/<rest\b/.test(note) &&
      !/<chord\b/.test(note) &&
      !/<grace\b/.test(note),
    ).length;
    playableNotes += playable;
    maxNotesInMeasure = Math.max(maxNotesInMeasure, playable);
  }

  const averageNotesPerMeasure = measures.length ? playableNotes / measures.length : 0;
  const reasons = [];

  if (measures.length === 0) reasons.push('no measures detected');
  if (playableNotes === 0) reasons.push('no playable notes detected');
  if (averageNotesPerMeasure > 18) reasons.push(`too dense (${averageNotesPerMeasure.toFixed(1)} notes/measure)`);
  if (maxNotesInMeasure > 32) reasons.push(`one measure has ${maxNotesInMeasure} notes`);

  return {
    suspicious: reasons.length > 0,
    reason: reasons.join('; '),
    measures: measures.length,
    playableNotes,
    maxNotesInMeasure,
    averageNotesPerMeasure: Number(averageNotesPerMeasure.toFixed(1)),
  };
}

function buildCandidate(engine, xml, preprocessing = 'original') {
  const inspection = inspectMusicXml(xml);
  return {
    success: true,
    musicXmlString: xml,
    engine,
    preprocessing,
    warning: inspection.suspicious
      ? `${engine} (${preprocessing}) produced suspicious MusicXML: ${inspection.reason}`
      : '',
    inspection,
  };
}

function candidateScore(candidate) {
  const i = candidate?.inspection ?? {};
  let score = 0;
  if (!i.suspicious) score += 1000;
  score += Math.min(i.measures ?? 0, 64) * 10;
  score += Math.min(i.playableNotes ?? 0, 240);
  if ((i.averageNotesPerMeasure ?? 0) > 18) score -= 400;
  if ((i.maxNotesInMeasure ?? 0) > 32) score -= 400;
  if ((i.playableNotes ?? 0) === 0) score -= 600;
  return score;
}

function timeoutMs(envName, fallback) {
  const parsed = Number(process.env[envName]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function splitArgs(value = '') {
  return value
    .split(/\s+/)
    .map(arg => arg.trim())
    .filter(Boolean);
}

function friendlyTimeoutError(engine, timeout) {
  return `${engine} timed out after ${Math.round(timeout / 1000)}s. Try a tighter crop, a straighter/brighter image, or upload MusicXML for reliable feedback.`;
}

async function runOemer(imagePath, { assumeDeskewed = false } = {}) {
  const cmd       = process.env.OEMER_CLI || 'oemer';
  const extraArgs = splitArgs(process.env.OEMER_ARGS || '');
  const timeout   = timeoutMs('OEMER_TIMEOUT_MS', DEFAULT_OEMER_TIMEOUT_MS);
  const outDir    = fs.mkdtempSync(path.join(os.tmpdir(), 'vc_oemer_'));
  const disablesDeskew = extraArgs.includes('-d') || extraArgs.includes('--without-deskew');
  const args = [imagePath, '--output-path', outDir, ...extraArgs];

  if (assumeDeskewed && !disablesDeskew) {
    args.push('--without-deskew');
  }

  try {
    try {
      await execFileAsync(cmd, args, {
        timeout,
        killSignal: 'SIGKILL',
        maxBuffer: 50 * 1024 * 1024,
      });
    } catch (err) {
      if (err.killed || err.signal === 'SIGTERM' || err.signal === 'SIGKILL') {
        throw new Error(friendlyTimeoutError('Oemer', timeout));
      }
      throw err;
    }

    const base    = path.basename(imagePath, path.extname(imagePath));
    const xmlPath = path.join(outDir, base + '.musicxml');
    const altPath = path.join(outDir, base + '.xml');

    if (fs.existsSync(xmlPath)) {
      return fs.readFileSync(xmlPath, 'utf-8');
    }
    if (fs.existsSync(altPath)) {
      return fs.readFileSync(altPath, 'utf-8');
    }

    const produced = fs.readdirSync(outDir).join(', ') || 'nothing';
    throw new Error(`Oemer did not produce MusicXML. Expected ${xmlPath} or ${altPath}; got ${produced}.`);
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}

// ── Engine 2: Audiveris ────────────────────────────────────────────────────
// Install:  https://github.com/Audiveris/audiveris/releases
// Docs:     https://github.com/Audiveris/audiveris

async function runAudiveris(imagePath, command = '') {
  const cmd     = command || resolveAudiverisCommand() || 'audiveris';
  const timeout = timeoutMs('AUDIVERIS_TIMEOUT_MS', DEFAULT_AUDIVERIS_TIMEOUT_MS);
  const outDir  = fs.mkdtempSync(path.join(os.tmpdir(), 'vc_audiveris_'));

  try {
    try {
      await execFileAsync(cmd, ['-batch', '-transcribe', '-export', '-output', outDir, imagePath], {
        timeout,
        killSignal: 'SIGKILL',
        maxBuffer: 50 * 1024 * 1024,
      });
    } catch (err) {
      if (err.killed || err.signal === 'SIGTERM' || err.signal === 'SIGKILL') {
        throw new Error(friendlyTimeoutError('Audiveris', timeout));
      }
      throw err;
    }

    // Audiveris can place output under outDir/<bookname>/ or directly in outDir.
    const outputFiles = findFiles(outDir, file => /\.(musicxml|xml|mxl)$/i.test(file));
    const scoreFile = outputFiles.find(file => !/container\.xml$/i.test(file));
    if (!scoreFile) {
      const produced = findFiles(outDir).map(file => path.relative(outDir, file)).join(', ') || 'nothing';
      throw new Error(`Audiveris output not found. Expected MusicXML/MXL; got ${produced}.`);
    }
    if (/\.mxl$/i.test(scoreFile)) return readMxlMusicXml(scoreFile);
    return fs.readFileSync(scoreFile, 'utf-8');
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}

function findFiles(dir, predicate = () => true) {
  const files = [];
  if (!fs.existsSync(dir)) return files;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...findFiles(fullPath, predicate));
    else if (predicate(fullPath)) files.push(fullPath);
  }

  return files;
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
    'No OMR engine produced a reliable MusicXML scan.\n\n' +
    'For the best result, upload a .musicxml/.mxl file. For screenshot scanning, use a tight crop of only the white sheet-music page, taken straight-on with good contrast.\n\n' +
    'Available engine setup options:\n\n' +
    '  • Audiveris (Java, best for complex classical scores)\n' +
    '      Install the macOS app from https://github.com/Audiveris/audiveris/releases\n\n' +
    '  • Oemer (Python fallback)\n' +
    '      pip install oemer\n\n' +
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
    audiveris:  !!resolveAudiverisCommand(),
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
  let suspiciousCandidate = null;
  const oemerCmd     = process.env.OEMER_CLI     || 'oemer';
  const audiverisCmd = resolveAudiverisCommand();
  const { variants, warning: preprocessingWarning } = await makeOmrImageVariants(imagePath);

  if (preprocessingWarning) errors.push(`Preprocessing: ${preprocessingWarning}`);

  function acceptOrFallback(engine, xml, preprocessing = 'original') {
    const candidate = buildCandidate(engine, xml, preprocessing);
    if (!candidate.inspection.suspicious) return candidate;

    console.warn(`[OMR] ${candidate.warning}; trying fallback if available.`);
    errors.push(`${engine}: ${candidate.inspection.reason}`);
    if (!suspiciousCandidate || candidateScore(candidate) > candidateScore(suspiciousCandidate)) {
      suspiciousCandidate = candidate;
    }
    return null;
  }

  try {
    // ── 1. Audiveris ───────────────────────────────────────────────
    if (audiverisCmd) {
      for (const variant of variants) {
        try {
          console.log(`[OMR] Trying Audiveris (${variant.label})…`);
          const xml = await runAudiveris(variant.path, audiverisCmd);
          console.log(`[OMR] Audiveris succeeded (${variant.label}).`);
          const candidate = acceptOrFallback('audiveris', xml, variant.label);
          if (candidate) return candidate;
        } catch (err) {
          console.warn(`[OMR] Audiveris failed (${variant.label}):`, err.message);
          errors.push(`Audiveris (${variant.label}): ${err.message}`);
        }
      }
    } else {
      errors.push('Audiveris: command not found. Install the macOS app from https://github.com/Audiveris/audiveris/releases');
    }

    // ── 2. Oemer ───────────────────────────────────────────────────
    if (isCommandAvailable(oemerCmd)) {
      for (const variant of variants) {
        try {
          console.log(`[OMR] Trying Oemer (${variant.label})…`);
          const xml = await runOemer(variant.path, { assumeDeskewed: variant.label === 'cleaned' });
          console.log(`[OMR] Oemer succeeded (${variant.label}).`);
          const candidate = acceptOrFallback('oemer', xml, variant.label);
          if (candidate) return candidate;
        } catch (err) {
          console.warn(`[OMR] Oemer failed (${variant.label}):`, err.message);
          errors.push(`Oemer (${variant.label}): ${err.message}`);
        }
      }
    } else {
      errors.push('Oemer: command not found (pip install oemer)');
    }

    // ── 3. Remote endpoint ─────────────────────────────────────────
    if (process.env.OMR_ENDPOINT) {
      try {
        console.log('[OMR] Trying remote endpoint:', process.env.OMR_ENDPOINT);
        const xml = await callRemoteEndpoint(base64, mediaType);
        console.log('[OMR] Remote endpoint succeeded.');
        const candidate = acceptOrFallback('remote', xml);
        if (candidate) return candidate;
      } catch (err) {
        console.warn('[OMR] Remote endpoint failed:', err.message);
        errors.push(`Remote (${process.env.OMR_ENDPOINT}): ${err.message}`);
      }
    }

    if (suspiciousCandidate) return suspiciousCandidate;

    return { success: false, error: buildInstallError(errors) };
  } finally {
    cleanupOmrImageVariants(variants);
  }
}
