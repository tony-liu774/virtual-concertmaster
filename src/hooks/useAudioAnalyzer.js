import { useState, useRef, useCallback, useEffect } from 'react';
import { detectPitch, PitchSmoother } from '../utils/pitchDetection.js';
import { freqToNote } from '../utils/musicTheory.js';

/**
 * fftSize = 4096 gives us:
 *   • Time-domain buffer of 4096 samples
 *   • At 44100 Hz → can resolve periods down to ~11ms (≈ 91 Hz)
 *   • Combined with minFreq clamping in YIN → accurate down to 38 Hz (bass low E)
 *   • RAF loop at ~60fps → new reading every ~16ms, well under the 30ms target
 */
const FFT_SIZE = 4096;

/**
 * useAudioAnalyzer
 *
 * Manages: AudioContext → MediaStream → AnalyserNode → YIN → smoothed note
 *
 * @param {object} opts
 * @param {number} opts.minFreq  Lowest note to detect (Hz)
 * @param {number} opts.maxFreq  Highest note to detect (Hz)
 * @param {number} opts.a4       A4 reference frequency (default 440)
 *
 * Returns:
 *   isListening, currentFreq, currentNote, rmsLevel,
 *   startListening, stopListening, error,
 *   getWaveform   – fills a Float32Array with the latest time-domain data
 */
export function useAudioAnalyzer({ minFreq = 40, maxFreq = 4000, a4 = 440 } = {}) {
  const [isListening, setIsListening] = useState(false);
  const [currentFreq, setCurrentFreq] = useState(null);
  const [currentNote, setCurrentNote] = useState(null);
  const [rmsLevel,    setRmsLevel]    = useState(0);
  const [error,       setError]       = useState(null);

  const ctxRef      = useRef(null);
  const analyserRef = useRef(null);
  const streamRef   = useRef(null);
  const rafRef      = useRef(null);
  const smoother    = useRef(new PitchSmoother(0.20, 6));

  // Keep latest opts accessible inside the RAF loop without re-subscribing
  const optsRef = useRef({ minFreq, maxFreq, a4 });
  useEffect(() => { optsRef.current = { minFreq, maxFreq, a4 }; }, [minFreq, maxFreq, a4]);

  const tick = useCallback(() => {
    if (!analyserRef.current || !ctxRef.current) return;

    const { minFreq, maxFreq, a4 } = optsRef.current;
    const sampleRate = ctxRef.current.sampleRate;
    const N = analyserRef.current.fftSize;

    // ── RMS level (for signal meter) ─────────────────────────
    const buf = new Float32Array(N);
    analyserRef.current.getFloatTimeDomainData(buf);
    let rms = 0;
    for (let i = 0; i < N; i++) rms += buf[i] * buf[i];
    setRmsLevel(Math.sqrt(rms / N));

    // ── YIN pitch detection ──────────────────────────────────
    const raw      = detectPitch(analyserRef.current, sampleRate, minFreq, maxFreq);
    const smoothed = smoother.current.push(raw);

    setCurrentFreq(smoothed);
    setCurrentNote(smoothed ? freqToNote(smoothed, a4) : null);

    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const startListening = useCallback(async () => {
    setError(null);
    try {
      // AudioContext must be created inside a user-gesture handler
      const ctx    = new (window.AudioContext || window.webkitAudioContext)();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false });

      ctxRef.current    = ctx;
      streamRef.current = stream;

      const source   = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize                = FFT_SIZE;
      analyser.smoothingTimeConstant  = 0;  // raw signal — our own smoother handles it
      source.connect(analyser);
      analyserRef.current = analyser;

      smoother.current.clear();
      setIsListening(true);
      rafRef.current = requestAnimationFrame(tick);
    } catch (err) {
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setError('Microphone access is required to use the tuner.');
      } else {
        setError(`Could not open microphone: ${err.message}`);
      }
    }
  }, [tick]);

  const stopListening = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    ctxRef.current?.close();
    ctxRef.current    = null;
    analyserRef.current = null;
    streamRef.current = null;
    smoother.current.clear();
    setIsListening(false);
    setCurrentFreq(null);
    setCurrentNote(null);
    setRmsLevel(0);
  }, []);

  /** Fill caller-supplied Float32Array with latest waveform samples */
  const getWaveform = useCallback((out) => {
    if (analyserRef.current) analyserRef.current.getFloatTimeDomainData(out);
  }, []);

  useEffect(() => () => stopListening(), [stopListening]);

  return { isListening, currentFreq, currentNote, rmsLevel, startListening, stopListening, error, getWaveform };
}
