/**
 * ──────────────────────────────────────────────────────────────────
 *  server/openaiExtractor.js
 *
 *  Server-side OMR via OpenAI gpt-4o vision + JSON mode.
 *  Shared note-conversion logic is intentionally kept in sync with
 *  src/utils/omrClient.js (the browser-direct version).
 * ──────────────────────────────────────────────────────────────────
 */

import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── Music-theory helpers ───────────────────────────────────────────
const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const SEMITONE   = { C:0, D:2, E:4, F:5, G:7, A:9, B:11 };

function midiToFreq(midi, a4 = 440) {
  return a4 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Parse GPT's note string ("C4", "F#5", "Eb3", "Bb4") into
 * { step, octave, alter }.
 */
function parseNoteString(raw) {
  const m = String(raw).trim().match(/^([A-Ga-g])(#{1,2}|b{1,2})?(-?\d+)$/);
  if (!m) throw new Error(`Unrecognisable note: "${raw}"`);
  const step   = m[1].toUpperCase();
  const acc    = m[2] ?? '';
  const octave = parseInt(m[3], 10);
  const alter  = acc === '#' ? 1 : acc === '##' ? 2
               : acc === 'b' ? -1 : acc === 'bb' ? -2 : 0;
  return { step, octave, alter };
}

/**
 * Convert GPT's fraction duration string to a VexFlow 5 duration code.
 * GPT returns values like "1/4", "1/8", "1/16", "1/2", "3/8" etc.
 */
function parseDuration(raw) {
  const s = String(raw).trim();
  const map = {
    '1/1':  'w',  '2/1': 'wd',
    '1/2':  'h',  '3/4': 'hd',
    '1/4':  'q',  '3/8': 'qd',
    '1/8':  '8',  '3/16':'8d',
    '1/16': '16',
    // Beat-count aliases GPT sometimes returns
    '4':'w', '2':'h', '1':'q', '0.5':'8', '0.25':'16', '0.75':'8d', '1.5':'qd', '3':'hd',
    // Word aliases
    'whole':'w', 'half':'h', 'quarter':'q', 'eighth':'8', 'sixteenth':'16',
    'dotted half':'hd', 'dotted quarter':'qd', 'dotted eighth':'8d',
  };
  return map[s] ?? null;
}

const BEAT_VALUES = { w:4, wd:6, hd:3, h:2, qd:1.5, q:1, '8d':0.75, '8':0.5, '16':0.25 };

/**
 * Group a flat note array into measure arrays based on the time signature.
 * Incomplete final bars are kept as-is.
 */
function groupIntoMeasures(notes, timeSignature) {
  const [num, denom] = (timeSignature || '4/4').split('/').map(Number);
  // Express measure length in quarter-note beats
  const beatsPerBar = num / ((denom || 4) / 4);

  const measures = [];
  let bar = [], tally = 0;

  for (const note of notes) {
    bar.push(note);
    tally += BEAT_VALUES[note.duration] ?? 1;
    if (tally >= beatsPerBar - 0.001) {
      measures.push(bar);
      bar = []; tally = 0;
    }
  }
  if (bar.length > 0) measures.push(bar);
  return measures;
}

/**
 * Convert a raw { step, octave, alter, duration } descriptor into a
 * fully-hydrated note compatible with VexFlow + the gatekeeper.
 */
function buildHydratedNote({ step, octave, alter, duration }) {
  const midi       = (octave + 1) * 12 + SEMITONE[step] + alter;
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

// ── System prompt ─────────────────────────────────────────────────
const SYSTEM_PROMPT = `\
You are a professional Optical Music Recognition (OMR) engine.
Analyze the provided image of sheet music. Extract the title, composer, clef,
key signature, time signature, estimated BPM, and every single note pitch and
duration sequentially.

Return ONLY a valid JSON object matching this exact schema:
{
  "title": "String",
  "composer": "String",
  "clef": "treble" | "bass" | "alto",
  "keySignature": "C" | "G" | "D" | "A" | "E" | "B" | "F#" | "C#" | "F" | "Bb" | "Eb" | "Ab" | "Db" | "Gb",
  "timeSignature": "4/4",
  "bpm": 120,
  "notationData": [
    { "note": "C4", "duration": "1/4" },
    { "note": "E4", "duration": "1/16" }
  ]
}

Duration codes (use fraction notation exactly):
  1/1 = whole   1/2 = half    3/4 = dotted half    1/4 = quarter
  3/8 = dotted quarter        1/8 = eighth          3/16 = dotted eighth   1/16 = sixteenth

Note format: letter name + optional accidental (# or b) + octave number.
  Examples: C4  F#5  Eb3  Bb4  G#4

Rules:
  - Preserve ALL notes and their EXACT rhythmic values.
  - Do NOT simplify, drop, or normalise durations.
  - List notes in left-to-right, top-to-bottom reading order.
  - Skip rests (include only pitched notes).`;

// ── Public API ────────────────────────────────────────────────────

/**
 * @param {string} base64Data   Raw base64 image (no data-URL prefix)
 * @param {string} mediaType    'image/jpeg' | 'image/png' | 'image/webp'
 * @param {string} [filename]   Original filename (title fallback)
 * @param {string} [model]      OpenAI model (default: gpt-4o)
 * @returns {Promise<{success, piece?, error?}>}
 */
export async function extractScoreFromImage(base64Data, mediaType, filename = '', model = 'gpt-4o') {
  // ── 1. Call gpt-4o vision with JSON mode ─────────────────────
  let rawJson;
  try {
    const response = await openai.chat.completions.create({
      model,
      response_format: { type: 'json_object' },
      max_tokens: 8192,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text:  'Transcribe this sheet music score, including all complex rhythms, accidentals, and exact pitches.',
            },
            {
              type:      'image_url',
              image_url: { url: `data:${mediaType};base64,${base64Data}`, detail: 'high' },
            },
          ],
        },
      ],
    });
    rawJson = response.choices[0]?.message?.content ?? '';
  } catch (err) {
    console.error('[openaiExtractor] API error:', err.message);
    const isAuth  = err.status === 401;
    const isQuota = err.status === 429;
    return {
      success: false,
      error: isAuth  ? 'Invalid OpenAI API key. Check OPENAI_API_KEY in server/.env.'
           : isQuota ? 'OpenAI rate limit reached. Wait a moment and try again.'
           : `OpenAI API error: ${err.message}`,
    };
  }

  // ── 2. Parse JSON ─────────────────────────────────────────────
  let parsed;
  try { parsed = JSON.parse(rawJson); }
  catch {
    console.error('[openaiExtractor] JSON parse error. Raw:', rawJson.slice(0, 200));
    return { success: false, error: 'Could not parse the score data returned by GPT.' };
  }

  if (!Array.isArray(parsed.notationData) || parsed.notationData.length === 0) {
    return { success: false, error: 'GPT returned no notes — is this a sheet music image?' };
  }

  // ── 3. Convert notationData → hydrated notes ─────────────────
  const hydratedNotes = [];
  let skipped = 0;

  for (const entry of parsed.notationData) {
    try {
      const { step, octave, alter } = parseNoteString(entry.note);
      const duration = parseDuration(entry.duration);
      if (!duration) { skipped++; continue; }
      if (!Object.prototype.hasOwnProperty.call(SEMITONE, step)) { skipped++; continue; }
      hydratedNotes.push(buildHydratedNote({ step, octave, alter, duration }));
    } catch { skipped++; }
  }

  if (hydratedNotes.length === 0) {
    return { success: false, error: 'No valid notes could be parsed. Try a clearer image.' };
  }

  // ── 4. Group into measures ────────────────────────────────────
  const measures = groupIntoMeasures(hydratedNotes, parsed.timeSignature || '4/4');

  if (skipped > 0) {
    console.warn(`[openaiExtractor] Skipped ${skipped} unreadable note(s).`);
  }

  // ── 5. Assemble piece object ──────────────────────────────────
  const titleFallback = filename ? filename.replace(/\.[^.]+$/, '') : 'Untitled Score';

  const piece = {
    id:            `upload_${Date.now()}`,
    title:         parsed.title         || titleFallback,
    composer:      parsed.composer      || 'Unknown',
    clef:          parsed.clef          || 'treble',
    keySignature:  parsed.keySignature  || 'C',
    timeSignature: parsed.timeSignature || '4/4',
    bpm:           Number(parsed.bpm)   || 80,
    instrument:    'all',
    difficulty:    'Beginner',
    isUploaded:    true,
    uploadedAt:    new Date().toISOString(),
    measures,
  };

  console.log(
    `[openaiExtractor] "${piece.title}" — ` +
    `${measures.length} measures, ${hydratedNotes.length} notes` +
    (skipped ? `, ${skipped} skipped` : '')
  );

  return { success: true, piece };
}
