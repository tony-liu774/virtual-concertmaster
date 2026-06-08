import { useState, useEffect, useRef, useCallback } from 'react';
import { Mic2, MicOff, ChevronDown, Volume2, VolumeX, Settings2 } from 'lucide-react';
import { useAudioAnalyzer } from '../hooks/useAudioAnalyzer.js';
import { useSynthTone } from '../utils/synthTone.js';
import { useInstrumentStore } from '../store/instrumentStore.js';
import { INSTRUMENT_RANGES, OPEN_STRINGS, centsLabel, intonationState, midiToFreq } from '../utils/musicTheory.js';

const A4_OPTIONS = [438, 440, 441, 442, 443, 444];

/**
 * Orchestra Temperament offsets (cents) per key signature.
 * String players in ensembles sharpen leading tones and widen
 * major thirds compared to equal temperament.
 * These offsets shift the "perfect" centre by the given amount.
 */
const TEMPERAMENT = {
  C: 0, G: +1, D: +2, A: +3, E: +4, B: +5,
  F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5,
};

const KEY_OPTIONS = Object.keys(TEMPERAMENT);

// ── Colour palette ────────────────────────────────────────────
const STATE_STYLE = {
  perfect: { text: '#10b981', glow: '0 0 18px #10b981, 0 0 36px #10b98155' },
  close:   { text: '#c9a227', glow: '0 0 18px #c9a227, 0 0 36px #c9a22755' },
  off:     { text: '#dc2626', glow: '0 0 18px #dc2626, 0 0 36px #dc262655' },
  far:     { text: '#dc2626', glow: '0 0 22px #dc2626, 0 0 44px #dc262670' },
  idle:    { text: '#4b5a72', glow: 'none' },
};

// ── Oscilloscope ──────────────────────────────────────────────
const WAVE_BUF = new Float32Array(512);
function Oscilloscope({ getWaveform, isListening, color }) {
  const canvasRef = useRef(null);
  const rafRef    = useRef(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    getWaveform(WAVE_BUF);
    ctx.clearRect(0, 0, W, H);
    ctx.strokeStyle = '#1e293b'; ctx.lineWidth = 0.5;
    ctx.beginPath(); ctx.moveTo(0, H/2); ctx.lineTo(W, H/2); ctx.stroke();
    ctx.strokeStyle = color; ctx.lineWidth = 1.5;
    ctx.shadowColor = color; ctx.shadowBlur = 4;
    ctx.beginPath();
    const step = W / WAVE_BUF.length;
    for (let i = 0; i < WAVE_BUF.length; i++) {
      const x = i * step, y = (1 - (WAVE_BUF[i] * 0.9 + 1) / 2) * H;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke(); ctx.shadowBlur = 0;
    rafRef.current = requestAnimationFrame(draw);
  }, [getWaveform, color]);

  useEffect(() => {
    if (isListening) { rafRef.current = requestAnimationFrame(draw); }
    else {
      cancelAnimationFrame(rafRef.current);
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = '#1e293b'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, canvas.height/2); ctx.lineTo(canvas.width, canvas.height/2); ctx.stroke();
      }
    }
    return () => cancelAnimationFrame(rafRef.current);
  }, [isListening, draw]);

  return <canvas ref={canvasRef} width={460} height={48} className="w-full rounded-lg" style={{ background: '#0a0f1a' }} />;
}

function SignalMeter({ rms, color }) {
  const pct = Math.min(100, rms * 600);
  return (
    <div className="w-full">
      <div className="flex justify-between mb-1">
        <span className="text-text-muted font-body text-[10px] uppercase tracking-widest">Signal</span>
        <span className="font-body text-[10px] tabular-nums" style={{ color }}>
          {rms > 0.005 ? `${(rms * 100).toFixed(1)}%` : 'No signal'}
        </span>
      </div>
      <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-75"
          style={{ width: `${pct}%`, backgroundColor: color, boxShadow: pct > 5 ? `0 0 6px ${color}` : 'none' }} />
      </div>
    </div>
  );
}

