import { useEffect, useRef, useState, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { BarChart3, TrendingUp, Mic2, RotateCcw, Loader2, FlaskConical } from 'lucide-react';
import { SAMPLE_PIECES, transposePieceForInstrument } from '../utils/samplePieces.js';
import { useStats } from '../contexts/StatsContext.jsx';
import { analyzeSession, buildSessionPayload } from '../utils/aiCoach.js';
import { computeMetrics, nextDemoScenario } from '../utils/sessionMetrics.js';
import SheetMusicViewer from '../components/SheetMusicViewer.jsx';

// ── Heat map helpers ──────────────────────────────────────────
// Constants mirror SheetMusicViewer so overlay coords align exactly
const MEASURES_PER_LINE = 4;
const STAVE_WIDTH       = 210;
const STAVE_X_PAD       = 16;
const STAVE_Y           = 55;
const LINE_HEIGHT       = 130;

function heatColor(pct) {
  if (pct === null) return 'bg-white/5 border-white/10';
  if (pct >= 85)   return 'bg-feedback-success/60 border-feedback-success/40';
  if (pct >= 65)   return 'bg-accent-amber/50 border-accent-amber/30';
  if (pct >= 40)   return 'bg-feedback-error/40 border-feedback-error/30';
  return 'bg-feedback-error/70 border-feedback-error/60';
}

/** Build per-measure accuracy array from raw log (for real sessions) */
function buildHeatData(log, totalMeasures) {
  const measures = Array.from({ length: totalMeasures }, () => ({ heard: 0, inTune: 0 }));
  for (const entry of log) {
    const m = entry.measureIdx ?? 0;
    if (m < totalMeasures) {
      if (entry.heard)  measures[m].heard++;
      if (entry.inTune) measures[m].inTune++;
    }
  }
  return measures.map(m => m.heard === 0 ? null : Math.round((m.inTune / m.heard) * 100));
}

/**
 * Generate plausible heat data for demo scenarios (no raw log available).
 * Hot measures are set low; others reflect the session score.
 */
function buildDemoHeatData(scenario, totalMeasures) {
  return Array.from({ length: totalMeasures }, (_, i) => {
    const m = i + 1;
    return scenario.heatMapMeasures.includes(m)
      ? Math.max(10, scenario.score - 30)
      : Math.min(100, scenario.score + 15);
  });
}

/**
 * SVG overlay — crimson measure boxes drawn over the sheet music.
 */
function HeatMapOverlay({ heatMapMeasures = [], totalMeasures = 12, svgWidth = 0 }) {
  if (!heatMapMeasures.length || !svgWidth) return null;
  const measuresOnPage = Math.min(totalMeasures, 8);
  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      style={{ width: svgWidth, height: Math.ceil(measuresOnPage / MEASURES_PER_LINE) * LINE_HEIGHT + 80 }}
    >
      {heatMapMeasures.map(m => {
        const idx  = m - 1;
        if (idx < 0 || idx >= measuresOnPage) return null;
        const col  = idx % MEASURES_PER_LINE;
        const line = Math.floor(idx / MEASURES_PER_LINE);
        const x    = STAVE_X_PAD + col * STAVE_WIDTH;
        const y    = STAVE_Y + line * LINE_HEIGHT - 8;
        const w    = STAVE_WIDTH - 2;
        const h    = LINE_HEIGHT - 12;
        return (
          <g key={m}>
            <rect x={x} y={y} width={w} height={h} rx="4"
              fill="#dc2626" fillOpacity="0.18"
              stroke="#dc2626" strokeOpacity="0.6" strokeWidth="1.5"/>
            <text x={x + w - 6} y={y + 13}
              fill="#dc2626" fontSize="9" fontFamily="monospace"
              textAnchor="end" opacity="0.9">
              m.{m}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────
export default function Report() {
  const navigate    = useNavigate();
  const { saveSession } = useStats();
  const savedRef    = useRef(false);
  const sheetRef    = useRef(null);

  // ── 1. Read session data from sessionStorage ──────────────
  // Parsed once at mount (stable via useMemo with empty deps).
  const sessionData = useMemo(() => {
    try {
      const raw = sessionStorage.getItem('sessionLog');
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }, []);

  const hasRealData = !!(sessionData?.log?.length > 0);

  // ── 2. Compute sessionResult ──────────────────────────────
  // Real session  → computeMetrics over the actual log
  // Demo / empty  → pick the next cycling scenario from MOCK_SCENARIOS
  const realMetrics = useMemo(
    () => hasRealData ? computeMetrics(sessionData.log) : null,
    [], // eslint-disable-line
  );

  // nextDemoScenario mutates localStorage (cycles A→B→C→A), called once
  const [demoScenario] = useState(() => hasRealData ? null : nextDemoScenario());

  /** The unified data contract — all JSX reads exclusively from this object */
  const sr = realMetrics
    ? {
        ...realMetrics,
        isDemo:    false,
        pieceTitle: sessionData.pieceTitle ?? 'Practice Session',
        elapsed:   sessionData.elapsed ?? 0,
      }
    : demoScenario;

  // ── 3. Piece for sheet-music rendering (real sessions only) ─
  const reportInstrument = sessionData?.instrument ?? 'violin';
  const rawPiece  = hasRealData
    ? (SAMPLE_PIECES[sessionData.pieceId] ?? null)
    : null;
  const piece     = rawPiece
    ? transposePieceForInstrument(rawPiece, reportInstrument)
    : null;
  const totalMeasures = piece?.measures?.length ?? 8;

  // ── 4. Per-measure heat data ──────────────────────────────
  const heatData = useMemo(() => {
    if (hasRealData && sessionData.log)
      return buildHeatData(sessionData.log, totalMeasures);
    return buildDemoHeatData(sr, totalMeasures);
  }, []); // eslint-disable-line

  const weakMeasures = heatData
    .map((pct, i) => ({ measure: i + 1, pct }))
    .filter(m => m.pct !== null && m.pct < 65)
    .sort((a, b) => a.pct - b.pct)
    .slice(0, 3);

  // ── 5. AI feedback state ──────────────────────────────────
  // Demo: pre-fill from scenario immediately (no API call needed)
  // Real: start null, fill after async analyzeSession call
  const [aiResult,  setAiResult]  = useState(
    sr.isDemo
      ? { feedbackText: sr.feedbackText, heatMapMeasures: sr.heatMapMeasures, source: 'mock' }
      : null,
  );
  const [aiLoading, setAiLoading] = useState(!sr.isDemo);

  // ── 6. SVG width for overlay positioning ──────────────────
  const [svgWidth, setSvgWidth] = useState(0);
  useEffect(() => {
    if (!sheetRef.current) return;
    const obs = new ResizeObserver(e => setSvgWidth(e[0].contentRect.width));
    obs.observe(sheetRef.current);
    setSvgWidth(sheetRef.current.offsetWidth);
    return () => obs.disconnect();
  }, []);

  // ── 7. AI call (real sessions only) ──────────────────────
  useEffect(() => {
    if (sr.isDemo) return;
    analyzeSession(buildSessionPayload(sessionData)).then(result => {
      setAiResult(result);
      setAiLoading(false);
    });
  }, []); // eslint-disable-line

  // ── 8. Save to Practice Vault (real sessions only) ────────
  useEffect(() => {
    if (!savedRef.current && !sr.isDemo && hasRealData) {
      savedRef.current = true;
      saveSession({
        pieceId:     sessionData.pieceId,
        pieceTitle:  sr.pieceTitle,
        accuracy:    sr.score,
        duration:    sr.elapsed,
        pitchPct:    sr.pitchAccuracy,
        coveragePct: sr.notesHeardPercent,
        avgCents:    sr.avgCents,
        sharpCount:  sr.sharp,
        flatCount:   sr.flat,
        totalNotes:  sr.totalTracked,
      });
    }
  }, []); // eslint-disable-line

  // ── 9. Derived display values (pure reads from sr) ────────
  const {
    score, pitchAccuracy, notesHeardPercent,
    intonationTendency, sharp, flat, missed,
    pieceTitle, elapsed, totalTracked, totalInTune,
  } = sr;

  // Heat map measures: prefer AI coaching focus; fall back to all error measures
  const displayHeatMapMeasures = aiResult?.heatMapMeasures?.length
    ? aiResult.heatMapMeasures
    : (sr.heatMapMeasures ?? weakMeasures.map(m => m.measure));

  const scoreColor = score >= 85 ? 'text-feedback-success'
                   : score >= 65 ? 'text-accent-amber'
                   : 'text-feedback-error';
  const scoreGlow  = score >= 85 ? 'shadow-[0_0_40px_var(--color-feedback-success)/25]'
                   : score >= 65 ? 'shadow-[0_0_40px_var(--color-accent-amber)/25]'
                   : 'shadow-[0_0_40px_var(--color-feedback-error)/25]';

  // ─────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-bg-deep px-6 py-8 md:py-12">

      {/* ── Header ──────────────────────────────────────── */}
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <p className="text-accent-amber font-body text-xs uppercase tracking-widest">
              Post-Session Analysis
            </p>
            {sr.isDemo && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-[10px] font-body text-text-muted uppercase tracking-widest">
                <FlaskConical size={9}/> Demo · {sr._scenario}
              </span>
            )}
          </div>
          <h1 className="font-header text-3xl md:text-4xl text-text-primary">{pieceTitle}</h1>
          {elapsed > 0 && (
            <p className="text-text-muted font-body text-sm mt-1">
              {Math.floor(elapsed / 60)}m {elapsed % 60}s · {totalTracked} notes tracked
            </p>
          )}
        </div>
        <button
          onClick={() => navigate('/practice')}
          className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 border border-white/10 text-text-muted font-body text-sm px-4 py-2 rounded-lg transition-all flex-shrink-0"
        >
          <RotateCcw size={14}/> Practice Again
        </button>
      </div>

      {/* ── AI Coach ────────────────────────────────────── */}
      <div className={`bg-bg-panel rounded-2xl border p-6 mb-6 transition-all
        ${aiLoading ? 'border-white/5' : 'border-accent-amber/20'}`}>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <p className="text-accent-amber font-body text-xs uppercase tracking-widest">AI Coach</p>
          {!aiLoading && aiResult && (
            aiResult.source === 'gemini' ? (
              <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#1a73e820] border border-[#1a73e840] text-[10px] font-body text-[#4fc3f7] uppercase tracking-widest">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z"/>
                </svg>
                Gemini AI
              </span>
            ) : (
              <span className="px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-[10px] font-body text-text-muted uppercase tracking-widest">
                Built-in · Add VITE_GEMINI_KEY for AI
              </span>
            )
          )}
        </div>
        {aiLoading ? (
          <div className="flex items-center gap-3 text-text-muted">
            <Loader2 size={16} className="animate-spin text-accent-amber"/>
            <span className="font-body text-sm">Analysing your session…</span>
          </div>
        ) : (
          <p className="font-header text-lg text-text-primary leading-relaxed">
            {aiResult?.feedbackText ?? 'No feedback available.'}
          </p>
        )}
      </div>

      {/* ── Score + 3 stat cards ─────────────────────────── */}
      <div className={`bg-bg-panel rounded-2xl border border-white/5 p-8 mb-6
        flex flex-col md:flex-row items-center gap-8 ${scoreGlow}`}>

        {/* Big score circle */}
        <div className="text-center flex-shrink-0">
          <p className="text-text-muted font-body text-xs uppercase tracking-widest mb-2">Overall Score</p>
          <div className={`font-header text-8xl tabular-nums ${scoreColor}`}>{score}</div>
          <div className="text-text-muted font-body text-sm">out of 100</div>
        </div>

        {/* Stat cards */}
        <div className="flex-1 w-full grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            {
              label:   'Pitch Accuracy',
              icon:    Mic2,
              // value and unit render as "{value}{unit}"
              value:   pitchAccuracy,
              unit:    '%',
              sub:     `${totalInTune} of ${totalTracked} notes in tune`,
              colorAt: pitchAccuracy,
              showBar: true,
            },
            {
              label:   'Notes Detected',
              icon:    BarChart3,
              value:   notesHeardPercent,
              unit:    '%',
              sub:     `${missed} note${missed !== 1 ? 's' : ''} not detected by mic`,
              colorAt: notesHeardPercent,
              showBar: true,
            },
            {
              label:   'Intonation',
              icon:    TrendingUp,
              // Descriptive string — not a percentage
              value:   intonationTendency,
              unit:    '',
              sub:     `${sharp} sharp · ${flat} flat errors`,
              // Colour by sharp+flat count relative to heard notes
              colorAt: (sharp + flat) === 0 ? 90
                     : (sharp + flat) <= 4   ? 70
                     : 40,
              showBar: false,
            },
          ].map(({ label, value, unit, sub, icon: Icon, colorAt, showBar }) => {
            const c  = colorAt >= 85 ? 'text-feedback-success'
                     : colorAt >= 65 ? 'text-accent-amber'
                     : 'text-feedback-error';
            const bg = colorAt >= 85 ? 'bg-feedback-success'
                     : colorAt >= 65 ? 'bg-accent-amber'
                     : 'bg-feedback-error';
            return (
              <div key={label} className="bg-white/5 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Icon size={13} className={c}/>
                  <span className="text-text-muted font-body text-xs uppercase tracking-wide">{label}</span>
                </div>
                <div className={`font-header text-3xl ${c} mb-1`}>{value}{unit}</div>
                <p className="text-text-muted font-body text-xs mb-2">{sub}</p>
                {showBar && (
                  <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${bg} rounded-full`}
                      style={{ width: `${Math.min(100, Number(value) || 0)}%` }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Measure Heat Map + Sheet Music ──────────────── */}
      <div className="bg-bg-panel rounded-2xl border border-white/5 p-6 mb-6">
        <h2 className="font-header text-lg text-text-primary mb-1">Measure Heat Map</h2>
        <p className="text-text-muted font-body text-xs mb-4">
          Crimson boxes mark measures flagged by the AI coach · Grey = no audio detected
        </p>

        {piece ? (
          <div ref={sheetRef} className="relative">
            <SheetMusicViewer
              piece={{ ...piece, measures: piece.measures.slice(0, 8) }}
              currentNoteGlobal={-1}
              className="rounded-xl overflow-hidden"
            />
            <HeatMapOverlay
              heatMapMeasures={displayHeatMapMeasures}
              totalMeasures={Math.min(totalMeasures, 8)}
              svgWidth={svgWidth}
            />
          </div>
        ) : (
          /* Fallback accuracy grid — shown for demos and when piece isn't available */
          <div className="grid gap-2"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(54px, 1fr))' }}>
            {heatData.map((pct, i) => {
              const isHot = displayHeatMapMeasures.includes(i + 1);
              return (
                <div key={i}
                  className={`flex flex-col items-center justify-center rounded-lg border p-2
                    ${isHot ? 'bg-feedback-error/30 border-feedback-error/50' : heatColor(pct)}`}
                  title={pct === null
                    ? `Measure ${i + 1}: not detected`
                    : `Measure ${i + 1}: ${pct}%`}>
                  <span className="text-white/80 font-body text-xs font-medium">{i + 1}</span>
                  <span className="text-white/60 font-body text-[9px] tabular-nums">
                    {pct === null ? '—' : `${pct}%`}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Legend */}
        <div className="flex gap-4 mt-4 flex-wrap">
          {[
            { label: '≥ 85%',      cls: 'bg-feedback-success/60' },
            { label: '65–84%',     cls: 'bg-accent-amber/50' },
            { label: '< 65%',      cls: 'bg-feedback-error/50' },
            { label: 'AI flagged', cls: 'border border-feedback-error/60 bg-feedback-error/15' },
          ].map(({ label, cls }) => (
            <div key={label} className="flex items-center gap-1.5">
              <div className={`w-3 h-3 rounded ${cls}`}/>
              <span className="text-text-muted font-body text-xs">{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Detailed Feedback ────────────────────────────── */}
      <div className="bg-bg-panel rounded-2xl border border-white/5 p-6">
        <h2 className="font-header text-lg text-text-primary mb-4">Detailed Feedback</h2>
        {aiLoading ? (
          <div className="flex items-center gap-2 text-text-muted">
            <Loader2 size={14} className="animate-spin text-accent-amber"/>
            <span className="font-body text-sm">Generating…</span>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {[aiResult?.feedbackText].filter(Boolean).map((tip, i) => (
              <div key={i}
                className="flex items-start gap-3 bg-white/3 rounded-xl px-4 py-3 border border-white/5">
                <span className="w-5 h-5 rounded-full bg-accent-amber/20 text-accent-amber font-body text-xs flex items-center justify-center flex-shrink-0 mt-0.5">
                  {i + 1}
                </span>
                <p className="text-text-muted font-body text-sm leading-relaxed">{tip}</p>
              </div>
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
