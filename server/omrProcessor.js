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
import JSZip              from 'jszip';
import { makeOmrImageVariants, cleanupOmrImageVariants } from './imagePreprocessor.js';

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

async function runOemer(imagePath) {
  const cmd       = process.env.OEMER_CLI || 'oemer';
  const extraArgs = process.env.OEMER_ARGS || '';
  const outDir    = fs.mkdtempSync(path.join(os.tmpdir(), 'vc_oemer_'));

  try {
    await execAsync(`"${cmd}" "${imagePath}" --output-path "${outDir}" ${extraArgs}`.trim(), {
      timeout: 600_000,   // Oemer can take several minutes on CPU/CoreML.
      maxBuffer: 50 * 1024 * 1024,
    });

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
// Install:  brew install audiveris   OR   https://github.com/Audiveris/audiveris/releases
// Docs:     https://github.com/Audiveris/audiveris

async function runAudiveris(imagePath) {
  const cmd    = process.env.AUDIVERIS_CLI || 'audiveris';
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc_audiveris_'));
  const base   = path.basename(imagePath, path.extname(imagePath));

  try {
    await execAsync(
      `"${cmd}" -batch -export -output "${outDir}" "${imagePath}"`,
      {
        timeout: 300_000,   // 5 min — JVM startup + heavy processing
        maxBuffer: 50 * 1024 * 1024,
      },
    );

    // Audiveris creates outDir/<bookname>/<bookname>.xml  (or .mxl)
    const xmlPath = path.join(outDir, base, base + '.xml');
    const mxlPath = path.join(outDir, base, base + '.mxl');

    if (fs.existsSync(xmlPath)) {
      return fs.readFileSync(xmlPath, 'utf-8');
    }
    if (fs.existsSync(mxlPath)) {
      return readMxlMusicXml(mxlPath);
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
  let suspiciousCandidate = null;
  const oemerCmd     = process.env.OEMER_CLI     || 'oemer';
  const audiverisCmd = process.env.AUDIVERIS_CLI || 'audiveris';
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
    // ── 1. Oemer ───────────────────────────────────────────────────
    if (isCommandAvailable(oemerCmd)) {
      for (const variant of variants) {
        try {
          console.log(`[OMR] Trying Oemer (${variant.label})…`);
          const xml = await runOemer(variant.path);
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

    // ── 2. Audiveris ───────────────────────────────────────────────
    if (isCommandAvailable(audiverisCmd)) {
      for (const variant of variants) {
        try {
          console.log(`[OMR] Trying Audiveris (${variant.label})…`);
          const xml = await runAudiveris(variant.path);
          console.log(`[OMR] Audiveris succeeded (${variant.label}).`);
          const candidate = acceptOrFallback('audiveris', xml, variant.label);
          if (candidate) return candidate;
        } catch (err) {
          console.warn(`[OMR] Audiveris failed (${variant.label}):`, err.message);
          errors.push(`Audiveris (${variant.label}): ${err.message}`);
        }
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