// ── Main Tuner ────────────────────────────────────────────────
export default function Tuner() {
  const { instrument } = useInstrumentStore();
  const range = INSTRUMENT_RANGES[instrument];

  const [a4,               setA4]               = useState(440);
  const [showSettings,     setShowSettings]      = useState(false);
  const [orchTuning,       setOrchTuning]        = useState(false);
  const [keySignature,     setKeySignature]      = useState('D');
  const [droneNote,        setDroneNote]         = useState(null); // midi number for drone

  const { isListening, currentNote, rmsLevel, startListening, stopListening, error, getWaveform } =
    useAudioAnalyzer({ minFreq: range.min, maxFreq: range.max, a4 });

  const { playing: droning, startDrone, stopDrone } = useSynthTone();

  // Orchestra temperament offset (cents) — shifts the "perfect" target
  const tempOffset = orchTuning ? (TEMPERAMENT[keySignature] ?? 0) : 0;
  const adjustedCents = (currentNote?.cents ?? 0) - tempOffset;

  const state  = isListening && currentNote ? intonationState(adjustedCents) : 'idle';
  const style  = STATE_STYLE[state];

  const clamped   = Math.max(-50, Math.min(50, adjustedCents));
  const needleDeg = isListening && currentNote ? (clamped / 50) * 80 : 0;

  function toggleMic() {
    isListening ? stopListening() : startListening();
  }

  function toggleDrone(midi) {
    if (droning) { stopDrone(); setDroneNote(null); }
    else { const f = midiToFreq(midi, a4); startDrone(f); setDroneNote(midi); }
  }

  // When A4 changes, update droning frequency live
  useEffect(() => {
    if (droning && droneNote !== null) {
      // useSynthTone setFrequency not exposed here — restart drone
      stopDrone();
      setTimeout(() => startDrone(midiToFreq(droneNote, a4)), 50);
    }
  }, [a4]);

  const openStrings = OPEN_STRINGS[instrument] ?? [];

  return (
    <div className="min-h-screen bg-bg-deep px-5 py-8 flex flex-col items-center" onClick={() => { setShowSettings(false); }}>

      {/* ── Header ─────────────────────────────────────── */}
      <div className="w-full max-w-lg mb-6 flex items-start justify-between">
        <div>
          <p className="text-accent-amber font-body text-xs uppercase tracking-widest mb-1">The Ear — Phase 1</p>
          <h1 className="font-header text-3xl md:text-4xl text-text-primary">Precision Tuner</h1>
          <p className="text-text-muted font-body text-xs mt-0.5 capitalize">{range.label}</p>
        </div>
        <button onClick={e => { e.stopPropagation(); setShowSettings(v => !v); }}
          className={`mt-1 p-2.5 rounded-xl border transition-all ${showSettings ? 'bg-accent-amber/15 text-accent-amber border-accent-amber/40' : 'bg-bg-panel text-text-muted border-white/10 hover:border-white/20'}`}>
          <Settings2 size={16} />
        </button>
      </div>

      {/* ── Settings panel ─────────────────────────────── */}
      {showSettings && (
        <div className="w-full max-w-lg mb-4 bg-bg-panel rounded-xl border border-accent-amber/20 p-5 animate-slide-up" onClick={e => e.stopPropagation()}>
          <p className="text-accent-amber font-body text-xs uppercase tracking-widest mb-4">Orchestra Tuning Settings</p>

          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-text-primary font-body text-sm">Expressive Intonation</p>
              <p className="text-text-muted font-body text-xs mt-0.5">Shifts the "perfect" target by a few cents to match ensemble temperament for the selected key</p>
            </div>
            <button onClick={() => setOrchTuning(v => !v)}
              className={`relative w-11 h-6 rounded-full border transition-all flex-shrink-0 ml-4 ${orchTuning ? 'bg-accent-amber border-accent-amber' : 'bg-white/10 border-white/20'}`}>
              <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${orchTuning ? 'left-5' : 'left-0.5'}`} />
            </button>
          </div>

          {orchTuning && (
            <div>
              <p className="text-text-muted font-body text-xs mb-2">Key Signature ({tempOffset >= 0 ? '+' : ''}{tempOffset}¢ offset)</p>
              <div className="flex flex-wrap gap-1.5">
                {KEY_OPTIONS.map(k => (
                  <button key={k} onClick={() => setKeySignature(k)}
                    className={`px-3 py-1 rounded-lg font-body text-xs border transition-all ${k === keySignature ? 'bg-accent-amber/15 text-accent-amber border-accent-amber/40' : 'bg-white/5 text-text-muted border-white/10 hover:border-white/20'}`}>
                    {k}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Main card ──────────────────────────────────── */}
      <div className="w-full max-w-lg bg-bg-panel rounded-2xl border border-white/5 p-7 flex flex-col items-center gap-5">

        {/* Frequency + note name */}
        <div className="flex items-end justify-center gap-5 w-full">
          <div className="text-center">
            <div className="font-header tabular-nums leading-none transition-all duration-100"
              style={{ fontSize: '4.5rem', color: style.text, textShadow: style.glow }}>
              {isListening && currentNote ? currentNote.frequency.toFixed(1) : '—'}
            </div>
            <div className="text-text-muted font-body text-sm mt-0.5">Hz</div>
          </div>
          <div className="text-center pb-1">
            <div className="font-header leading-none transition-all duration-100"
              style={{ fontSize: '3.5rem', color: style.text, textShadow: style.glow }}>
              {isListening && currentNote
                ? `${currentNote.name}${currentNote.octave}`
                : <span className="text-text-muted/20 text-5xl">—</span>}
            </div>
          </div>
        </div>

        {/* SVG Needle */}
        <div className="w-full">
          <svg viewBox="0 0 320 170" className="w-full max-w-sm mx-auto overflow-visible">
            <defs>
              <filter id="tglow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="3.5" result="blur"/>
                <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
              </filter>
            </defs>
            <path d="M 50 155 A 120 120 0 0 1 270 155" fill="none" stroke="#1a2438" strokeWidth="20" strokeLinecap="round"/>
            <path d="M 50 155 A 120 120 0 0 1 160 35"  fill="none" stroke="#dc262620" strokeWidth="20" strokeLinecap="round"/>
            <path d="M 160 35 A 120 120 0 0 1 270 155" fill="none" stroke="#dc262620" strokeWidth="20" strokeLinecap="round"/>
            <path d="M 142 40 A 120 120 0 0 1 178 40"  fill="none" stroke="#10b98145" strokeWidth="20"/>
            {[-80,-60,-40,-20,0,20,40,60,80].map(deg => {
              const rad = ((-90 + deg) * Math.PI) / 180;
              const cx = 160, cy = 155, r = 120;
              return <line key={deg} x1={cx+(r-15)*Math.cos(rad)} y1={cy+(r-15)*Math.sin(rad)} x2={cx+(r+3)*Math.cos(rad)} y2={cy+(r+3)*Math.sin(rad)} stroke={deg===0?'#10b98160':'#2d3f58'} strokeWidth={deg===0?2.5:1.5}/>;
            })}
            <g style={{ transformOrigin:'160px 155px', transform:`rotate(${needleDeg}deg)`, transition:'transform 0.055s ease-out' }}>
              <line x1="160" y1="155" x2="160" y2="47" stroke={style.text} strokeWidth="2.5" strokeLinecap="round" filter="url(#tglow)"/>
              <line x1="160" y1="155" x2="160" y2="170" stroke={style.text} strokeWidth="4" strokeLinecap="round" opacity="0.4"/>
            </g>
            <circle cx="160" cy="155" r="8" fill={style.text} filter="url(#tglow)"/>
            <circle cx="160" cy="155" r="3" fill="#0a0f1a"/>
            <text x="36"  y="166" fill="#dc262680" fontSize="12" fontFamily="sans-serif" textAnchor="middle">♭</text>
            <text x="160" y="24"  fill="#10b98180" fontSize="12" fontFamily="sans-serif" textAnchor="middle">●</text>
            <text x="284" y="166" fill="#dc262680" fontSize="12" fontFamily="sans-serif" textAnchor="middle">♯</text>
          </svg>
          <div className="text-center -mt-1">
            <span className="font-body text-base tabular-nums transition-all duration-100" style={{ color: style.text }}>
              {isListening && currentNote
                ? centsLabel(adjustedCents) + (orchTuning && tempOffset !== 0 ? ` (${tempOffset >= 0 ? '+' : ''}${tempOffset}¢ key offset)` : '')
                : isListening ? 'Waiting for signal…' : 'Press Start Tuner'}
            </span>
          </div>
        </div>

        {/* Status chip */}
        <div className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full border font-body text-sm transition-all
          ${state === 'perfect' ? 'bg-feedback-success/12 text-feedback-success border-feedback-success/30' : ''}
          ${state === 'close'   ? 'bg-accent-amber/12 text-accent-amber border-accent-amber/30' : ''}
          ${state === 'off' || state === 'far' ? 'bg-feedback-error/12 text-feedback-error border-feedback-error/25' : ''}
          ${state === 'idle'    ? 'bg-white/5 text-text-muted border-white/10' : ''}
        `}>
          <span className={`w-1.5 h-1.5 rounded-full ${state === 'perfect' ? 'bg-feedback-success animate-breath' : state === 'close' ? 'bg-accent-amber animate-breath' : state === 'off' || state === 'far' ? 'bg-feedback-error animate-breath' : 'bg-text-muted/30'}`}/>
          {state === 'perfect' ? 'Perfect Pitch' : state === 'close' ? 'Nearly There' : state === 'off' ? 'Adjust Intonation' : state === 'far' ? 'Out of Tune' : isListening ? 'Listening…' : 'Ready'}
        </div>

        {/* Oscilloscope */}
        <div className="w-full">
          <p className="text-text-muted font-body text-[10px] uppercase tracking-widest mb-2">Live Waveform</p>
          <Oscilloscope getWaveform={getWaveform} isListening={isListening} color={style.text} />
        </div>

        <SignalMeter rms={isListening ? rmsLevel : 0} color={style.text} />

        {error && (
          <div className="w-full bg-feedback-error/10 border border-feedback-error/30 rounded-xl px-4 py-3 text-center">
            <p className="text-feedback-error font-body text-sm">{error}</p>
          </div>
        )}

        {/* Start / Stop mic */}
        <button onClick={toggleMic}
          className={`w-full flex items-center justify-center gap-2.5 py-3.5 rounded-xl font-body font-semibold text-base transition-all
            ${isListening ? 'bg-feedback-error/15 text-feedback-error border border-feedback-error/30 hover:bg-feedback-error/25' : 'bg-accent-amber text-bg-deep hover:shadow-[0_0_28px_var(--color-accent-amber)/55] active:scale-[0.98]'}`}>
          {isListening ? <><MicOff size={18}/> Stop Tuner</> : <><Mic2 size={18}/> Start Tuner</>}
        </button>
      </div>

      {/* ── Reference Drone ────────────────────────────── */}
      <div className="w-full max-w-lg mt-5 bg-bg-panel rounded-xl border border-white/5 p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <p className="text-text-muted font-body text-[10px] uppercase tracking-widest">Reference Drone</p>
          {droning && (
            <span className="flex items-center gap-1.5 text-accent-amber font-body text-xs">
              <span className="w-1.5 h-1.5 rounded-full bg-accent-amber animate-breath"/>
              Sounding
            </span>
          )}
        </div>
        <div className="grid grid-cols-4 gap-2">
          {openStrings.map(({ name, midi }) => {
            const freq  = midiToFreq(midi, a4);
            const active = droning && droneNote === midi;
            return (
              <button key={name} onClick={() => toggleDrone(midi)}
                className={`flex flex-col items-center gap-1 py-3 rounded-xl border transition-all
                  ${active
                    ? 'bg-accent-amber/15 border-accent-amber text-accent-amber shadow-[0_0_16px_var(--color-accent-amber)/30]'
                    : 'bg-white/3 border-white/8 text-text-muted hover:border-white/20 hover:text-text-primary'}`}>
                <span className="font-header text-xl">{name}</span>
                <span className="font-body text-[10px] tabular-nums">{freq.toFixed(0)} Hz</span>
                {active ? <VolumeX size={12}/> : <Volume2 size={12}/>}
              </button>
            );
          })}
        </div>
        <p className="text-text-muted/50 font-body text-[10px] mt-3 text-center">Tap an open string to play a warm cello drone · Tap again to stop</p>
      </div>

      {/* ── A4 Reference ───────────────────────────────── */}
      <div className="w-full max-w-lg mt-4">
        <p className="text-text-muted font-body text-[10px] uppercase tracking-widest mb-2">A4 Reference</p>
        <div className="flex gap-2">
          {A4_OPTIONS.map(f => (
            <button key={f} onClick={() => setA4(f)}
              className={`flex-1 py-2 rounded-lg font-body text-sm border transition-all
                ${f === a4 ? 'bg-accent-amber/15 text-accent-amber border-accent-amber/40 shadow-[0_0_10px_var(--color-accent-amber)/20]' : 'bg-bg-panel text-text-muted border-white/10 hover:border-white/20'}`}>
              {f}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
