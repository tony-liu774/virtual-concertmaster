import { useState, useRef, useCallback, useEffect } from 'react';
import { Mic2, Volume2, SkipForward, Trophy, Zap, ChevronRight, Swords } from 'lucide-react';
import { useAudioAnalyzer } from '../hooks/useAudioAnalyzer.js';
import { useInstrumentStore } from '../store/instrumentStore.js';
import { INSTRUMENT_RANGES, midiToFreq } from '../utils/musicTheory.js';

// ── Level system ─────────────────────────────────────────────
const LEVELS = [
  { level: 1,  title: 'Novice Listener',          threshold: 0     },
  { level: 2,  title: 'Apprentice Minstrel',      threshold: 300   },
  { level: 3,  title: 'Minstrel',                 threshold: 700   },
  { level: 4,  title: 'Journeyman Bard',          threshold: 1300  },
  { level: 5,  title: 'Bard',                     threshold: 2200  },
  { level: 6,  title: 'Arcane Bard',              threshold: 3400  },
  { level: 7,  title: 'Loremaster',               threshold: 5000  },
  { level: 8,  title: 'Grand Minstrel',           threshold: 7000  },
  { level: 9,  title: 'Apprentice Concertmaster', threshold: 9500  },
  { level: 10, title: 'Grand Concertmaster',      threshold: 13000 },
];

function getLevelInfo(score) {
  let idx = 0;
  for (let i = LEVELS.length - 1; i >= 0; i--) {
    if (score >= LEVELS[i].threshold) { idx = i; break; }
  }
  const current  = LEVELS[idx];
  const next     = LEVELS[idx + 1] ?? null;
  const progress = next
    ? (score - current.threshold) / (next.threshold - current.threshold)
    : 1;
  return { current, next, progress };
}

// ── Note pools per instrument ─────────────────────────────────
const NOTE_POOLS = {
  violin: [
    { name: 'G4', midi: 67 }, { name: 'A4', midi: 69 }, { name: 'B4', midi: 71 },
    { name: 'C5', midi: 72 }, { name: 'D5', midi: 74 }, { name: 'E5', midi: 76 },
    { name: 'F#5',midi: 78 }, { name: 'G5', midi: 79 }, { name: 'A5', midi: 81 },
    { name: 'D4', midi: 62 }, { name: 'E4', midi: 64 }, { name: 'C4', midi: 60 },
  ],
  viola: [
    { name: 'C4', midi: 60 }, { name: 'D4', midi: 62 }, { name: 'E4', midi: 64 },
    { name: 'F4', midi: 65 }, { name: 'G4', midi: 67 }, { name: 'A4', midi: 69 },
    { name: 'B4', midi: 71 }, { name: 'C5', midi: 72 }, { name: 'D5', midi: 74 },
    { name: 'G3', midi: 55 }, { name: 'A3', midi: 57 },
  ],
  cello: [
    { name: 'C3', midi: 48 }, { name: 'D3', midi: 50 }, { name: 'E3', midi: 52 },
    { name: 'G3', midi: 55 }, { name: 'A3', midi: 57 }, { name: 'B3', midi: 59 },
    { name: 'C4', midi: 60 }, { name: 'D4', midi: 62 }, { name: 'A2', midi: 45 },
  ],
  bass: [
    { name: 'E2', midi: 40 }, { name: 'A2', midi: 45 }, { name: 'D3', midi: 50 },
    { name: 'G3', midi: 55 }, { name: 'A3', midi: 57 }, { name: 'B2', midi: 47 },
    { name: 'C3', midi: 48 }, { name: 'G2', midi: 43 }, { name: 'F#2',midi: 42 },
  ],
};

const PASS_CENTS      = 15;
const VERIFY_DURATION = 3000;

// ── Reference tone (warm sawtooth cello-like) ─────────────────
function playReferenceNote(freq, duration = 2.2) {
  const ctx  = new (window.AudioContext || window.webkitAudioContext)();
  const osc  = ctx.createOscillator();
  const filt = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  osc.type             = 'sawtooth';
  osc.frequency.value  = freq;
  filt.type            = 'lowpass';
  filt.frequency.value = 1700;
  filt.Q.value         = 0.9;
  gain.gain.setValueAtTime(0, ctx.currentTime);
  gain.gain.linearRampToValueAtTime(0.24, ctx.currentTime + 0.07);
  gain.gain.setValueAtTime(0.24, ctx.currentTime + duration - 0.25);
  gain.gain.linearRampToValueAtTime(0, ctx.currentTime + duration);
  osc.connect(filt); filt.connect(gain); gain.connect(ctx.destination);
  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + duration);
  osc.onended = () => ctx.close();
}

