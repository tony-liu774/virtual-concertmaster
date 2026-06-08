/**
 * ─────────────────────────────────────────────────────────────
 *  AI Coach Pipeline — Gemini 1.5 Flash (free tier)
 * ─────────────────────────────────────────────────────────────
 *  Flow:
 *    Real session log (Practice.jsx)
 *      → buildSessionPayload()
 *      → callGemini()   ← uses VITE_GEMINI_KEY if present
 *           ↳ callMockLLM() if key is missing or call fails
 *      → { feedbackText, heatMapMeasures, overallScore }
 *
 *  Free-tier limits (gemini-1.5-flash):
 *    15 requests / minute  ·  1 M tokens / day  ·  no credit card
 *
 *  To get your free key:
 *    https://aistudio.google.com/app/apikey  → "Create API key"
 *    Paste it in .env as VITE_GEMINI_KEY=your_key_here
 * ─────────────────────────────────────────────────────────────
 */

const GEMINI_MODEL    = 'gemini-1.5-flash-latest';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// ── Mock session payload (used on Report page with no real session) ──
export const MOCK_SESSION_PAYLOAD = {
  pieceTitle: 'Air on the G String',
  bpm: 60,
  totalNotes: 48,
  errors: [
    { measure: 3,  expected: 'C#5', played: 'C5',  errorType: 'pitch',  cents: -44 },
    { measure: 4,  expected: 'C#5', played: 'C5',  errorType: 'pitch',  cents: -41 },
    { measure: 5,  expected: 'B4',  played: 'B4',  errorType: 'rhythm', late: 0.14 },
    { measure: 7,  expected: 'A4',  played: 'G#4', errorType: 'pitch',  cents: -37 },
    { measure: 8,  expected: 'A4',  played: 'G#4', errorType: 'pitch',  cents: -40 },
    { measure: 11, expected: 'D5',  played: 'D5',  errorType: 'rhythm', late: 0.21 },
  ],
};

/**
 * Convert a raw Practice session log into the structured payload
 * the AI coach prompt expects.
 */
export function buildSessionPayload(sessionData) {
  const { pieceTitle, log = [], totalNotes, elapsed } = sessionData;
  const errors = log
    .filter(n => !n.inTune)
    .map(n => ({
      measure:   n.measureIdx + 1,
      expected:  n.targetName,
      played:    n.detectedFreq ? `~${n.detectedFreq.toFixed(0)} Hz` : 'not detected',
      errorType: !n.heard ? 'missed' : 'pitch',
      cents:     n.cents ?? null,
    }));

  return { pieceTitle, totalNotes, elapsed, errors };
}

// ── Gemini prompt builder ────────────────────────────────────
function buildPrompt(payload) {
  const { errors = [], pieceTitle = '', totalNotes = 0 } = payload;
  const correct     = totalNotes - errors.length;
  const accuracy    = totalNotes > 0 ? Math.round((correct / totalNotes) * 100) : 0;
  const errorSummary = errors.length === 0
    ? 'No errors detected — all notes were played in tune.'
    : errors.map(e =>
        `  • Measure ${e.measure}: expected ${e.expected}, got ${e.played}` +
        (e.cents !== null ? ` (${e.cents > 0 ? '+' : ''}${Math.round(e.cents)}¢)` : '') +
        ` [${e.errorType}]`
      ).join('\n');

  return `You are an expert string instrument teacher giving concise post-session feedback.

Session data:
  Piece: "${pieceTitle}"
  Notes played: ${totalNotes}
  Accuracy: ${accuracy}%
  Errors (${errors.length} total):
${errorSummary}

Respond ONLY with a JSON object in this exact shape — no markdown, no code fences, no extra keys:
{
  "feedbackText": "<2–3 sentences of specific, actionable coaching advice tailored to the errors above. Mention note names, measures, and technique (bow pressure, finger placement, intonation) where relevant. Keep it encouraging but honest.>",
  "heatMapMeasures": [<array of measure numbers (integers) that had errors, sorted ascending>]
}`;
}

