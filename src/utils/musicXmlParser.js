/**
 * musicXmlParser.js — Browser DOMParser-based MusicXML → internal piece format.
 *
 * Converts a MusicXML string into the same `{ title, composer, clef,
 * keySignature, timeSignature, bpm, measures }` shape used throughout
 * the app, so the pitch-detection engine and progress bar work identically
 * for scanned pieces and built-in sample pieces.
 *
 * Limitations (by design – single-voice violin/string parts):
 *   - Only the first <part> is read.
 *   - Chord continuations (<chord/>) are skipped; only the first note
 *     of each chord stack is kept.
 *   - Rests are skipped.
 *   - Grace notes are skipped.
 *   - Double-dots produce the same vexDur as single-dot (rare in practice).
 */

// ── Constants ──────────────────────────────────────────────────────────────

const FIFTHS_TO_KEY = {
  '-7': 'Cb', '-6': 'Gb', '-5': 'Db', '-4': 'Ab',
  '-3': 'Eb', '-2': 'Bb', '-1': 'F',
   '0': 'C',
   '1': 'G',  '2': 'D',  '3': 'A',  '4': 'E',  '5': 'B',  '6': 'F#',  '7': 'C#',
};

/** MusicXML <type> text → VexFlow 5 base duration code */
const TYPE_TO_VEX = {
  'whole':    'w',
  'half':     'h',
  'quarter':  'q',
  'eighth':   '8',
  '16th':     '16',
  '32nd':     '32',
};

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const SEMITONE   = { C:0, D:2, E:4, F:5, G:7, A:9, B:11 };

// ── Private helpers ────────────────────────────────────────────────────────

function midiToFreq(midi, a4 = 440) {
  return a4 * Math.pow(2, (midi - 69) / 12);
}

function buildNote(step, octave, alter, vexDuration) {
  const midi      = (octave + 1) * 12 + (SEMITONE[step] ?? 0) + Math.round(alter);
  const noteIdx   = ((midi % 12) + 12) % 12;
  const realOctave = Math.floor(midi / 12) - 1;
  const name      = NOTE_NAMES[noteIdx];
  return {
    midi,
    freq:     midiToFreq(midi),
    name:     `${name}${realOctave}`,
    vexKey:   `${name.toLowerCase()}/${realOctave}`,
    duration: vexDuration,
  };
}

// ── Public API ─────────────────────────────────────────────────────────────

// ── Safe fallback returned when any parse stage fails ─────────────────────
const EMPTY_RESULT = (fallbackBpm = 80) => ({
  title: 'Untitled', composer: 'Unknown',
  clef: 'treble', keySignature: 'C', timeSignature: '4/4',
  bpm: fallbackBpm, measures: [],
});

/**
 * Parse a MusicXML string and return the internal piece representation.
 *
 * This function NEVER throws.  On any error it logs to the console and
 * returns a safe empty-measures object so the app keeps running and OSMD
 * can still render the visual score independently.
 *
 * @param {string} xmlString       Full MusicXML document text.
 * @param {number} [fallbackBpm]   BPM to use when the score has no tempo marking.
 * @returns {{ title, composer, clef, keySignature, timeSignature, bpm, measures }}
 */
