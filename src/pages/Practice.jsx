import { useState, useEffect, useRef, useCallback, useMemo, Component } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { AlertCircle, Play, Square, SkipForward, ChevronDown, Mic2, MicOff, Volume2, VolumeX, PlayCircle } from 'lucide-react';
import { useAudioAnalyzer } from '../hooks/useAudioAnalyzer.js';
import { useSynthTone } from '../utils/synthTone.js';
import { useInstrumentStore } from '../store/instrumentStore.js';
import { intonationState, INSTRUMENT_RANGES, midiToFreq, OPEN_STRINGS } from '../utils/musicTheory.js';
import { SAMPLE_PIECES, transposePieceForInstrument } from '../utils/samplePieces.js';
import { generateRandomScore, RANDOM_OPTIONS_KEY } from '../utils/randomScoreGenerator.js';
import { evaluateScanQuality, isOmrScannedPiece } from '../utils/scanQuality.js';
import { checkNote, CENTS_TOLERANCE } from '../utils/sessionMetrics.js';
import { useReferencePlayer } from '../utils/useReferencePlayer.js';
import IntonationGauge from '../components/IntonationGauge.jsx';
import SheetMusicViewer from '../components/SheetMusicViewer.jsx';
import OsmdViewer from '../components/OsmdViewer.jsx';

const BPM_OPTIONS       = [60, 72, 80, 100, 120];
const MEASURES_PER_PAGE = 8;
const LINE_HEIGHT_PX    = 130;  // matches SheetMusicViewer LINE_HEIGHT
const MEASURES_PER_LINE = 4;

/** Safely flatten a piece into its timed practice stream. Never throws. */
function flattenNotes(piece) {
  if (piece?.events?.length) {
    try { return piece.events.flatMap(m => (Array.isArray(m) ? m : [])); }
    catch { return []; }
  }
  if (!piece?.measures?.length) return [];
  try {
    return piece.measures.flatMap(m => (Array.isArray(m) ? m : []));
  } catch {
    return [];
  }
}

/** Return the measure index that contains the given global note index. */
function measureIdxFor(piece, noteIdx) {
  const measureSource = piece?.events?.length ? piece.events : piece?.measures;
  if (!measureSource?.length) return 0;
  let count = 0;
  for (let m = 0; m < measureSource.length; m++) {
    count += (measureSource[m]?.length ?? 0);
    if (noteIdx < count) return m;
  }
  return Math.max(0, measureSource.length - 1);
}