// ── Stone Dragon SVG ──────────────────────────────────────────
// Frontal sleeping view — chest weak-point at SVG (350, 348)
// viewBox 0 0 700 560
function StoneDragon({ dragonState, result, phase, successKey }) {
  const isResonating = dragonState === 'resonating';
  const isStruck     = dragonState === 'struck';

  const glowStyle = {
    filter: isResonating
      ? 'drop-shadow(0 0 22px #c9a227) drop-shadow(0 0 55px #c9a22780) drop-shadow(0 0 100px #c9a22730)'
      : isStruck
      ? 'drop-shadow(0 0 14px #dc2626) drop-shadow(0 0 36px #dc262650)'
      : 'none',
    transition: 'filter 0.45s ease',
  };

  const reticleStroke = phase === 'result'
    ? (result?.pass ? '#10b981' : '#dc2626')
    : '#c9a22790';

  const showSuccessRings = phase === 'result' && result?.pass;
  const showFailFlash    = phase === 'result' && !result?.pass;

  return (
    <div className="w-full max-w-2xl mx-auto" style={glowStyle}>
      <svg viewBox="0 0 700 560" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full">
        <defs>
          <radialGradient id="pq-body" cx="48%" cy="38%" r="58%">
            <stop offset="0%"   stopColor="#263d55"/>
            <stop offset="100%" stopColor="#0f1a28"/>
          </radialGradient>
          <radialGradient id="pq-chest" cx="50%" cy="45%" r="55%">
            <stop offset="0%"   stopColor="#2a4262"/>
            <stop offset="100%" stopColor="#182438"/>
          </radialGradient>
          <radialGradient id="pq-wing" cx="50%" cy="25%" r="70%">
            <stop offset="0%"   stopColor="#101c2a"/>
            <stop offset="100%" stopColor="#060e18"/>
          </radialGradient>
          <radialGradient id="pq-floor" cx="50%" cy="100%" r="55%">
            <stop offset="0%"   stopColor={isResonating ? '#c9a22718' : '#c9a22710'}/>
            <stop offset="100%" stopColor="transparent"/>
          </radialGradient>
        </defs>

        {/* ── Dungeon atmosphere ──────────────────────────── */}
        <ellipse cx="350" cy="545" rx="370" ry="90" fill="url(#pq-floor)"/>

        {/* Magical ground runes */}
        <g opacity={isResonating ? 0.35 : 0.12} style={{ transition: 'opacity 0.6s' }}>
          <circle cx="350" cy="530" r="148" stroke="#c9a227" strokeWidth="0.8" fill="none"/>
          <circle cx="350" cy="530" r="112" stroke="#c9a227" strokeWidth="0.5" fill="none"/>
          {[0,45,90,135,180,225,270,315].map(deg => {
            const r = (deg * Math.PI) / 180;
            return (
              <line key={deg}
                x1={350 + Math.cos(r) * 62}  y1={530 + Math.sin(r) * 62}
                x2={350 + Math.cos(r) * 148} y2={530 + Math.sin(r) * 148}
                stroke="#c9a227" strokeWidth="0.6"/>
            );
          })}
        </g>

        {/* ── LEFT WING (background) ─────────────────────── */}
        <path d="M 208,268 C 168,218 95,152 52,108 C 28,86 18,128 38,172 C 58,214 122,234 182,256 Z"
              fill="url(#pq-wing)"/>
        <line x1="208" y1="268" x2="52"  y2="108" stroke="#1e2f42" strokeWidth="1.2" opacity="0.6"/>
        <line x1="208" y1="268" x2="74"  y2="132" stroke="#1e2f42" strokeWidth="0.9" opacity="0.4"/>
        <line x1="208" y1="268" x2="100" y2="162" stroke="#1e2f42" strokeWidth="0.7" opacity="0.3"/>
        {/* Wing finger bones */}
        <path d="M 208,268 L 52,108" stroke="#162030" strokeWidth="2" opacity="0.25"/>
        <path d="M 208,268 L 38,172" stroke="#162030" strokeWidth="1.5" opacity="0.2"/>

        {/* ── RIGHT WING (background) ────────────────────── */}
        <path d="M 492,268 C 532,218 605,152 648,108 C 672,86 682,128 662,172 C 642,214 578,234 518,256 Z"
              fill="url(#pq-wing)"/>
        <line x1="492" y1="268" x2="648" y2="108" stroke="#1e2f42" strokeWidth="1.2" opacity="0.6"/>
        <line x1="492" y1="268" x2="626" y2="132" stroke="#1e2f42" strokeWidth="0.9" opacity="0.4"/>
        <line x1="492" y1="268" x2="600" y2="162" stroke="#1e2f42" strokeWidth="0.7" opacity="0.3"/>
        <path d="M 492,268 L 648,108" stroke="#162030" strokeWidth="2" opacity="0.25"/>
        <path d="M 492,268 L 662,172" stroke="#162030" strokeWidth="1.5" opacity="0.2"/>

        {/* ── TAIL ───────────────────────────────────────── */}
        <path d="M 350,492 C 306,514 272,526 260,518 C 248,510 252,497 268,492"
              stroke="#111e2d" strokeWidth="30" strokeLinecap="round" fill="none"/>
        <path d="M 350,492 C 306,514 272,526 260,518 C 248,510 252,497 268,492"
              stroke="#1e2e42" strokeWidth="20" strokeLinecap="round" fill="none"/>
        <polygon points="260,518 244,530 254,544 270,522" fill="#0f1825"/>

        {/* ── MAIN BODY ──────────────────────────────────── */}
        <ellipse cx="350" cy="395" rx="218" ry="168" fill="url(#pq-body)"/>

        {/* Scale texture rows */}
        {[
          [186,390],[208,368],[232,352],[468,390],[490,368],[512,352],
          [196,412],[220,432],[248,448],[452,412],[476,432],[502,448],
        ].map(([cx, cy], i) => (
          <path key={i}
            d={`M ${cx-9},${cy} C ${cx},${cy-11} ${cx+9},${cy}`}
            stroke="#2d4260" strokeWidth="1.5" fill="none" opacity="0.5"/>
        ))}

        {/* ── FORELEGS ───────────────────────────────────── */}
        {/* Left foreleg */}
        <path d="M 175,348 C 152,392 138,432 132,460"
              stroke="#111e2d" strokeWidth="34" strokeLinecap="round" fill="none"/>
        <path d="M 175,348 C 152,392 138,432 132,460"
              stroke="#1c2d3e" strokeWidth="24" strokeLinecap="round" fill="none"/>
        {[-16,-5,6,17].map((dx, i) => (
          <path key={i}
            d={`M ${134+dx},${462} L ${126+dx+dx*0.4},${480}`}
            stroke="#3a5268" strokeWidth="3.5" strokeLinecap="round"/>
        ))}

        {/* Right foreleg */}
        <path d="M 525,348 C 548,392 562,432 568,460"
              stroke="#111e2d" strokeWidth="34" strokeLinecap="round" fill="none"/>
        <path d="M 525,348 C 548,392 562,432 568,460"
              stroke="#1c2d3e" strokeWidth="24" strokeLinecap="round" fill="none"/>
        {[-17,-6,5,16].map((dx, i) => (
          <path key={i}
            d={`M ${568+dx},${462} L ${576+dx+dx*0.4},${480}`}
            stroke="#3a5268" strokeWidth="3.5" strokeLinecap="round"/>
        ))}

        {/* ── CHEST (target zone) ────────────────────────── */}
        {/* Outer chest plate */}
        <ellipse cx="350" cy="348" rx="108" ry="92" fill="url(#pq-chest)"/>
        {/* Mid chest */}
        <ellipse cx="350" cy="348" rx="68" ry="56" fill="#1e3152" opacity="0.85"/>
        {/* Inner core — glows amber when resonating */}
        <ellipse cx="350" cy="348" rx="34" ry="28" fill={isResonating ? '#c9a22730' : '#162540'}>
          <animate attributeName="rx" values="34;38;34" dur="4s" repeatCount="indefinite"/>
          <animate attributeName="ry" values="28;32;28" dur="4s" repeatCount="indefinite"/>
        </ellipse>
        {/* Breathing pulse on chest */}
        <ellipse cx="350" cy="348" rx="108" ry="92" fill="#c9a227" opacity="0">
          <animate attributeName="opacity" values="0;0.05;0" dur="4.2s" repeatCount="indefinite"/>
        </ellipse>

        {/* ── UPPER TORSO / SHOULDER BULK ────────────────── */}
        <ellipse cx="195" cy="305" rx="58" ry="46" fill="#1c2d3e"/>
        <ellipse cx="505" cy="305" rx="58" ry="46" fill="#1c2d3e"/>

        {/* ── NECK ───────────────────────────────────────── */}
        <path d="M 306,270 C 302,242 308,218 316,202"
              stroke="#111e2d" strokeWidth="56" strokeLinecap="round" fill="none"/>
        <path d="M 394,270 C 398,242 392,218 384,202"
              stroke="#111e2d" strokeWidth="56" strokeLinecap="round" fill="none"/>
        <path d="M 306,270 C 302,242 308,218 316,202"
              stroke="#1e2d40" strokeWidth="40" strokeLinecap="round" fill="none"/>
        <path d="M 394,270 C 398,242 392,218 384,202"
              stroke="#1e2d40" strokeWidth="40" strokeLinecap="round" fill="none"/>

        {/* ── HEAD ───────────────────────────────────────── */}
        {/* Head shadow for depth */}
        <path d="M 258,88 L 350,60 L 442,88 L 428,162 L 394,195 L 350,202 L 306,195 L 272,162 Z"
              fill="#0d1825"/>
        {/* Head main */}
        <path d="M 262,90 L 350,63 L 438,90 L 424,160 L 390,192 L 350,198 L 310,192 L 276,160 Z"
              fill="#1c2d3e"/>
        {/* Brow ridge subtle depth */}
        <path d="M 274,112 C 292,100 316,96 332,104" stroke="#2e4562" strokeWidth="4.5" fill="none"/>
        <path d="M 426,112 C 408,100 384,96 368,104" stroke="#2e4562" strokeWidth="4.5" fill="none"/>
        {/* Brow plate (raised) */}
        <path d="M 278,106 C 295,98 314,96 328,103" stroke="#3a5572" strokeWidth="2" fill="none" opacity="0.7"/>
        <path d="M 422,106 C 405,98 386,96 372,103" stroke="#3a5572" strokeWidth="2" fill="none" opacity="0.7"/>

        {/* Closed eyes — amber sleeping slits */}
        <path d="M 286,124 C 302,114 322,114 336,124"
              stroke="#c9a227" strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.55"/>
        <path d="M 364,124 C 378,114 398,114 414,124"
              stroke="#c9a227" strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.55"/>
        {/* Subtle eye glow */}
        <ellipse cx="311" cy="120" rx="14" ry="5" fill="#c9a227" opacity="0.07"/>
        <ellipse cx="389" cy="120" rx="14" ry="5" fill="#c9a227" opacity="0.07"/>

        {/* Snout */}
        <path d="M 280,158 L 298,198 L 350,205 L 402,198 L 420,158" fill="#141f2e"/>
        {/* Jaw line accent */}
        <path d="M 282,162 L 299,197 L 350,203 L 401,197 L 418,162"
              stroke="#263d52" strokeWidth="1" fill="none" opacity="0.5"/>
        {/* Nostril slits */}
        <ellipse cx="322" cy="180" rx="7.5" ry="5.5" fill="#090f1a" opacity="0.95"/>
        <ellipse cx="378" cy="180" rx="7.5" ry="5.5" fill="#090f1a" opacity="0.95"/>
        {/* Nose smoke wisps */}
        <path d="M 320,176 Q 313,162 317,148" stroke="#4a6a88" strokeWidth="1.5"
              fill="none" opacity="0.22" strokeLinecap="round"/>
        <path d="M 380,176 Q 387,162 383,148" stroke="#4a6a88" strokeWidth="1.5"
              fill="none" opacity="0.22" strokeLinecap="round"/>
        {/* Teeth hint */}
        {[0,1,2,3,4].map(i => (
          <path key={i} d={`M ${298+i*26},197 L ${302+i*26},210`}
                stroke="#1a2d3f" strokeWidth="3.5" strokeLinecap="round" opacity="0.7"/>
        ))}

        {/* ── HORNS ──────────────────────────────────────── */}
        <polygon points="274,90 254,34 297,56" fill="#0f1a25"/>
        <polygon points="274,90 262,40 284,54" fill="#162434" opacity="0.55"/>
        <polygon points="426,90 446,34 403,56" fill="#0f1a25"/>
        <polygon points="426,90 438,40 416,54" fill="#162434" opacity="0.55"/>
        {/* Horn ridge detail */}
        <line x1="274" y1="90" x2="254" y2="34" stroke="#263a4e" strokeWidth="1" opacity="0.4"/>
        <line x1="426" y1="90" x2="446" y2="34" stroke="#263a4e" strokeWidth="1" opacity="0.4"/>

        {/* ── DORSAL SPINES ─────────────────────────────── */}
        {[298,320,342,364,386,408].map((x, i) => (
          <polygon key={i} points={`${x},198 ${x-7},165 ${x+7},165`} fill="#0f1825"/>
        ))}

        {/* ── RETICLE (centered on chest at 350,348) ─────── */}
        <g transform="translate(350, 348)">
          {/* Outer rotating dashed ring */}
          <circle r="36" fill="none" stroke={reticleStroke} strokeWidth="1"
                  strokeDasharray="5 5" opacity="0.65">
            <animateTransform attributeName="transform" type="rotate"
                              from="0 0 0" to="360 0 0" dur="14s" repeatCount="indefinite"/>
          </circle>
          {/* Static rings */}
          <circle r="24" fill="none" stroke={reticleStroke} strokeWidth="1.5" opacity="0.85"/>
          {/* Crosshair arms */}
          <line x1="-30" y1="0" x2="-16" y2="0" stroke={reticleStroke} strokeWidth="1.5"
                opacity="0.9" strokeLinecap="round"/>
          <line x1="16"  y1="0" x2="30"  y2="0" stroke={reticleStroke} strokeWidth="1.5"
                opacity="0.9" strokeLinecap="round"/>
          <line x1="0" y1="-30" x2="0" y2="-16" stroke={reticleStroke} strokeWidth="1.5"
                opacity="0.9" strokeLinecap="round"/>
          <line x1="0" y1="16"  x2="0" y2="30"  stroke={reticleStroke} strokeWidth="1.5"
                opacity="0.9" strokeLinecap="round"/>
          {/* Corner brackets */}
          {[[-1,-1],[1,-1],[-1,1],[1,1]].map(([sx,sy],i) => (
            <g key={i}>
              <path d={`M ${sx*26},${sy*26} L ${sx*18},${sy*26}`}
                    stroke={reticleStroke} strokeWidth="1.2" opacity="0.55"/>
              <path d={`M ${sx*26},${sy*26} L ${sx*26},${sy*18}`}
                    stroke={reticleStroke} strokeWidth="1.2" opacity="0.55"/>
            </g>
          ))}
          {/* Center pulsing dot */}
          <circle r="4.5" fill={reticleStroke} opacity="0.95">
            {phase !== 'result' && (
              <animate attributeName="r" values="4.5;6.5;4.5" dur="2.2s" repeatCount="indefinite"/>
            )}
          </circle>
          {/* Success resonance rings */}
          {showSuccessRings && (
            <>
              <circle key={`r1-${successKey}`} r="10" fill="none" stroke="#10b981"
                      strokeWidth="2"   className="ring-expand"/>
              <circle key={`r2-${successKey}`} r="10" fill="none" stroke="#10b981"
                      strokeWidth="1.5" className="ring-expand ring-expand-2"/>
              <circle key={`r3-${successKey}`} r="10" fill="none" stroke="#10b981"
                      strokeWidth="1"   className="ring-expand ring-expand-3"/>
            </>
          )}
          {/* Miss flash ring */}
          {showFailFlash && (
            <circle key={`fail-${successKey}`} r="10" fill="none" stroke="#dc2626"
                    strokeWidth="2" className="ring-expand"/>
          )}
        </g>
      </svg>
    </div>
  );
}

