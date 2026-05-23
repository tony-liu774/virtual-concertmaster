/**
 * imagePreprocessor.js — creates cleaner OMR input images.
 *
 * This is intentionally optional. If Python/OpenCV is unavailable, the OMR
 * pipeline falls back to the original upload instead of failing the scan.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';

const execFileAsync = promisify(execFile);

function candidatePythonCommands() {
  const commands = [];
  if (process.env.OMR_PREPROCESSOR_PYTHON) commands.push(process.env.OMR_PREPROCESSOR_PYTHON);

  const oemerCmd = process.env.OEMER_CLI;
  if (oemerCmd && oemerCmd.includes(path.sep)) {
    commands.push(path.join(path.dirname(oemerCmd), 'python'));
    commands.push(path.join(path.dirname(oemerCmd), 'python3'));
  }

  commands.push(path.resolve(process.cwd(), '.venv-omr/bin/python'));
  commands.push('python3');
  commands.push('python');

  return [...new Set(commands)];
}

async function findPython() {
  for (const cmd of candidatePythonCommands()) {
    try {
      await execFileAsync(cmd, ['-c', 'import cv2, numpy'], { timeout: 5000 });
      return cmd;
    } catch {
      // Try the next candidate.
    }
  }
  return '';
}

export async function makeOmrImageVariants(imagePath) {
  const includeOriginalFallback = process.env.OMR_TRY_ORIGINAL_FALLBACK === '1';
  const variants = [{ label: 'original', path: imagePath, cleanup: false }];
  const python = await findPython();
  if (!python) {
    return {
      variants,
      warning: 'Image preprocessing skipped because Python OpenCV was not available.',
    };
  }

  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vc_omr_pre_'));
  const cleanedPath = path.join(outDir, `${path.basename(imagePath, path.extname(imagePath))}_clean.png`);
  const script = path.resolve(process.cwd(), 'server/preprocessImage.py');

  try {
    await execFileAsync(python, [script, imagePath, cleanedPath], {
      timeout: 60_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    if (fs.existsSync(cleanedPath) && fs.statSync(cleanedPath).size > 1000) {
      if (includeOriginalFallback) {
        variants.unshift({ label: 'cleaned', path: cleanedPath, cleanup: true, outDir });
      } else {
        variants.splice(0, variants.length, { label: 'cleaned', path: cleanedPath, cleanup: true, outDir });
      }
      return { variants, warning: '' };
    }
    fs.rmSync(outDir, { recursive: true, force: true });
    return {
      variants,
      warning: 'Image preprocessing did not produce a usable cleaned image.',
    };
  } catch (err) {
    fs.rmSync(outDir, { recursive: true, force: true });
    return {
      variants,
      warning: `Image preprocessing failed: ${err.message}`,
    };
  }
}

export function cleanupOmrImageVariants(variants = []) {
  const dirs = new Set(variants.filter(v => v.cleanup && v.outDir).map(v => v.outDir));
  for (const dir of dirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}
