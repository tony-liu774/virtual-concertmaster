/**
 * ─────────────────────────────────────────────────────────────
 *  YIN Pitch Detection Algorithm
 *  de Cheveigné & Kawahara (2002) — optimised for JS / strings
 * ─────────────────────────────────────────────────────────────
 *
 *  Key improvements over basic autocorrelation:
 *    • CMND (step 2) eliminates DC-bias false positives
 *    • Parabolic interpolation gives sub-sample period accuracy
 *    • Only searches the tau range implied by [minFreq, maxFreq]
 *      → much faster than full-buffer search
 *    • Octave-error guard in PitchSmoother handles harmonics
 */

/**
 * Detect fundamental frequency from an AnalyserNode's time-domain buffer.
 * Returns Hz (float) or null when no clear pitch is found.
 *
 * @param {AnalyserNode} analyserNode
 * @param {number}       sampleRate   – ctx.sampleRate
 * @param {number}       minFreq      – lowest expected note (Hz)
 * @param {number}       maxFreq      – highest expected note (Hz)
 */
export function detectPitch(analyserNode, sampleRate, minFreq = 40, maxFreq = 4000) {
  const N = analyserNode.fftSize;
  const buffer = new Float32Array(N);
  analyserNode.getFloatTimeDomainData(buffer);

  // ── 0. RMS gate — bail immediately on silence ──────────────
  let sum = 0;
  for (let i = 0; i < N; i++) sum += buffer[i] * buffer[i];
  if (sum / N < 0.00015) return null;   // ~0.012 RMS threshold

  // ── 1. Tau search bounds ───────────────────────────────────
  const minTau = Math.max(2, Math.floor(sampleRate / maxFreq));
  const maxTau = Math.min(Math.floor(N / 2) - 2, Math.ceil(sampleRate / minFreq));
  const W      = N - maxTau;            // safe comparison window

  // ── 2. YIN difference function d(tau) ─────────────────────
  const d = new Float32Array(maxTau + 1);
  for (let tau = minTau; tau <= maxTau; tau++) {
    let s = 0;
    for (let i = 0; i < W; i++) {
      const x = buffer[i] - buffer[i + tau];
      s += x * x;
    }
    d[tau] = s;
  }

  // ── 3. Cumulative mean normalised difference (CMND) ────────
  const cmnd = new Float32Array(maxTau + 1);
  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= maxTau; tau++) {
    running += d[tau];
    cmnd[tau] = running > 0 ? (d[tau] * tau / running) : 1;
  }

  // ── 4. First minimum below threshold ──────────────────────
  const THRESHOLD = 0.18;   // tighter than original paper → fewer false positives
  let bestTau = -1;
  for (let tau = minTau; tau < maxTau - 1; tau++) {
    if (cmnd[tau] < THRESHOLD && cmnd[tau] <= cmnd[tau + 1]) {
      bestTau = tau;
      break;
    }
  }
  if (bestTau < 0) return null;

  // ── 5. Parabolic interpolation → sub-sample accuracy ──────
  let refined = bestTau;
  if (bestTau > minTau && bestTau < maxTau) {
    const s0 = cmnd[bestTau - 1];
    const s1 = cmnd[bestTau];
    const s2 = cmnd[bestTau + 1];
    const denom = 2 * (2 * s1 - s0 - s2);
    if (denom !== 0) refined = bestTau + (s2 - s0) / denom;
  }

  return refined > 0 ? sampleRate / refined : null;
}

/**
 * Exponential Moving Average pitch smoother.
 *
 * Handles vibrato by smoothing small oscillations around the centre
 * pitch.  Includes an octave-error guard: if the new reading is ~2×
 * or ~0.5× the current value we flip the octave before blending,
 * which prevents the common "jumps an octave" artefact on strings.
 */
export class PitchSmoother {
  /**
   * @param {number} alpha  Blend factor per frame (0 = frozen, 1 = raw).
   *                        0.18–0.25 works well for vibrato at 60 fps.
   * @param {number} hold   Frames of silence before output drops to null.
   */
  constructor(alpha = 0.20, hold = 6) {
    this.alpha  = alpha;
    this.hold   = hold;
    this.value  = null;
    this.silent = 0;
  }

  push(raw) {
    if (raw === null) {
      if (++this.silent > this.hold) this.value = null;
      return this.value;
    }

    this.silent = 0;

    if (this.value === null) {
      this.value = raw;
      return this.value;
    }

    // Octave-error correction
    const ratio = raw / this.value;
    let corrected = raw;
    if      (ratio > 1.82 && ratio < 2.18) corrected = raw / 2;   // octave-up artefact
    else if (ratio > 0.45 && ratio < 0.55) corrected = raw * 2;   // octave-down artefact

    // Large jump (> ±40%) = note change, reset immediately
    const r2 = corrected / this.value;
    if (r2 < 0.6 || r2 > 1.4) {
      this.value = corrected;
    } else {
      this.value = this.alpha * corrected + (1 - this.alpha) * this.value;
    }

    return this.value;
  }

  clear() {
    this.value  = null;
    this.silent = 0;
  }
}