// ── HUD bar ───────────────────────────────────────────────────
function HUD({ score, streak, levelInfo, prevLevel }) {
  const { current, next, progress } = levelInfo;
  const leveledUp = prevLevel !== null && prevLevel < current.level;

  return (
    <div className="flex items-center justify-between gap-4 px-5 py-3
                    bg-black/60 backdrop-blur-md border-b border-accent-amber/10 flex-shrink-0">
      {/* Level + title */}
      <div className={`flex flex-col gap-0.5 ${leveledUp ? 'level-up-flash' : ''}`}>
        <p className="text-accent-amber font-body text-[10px] uppercase tracking-widest">
          Level {current.level}
        </p>
        <p className="text-text-primary font-header text-sm leading-tight">{current.title}</p>
        {/* XP progress bar */}
        <div className="w-32 h-1 bg-white/10 rounded-full overflow-hidden mt-0.5">
          <div
            className="h-full bg-accent-amber rounded-full transition-all duration-700"
            style={{ width: `${Math.min(progress * 100, 100)}%` }}
          />
        </div>
        {next && (
          <p className="text-text-muted/50 font-body text-[9px]">
            {next.threshold - score} pts to {next.title}
          </p>
        )}
      </div>

      {/* Score (center) */}
      <div className="flex flex-col items-center gap-0.5">
        <p className="text-text-muted font-body text-[10px] uppercase tracking-widest">Score</p>
        <p className="font-header text-2xl text-text-primary tabular-nums">{score}</p>
      </div>

      {/* Streak (right) */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5">
          <Trophy size={12} className="text-accent-amber"/>
          <span className="font-body text-sm text-text-primary tabular-nums">{score}</span>
        </div>
        {streak >= 2 && (
          <div className="flex items-center gap-1 bg-accent-amber/15 border border-accent-amber/35
                          rounded-lg px-2.5 py-1.5">
            <Zap size={12} className="text-accent-amber"/>
            <span className="font-body text-xs text-accent-amber font-semibold">{streak}×</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────
const PHASE = {
  IDLE:         'idle',
  PLAYING_REF:  'playing_ref',
  VERIFYING:    'verifying',
  RESULT:       'result',
};

const NARRATIVE = {
  idle:        'The Ancient Dragon Slumbers…  Strike Its Heart With Perfect Pitch.',
  playing_ref: 'The Arcane Tone Resonates Through the Chamber…',
  verifying:   'The Dragon Stirs — Play Your Note!',
  result_pass: '✦ The Dragon Resonates With Your Pitch! ✦',
  result_fail: 'The Dragon Does Not Stir… Adjust Your Intonation.',
};

export default function PitchQuest() {
  const { instrument } = useInstrumentStore();
  const range = INSTRUMENT_RANGES[instrument];
  const pool  = NOTE_POOLS[instrument] ?? NOTE_POOLS.violin;

  const [target,      setTarget]      = useState(() => pool[Math.floor(Math.random() * pool.length)]);
  const [phase,       setPhase]       = useState(PHASE.IDLE);
  const [dragonState, setDragonState] = useState('sleeping');
  const [result,      setResult]      = useState(null);
  const [score,       setScore]       = useState(0);
  const [streak,      setStreak]      = useState(0);
  const [prevLevel,   setPrevLevel]   = useState(null);
  const [successKey,  setSuccessKey]  = useState(0);
  const [countdown,   setCountdown]   = useState(3);
  const [history,     setHistory]     = useState([]);
  const [floatPts,    setFloatPts]    = useState(null); // { pts, id }

  const verifyTimerRef  = useRef(null);
  const countdownRef    = useRef(null);
  const dragonResetRef  = useRef(null);
  const bestCentsRef    = useRef(null);
  const bestNoteRef     = useRef(null);
  const floatTimerRef   = useRef(null);

  const { currentNote, startListening, stopListening } = useAudioAnalyzer({
    minFreq: range.min, maxFreq: range.max,
  });

  const levelInfo = getLevelInfo(score);

  // Track best pitch reading during verify window
  useEffect(() => {
    if (phase !== PHASE.VERIFYING || !currentNote) return;
    const targetFreq = midiToFreq(target.midi);
    const cents = 12 * Math.log2(currentNote.frequency / targetFreq) * 100;
    if (bestCentsRef.current === null || Math.abs(cents) < Math.abs(bestCentsRef.current)) {
      bestCentsRef.current = cents;
      bestNoteRef.current  = `${currentNote.name}${currentNote.octave}`;
    }
  }, [currentNote, phase, target]);

  const pickNewTarget = useCallback(() => {
    const filtered = pool.filter(n => n.midi !== target.midi);
    const next     = filtered[Math.floor(Math.random() * filtered.length)];
    setTarget(next);
    setResult(null);
    setPhase(PHASE.IDLE);
    setDragonState('sleeping');
    bestCentsRef.current = null;
    bestNoteRef.current  = null;
  }, [pool, target]);

  function handleListen() {
    if (phase === PHASE.VERIFYING) return;
    setPhase(PHASE.PLAYING_REF);
    playReferenceNote(midiToFreq(target.midi), 2.2);
    setTimeout(() => {
      setPhase(p => p === PHASE.PLAYING_REF ? PHASE.IDLE : p);
    }, 2400);
  }

  async function handleVerify() {
    bestCentsRef.current = null;
    bestNoteRef.current  = null;
    setCountdown(3);
    setPhase(PHASE.VERIFYING);
    await startListening();

    let secs = 3;
    countdownRef.current = setInterval(() => {
      secs--;
      setCountdown(secs);
      if (secs <= 0) clearInterval(countdownRef.current);
    }, 1000);

    verifyTimerRef.current = setTimeout(async () => {
      clearInterval(countdownRef.current);
      stopListening();

      const cents        = bestCentsRef.current;
      const detectedName = bestNoteRef.current;
      const pass         = cents !== null && Math.abs(cents) <= PASS_CENTS;
      const prevLvl      = getLevelInfo(score).current.level;

      setResult({ pass, cents: cents ?? 0, detectedName: detectedName ?? 'Nothing detected' });
      setPhase(PHASE.RESULT);

      if (pass) {
        const accuracy = Math.max(0, (PASS_CENTS - Math.abs(cents)) / PASS_CENTS);
        const streakBonus = Math.floor(streak / 3);                   // bonus per 3-streak
        const pts = Math.round(100 + accuracy * 60 + streakBonus * 20);

        setScore(s => {
          const newScore = s + pts;
          const newLvl   = getLevelInfo(newScore).current.level;
          if (newLvl > prevLvl) setPrevLevel(prevLvl);
          return newScore;
        });
        setStreak(s => s + 1);
        setSuccessKey(k => k + 1);
        setDragonState('resonating');
        setHistory(h => [{ pass: true,  name: target.name, pts }, ...h.slice(0, 11)]);

        // Show floating score
        const fid = Date.now();
        setFloatPts({ pts, id: fid });
        floatTimerRef.current = setTimeout(() => setFloatPts(null), 1400);

        // Dragon resonates then dims
        dragonResetRef.current = setTimeout(() => setDragonState('sleeping'), 2200);
      } else {
        setStreak(0);
        setDragonState('struck');
        setHistory(h => [{ pass: false, name: target.name, pts: 0 }, ...h.slice(0, 11)]);
        dragonResetRef.current = setTimeout(() => setDragonState('sleeping'), 1200);
      }
    }, VERIFY_DURATION);
  }

  // Cleanup
  useEffect(() => () => {
    clearTimeout(verifyTimerRef.current);
    clearTimeout(dragonResetRef.current);
    clearTimeout(floatTimerRef.current);
    clearInterval(countdownRef.current);
    stopListening();
  }, []); // eslint-disable-line

  // Narrative text
  const narrativeText = phase === PHASE.RESULT
    ? (result?.pass ? NARRATIVE.result_pass : NARRATIVE.result_fail)
    : NARRATIVE[phase];

  const narrativeColor = phase === PHASE.RESULT
    ? (result?.pass ? 'text-feedback-success' : 'text-feedback-error')
    : phase === PHASE.VERIFYING ? 'text-feedback-error' : 'text-text-muted/70';

  const isSharp   = target.name.includes('#');
  const noteLetter = target.name.replace(/[0-9#]/g, '').replace('#', '');
  const noteOctave = target.name.replace(/[A-G#]/g, '');

  return (
    <div className="min-h-screen bg-bg-deep flex flex-col overflow-hidden">

      {/* ── HUD ────────────────────────────────────────────── */}
      <HUD score={score} streak={streak} levelInfo={levelInfo} prevLevel={prevLevel}/>

      {/* ── Dragon arena ────────────────────────────────────── */}
      <div className="flex-1 relative flex flex-col items-center justify-center px-4 pt-2 pb-2 overflow-hidden min-h-0">

        {/* Atmospheric vignette */}
        <div className="absolute inset-0 pointer-events-none"
             style={{ background: 'radial-gradient(ellipse at 50% 60%, transparent 30%, #0a0a12 80%)' }}/>

        {/* Narrative text */}
        <p className={`font-header text-sm md:text-base text-center mb-2 z-10 transition-all duration-500 px-4 ${narrativeColor}`}>
          {narrativeText}
        </p>

        {/* Dragon SVG */}
        <div className="relative z-10 w-full flex items-center justify-center" style={{ maxHeight: '54vh' }}>
          <StoneDragon
            dragonState={dragonState}
            result={result}
            phase={phase}
            successKey={successKey}
          />

          {/* Floating score popup */}
          {floatPts && (
            <div key={floatPts.id}
                 className="absolute top-1/4 left-1/2 -translate-x-1/2 font-header text-2xl
                            text-feedback-success float-score pointer-events-none z-20">
              +{floatPts.pts}
            </div>
          )}
        </div>

        {/* History strip */}
        {history.length > 0 && (
          <div className="flex gap-1.5 mt-2 z-10 flex-wrap justify-center max-w-lg">
            {history.map((h, i) => (
              <div key={i}
                   className={`w-2.5 h-2.5 rounded-full
                     ${h.pass ? 'bg-feedback-success/70' : 'bg-feedback-error/60'}`}
                   title={`${h.pass ? '✓' : '✗'} ${h.name}`}/>
            ))}
          </div>
        )}
      </div>

      {/* ── Action Cards (floating glass UI) ─────────────────── */}
      <div className="flex-shrink-0 px-4 pb-5 pt-2">
        <div className="flex gap-3 max-w-2xl mx-auto">

          {/* ── CARD 1: Target + Listen ───────────────────────── */}
          <div className={`flex-1 rounded-2xl border p-4 backdrop-blur-md transition-all duration-300
            bg-black/70
            ${phase === PHASE.PLAYING_REF
              ? 'border-accent-amber/60 shadow-[0_0_24px_var(--color-accent-amber)/30]'
              : 'border-accent-amber/20'}`}
          >
            <p className="text-accent-amber font-body text-[10px] uppercase tracking-widest mb-2">
              Target Note
            </p>

            {/* Note display */}
            <div className="flex items-end gap-1 mb-1">
              <span className="font-header text-5xl text-text-primary leading-none">
                {noteLetter}
              </span>
              {isSharp && <span className="font-header text-2xl text-accent-amber leading-none mb-1">#</span>}
              <span className="font-body text-lg text-text-muted/70 leading-none mb-1">{noteOctave}</span>
            </div>
            <p className="text-text-muted/60 font-body text-xs mb-3">
              {midiToFreq(target.midi).toFixed(1)} Hz
            </p>

            {/* Listen button */}
            <button
              onClick={handleListen}
              disabled={phase === PHASE.VERIFYING}
              className={`w-full flex items-center justify-center gap-2 rounded-xl py-2.5 font-body
                font-semibold text-sm transition-all
                ${phase === PHASE.PLAYING_REF
                  ? 'bg-accent-amber/25 text-accent-amber border border-accent-amber/50 cursor-default'
                  : phase === PHASE.VERIFYING
                  ? 'bg-white/5 text-text-muted/40 border border-white/5 cursor-not-allowed'
                  : 'bg-accent-amber/15 text-accent-amber border border-accent-amber/30 hover:bg-accent-amber/25'}`}
            >
              <Volume2 size={14}/>
              {phase === PHASE.PLAYING_REF ? 'Playing…' : 'Listen'}
            </button>
          </div>

          {/* ── CARD 2: Verify / Result ───────────────────────── */}
          <div className={`flex-1 rounded-2xl border p-4 backdrop-blur-md transition-all duration-300
            bg-black/70
            ${phase === PHASE.VERIFYING
              ? 'border-feedback-error/60 shadow-[0_0_24px_var(--color-feedback-error)/25]'
              : phase === PHASE.RESULT
              ? result?.pass
                ? 'border-feedback-success/50 shadow-[0_0_28px_var(--color-feedback-success)/20]'
                : 'border-feedback-error/40'
              : 'border-accent-amber/20'}`}
          >
            <p className="text-accent-amber font-body text-[10px] uppercase tracking-widest mb-2">
              {phase === PHASE.RESULT ? 'Result' : 'Verify Pitch'}
            </p>

            {/* Content area */}
            {phase === PHASE.VERIFYING ? (
              <div className="flex flex-col gap-2 mb-3">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-feedback-error animate-breath"/>
                  <span className="font-body text-sm text-feedback-error uppercase tracking-widest">
                    Listening… {countdown}s
                  </span>
                </div>
                <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <div className="h-full bg-feedback-error rounded-full transition-all duration-1000"
                       style={{ width: `${(countdown / 3) * 100}%` }}/>
                </div>
              </div>
            ) : phase === PHASE.RESULT && result ? (
              <div className="mb-3">
                {result.pass ? (
                  <>
                    <p className="font-header text-lg text-feedback-success">✓ Resonance!</p>
                    <p className="font-body text-xs text-feedback-success/70 mt-0.5">
                      {Math.round(Math.abs(result.cents))}¢ deviation
                    </p>
                  </>
                ) : (
                  <>
                    <p className="font-header text-base text-feedback-error">
                      {result.detectedName !== 'Nothing detected'
                        ? `${result.detectedName} detected`
                        : 'Nothing detected'}
                    </p>
                    {result.detectedName !== 'Nothing detected' && (
                      <p className="font-body text-xs text-feedback-error/70 mt-0.5">
                        {result.cents > 0 ? '+' : ''}{Math.round(result.cents)}¢&nbsp;
                        ({result.cents > 0 ? 'sharp' : 'flat'})
                      </p>
                    )}
                  </>
                )}
              </div>
            ) : (
              <div className="mb-3">
                <p className="font-body text-xs text-text-muted/60 leading-relaxed">
                  Play the note on your instrument.<br/>
                  Within ±{PASS_CENTS}¢ = Dragon resonates.
                </p>
              </div>
            )}

            {/* Action button */}
            <button
              onClick={phase === PHASE.RESULT ? pickNewTarget : handleVerify}
              disabled={phase === PHASE.VERIFYING || phase === PHASE.PLAYING_REF}
              className={`w-full flex items-center justify-center gap-2 rounded-xl py-2.5 font-body
                font-semibold text-sm transition-all
                ${phase === PHASE.RESULT
                  ? 'bg-accent-amber text-bg-deep hover:shadow-[0_0_20px_var(--color-accent-amber)/50]'
                  : phase === PHASE.VERIFYING || phase === PHASE.PLAYING_REF
                  ? 'bg-white/5 text-text-muted/40 border border-white/5 cursor-not-allowed'
                  : 'bg-white/10 text-text-primary border border-white/15 hover:bg-white/15 hover:border-accent-amber/30'}`}
            >
              {phase === PHASE.RESULT
                ? <><SkipForward size={14}/> Next Target</>
                : <><Swords size={14}/> Strike!</>}
            </button>
          </div>
        </div>

        {/* Tiny legend */}
        <p className="text-center text-text-muted/35 font-body text-[9px] mt-2 uppercase tracking-widest">
          Listen → Play → Strike · ±{PASS_CENTS}¢ tolerance
        </p>
      </div>
    </div>
  );
}
