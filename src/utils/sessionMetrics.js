/**
 * ─────────────────────────────────────────────────────────────────
 *  Session Metrics — single source of truth for pitch evaluation math
 *
 *  Both Practice.jsx (live detection) and Report.jsx (post-session
 *  analysis) import from here so the formula can never drift apart.
 * ─────────────────────────────────────────────────────────────────
 */

// ── Tolerance ──────────────────────────────────────────────────
/** ±cents window that counts as "in tune" for bowed string players */
export const CENTS_TOLERANCE = 15;

// ── Live note check ────────────────────────────────────────────
/**
 * Compare a detected frequency against a target frequency.
 *
 * Formula: cents = 1200 × log₂(f_detected / f_target)
 *
 * Returns:
 *   'GREEN'    – within ±CENTS_TOLERANCE (correct)
 *   'RED_SHARP'– deviation > +CENTS_TOLERANCE (too high)
 *   'RED_FLAT' – deviation < −CENTS_TOLERANCE (too low)
 *   'NONE'     – no valid input
 */
export function checkNote(micFreq, realFreq) {
  if (!micFreq || !realFreq || micFreq <= 0 || realFreq <= 0) return 'NONE';
  const cents = 1200 * Math.log2(micFreq / realFreq);
  if (cents >= -CENTS_TOLERANCE && cents <= CENTS_TOLERANCE) return 'GREEN';
  if (cents > CENTS_TOLERANCE)  return 'RED_SHARP';
  if (cents < -CENTS_TOLERANCE) return 'RED_FLAT';
  return 'NONE'; // unreachable, but satisfies exhaustiveness
}

// ── Post-session computation ───────────────────────────────────
/**
 * Compute the clean sessionResult metrics from a raw log array.
 *
 * Data contract returned:
 * {
 *   score              – 0-100 (= pitchAccuracy)
 *   pitchAccuracy      – % of ALL tracked notes played in tune
 *   notesHeardPercent  – % of notes microphone detected
 *   intonationTendency – "X sharp / Y flat"  or  "Clean"
 *   sharp              – count of notes > +CENTS_TOLERANCE
 *   flat               – count of notes < -CENTS_TOLERANCE
 *   missed             – count of notes mic never detected
 *   avgCents           – mean cents deviation of heard notes (signed)
 *   heatMapMeasures    – 1-indexed measure numbers that had errors
 *   totalTracked       – total notes in the session log
 *   totalInTune        – notes within tolerance
 *   totalHeard         – notes mic detected (heard, regardless of tuning)
 * }
 */
export function computeMetrics(log = []) {
  const heard  = log.filter(n => n.heard);
  const inTune = log.filter(n => n.inTune);
  const missed = log.filter(n => !n.heard);

  // Use the same CENTS_TOLERANCE threshold for report-side sharp/flat counting
  const sharp = heard.filter(n => n.cents !== null && n.cents >  CENTS_TOLERANCE);
  const flat  = heard.filter(n => n.cents !== null && n.cents < -CENTS_TOLERANCE);

  // pitchAccuracy = in-tune notes / ALL notes (missed = wrong, not "excused")
  const pitchAccuracy     = log.length > 0 ? Math.round((inTune.length / log.length) * 100) : 0;
  const notesHeardPercent = log.length > 0 ? Math.round((heard.length  / log.length) * 100) : 0;

  // Tendency string — human-readable, not a duplicate percentage
  const intonationTendency = (sharp.length === 0 && flat.length === 0)
    ? 'Clean'
    : `${sharp.length} sharp / ${flat.length} flat`;

  // Average signed cents deviation (only from heard notes that have pitch data)
  const centsValues = heard.filter(n => n.cents !== null).map(n => n.cents);
  const avgCents    = centsValues.length > 0
    ? Math.round(centsValues.reduce((s, c) => s + c, 0) / centsValues.length)
    : 0;

  // 1-indexed measure numbers where any note was out of tune
  const heatMapMeasures = [...new Set(
    log.filter(n => !n.inTune).map(n => (n.measureIdx ?? 0) + 1),
  )].sort((a, b) => a - b);

  return {
    score:              pitchAccuracy,   // top-level single score = pitchAccuracy
    pitchAccuracy,
    notesHeardPercent,
    intonationTendency,
    sharp:              sharp.length,
    flat:               flat.length,
    missed:             missed.length,
    avgCents,
    heatMapMeasures,
    totalTracked:       log.length,
    totalInTune:        inTune.length,
    totalHeard:         heard.length,
  };
}

