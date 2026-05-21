/**
 * musicXmlBuilder.js — Programmatic MusicXML 3.1 compiler.
 *
 * Takes the flat, structured JSON that GPT-4o returns (see omrClient.js for
 * the exact schema) and compiles it into a valid MusicXML document and an
 * internal pitch-detection note array — entirely in JavaScript code, with
 * zero AI-generated XML tags.
 *
 * This sidesteps every class of hallucination that arises from asking an LLM
 * to write raw XML: truncated documents, wrong clef signs, made-up attributes,
 * unbalanced tags, etc.
 *
 * Public exports:
 *   buildMusicXml(scoreData)          → string  (MusicXML document)
 *   buildInternalMeasures(scoreData)  → Array<Array<HydratedNote>>
 */

// ── Lookup tables ──────────────────────────────────────────────────────────

const KEY_TO_FIFTHS = {
  Cb: -7, Gb: -6, Db: -5, Ab: -4, Eb: -3, Bb: -2, F: -1,
  C:   0, G:   1, D:   2, A:   3, E:   4, B:   5, 'F#': 6, 'C#': 7,
};

/**
 * Duration code → MusicXML type label, tick count (at divisions=4), dot count.
 *
 * Codes follow the MusicXML denominator convention used in the GPT prompt:
 *   "1"  = whole       "2"  = half       "4"  = quarter
 *   "8"  = eighth      "16" = 16th
 * Append "d" for dotted: "4d" = dotted quarter, "8d" = dotted eighth, etc.
 */
const DURATION_TABLE = {
  '1':   { type: 'whole',   ticks: 16, dots: 0 },
  '2':   { type: 'half',    ticks:  8, dots: 0 },
  '4':   { type: 'quarter', ticks:  4, dots: 0 },
  '8':   { type: 'eighth',  ticks:  2, dots: 0 },
  '16':  { type: '16th',    ticks:  1, dots: 0 },
  '1d':  { type: 'whole',   ticks: 24, dots: 1 },
  '2d':  { type: 'half',    ticks: 12, dots: 1 },
  '4d':  { type: 'quarter', ticks:  6, dots: 1 },
  '8d':  { type: 'eighth',  ticks:  3, dots: 1 },
  '16d': { type: '16th',    ticks:  2, dots: 1 },   // approximate — 1.5 ticks
};

/** Duration code → VexFlow 5 duration string (for the practice tick engine) */
const TO_VEX = {
  '1': 'w',  '1d': 'wd',
  '2': 'h',  '2d': 'hd',
  '4': 'q',  '4d': 'qd',
  '8': '8',  '8d': '8d',
  '16': '16',
};

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const SEMITONE   = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// ── Private helpers ────────────────────────────────────────────────────────

