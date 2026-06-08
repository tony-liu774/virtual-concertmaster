/**
 * ─────────────────────────────────────────────────────────────
 *  useReferencePlayer — full-piece audio reference via Web Audio
 *
 *  Plays every note in a piece at the specified BPM using a
 *  triangle-wave oscillator with a bowed-string-like envelope.
 *  Audio events are scheduled ahead-of-time in Web Audio "absolute
 *  time" for sample-accurate playback, with parallel JavaScript
 *  setTimeout callbacks to keep the UI note index in sync.
 *
 *  Returns
 *    { playing, refNoteIdx, startRef, stopRef }
 *      playing    – true while reference audio is running
 *      refNoteIdx – 0-indexed global note currently sounding
 *      startRef   – fn(allNotes: Note[], bpm: number) → void
 *      stopRef    – fn() → void
 * ─────────────────────────────────────────────────────────────
 */

import { useState, useRef, useEffect, useCallback } from 'react';

/** Duration in beats per VexFlow duration string */
const DURATION_BEATS = { wd: 6, w: 4, hd: 3, h: 2, qd: 1.5, q: 1, '8d': 0.75, '8': 0.5, '16': 0.25 };

/** Lazy-create a single shared AudioContext (avoids duplicate nodes) */
function makeCtx() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

/**
 * Schedule one note at a pre-computed Web Audio absolute time.
 * Uses a triangle wave (clean, non-harsh) with a quick bow-like
 * attack and a natural release to avoid harsh clicks.
 */
function scheduleNote(ctx, freq, startTime, durationSecs) {
  if (!freq || freq <= 0 || durationSecs <= 0) return;

  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type            = 'triangle';
  osc.frequency.value = freq;

  const attack  = Math.min(0.018, durationSecs * 0.08);
  const release = Math.min(0.06,  durationSecs * 0.28);
  const peak    = 0.26;

  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(peak, startTime + attack);
  gain.gain.setValueAtTime(peak, startTime + durationSecs - release);
  gain.gain.linearRampToValueAtTime(0,    startTime + durationSecs);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(startTime);
  osc.stop(startTime + durationSecs + 0.02);  // tiny buffer so stop doesn't clip
}

export function useReferencePlayer() {
  const [playing,    setPlaying]    = useState(false);
  const [refNoteIdx, setRefNoteIdx] = useState(0);

  const ctxRef      = useRef(null);
  const timeoutsRef = useRef([]);   // JS timer IDs for UI sync + auto-stop

  // ── Stop ───────────────────────────────────────────────────────
  const stopRef = useCallback(() => {
    // Cancel all pending UI-sync timers
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];

    // Close the Web Audio context so no orphaned oscillators linger
    if (ctxRef.current) {
      try { ctxRef.current.close(); } catch { /* ignore closed-context errors */ }
      ctxRef.current = null;
    }

    setPlaying(false);
    setRefNoteIdx(0);
  }, []);

  // ── Start ──────────────────────────────────────────────────────
  const startRef = useCallback((allNotes, bpm) => {
    stopRef();  // clean slate

    if (!allNotes?.length || !bpm) return;

    const ctx     = makeCtx();
    ctxRef.current = ctx;
    setPlaying(true);
    setRefNoteIdx(0);

    const beatSecs = 60 / bpm;

    // Schedule audio ahead-of-time.  `t` tracks the absolute Web Audio
    // clock position; we add a small initial buffer (80ms) so the first
    // audio event is never missed even on slow devices.
    let t = ctx.currentTime + 0.08;

    allNotes.forEach((note, i) => {
      const durSecs      = (DURATION_BEATS[note.duration] ?? 1) * beatSecs;
      const noteStart    = t;

      // ── Audio (scheduled absolutely) ───────────────────────
      scheduleNote(ctx, note.freq, noteStart, durSecs);

      // ── UI index update (setTimeout, approximate but close enough) ─
      // delayMs = how many milliseconds from NOW until this note starts
      const delayMs = Math.max(0, (noteStart - ctx.currentTime) * 1000);
      const id = setTimeout(() => setRefNoteIdx(i), delayMs);
      timeoutsRef.current.push(id);

      t += durSecs;
    });

    // Auto-stop ~300 ms after the last note finishes
    const totalMs   = Math.max(0, (t - ctx.currentTime) * 1000) + 300;
    const stopId    = setTimeout(stopRef, totalMs);
    timeoutsRef.current.push(stopId);
  }, [stopRef]);

  // Cleanup on unmount
  useEffect(() => () => stopRef(), [stopRef]);

  return { playing, refNoteIdx, startRef, stopRef };
}