// ── 3 demo scenarios ───────────────────────────────────────────
/**
 * Wildly different test cases used when no real session is in
 * sessionStorage.  Each visit cycles to the next scenario so
 * every refresh proves a different code path works end-to-end.
 *
 * Scenario A – Excellent  (~91%)  0 hot measures
 * Scenario B – Struggling (~52%)  4 hot measures, flat tendency
 * Scenario C – Average    (~72%)  3 hot measures, sharp tendency
 */
export const MOCK_SCENARIOS = [
  {
    _scenario:          'A_excellent',
    score:              91,
    pitchAccuracy:      91,
    notesHeardPercent:  98,
    intonationTendency: 'Clean',
    sharp: 0,  flat: 2,  missed: 1,  avgCents: -3,
    heatMapMeasures:    [],
    totalTracked: 48,  totalInTune: 44,  totalHeard: 47,
    feedbackText: 'Exceptional session — your intonation was remarkably consistent throughout. The two barely-flat notes were imperceptible to most ears. Try increasing the tempo by 10 BPM to build performance fluency while holding this accuracy.',
    aiSource:    'mock',
    pieceTitle:  'Twinkle Twinkle Little Star',
    elapsed:     185,
    isDemo:      true,
  },
  {
    _scenario:          'B_struggling',
    score:              52,
    pitchAccuracy:      52,
    notesHeardPercent:  79,
    intonationTendency: '14 flat / 3 sharp',
    sharp: 3,  flat: 14,  missed: 10,  avgCents: -28,
    heatMapMeasures:    [1, 2, 6, 7],
    totalTracked: 48,  totalInTune: 25,  totalHeard: 38,
    feedbackText: 'Your notes are consistently drifting flat — average deviation of 28¢ below pitch in measures 1, 2, and 6. Place your fingers slightly toward the upper edge of each position and run those passages with the tonic drone active at 50% tempo.',
    aiSource:    'mock',
    pieceTitle:  'Air on the G String',
    elapsed:     310,
    isDemo:      true,
  },
  {
    _scenario:          'C_average',
    score:              72,
    pitchAccuracy:      72,
    notesHeardPercent:  91,
    intonationTendency: '8 sharp / 5 flat',
    sharp: 8,  flat: 5,  missed: 6,  avgCents: 11,
    heatMapMeasures:    [3, 5, 9],
    totalTracked: 64,  totalInTune: 46,  totalHeard: 60,
    feedbackText: 'Good progress. A slight sharp tendency in measures 3 and 5 suggests excess bow weight in the upper half — focus on a lighter stroke and let the string vibrate freely. Your note coverage was strong at 91%.',
    aiSource:    'mock',
    pieceTitle:  'Canon in D',
    elapsed:     248,
    isDemo:      true,
  },
];

const _SCENARIO_KEY = 'vc_demo_scenario_idx';

/**
 * Returns the next demo scenario, cycling A → B → C → A → …
 * The index is persisted in localStorage so every page refresh
 * shows a different scenario.
 */
export function nextDemoScenario() {
  const current = parseInt(localStorage.getItem(_SCENARIO_KEY) ?? '-1', 10);
  const next    = (current + 1) % MOCK_SCENARIOS.length;
  localStorage.setItem(_SCENARIO_KEY, String(next));
  return MOCK_SCENARIOS[next];
}