export function parseMusicXml(xmlString, fallbackBpm = 80) {
  if (!xmlString || typeof xmlString !== 'string') {
    console.warn('[musicXmlParser] parseMusicXml called with empty input.');
    return EMPTY_RESULT(fallbackBpm);
  }

  try {
    // ── 1. Parse XML ─────────────────────────────────────────────
    const parser     = new DOMParser();
    const doc        = parser.parseFromString(xmlString, 'application/xml');
    const parseError = doc.querySelector('parsererror');
    if (parseError) {
      console.error('[musicXmlParser] DOMParser error:', parseError.textContent.slice(0, 300));
      return EMPTY_RESULT(fallbackBpm);
    }

    // ── 2. Metadata ──────────────────────────────────────────────
    const movementTitle = doc.querySelector('movement-title')?.textContent?.trim() ?? '';
    const workTitle     = doc.querySelector('work work-title')?.textContent?.trim() ?? '';
    const title         = movementTitle || workTitle || 'Untitled';

    const composerEl = doc.querySelector('identification creator[type="composer"]');
    const composer   = composerEl?.textContent?.trim() ?? 'Unknown';

    // ── 3. First part only ───────────────────────────────────────
    const part = doc.querySelector('part');
    if (!part) {
      console.warn('[musicXmlParser] No <part> element — OSMD-only mode.');
      return EMPTY_RESULT(fallbackBpm);
    }

    const measureEls = Array.from(part.querySelectorAll(':scope > measure'));

    // ── 4. Walk measures ─────────────────────────────────────────
    let clef          = 'treble';
    let keySignature  = 'C';
    let timeSignature = '4/4';

    const measures = [];

    for (const measureEl of measureEls) {
      try {
        // ── 4a. Attributes block ────────────────────────────────
        const attribs = measureEl.querySelector('attributes');
        if (attribs) {
          const fifthsEl = attribs.querySelector('key > fifths');
          if (fifthsEl) {
            const f = parseInt(fifthsEl.textContent, 10);
            keySignature = FIFTHS_TO_KEY[String(f)] ?? 'C';
          }

          const beatsEl    = attribs.querySelector('time > beats');
          const beatTypeEl = attribs.querySelector('time > beat-type');
          if (beatsEl && beatTypeEl) {
            timeSignature = `${beatsEl.textContent.trim()}/${beatTypeEl.textContent.trim()}`;
          }

          const clefSign = attribs.querySelector('clef > sign');
          if (clefSign) {
            const s = clefSign.textContent.trim();
            clef = s === 'G' ? 'treble'
                 : s === 'F' ? 'bass'
                 : s === 'C' ? 'alto'
                 : clef;
          }
        }

        // ── 4b. Note elements ───────────────────────────────────
        const noteEls = Array.from(measureEl.querySelectorAll(':scope > note'));
        const bar = [];

        for (const noteEl of noteEls) {
          try {
            if (noteEl.querySelector('rest'))   continue;  // rest
            if (noteEl.querySelector('chord'))  continue;  // chord continuation
            if (noteEl.querySelector('grace'))  continue;  // grace note

            const stepEl   = noteEl.querySelector('pitch > step');
            const octaveEl = noteEl.querySelector('pitch > octave');
            const alterEl  = noteEl.querySelector('pitch > alter');
            if (!stepEl || !octaveEl) continue;

            const step   = stepEl.textContent.trim().toUpperCase();
            const octave = parseInt(octaveEl.textContent, 10);
            const alter  = alterEl ? parseFloat(alterEl.textContent) : 0;

            if (!Object.prototype.hasOwnProperty.call(SEMITONE, step)) continue;

            const typeEl = noteEl.querySelector('type');
            if (!typeEl) continue;
            const baseVex = TYPE_TO_VEX[typeEl.textContent.trim()];
            if (!baseVex) continue;   // 32nd, 64th etc. — skip

            const dotCount = noteEl.querySelectorAll('dot').length;
            const vexDur   = dotCount >= 1 ? baseVex + 'd' : baseVex;

            bar.push(buildNote(step, octave, alter, vexDur));
          } catch (noteErr) {
            // Malformed note element — skip silently, keep going
            console.warn('[musicXmlParser] Skipping malformed <note>:', noteErr.message);
          }
        }

        if (bar.length > 0) measures.push(bar);
      } catch (measureErr) {
        // Malformed measure — skip, keep going
        console.warn('[musicXmlParser] Skipping malformed <measure>:', measureErr.message);
      }
    }

    // Empty result is valid — OSMD still renders; pitch detection just idles
    if (measures.length === 0) {
      console.warn('[musicXmlParser] No playable notes extracted — OSMD-only mode.');
    }

    return { title, composer, clef, keySignature, timeSignature, bpm: fallbackBpm, measures };

  } catch (fatal) {
    console.error('[musicXmlParser] Critical parsing failure:', fatal);
    return EMPTY_RESULT(fallbackBpm);
  }
}