function midiToFreq(midi, a4 = 440) {
  return a4 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Parse pitch strings produced by GPT-4o: "A2", "F#4", "Bb3", "C##5"
 * Returns { step, octave, alter } or null on failure.
 */
function parsePitchString(raw) {
  const m = String(raw ?? '')
    .trim()
    .match(/^([A-Ga-g])(#{1,2}|b{1,2})?(-?\d+)$/);
  if (!m) return null;
  const step   = m[1].toUpperCase();
  const acc    = m[2] ?? '';
  const octave = parseInt(m[3], 10);
  const alter  = acc === '##' ?  2 : acc === '#'  ?  1
               : acc === 'bb' ? -2 : acc === 'b'  ? -1 : 0;
  return { step, octave, alter };
}

/**
 * Normalise the raw duration value GPT might return.
 * Handles: numbers (4 → "4"), strings ("quarter" → "4", "dotted-quarter" → "4d"), etc.
 */
function normaliseDuration(raw) {
  const wordMap = {
    whole: '1', half: '2', quarter: '4', eighth: '8',
    sixteenth: '16', '16th': '16',
    'dotted whole': '1d', 'dotted half': '2d', 'dotted quarter': '4d',
    'dotted eighth': '8d', 'dotted-whole': '1d', 'dotted-half': '2d',
    'dotted-quarter': '4d', 'dotted-eighth': '8d',
  };
  const s = String(raw ?? '4').trim().toLowerCase();
  if (wordMap[s]) return wordMap[s];
  // Already a code like "4", "8d", "16"
  return s;
}

/**
 * Build a hydrated note object from parsed components.
 * Same shape as samplePieces.js uses throughout the app.
 */
function hydrateNote(step, octave, alter, vexDur) {
  const midi      = (octave + 1) * 12 + (SEMITONE[step] ?? 0) + alter;
  const noteIdx   = ((midi % 12) + 12) % 12;
  const realOctave = Math.floor(midi / 12) - 1;
  const name      = NOTE_NAMES[noteIdx];
  return {
    midi,
    freq:     midiToFreq(midi),
    name:     `${name}${realOctave}`,
    vexKey:   `${name.toLowerCase()}/${realOctave}`,
    duration: vexDur,
  };
}

// ── XML construction helpers ───────────────────────────────────────────────

function xmlEsc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function clefXml(clef) {
  // Bass clef (Cello / Double Bass / bass instruments)
  if (clef === 'bass')  return '<clef><sign>F</sign><line>4</line></clef>';
  if (clef === 'tenor') return '<clef><sign>C</sign><line>4</line></clef>';
  if (clef === 'alto')  return '<clef><sign>C</sign><line>3</line></clef>';
  // Default: treble
  return '<clef><sign>G</sign><line>2</line></clef>';
}

function keyXml(keySignature) {
  const fifths = KEY_TO_FIFTHS[keySignature] ?? 0;
  return `<key><fifths>${fifths}</fifths></key>`;
}

function timeXml(timeSignature) {
  const parts = String(timeSignature ?? '4/4').split('/');
  const beats    = parts[0] ?? '4';
  const beatType = parts[1] ?? '4';
  return `<time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time>`;
}

/**
 * Compile a single <note> element (pitched or rest), or '' if unrecognisable.
 * Rest entries use pitch === "rest" (case-insensitive).
 */
function noteXml(pitchStr, durationCode) {
  const code = normaliseDuration(durationCode);
  const dur  = DURATION_TABLE[code];
  if (!dur) return '';

  const dotTag = dur.dots > 0 ? '\n  <dot/>' : '';

  // ── Rest note ─────────────────────────────────────────────────
  if (String(pitchStr ?? '').trim().toLowerCase() === 'rest') {
    return (
      '<note>\n' +
      '  <rest/>\n' +
      `  <duration>${dur.ticks}</duration>\n` +
      `  <type>${dur.type}</type>${dotTag}\n` +
      '</note>'
    );
  }

  // ── Pitched note ──────────────────────────────────────────────
  const pitch = parsePitchString(pitchStr);
  if (!pitch || !Object.prototype.hasOwnProperty.call(SEMITONE, pitch.step)) return '';

  const alterTag = pitch.alter !== 0 ? `<alter>${pitch.alter}</alter>` : '';

  return (
    '<note>\n' +
    `  <pitch><step>${pitch.step}</step>${alterTag}<octave>${pitch.octave}</octave></pitch>\n` +
    `  <duration>${dur.ticks}</duration>\n` +
    `  <type>${dur.type}</type>${dotTag}\n` +
    '</note>'
  );
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Compile GPT-4o score JSON → complete MusicXML 3.1 document string.
 *
 * @param {object} scoreData  { title, composer, clef, keySignature, timeSignature, allMeasures }
 * @returns {string}  Full MusicXML document, or '' if no valid notes.
 */
export function buildMusicXml(scoreData) {
  const {
    title         = 'Untitled',
    composer      = 'Unknown',
    clef          = 'treble',
    keySignature  = 'C',
    timeSignature = '4/4',
    allMeasures   = [],
  } = scoreData ?? {};

  const measureLines = [];

  for (let i = 0; i < allMeasures.length; i++) {
    const measure = allMeasures[i];
    if (!measure) continue;
    const mNum  = measure.measureNumber ?? (i + 1);
    const notes = Array.isArray(measure.notes) ? measure.notes : [];

    const notesXml = notes
      .map(n => noteXml(n?.pitch ?? '', n?.duration ?? '4'))
      .filter(Boolean)
      .join('\n');

    if (!notesXml) continue;   // skip entirely empty bars

    // Attributes block only on the first measure
    const attribs = i === 0
      ? `<attributes>\n` +
        `  <divisions>4</divisions>\n` +
        `  ${keyXml(keySignature)}\n` +
        `  ${timeXml(timeSignature)}\n` +
        `  ${clefXml(clef)}\n` +
        `</attributes>`
      : '';

    measureLines.push(
      `<measure number="${mNum}">`,
      ...(attribs ? [attribs] : []),
      notesXml,
      `</measure>`,
    );
  }

  if (measureLines.length === 0) return '';

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE score-partwise PUBLIC',
    '  "-//Recordare//DTD MusicXML 3.1 Partwise//EN"',
    '  "http://www.musicxml.org/dtds/partwise.dtd">',
    '<score-partwise version="3.1">',
    `  <work><work-title>${xmlEsc(title)}</work-title></work>`,
    `  <identification>`,
    `    <creator type="composer">${xmlEsc(composer)}</creator>`,
    `    <encoding><software>Virtual Concertmaster OMR</software></encoding>`,
    `  </identification>`,
    `  <part-list>`,
    `    <score-part id="P1"><part-name>Music</part-name></score-part>`,
    `  </part-list>`,
    `  <part id="P1">`,
    ...measureLines.map(l => '    ' + l),
    `  </part>`,
    `</score-partwise>`,
  ].join('\n');
}

/**
 * Convert GPT-4o score JSON → internal measures array for pitch detection.
 * Returns Array<Array<HydratedNote>> — the same shape samplePieces.js uses.
 *
 * Never throws; skips unrecognisable notes silently.
 *
 * @param {object} scoreData
 * @returns {Array<Array<object>>}
 */
export function buildInternalMeasures(scoreData) {
  const allMeasures = scoreData?.allMeasures;
  if (!Array.isArray(allMeasures)) return [];

  const measures = [];

  for (const measure of allMeasures) {
    const notes = Array.isArray(measure?.notes) ? measure.notes : [];
    const bar   = [];

    for (const n of notes) {
      try {
        // Rests hold timing only — skip for pitch detection
        if (String(n?.pitch ?? '').trim().toLowerCase() === 'rest') continue;

        const pitch = parsePitchString(String(n?.pitch ?? ''));
        if (!pitch || !Object.prototype.hasOwnProperty.call(SEMITONE, pitch.step)) continue;

        const code   = normaliseDuration(n?.duration ?? '4');
        const vexDur = TO_VEX[code] ?? 'q';

        bar.push(hydrateNote(pitch.step, pitch.octave, pitch.alter, vexDur));
      } catch (err) {
        console.warn('[musicXmlBuilder] Skipping malformed note entry:', err.message);
      }
    }

    if (bar.length > 0) measures.push(bar);
  }

  return measures;
}

/**
 * Parse a flat GPT-4o note-stream string into the two data structures the
 * rest of the pipeline needs.
 *
 * Input format (produced by the OMR system prompt):
 *   "A2/4 D3/4 F#3/4 | G3/4 F#3/4 E3/4 | D3/2 R/4 | ..."
 *
 *   Each token is  [Pitch]/[Duration]  where:
 *     Pitch    = A–G + optional # or b + octave (e.g. F#3, Bb2, C4)
 *                or  R / rest  for a silent beat
 *     Duration = MusicXML denominator: 1 2 4 8 16 with optional d suffix
 *   Tokens within a bar are space-separated; bars are separated by  |
 *
 * Returns:
 *   allMeasures  — Array in the shape buildMusicXml() expects
 *   measures     — HydratedNote[][] for the pitch-detection tick loop
 *                  (rests are excluded; bars with no pitched notes are excluded)
 *
 * Never throws.
 *
 * @param {string} noteStream
 * @returns {{ allMeasures: Array, measures: Array }}
 */
export function parseNoteStream(noteStream) {
  const emptyResult = { allMeasures: [], measures: [] };
  if (!noteStream || typeof noteStream !== 'string') return emptyResult;

  const allMeasures = [];
  const measures    = [];

  // Split on "|" — each segment is one bar
  const bars = noteStream.split('|');

  for (let i = 0; i < bars.length; i++) {
    const tokens = bars[i].trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;

    const noteEntries = [];   // for allMeasures (includes rests)
    const hydratedBar = [];   // for pitch detection (excludes rests)

    for (const token of tokens) {
      try {
        // Token format:  [Pitch]/[Duration]
        // Allow an optional trailing comma/semicolon GPT might add
        const clean    = token.replace(/[,;]+$/, '');
        const slashIdx = clean.lastIndexOf('/');
        if (slashIdx === -1) continue;

        const pitchStr = clean.slice(0, slashIdx).trim();
        const durRaw   = clean.slice(slashIdx + 1).trim();
        const durCode  = normaliseDuration(durRaw);

        // Validate duration is in our table
        if (!DURATION_TABLE[durCode]) continue;

        const isRest = /^[Rr](?:est)?$/.test(pitchStr);

        // Always add to allMeasures (rests are needed for MusicXML timing)
        noteEntries.push({ pitch: isRest ? 'rest' : pitchStr, duration: durCode });

        if (!isRest) {
          const pitch = parsePitchString(pitchStr);
          if (pitch && Object.prototype.hasOwnProperty.call(SEMITONE, pitch.step)) {
            const vexDur = TO_VEX[durCode] ?? 'q';
            hydratedBar.push(hydrateNote(pitch.step, pitch.octave, pitch.alter, vexDur));
          }
        }
      } catch (err) {
        console.warn('[parseNoteStream] Skipping malformed token:', token, err.message);
      }
    }

    if (noteEntries.length > 0) {
      allMeasures.push({ measureNumber: i + 1, notes: noteEntries });
    }
    if (hydratedBar.length > 0) {
      measures.push(hydratedBar);
    }
  }

  return { allMeasures, measures };
}
