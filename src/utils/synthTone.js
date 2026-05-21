/**
 * ─────────────────────────────────────────────────────────────
 *  Warm Cello-like Reference Drone — Web Audio API
 * ─────────────────────────────────────────────────────────────
 *  Signal chain:
 *    Sawtooth OSC  ─┐
 *    LFO (vibrato) ─┘→ BiquadFilter (LP ~1700 Hz) → Gain → Destination
 *
 *  The sawtooth provides the harmonic richness of a bowed string.
 *  The low-pass filter removes the harsh upper partials, leaving
 *  a warm, cello-like timbre.  The LFO adds ~5 Hz vibrato at ±4 Hz depth.
 */

let _sharedCtx = null;

function getCtx() {
  if (!_sharedCtx || _sharedCtx.state === 'closed') {
    _sharedCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (_sharedCtx.state === 'suspended') _sharedCtx.resume();
  return _sharedCtx;
}

/**
 * useSynthTone — React hook that manages a persistent drone oscillator.
 *
 * Returns { playing, startDrone, stopDrone, setFrequency }
 */
import { useState, useRef, useEffect, useCallback } from 'react';

export function useSynthTone() {
  const [playing, setPlaying] = useState(false);
  const nodesRef = useRef(null);

  const stopDrone = useCallback(() => {
    if (!nodesRef.current) return;
    const { gain, osc, lfo, ctx } = nodesRef.current;
    const t = ctx.currentTime;
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(gain.gain.value, t);
    gain.gain.linearRampToValueAtTime(0, t + 0.35);
    setTimeout(() => {
      try { osc.stop(); lfo.stop(); } catch {
        // Nodes may already be stopped by the browser during teardown.
      }
    }, 400);
    nodesRef.current = null;
    setPlaying(false);
  }, []);

  const startDrone = useCallback((freq = 440) => {
    stopDrone();
    const ctx = getCtx();

    // ── Oscillator (sawtooth = bow-like harmonic stack) ──────
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, ctx.currentTime);

    // ── Vibrato LFO ─────────────────────────────────────────
    const lfo     = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.type            = 'sine';
    lfo.frequency.value = 5.5;          // 5.5 Hz vibrato rate
    lfoGain.gain.value  = 4;            // ±4 Hz depth
    lfo.connect(lfoGain);
    lfoGain.connect(osc.frequency);

    // ── Low-pass filter (warm string tone) ──────────────────
    const filter = ctx.createBiquadFilter();
    filter.type            = 'lowpass';
    filter.frequency.value = 1700;
    filter.Q.value         = 0.6;

    // ── Master gain with bow-like attack ────────────────────
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.22, ctx.currentTime + 0.45); // slow bow attack

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    lfo.start();
    osc.start();

    nodesRef.current = { osc, lfo, gain, ctx };
    setPlaying(true);
  }, [stopDrone]);

  /** Smoothly glide the drone to a new frequency */
  const setFrequency = useCallback((freq) => {
    if (!nodesRef.current) return;
    const { osc, ctx } = nodesRef.current;
    osc.frequency.linearRampToValueAtTime(freq, ctx.currentTime + 0.08);
  }, []);

  const toggle = useCallback((freq) => {
    if (playing) stopDrone();
    else startDrone(freq);
  }, [playing, startDrone, stopDrone]);

  useEffect(() => () => stopDrone(), [stopDrone]);

  return { playing, startDrone, stopDrone, toggle, setFrequency };
}