// ── Sheet-music error boundary ──────────────────────────────────
// Catches render-time crashes inside SheetMusicViewer or OsmdViewer so
// a malformed generated score never blanks the whole Practice page.
class SheetErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { crashed: false, message: '' };
  }
  static getDerivedStateFromError(err) {
    return { crashed: true, message: err?.message ?? 'Unknown render error' };
  }
  componentDidCatch(err, info) {
    console.error('[SheetErrorBoundary] Sheet music render crash:', err, info);
  }
  render() {
    if (this.state.crashed) {
      return (
        <div className="rounded-2xl border border-white/10 bg-bg-panel/60 p-6 text-center">
          <p className="text-accent-amber font-body text-sm mb-1">Score display error</p>
          <p className="text-text-muted font-body text-xs leading-relaxed">
            Rendering score… If performance tracking fails to load, start a new quest
            or refresh the generated score.
          </p>
          <p className="text-white/20 font-mono text-[10px] mt-3 break-all">
            {this.state.message}
          </p>
          {/* Offer the OSMD fallback if the parent passed musicXml */}
          {this.props.musicXml && (
            <OsmdViewer
              musicXml={this.props.musicXml}
              className="mt-4"
            />
          )}
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Piece resolution helpers ────────────────────────────────────
const UPLOADS_LS_KEY = 'virtual_concertmaster_uploads';

function loadUploadedPieces() {
  try { return JSON.parse(localStorage.getItem(UPLOADS_LS_KEY) || '[]'); }
  catch { return []; }
}

function loadRandomOptions(locationState) {
  let saved = {};
  try { saved = JSON.parse(sessionStorage.getItem(RANDOM_OPTIONS_KEY) || '{}'); }
  catch { saved = {}; }
  return { ...saved, ...(locationState?.randomOptions ?? {}) };
}

function makeRandomPiece(instrument, locationState) {
  return generateRandomScore({ instrument, ...loadRandomOptions(locationState) });
}

/**
 * Resolve any piece ID to a full piece object.
 *   1. Built-in catalogue (SAMPLE_PIECES)
 *   2. User-uploaded / OMR-scanned pieces in localStorage
 */
function resolvePiece(id) {
  if (!id) return null;
  if (SAMPLE_PIECES[id]) return SAMPLE_PIECES[id];
  const found = loadUploadedPieces().find(p => p.id === id);
  if (found) return found;
  return null;
}

/** Resolve piece from navigation state, otherwise create a new quest. */
function resolveRawPiece(locationState, instrument) {
  const navPiece = resolvePiece(locationState?.pieceId);
  if (navPiece) return navPiece;
  const storedPiece = resolvePiece(sessionStorage.getItem('selectedPiece'));
  if (storedPiece) return storedPiece;
  return makeRandomPiece(instrument, locationState);
}

export default function Practice() {
  const navigate   = useNavigate();
  const location   = useLocation();
  const { instrument } = useInstrumentStore();
  const range      = INSTRUMENT_RANGES[instrument] ?? INSTRUMENT_RANGES.violin;

  // ── Base (untransposed) piece ───────────────────────────────
  const [rawPiece, setRawPiece] = useState(() => resolveRawPiece(location.state, instrument));

  // ── Transposed piece for the active instrument ──────────────
  //    All display AND pitch-detection uses this version.
  const piece = useMemo(
    () => rawPiece?.isGenerated ? rawPiece : transposePieceForInstrument(rawPiece, instrument),
    [rawPiece, instrument],
  );
  const rawScanQuality = useMemo(
    () => isOmrScannedPiece(rawPiece)
      ? evaluateScanQuality(rawPiece, { expectedInstrument: instrument })
      : null,
    [instrument, rawPiece],
  );
  const scanBlocked = rawScanQuality?.status === 'fail';

  const [bpm,            setBpm]            = useState(rawPiece.bpm ?? 100);
  const [isPlaying,      setIsPlaying]      = useState(false);
  const [currentNoteIdx, setCurrentNoteIdx] = useState(0);
  const [sessionLog,     setSessionLog]     = useState([]);
  const [showBpmPicker,  setShowBpmPicker]  = useState(false);
  const [elapsed,        setElapsed]        = useState(0);
  const [page,           setPage]           = useState(0);

  const tickRef          = useRef(null);
  const elapsedRef       = useRef(null);
  const noteIdxRef       = useRef(0);
  const currentNoteRef   = useRef(null);
  const elapsedSecsRef   = useRef(0);
  const sessionLogRef    = useRef([]);
  const sheetScrollRef   = useRef(null);
  const osmdRef          = useRef(null);   // OSMD cursor API for generated pieces

  const { isListening, currentNote, startListening, stopListening, error } =
    useAudioAnalyzer({ minFreq: range.min, maxFreq: range.max });

  const { playing: droning, startDrone, stopDrone } = useSynthTone();
  const { playing: refPlaying, refNoteIdx, startRef, stopRef } = useReferencePlayer();

  // Sync refs
  useEffect(() => { currentNoteRef.current = currentNote;  }, [currentNote]);
  useEffect(() => { sessionLogRef.current  = sessionLog;   }, [sessionLog]);

  const resetPracticeState = useCallback((nextPiece) => {
    clearTimeout(tickRef.current);
    clearInterval(elapsedRef.current);
    stopListening();
    stopDrone();
    stopRef();
    setIsPlaying(false);
    setRawPiece(nextPiece);
    setBpm(nextPiece.bpm ?? 100);
    setCurrentNoteIdx(0);
    noteIdxRef.current     = 0;
    setPage(0);
    setSessionLog([]);
    sessionLogRef.current  = [];
    setElapsed(0);
    elapsedSecsRef.current = 0;
    osmdRef.current?.cursorHide();
  }, [stopDrone, stopListening, stopRef]);

  const startNewQuest = useCallback(() => {
    resetPracticeState(makeRandomPiece(instrument, location.state));
  }, [instrument, location.state, resetPracticeState]);

  // ── React when Library navigates here with a new piece ──────
  //    location.state?.pieceId changes every time the user clicks
  //    "Practice Now", even if the URL stays /practice.
  const navPieceId = location.state?.pieceId;
  const randomSeed = location.state?.randomSeed;
  useEffect(() => {
    if (!navPieceId && !randomSeed) return;
    const next = randomSeed
      ? makeRandomPiece(instrument, location.state)
      : resolvePiece(navPieceId);
    if (!next) return;
    if (next.id === rawPiece.id) return; // same piece — no-op
    resetPracticeState(next);
  }, [navPieceId, randomSeed]); // eslint-disable-line

  // ── Also reset when instrument changes mid-session ──────────
  //    (Pitch detection targets change, so a running session is invalid)
  const prevInstrumentRef = useRef(instrument);
  useEffect(() => {
    if (prevInstrumentRef.current === instrument) return;
    prevInstrumentRef.current = instrument;
    if (rawPiece?.isGenerated) {
      resetPracticeState(makeRandomPiece(instrument, location.state));
      return;
    }
    if (!isPlaying) return;
    clearTimeout(tickRef.current);
    clearInterval(elapsedRef.current);
    stopListening();
    stopDrone();
    setIsPlaying(false);
    setCurrentNoteIdx(0);
    noteIdxRef.current     = 0;
    setPage(0);
    setSessionLog([]);
    sessionLogRef.current  = [];
    setElapsed(0);
    elapsedSecsRef.current = 0;
  }, [instrument]); // eslint-disable-line

  const allNotes       = flattenNotes(piece);
  const playableTotal  = allNotes.filter(note => !note?.isRest).length;
  const targetNote     = allNotes[currentNoteIdx] ?? null;
  const targetIsRest   = !!targetNote?.isRest;
  const cents = currentNote && targetNote && !targetIsRest
    ? 12 * Math.log2(currentNote.frequency / targetNote.freq) * 100
    : 0;
  const state    = intonationState(cents);
  const showGauge = !targetIsRest && isListening && Math.abs(cents) > 10 && currentNote !== null;

  // ── Page slice (must be declared before pageNoteErrors useMemo) ──
  const pageStart = page * MEASURES_PER_PAGE;

  // ── Performance tracker: error paint ─────────────────────────
  // Global note indices that had pitch errors this session
  const errorNoteSet = useMemo(
    () => new Set(sessionLog.filter(e => !e.inTune).map(e => e.noteIdx)),
    [sessionLog],
  );

  // Convert global error indices → page-relative indices for SheetMusicViewer
  const pageNoteErrors = useMemo(() => {
    if (!piece) return new Set();
    let offset = 0;
    for (let m = 0; m < pageStart && m < piece.measures.length; m++) {
      offset += piece.measures[m].length;
    }
    const local = new Set();
    errorNoteSet.forEach(gIdx => {
      const lIdx = gIdx - offset;
      if (lIdx >= 0) local.add(lIdx);
    });
    return local;
  }, [errorNoteSet, piece, pageStart]);

  // Live pitch status → flash cursor crimson if player is off-pitch right now
  const pitchStatus = isListening && isPlaying && targetNote && !targetIsRest && currentNote
    ? checkNote(currentNote.frequency, targetNote.freq)
    : 'NONE';
  const pitchFlash = pitchStatus === 'RED_SHARP' || pitchStatus === 'RED_FLAT';

  const beatMs = useCallback(() => (60 / bpm) * 1000, [bpm]);
  const durationBeats = { wd: 6, w: 4, hd: 3, h: 2, qd: 1.5, q: 1, '8d': 0.75, '8': 0.5, '16': 0.25 };

  // ── Auto page-scroll (practice mode) ───────────────────────
  useEffect(() => {
    if (!piece) return;
    const mIdx   = measureIdxFor(piece, currentNoteIdx);
    const newPage = Math.floor(mIdx / MEASURES_PER_PAGE);
    if (newPage !== page) setPage(newPage);
    if (sheetScrollRef.current) {
      const localMeasure = mIdx % MEASURES_PER_PAGE;
      const lineIdx      = Math.floor(localMeasure / MEASURES_PER_LINE);
      sheetScrollRef.current.scrollTo({ top: lineIdx * LINE_HEIGHT_PX, behavior: 'smooth' });
    }
  }, [currentNoteIdx, piece]); // eslint-disable-line

  // ── Auto page-flip + scroll (reference playback mode) ───────
  useEffect(() => {
    if (!refPlaying || !piece) return;
    const mIdx    = measureIdxFor(piece, refNoteIdx);
    const newPage = Math.floor(mIdx / MEASURES_PER_PAGE);
    if (newPage !== page) setPage(newPage);
    if (sheetScrollRef.current) {
      const localMeasure = mIdx % MEASURES_PER_PAGE;
      const lineIdx      = Math.floor(localMeasure / MEASURES_PER_LINE);
      sheetScrollRef.current.scrollTo({ top: lineIdx * LINE_HEIGHT_PX, behavior: 'smooth' });
    }
  }, [refNoteIdx, refPlaying, piece]); // eslint-disable-line

  function logNote() {
    const target = allNotes[noteIdxRef.current];
    if (!target || target.isRest) return;
    const detected = currentNoteRef.current;
    let noteCents = null, inTune = false;
    if (detected && target.freq > 0) {
      noteCents = 1200 * Math.log2(detected.frequency / target.freq);
      inTune    = Math.abs(noteCents) < CENTS_TOLERANCE; // ±15¢ window
    }
    const entry = {
      noteIdx:      noteIdxRef.current,
      measureIdx:   measureIdxFor(piece, noteIdxRef.current),
      targetName:   target.name,
      targetFreq:   target.freq,
      detectedFreq: detected?.frequency ?? null,
      cents:  noteCents,
      inTune,
      heard:  detected !== null,
    };
    // ── CRITICAL: update ref synchronously so stopSession always sees the
    //    latest log even if React hasn't flushed the state update yet.
    const newLog = [...sessionLogRef.current, entry];
    sessionLogRef.current = newLog;
    setSessionLog(newLog);
  }

  function advanceNote() {
    const next = noteIdxRef.current + 1;
    if (next >= allNotes.length) { stopSession(); return; }
    noteIdxRef.current = next;
    setCurrentNoteIdx(next);
    osmdRef.current?.cursorNext();   // keep OSMD cursor in sync
  }

  function scheduleNextNote() {
    const note = allNotes[noteIdxRef.current];
    if (!note) return;                                    // empty score — no-op
    const beats = durationBeats[note?.duration] ?? 1;    // safe property access
    logNote();
    tickRef.current = setTimeout(() => { advanceNote(); scheduleNextNote(); }, beats * beatMs());
  }

  async function startSession() {
    if (scanBlocked) return;
    stopRef();          // reference playback can't run during practice
    await startListening();
    // Clear any previous report so Report.jsx starts fresh (avoids StrictMode stale-read)
    sessionStorage.removeItem('sessionLog');
    sessionLogRef.current  = [];
    setSessionLog([]);
    noteIdxRef.current     = 0;
    elapsedSecsRef.current = 0;
    setCurrentNoteIdx(0);
    setElapsed(0);
    setPage(0);
    setIsPlaying(true);
    osmdRef.current?.cursorReset();  // OSMD: move cursor to beat 1 and show it
    if (allNotes.length > 0) scheduleNextNote();  // skip tick loop for XML-only pieces
    elapsedRef.current = setInterval(() => {
      elapsedSecsRef.current += 1;
      setElapsed(s => s + 1);
    }, 1000);
  }

  function stopSession() {
    clearTimeout(tickRef.current);
    clearInterval(elapsedRef.current);
    stopListening();
    stopDrone();
    setIsPlaying(false);
    osmdRef.current?.cursorHide();   // OSMD: hide cursor when session ends
    const log = sessionLogRef.current;
    if (log.length > 0) {
      sessionStorage.setItem('sessionLog', JSON.stringify({
        pieceId:    rawPiece.id,       // always the canonical (untransposed) id
        pieceTitle: rawPiece.title,
        instrument,                    // save so Report can re-transpose correctly
        pieceSnapshot: rawPiece.isGenerated || rawPiece.isUploaded ? rawPiece : null,
        log,
        totalNotes: playableTotal,
        elapsed:    elapsedSecsRef.current,
      }));
      navigate('/report');
    }
  }

  function formatTime(s) {
    return `${String(Math.floor(s / 60)).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}`;
  }

  // Drone — tonic open string
  const openStrings  = OPEN_STRINGS[instrument] ?? [];
  const droneDefault = openStrings.find(s => s.name === 'A') ?? openStrings[2] ?? openStrings[0];
  function toggleDrone() {
    if (droning) stopDrone();
    else if (droneDefault) startDrone(midiToFreq(droneDefault.midi));
  }

  const stateColor = {
    perfect: 'text-feedback-success',
    close:   'text-accent-amber',
    off:     'text-feedback-error',
    far:     'text-feedback-error',
  }[state] ?? 'text-text-muted';

  // Current page slice for SheetMusicViewer
  const pagePiece   = piece
    ? { ...piece, measures: piece.measures.slice(pageStart, pageStart + MEASURES_PER_PAGE) }
    : null;

  const localNoteIdx = (() => {
    if (!piece) return 0;
    let count = 0;
    for (let m = 0; m < pageStart && m < piece.measures.length; m++) {
      count += piece.measures[m].length;
    }
    return Math.max(0, currentNoteIdx - count);
  })();

  // Page-relative reference note index for the bouncing ball.
  // Null when reference is not playing — hides the ball.
  const localRefNoteIdx = (() => {
    if (!refPlaying || !piece) return null;
    let count = 0;
    for (let m = 0; m < pageStart && m < piece.measures.length; m++) {
      count += piece.measures[m].length;
    }
    const local = refNoteIdx - count;
    return local >= 0 ? local : null;
  })();

  const totalPages = piece ? Math.ceil(piece.measures.length / MEASURES_PER_PAGE) : 1;

  // Clue label shown in top bar next to piece title
  const clefLabel = { treble: 'Treble', alto: 'Alto', bass: 'Bass' }[piece?.clef ?? 'treble'];
  const instrLabel = { violin: 'Violin', viola: 'Viola', cello: 'Cello', bass: 'Double Bass' }[instrument];

  useEffect(() => () => { clearTimeout(tickRef.current); clearInterval(elapsedRef.current); }, []);

  return (
    <div className="min-h-screen bg-bg-deep flex flex-col">
      {/* ── Top bar ────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-white/5 bg-bg-panel flex-shrink-0">
        <div>
          <p className="text-text-muted font-body text-xs uppercase tracking-widest">
            Sight-Read · {instrLabel} · {clefLabel} Clef
          </p>
          <h1 className="font-header text-lg text-text-primary leading-tight">{piece?.title ?? 'Practice'}</h1>
          <p className="text-text-muted font-body text-[10px]">{piece?.composer ?? ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={startNewQuest}
            disabled={isPlaying}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-body text-xs transition-all
              ${isPlaying
                ? 'bg-white/5 text-text-muted/40 border-white/10 cursor-not-allowed'
                : 'bg-accent-amber/15 text-accent-amber border-accent-amber/40 hover:bg-accent-amber/25'}`}
          >
            <SkipForward size={13}/> New Quest
          </button>

          {/* Play Reference button — hear the piece before practising */}
          <button
            onClick={() => refPlaying
              ? stopRef()
              : startRef(allNotes, bpm)
            }
            disabled={isPlaying || scanBlocked}
            title={isPlaying ? 'Stop the session to use reference playback' : ''}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-body text-xs transition-all
              ${refPlaying
                ? 'bg-accent-amber/20 text-accent-amber border-accent-amber/50'
                : 'bg-white/5 text-text-muted border-white/10 hover:border-white/20'}
              ${isPlaying || scanBlocked ? 'opacity-30 cursor-not-allowed' : ''}`}
          >
            {refPlaying
              ? <><Square size={13} fill="currentColor"/> Stop</>
              : <><PlayCircle size={13}/> Reference</>}
          </button>

          {/* Drone toggle */}
          <button
            onClick={toggleDrone}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-body text-xs transition-all
              ${droning
                ? 'bg-accent-amber/15 text-accent-amber border-accent-amber/40'
                : 'bg-white/5 text-text-muted border-white/10 hover:border-white/20'}`}
          >
            {droning ? <><VolumeX size={13}/> Drone On</> : <><Volume2 size={13}/> Drone</>}
          </button>

          {/* BPM picker */}
          <div className="relative">
            <button
              onClick={() => setShowBpmPicker(v => !v)}
              className="flex items-center gap-1.5 bg-white/5 border border-white/10 text-text-primary font-body text-xs px-3 py-1.5 rounded-lg"
            >
              {bpm} BPM <ChevronDown size={11}/>
            </button>
            {showBpmPicker && (
              <div className="absolute right-0 top-full mt-1 bg-bg-panel border border-white/10 rounded-lg overflow-hidden z-20 shadow-xl">
                {BPM_OPTIONS.map(b => (
                  <button
                    key={b}
                    onClick={() => { setBpm(b); setShowBpmPicker(false); }}
                    className={`block w-full text-left px-4 py-2 font-body text-xs transition-colors
                      ${b === bpm
                        ? 'text-accent-amber bg-accent-amber/10'
                        : 'text-text-muted hover:text-text-primary hover:bg-white/5'}`}
                  >
                    {b} BPM
                  </button>
                ))}
              </div>
            )}
          </div>

          {isPlaying && (
            <span className="font-body text-text-muted text-sm tabular-nums">{formatTime(elapsed)}</span>
          )}
        </div>
      </div>

      {/* ── Sheet music ─────────────────────────────────────── */}
      <div ref={sheetScrollRef} className="flex-1 overflow-auto px-4 md:px-6 py-5">

        {scanBlocked ? (
          <div className="rounded-2xl border border-feedback-error/30 bg-feedback-error/10 p-6 md:p-8 text-center">
            <p className="text-feedback-error font-body text-xs uppercase tracking-widest mb-2">
              Scan Failed Quality Checks
            </p>
            <h2 className="font-header text-3xl text-text-primary mb-3">
              This OMR result is not safe to practice.
            </h2>
            <p className="text-text-muted font-body text-sm max-w-2xl mx-auto mb-5">
              The scanner produced MusicXML that looks dense or mislabeled, so feedback would be wrong.
              Upload real MusicXML for accuracy, or rescan a cleaner cropped page.
            </p>
            {rawScanQuality?.issues?.length > 0 && (
              <ul className="max-w-2xl mx-auto text-left space-y-2 mb-6">
                {rawScanQuality.issues.map(issue => (
                  <li key={issue} className="flex gap-2 text-feedback-error font-body text-xs">
                    <AlertCircle size={13} className="mt-0.5 flex-shrink-0" /> <span>{issue}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button
                onClick={() => navigate('/library')}
                className="px-5 py-3 rounded-xl bg-accent-amber text-bg-deep font-body font-semibold"
              >
                Back to Library
              </button>
              <button
                onClick={startNewQuest}
                className="px-5 py-3 rounded-xl border border-white/10 text-text-primary font-body font-semibold hover:border-white/25"
              >
                Start Random Quest
              </button>
            </div>
          </div>
        ) : (
        <SheetErrorBoundary musicXml={rawPiece.musicXmlString ?? null}>
          {/* ── OSMD renderer — generated MusicXML pieces ───── */}
          {rawPiece.musicXmlString ? (
            <OsmdViewer
              ref={osmdRef}
              key={rawPiece.id}
              musicXml={rawPiece.musicXmlString}
              className="shadow-sm"
            />
          ) : (
            /* ── VexFlow renderer — built-in sample pieces ─────── */
            pagePiece && (
              <SheetMusicViewer
                key={`${pagePiece?.id ?? 'piece'}-${pagePiece?.clef ?? 'treble'}`}
                piece={pagePiece}
                currentNoteGlobal={isPlaying ? localNoteIdx : null}
                noteErrors={pageNoteErrors}
                pitchFlash={pitchFlash}
                referenceNoteGlobal={localRefNoteIdx}
                className="bg-bg-panel/40 p-4 rounded-2xl border border-white/5"
              />
            )
          )}
        </SheetErrorBoundary>
        )}

        {/* Page dots — only shown for VexFlow (multi-page) pieces */}
        {!scanBlocked && !rawPiece.musicXmlString && (
          <div className="flex items-center justify-center gap-2 mt-4">
            {Array.from({ length: totalPages }, (_, i) => (
              <div
                key={i}
                className={`w-1.5 h-1.5 rounded-full transition-all
                  ${i === page ? 'bg-accent-amber scale-125' : 'bg-white/20'}`}
              />
            ))}
            {totalPages > 1 && (
              <span className="text-text-muted font-body text-xs ml-1">
                Page {page + 1} of {totalPages}
              </span>
            )}
          </div>
        )}

        {/* Note progress bar */}
        {!scanBlocked && <div className="flex items-center gap-3 mt-3">
          <span className="text-text-muted font-body text-xs">
            Step {Math.min(currentNoteIdx + 1, allNotes.length)} / {allNotes.length}
          </span>
          <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-accent-amber rounded-full transition-all"
              style={{ width: `${allNotes.length ? ((currentNoteIdx + 1) / allNotes.length) * 100 : 0}%` }}
            />
          </div>
        </div>}
      </div>

      {/* ── Live feedback panel ──────────────────────────────── */}
      <div className="bg-bg-panel border-t border-white/5 px-5 py-4 flex-shrink-0">
        <div className="flex flex-col md:flex-row items-center gap-5">
          {/* Target */}
          <div className="flex flex-col items-center gap-0.5 min-w-20">
            <span className="text-text-muted font-body text-[10px] uppercase tracking-widest">Target</span>
            <span className="font-header text-4xl text-text-primary">
              {targetNote ? targetNote.name : '—'}
            </span>
            <span className="text-text-muted font-body text-[10px]">
              {targetNote && !targetIsRest ? `${targetNote.freq.toFixed(1)} Hz` : '—'}
            </span>
          </div>

          {/* Detected */}
          <div className="flex flex-col items-center gap-0.5 min-w-20">
            <span className="text-text-muted font-body text-[10px] uppercase tracking-widest">Detected</span>
            <span className={`font-header text-4xl ${isListening && currentNote ? stateColor : 'text-text-muted/30'}`}>
              {!targetIsRest && isListening && currentNote ? `${currentNote.name}${currentNote.octave}` : '—'}
            </span>
            <span className="text-text-muted font-body text-[10px]">
              {!targetIsRest && isListening && currentNote ? `${currentNote.frequency.toFixed(1)} Hz` : '—'}
            </span>
          </div>

          {/* Gauge */}
          <div className="flex-1 flex justify-center">
            <IntonationGauge cents={cents} visible={showGauge} />
            {targetIsRest && (
              <div className="flex flex-col items-center gap-1 text-text-muted/50">
                <Square size={18}/>
                <span className="font-body text-xs">Rest</span>
              </div>
            )}
            {!targetIsRest && !showGauge && isListening && currentNote && (
              <div className="flex flex-col items-center gap-1">
                <div className="w-3 h-3 rounded-full bg-feedback-success animate-breath shadow-[0_0_12px_var(--color-feedback-success)]"/>
                <span className="text-feedback-success font-body text-xs">In Tune</span>
              </div>
            )}
            {!targetIsRest && !isListening && (
              <div className="flex flex-col items-center gap-1 text-text-muted/30">
                <MicOff size={24}/>
                <span className="font-body text-xs">Start to enable mic</span>
              </div>
            )}
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2">
            {!isPlaying ? (
              <button
                onClick={startSession}
                disabled={scanBlocked}
                className={`flex items-center gap-2 font-body font-semibold px-6 py-3 rounded-xl transition-all
                  ${scanBlocked
                    ? 'bg-feedback-error/10 text-feedback-error cursor-not-allowed'
                    : 'bg-accent-amber text-bg-deep hover:shadow-[0_0_24px_var(--color-accent-amber)/50]'}`}
              >
                <Play size={16} fill="currentColor"/> {scanBlocked ? 'Scan Failed' : 'Start Quest'}
              </button>
            ) : (
              <>
                <button
                  onClick={() => stopSession()}
                  className="flex items-center gap-2 bg-feedback-error/20 text-feedback-error font-body px-5 py-3 rounded-xl border border-feedback-error/30 hover:bg-feedback-error/30 transition-all"
                >
                  <Square size={14} fill="currentColor"/> Stop
                </button>
                <button
                  onClick={advanceNote}
                  className="flex items-center gap-2 bg-white/5 text-text-muted font-body px-3 py-3 rounded-xl border border-white/10 hover:bg-white/10 transition-all"
                  title="Skip note"
                >
                  <SkipForward size={14}/>
                </button>
              </>
            )}
          </div>
        </div>

        {error && (
          <p className="text-feedback-error font-body text-xs mt-2 text-center">{error}</p>
        )}
        {isListening && (
          <div className="flex items-center justify-center gap-1.5 mt-2">
            <span className="w-1.5 h-1.5 rounded-full bg-feedback-error animate-breath"/>
            <span className="text-feedback-error font-body text-[10px] uppercase tracking-widest">
              Microphone Active
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
