/**
 * ──────────────────────────────────────────────────────────────────
 *  musicExtractor.js
 *
 *  Sends a sheet-music image to Claude (vision) and converts the
 *  structured JSON response into Virtual Concertmaster's internal
 *  note format so it can be validated, stored, and rendered by
 *  VexFlow immediately after upload.
 *
 *  Exported:
 *    extractScoreFromImage(base64Data, mediaType) → pieceObject | null
 * ──────────────────────────────────────────────────────────────────
 */

import Anthropic from '@anthropic-ai/sdk';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Internal music-theory helpers ──────────────────────────────────
// (Mirrors the client-side samplePieces.js helpers; duplicated here
// so the server has zero dependency on the frontend source tree.)

const NOTE_NAMES  = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const SEMITONE    = { C:0, D:2, E:4, F:5, G:7, A:9, B:11 };

function midiToFreq(midi, a4 = 440) {
  return a4 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Convert a raw note descriptor returned by Claude into a fully
 * hydrated note object compatible with buildNote() on the client.
 *
 *   { step:"E", octave:5, alter:0, duration:"q" }
 *   →  { midi, freq, name, vexKey, duration }
 */
function rawToNote({ step, octave, alter = 0, duration }) {
  const s = String(step).toUpperCase();
  if (!Object.prototype.hasOwnProperty.call(SEMITONE, s)) {
    throw new Error(`Unknown note step: "${step}"`);
  }

  const midi       = (octave + 1) * 12 + SEMITONE[s] + alter;
  const noteIdx    = ((midi % 12) + 12) % 12;
  const realOctave = Math.floor(midi / 12) - 1;
  const name       = NOTE_NAMES[noteIdx];

  return {
    midi,
    freq:     midiToFreq(midi),
    name:     `${name}${realOctave}`,
    vexKey:   `${name.toLowerCase()}/${realOctave}`,
    duration,
  };
}

// ── Valid VexFlow 5 duration strings ───────────────────────────────
const VALID_DURATIONS = new Set(['wd','w','hd','h','qd','q','8d','8','16']);

/**
 * Normalise a duration string Claude might return into one VexFlow accepts.
 * Returns null if the duration cannot be salvaged.
 */
function normaliseDuration(raw) {
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase();
  if (VALID_DURATIONS.has(s)) return s;

  // Common aliases Claude sometimes uses
  const aliases = {
    'whole':          'w',
    'half':           'h',
    'quarter':        'q',
    'eighth':         '8',
    'sixteenth':      '16',
    'dotted-half':    'hd',
    'dotted-quarter': 'qd',
    'dotted-eighth':  '8d',
    'dotted half':    'hd',
    'dotted quarter': 'qd',
    'dotted eighth':  '8d',
    '1/1':  'w',  '1/2':  'h',  '1/4':  'q',
    '1/8':  '8',  '1/16': '16',
  };
  return aliases[s] ?? null;
}

// ── The extraction prompt ──────────────────────────────────────────
// Every rule exists to prevent a specific common failure mode:
//   • "Return ONLY valid JSON" → stops markdown code fences
//   • alter field explanation → prevents Claude using "Eb" instead of E♭
//   • "do not simplify" → stops Claude flattening 16ths to quarters
const EXTRACTION_PROMPT = `\
You are a professional music engraver with perfect score-reading ability.
Carefully analyze this sheet music image and extract every note you can see.

Return ONLY a single valid JSON object — no markdown, no code fences, no commentary:

{
  "title":         "<title printed on the score, or Untitled>",
  "composer":      "<composer name, or Unknown>",
  "clef":          "<treble|bass|alto>",
  "keySignature":  "<C|G|D|A|E|B|F#|C#|F|Bb|Eb|Ab|Db|Gb|Cb>",
  "timeSignature": "<e.g. 4/4>",
  "bpm":           <estimated tempo as an integer>,
  "measures": [
    [
      { "step": "E", "octave": 5, "alter": 0, "duration": "q" },
      ...more notes...
    ],
    ...more measures...
  ]
}

Rules:
- step   : capital letter A–G
- octave : integer (middle C = C4 = octave 4)
- alter  : -1 = flat, 0 = natural, 1 = sharp
- duration codes (use these EXACTLY):
    w   whole note          h   half note
    hd  dotted half         q   quarter note
    qd  dotted quarter      8   eighth note
    8d  dotted eighth       16  sixteenth note
- Group notes into measures separated by the printed bar lines.
- Preserve ALL notes and their EXACT rhythmic values.
  Do NOT simplify, shorten, or normalize note durations.
- For rests, skip them (include only pitched notes).
- Return at minimum 4 measures; include every measure you can read.`;

// ── Public API ─────────────────────────────────────────────────────

/**
 * Send a base64-encoded image to Claude and parse the returned
 * JSON into a Virtual Concertmaster piece object.
 *
 * @param {string} base64Data   – raw base64 string (no data-URL prefix)
 * @param {string} mediaType    – 'image/jpeg' | 'image/png' | 'image/webp'
 * @param {string} [filename]   – original filename (used for title fallback)
 * @returns {Object}  { success, piece?, error? }
 */
export async function extractScoreFromImage(base64Data, mediaType, filename = '') {
  // ── 1. Call Claude vision ────────────────────────────────────
  let rawText;
  try {
    const response = await anthropic.messages.create({
      model:      'claude-opus-4-5',
      max_tokens: 8096,
      messages: [{
        role: 'user',
        content: [
          {
            type:   'image',
            source: { type: 'base64', media_type: mediaType, data: base64Data },
          },
          { type: 'text', text: EXTRACTION_PROMPT },
        ],
      }],
    });
    rawText = response.content[0]?.text ?? '';
  } catch (err) {
    // Surface Anthropic SDK errors (auth failure, rate limit, etc.)
    console.error('[musicExtractor] Anthropic API error:', err.message);
    return {
      success: false,
      error: err.status === 401
        ? 'ANTHROPIC_API_KEY is missing or invalid. Set it in server/.env.'
        : `Anthropic API error: ${err.message}`,
    };
  }

  // ── 2. Extract JSON from response ──────────────────────────
  // Claude sometimes wraps JSON in markdown fences; strip them.
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error('[musicExtractor] No JSON found in Claude response:', rawText.slice(0, 200));
    return { success: false, error: 'Claude did not return a recognisable JSON structure.' };
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (parseErr) {
    console.error('[musicExtractor] JSON parse error:', parseErr.message);
    return { success: false, error: 'Could not parse Claude\'s JSON output.' };
  }

  // ── 3. Validate the top-level shape ─────────────────────────
  if (!Array.isArray(parsed.measures) || parsed.measures.length === 0) {
    return { success: false, error: 'Claude returned no measures — is this a sheet music image?' };
  }

  // ── 4. Convert raw note descriptors → hydrated note objects ─
  const measures = [];
  let skippedNotes = 0;

  for (const rawMeasure of parsed.measures) {
    if (!Array.isArray(rawMeasure)) continue;
    const measure = [];

    for (const rawNote of rawMeasure) {
      try {
        const dur = normaliseDuration(rawNote.duration);
        if (!dur) { skippedNotes++; continue; }
        measure.push(rawToNote({ ...rawNote, duration: dur }));
      } catch {
        // Skip individual unreadable notes silently
        skippedNotes++;
      }
    }

    if (measure.length > 0) measures.push(measure);
  }

  if (measures.length === 0) {
    return { success: false, error: 'No valid notes could be extracted from the score.' };
  }

  if (skippedNotes > 0) {
    console.warn(`[musicExtractor] Skipped ${skippedNotes} unreadable note(s).`);
  }

  // ── 5. Build the piece object ────────────────────────────────
  const titleFallback = filename
    ? filename.replace(/\.[^.]+$/, '')   // strip extension
    : 'Untitled Score';

  const piece = {
    id:            `upload_${Date.now()}`,
    title:         parsed.title        || titleFallback,
    composer:      parsed.composer     || 'Unknown',
    clef:          parsed.clef         || 'treble',
    keySignature:  parsed.keySignature || 'C',
    timeSignature: parsed.timeSignature || '4/4',
    bpm:           Number(parsed.bpm)  || 80,
    instrument:    'all',
    difficulty:    'Beginner',
    isUploaded:    true,
    uploadedAt:    new Date().toISOString(),
    measures,
    _skippedNotes: skippedNotes,  // diagnostic — stripped before storage
  };

  console.log(
    `[musicExtractor] Extracted "${piece.title}" — ` +
    `${measures.length} measures, ` +
    `${measures.reduce((s, m) => s + m.length, 0)} notes` +
    (skippedNotes ? `, ${skippedNotes} skipped` : '')
  );

  return { success: true, piece };
}