// ── Gemini API call ──────────────────────────────────────────
async function callGemini(payload) {
  const apiKey = import.meta.env.VITE_GEMINI_KEY;
  if (!apiKey) return null; // no key → fall through to mock

  const body = {
    contents: [{ parts: [{ text: buildPrompt(payload) }] }],
    generationConfig: {
      temperature:     0.4,   // slightly creative but consistent
      maxOutputTokens: 300,
      responseMimeType: 'application/json',
    },
  };

  try {
    const res = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.warn('[AI Coach] Gemini API error:', res.status, errText);
      return null; // fall through to mock
    }

    const json = await res.json();
    const raw  = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

    // Gemini may still wrap in ```json … ``` despite responseMimeType — strip it
    const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed  = JSON.parse(cleaned);

    if (!parsed.feedbackText || !Array.isArray(parsed.heatMapMeasures)) {
      console.warn('[AI Coach] Unexpected Gemini response shape:', parsed);
      return null;
    }

    return {
      feedbackText:    parsed.feedbackText,
      heatMapMeasures: parsed.heatMapMeasures.map(Number).filter(n => !isNaN(n)).sort((a,b)=>a-b),
    };
  } catch (err) {
    console.warn('[AI Coach] Gemini call failed, using mock feedback:', err);
    return null;
  }
}

// ── Mock fallback (deterministic, pedagogically sound) ───────
async function callMockLLM(payload) {
  const { errors = [], pieceTitle = '' } = payload;
  const pitchErrors  = errors.filter(e => e.errorType === 'pitch');
  const missedNotes  = errors.filter(e => e.errorType === 'missed');
  const rhythmErrors = errors.filter(e => e.errorType === 'rhythm');
  const errorMeasures = [...new Set(errors.map(e => e.measure))].sort((a,b) => a-b);

  const flatCount  = pitchErrors.filter(e => (e.cents ?? 0) < -10).length;
  const sharpCount = pitchErrors.filter(e => (e.cents ?? 0) >  10).length;

  let line1 = '', line2 = '';

  if (pitchErrors.length === 0 && missedNotes.length === 0) {
    line1 = `Outstanding session on "${pieceTitle}" — your intonation was consistently clean throughout.`;
    line2 = `Try increasing the tempo by 5–10 BPM to build fluency while maintaining this level of accuracy.`;
  } else if (flatCount > sharpCount) {
    const worst = pitchErrors.sort((a,b) => a.cents - b.cents)[0];
    const avg   = Math.abs(Math.round(pitchErrors.reduce((s,e) => s+(e.cents??0),0) / pitchErrors.length));
    const noteName = worst?.expected ?? null;
    // "C#5" → "C#5 notes" so the sentence reads "Your C#5 notes are drifting flat"
    const noteLabel = noteName ? `${noteName} notes` : 'upper-register notes';
    line1 = `Your ${noteLabel} are drifting flat — average deviation in measures ${errorMeasures.slice(0,3).join(', ')} was ~${avg}¢ below pitch.`;
    line2 = missedNotes.length > 0
      ? `${missedNotes.length} notes were not detected; check bow pressure and mic proximity, then isolate those measures with a drone at 50% tempo.`
      : `Place your finger slightly toward the upper edge of each position and listen for sympathetic resonance on the open string below.`;
  } else if (sharpCount > 0) {
    line1 = `Several notes in measures ${errorMeasures.slice(0,3).join(', ')} ran sharp — ease finger pressure slightly and let the string speak with less force.`;
    line2 = `Slow-practice those passages with the reference drone active to calibrate your ear against a steady pitch centre.`;
  } else if (rhythmErrors.length > 0) {
    line1 = `Rhythmic rushing was detected in ${rhythmErrors.length} passages — your bow is moving ahead of the beat in the faster runs.`;
    line2 = `Use the built-in metronome at 60% tempo and focus on keeping the bow change exactly on the click before increasing speed.`;
  } else {
    line1 = `Good session on "${pieceTitle}". The main area to address is consistency across measures ${errorMeasures.slice(0,4).join(', ')}.`;
    line2 = `Isolate each flagged measure and practise three clean repetitions before moving on.`;
  }

  return {
    feedbackText:    `${line1} ${line2}`,
    heatMapMeasures: errorMeasures,
  };
}

/**
 * Main entry point.
 *
 * 1. Tries Gemini 1.5 Flash if VITE_GEMINI_KEY is set.
 * 2. Falls back to deterministic mock if key is missing or API fails.
 *
 * @returns {{ feedbackText: string, heatMapMeasures: number[], overallScore: number }}
 */
export async function analyzeSession(payload = MOCK_SESSION_PAYLOAD) {
  const geminiResult = await callGemini(payload);
  const usedAI = geminiResult !== null;
  const { feedbackText, heatMapMeasures } = geminiResult ?? await callMockLLM(payload);

  const correct      = (payload.totalNotes ?? 1) - (payload.errors?.length ?? 0);
  const overallScore = Math.round(Math.max(0, Math.min(100, (correct / (payload.totalNotes || 1)) * 100)));

  // `source` lets the UI show a "Powered by Gemini" badge vs "Built-in coaching"
  return { feedbackText, heatMapMeasures, overallScore, source: usedAI ? 'gemini' : 'mock' };
}
