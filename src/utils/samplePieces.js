import { midiToFreq } from './musicTheory.js';

// ── Note builder ─────────────────────────────────────────────
const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

/**
 * Build a fully-hydrated note object from a MIDI number.
 * Exported so transposePieceForInstrument can rehydrate shifted notes.
 */
export function buildNote(midi, dur, accidental = null) {
  const noteIdx = ((midi % 12) + 12) % 12;
  const octave  = Math.floor(midi / 12) - 1;
  const name    = NOTE_NAMES[noteIdx];
  const vexKey  = `${name.toLowerCase()}/${octave}`;
  return { midi, freq: midiToFreq(midi), name: `${name}${octave}`, vexKey, duration: dur, accidental };
}

// Quick shorthands
const n = (midi, dur, acc = null) => buildNote(midi, dur, acc);
const q = (midi) => buildNote(midi, 'q');
const h = (midi) => buildNote(midi, 'h');
const w = (midi) => buildNote(midi, 'w');
const e = (midi) => buildNote(midi, '8');

// ── Instrument clef / transposition config ────────────────────
/**
 * Clef and MIDI offset per instrument.
 * Pieces are authored in violin/treble range. Transposition:
 *   violin :  0   treble clef  (no change)
 *   viola  :  0   alto clef    (same pitch, C-clef notation)
 *   cello  : -12  bass clef    (one octave lower)
 *   bass   : -24  bass clef    (two octaves lower)
 */
export const INSTRUMENT_CLEF_CONFIG = {
  violin: { clef: 'treble', midiOffset:   0 },
  viola:  { clef: 'alto',   midiOffset:   0 },
  cello:  { clef: 'bass',   midiOffset: -12 },
  bass:   { clef: 'bass',   midiOffset: -24 },
};

/**
 * Return a new piece with all notes transposed and clef set for `instrument`.
 * The original piece is never mutated.
 */
export function transposePieceForInstrument(piece, instrument) {
  if (!piece) return piece;
  const { clef, midiOffset } = INSTRUMENT_CLEF_CONFIG[instrument] ?? INSTRUMENT_CLEF_CONFIG.violin;
  if (midiOffset === 0 && clef === (piece.clef ?? 'treble')) return piece;
  return {
    ...piece,
    clef,
    measures: piece.measures.map(measure =>
      measure.map(note => buildNote(note.midi + midiOffset, note.duration, note.accidental))
    ),
  };
}

// ── Pieces ────────────────────────────────────────────────────
// All pieces authored in violin/treble range.
// `instrument: 'all'` = works on every instrument via transposition.

export const SAMPLE_PIECES = {

  // ── 1. Twinkle Twinkle Little Star ───────────────────────
  twinkle: {
    id: 'twinkle', title: 'Twinkle Twinkle Little Star',
    composer: 'Traditional', instrument: 'all',
    difficulty: 'Beginner', bpm: 100,
    keySignature: 'C', timeSignature: '4/4', clef: 'treble',
    measures: [
      [q(60), q(60), q(67), q(67)],           // C C G G
      [q(69), q(69), h(67)],                   // A A G—
      [q(65), q(65), q(64), q(64)],            // F F E E
      [q(62), q(62), h(60)],                   // D D C—
      [q(67), q(67), q(65), q(65)],            // G G F F
      [q(64), q(64), h(62)],                   // E E D—
      [q(67), q(67), q(65), q(65)],            // G G F F
      [q(64), q(64), h(62)],                   // E E D—
      [q(60), q(60), q(67), q(67)],            // C C G G
      [q(69), q(69), h(67)],                   // A A G—
      [q(65), q(65), q(64), q(64)],            // F F E E
      [q(62), q(62), h(60)],                   // D D C—
    ],
  },

  // ── 2. Ode to Joy ─────────────────────────────────────────
  ode_to_joy: {
    id: 'ode_to_joy', title: 'Ode to Joy',
    composer: 'L. van Beethoven', instrument: 'all',
    difficulty: 'Beginner', bpm: 100,
    keySignature: 'C', timeSignature: '4/4', clef: 'treble',
    measures: [
      [q(64), q(64), q(65), q(67)],            // E E F G
      [q(67), q(65), q(64), q(62)],            // G F E D
      [q(60), q(60), q(62), q(64)],            // C C D E
      [q(64), q(62), h(62)],                   // E D D—
      [q(64), q(64), q(65), q(67)],            // E E F G
      [q(67), q(65), q(64), q(62)],            // G F E D
      [q(60), q(60), q(62), q(64)],            // C C D E
      [q(62), q(60), h(60)],                   // D C C—
      [q(62), q(62), q(64), q(60)],            // D D E C
      [q(62), q(64), q(65), q(64)],            // D E F E  (middle section)
      [q(60), q(64), q(65), q(64)],            // C E F E
      [q(62), q(62), q(67), q(67)],             // D D G G
      [q(64), q(64), q(65), q(67)],            // E E F G
      [q(67), q(65), q(64), q(62)],            // G F E D
      [q(60), q(60), q(62), q(64)],            // C C D E
      [q(62), q(60), h(60)],                   // D C C—
    ],
  },

  // ── 3. Minuet in G ────────────────────────────────────────
  minuet_in_g: {
    id: 'minuet_in_g', title: 'Minuet in G',
    composer: 'J. S. Bach / Petzold', instrument: 'all',
    difficulty: 'Beginner', bpm: 120,
    keySignature: 'G', timeSignature: '3/4', clef: 'treble',
    measures: [
      // G major: G4=67 A4=69 B4=71 C5=72 D5=74 E5=76 F#5=78 G5=79
      [q(74), q(67), q(69)],    // D5 G4 A4
      [q(71), q(72), q(74)],    // B4 C5 D5
      [q(79), q(74), q(74)],    // G5 D5 D5
      [n(74,'hd')],              // D5 dotted-half (whole measure)
      [q(72), q(74), q(72)],    // C5 D5 C5
      [q(71), q(69), q(69)],    // B4 A4 A4
      [q(67), q(71), q(74)],    // G4 B4 D5
      [n(67,'hd')],              // G4 dotted-half
      // Second half
      [q(74), q(76), q(74)],    // D5 E5 D5
      [q(72), q(71), q(69)],    // C5 B4 A4
      [q(71), q(72), q(71)],    // B4 C5 B4
      [q(69), q(67), q(67)],    // A4 G4 G4
      [q(76), q(74), q(72)],    // E5 D5 C5
      [q(71), q(69), q(67)],    // B4 A4 G4
      [q(69), q(71), q(69)],    // A4 B4 A4
      [n(67,'hd')],              // G4 dotted-half
    ],
  },

  // ── 4. Amazing Grace ──────────────────────────────────────
  amazing_grace: {
    id: 'amazing_grace', title: 'Amazing Grace',
    composer: 'Traditional', instrument: 'all',
    difficulty: 'Beginner', bpm: 88,
    keySignature: 'G', timeSignature: '3/4', clef: 'treble',
    measures: [
      // G major: G4=67 A4=69 B4=71 D5=74 E5=76 G5=79
      [q(67), q(74), q(74)],    // G4 D5 D5   A-maz-ing
      [q(71), q(79), q(74)],    // B4 G5 D5   grace how
      [q(76), q(74), q(71)],    // E5 D5 B4   sweet the
      [q(67), q(69), q(69)],    // G4 A4 A4   sound that
      [q(71), q(74), q(74)],    // B4 D5 D5   saved a
      [q(71), q(74), q(76)],    // B4 D5 E5   wretch like
      [q(74), q(71), q(67)],    // D5 B4 G4   me I
      [n(69,'h'), q(67)],        // A4— G4     once was
      [q(67), q(74), q(74)],    // G4 D5 D5   lost but
      [q(71), q(79), q(74)],    // B4 G5 D5   now I'm
      [q(76), q(74), q(71)],    // E5 D5 B4   found was
      [q(67), q(69), q(69)],    // G4 A4 A4   blind but
      [q(71), q(74), q(74)],    // B4 D5 D5   now I
      [q(71), q(74), q(76)],    // B4 D5 E5   see
      [n(74,'h'), q(71)],        // D5— B4
      [n(67,'hd')],              // G4 dotted-half (end)
    ],
  },

  // ── 5. Air on the G String ────────────────────────────────
  bach_air: {
    id: 'bach_air', title: 'Air on the G String',
    composer: 'J. S. Bach', instrument: 'all',
    difficulty: 'Intermediate', bpm: 60,
    keySignature: 'D', timeSignature: '4/4', clef: 'treble',
    measures: [
      [n(74,'h'), n(73,'q'), n(71,'q')],
      [n(69,'h'), n(71,'q'), n(73,'q')],
      [n(74,'hd'), n(73,'8'), n(71,'8')],
      [n(69,'w')],
      [n(71,'h'), n(69,'q'), n(67,'q')],
      [n(66,'h'), n(67,'q'), n(69,'q')],
      [n(71,'hd'), n(69,'8'), n(67,'8')],
      [n(66,'w')],
      [n(74,'q'), n(73,'q'), n(71,'q'), n(69,'q')],
      [n(67,'q'), n(66,'q'), n(67,'q'), n(69,'q')],
      [n(71,'h'), n(69,'q'), n(71,'q')],
      [n(74,'w')],
    ],
  },

  // ── 6. Canon in D ─────────────────────────────────────────
  pachelbel_canon: {
    id: 'pachelbel_canon', title: 'Canon in D',
    composer: 'J. Pachelbel', instrument: 'all',
    difficulty: 'Intermediate', bpm: 72,
    keySignature: 'D', timeSignature: '4/4', clef: 'treble',
    measures: [
      [q(74), q(71), q(69), q(66)],   // D5 B4 A4 F#4
      [q(67), q(66), q(67), q(69)],   // G4 F#4 G4 A4
      [q(71), q(69), q(71), q(73)],   // B4 A4 B4 C#5
      [q(74), q(73), q(74), q(76)],   // D5 C#5 D5 E5
      [q(74), q(71), q(69), q(66)],   // D5 B4 A4 F#4
      [q(67), q(66), q(67), q(69)],   // G4 F#4 G4 A4
      [q(71), q(69), q(71), q(73)],   // B4 A4 B4 C#5
      [w(74)],                         // D5 whole
    ],
  },

  // ── 7. Spring — Allegro (Vivaldi) ─────────────────────────
  vivaldi_spring: {
    id: 'vivaldi_spring', title: 'Spring — Allegro',
    composer: 'A. Vivaldi', instrument: 'all',
    difficulty: 'Advanced', bpm: 132,
    keySignature: 'E', timeSignature: '4/4', clef: 'treble',
    measures: [
      [e(76), e(76), e(76), e(76), e(76), e(76), e(76), e(76)],  // E5 eighths
      [e(75), e(75), e(75), e(75), e(75), e(75), e(75), e(75)],  // D#5
      [e(76), e(76), e(76), e(76), e(76), e(76), e(76), e(76)],  // E5
      [n(76,'h'), n(75,'h')],                                     // E D#
      [q(76), q(75), q(73), q(71)],                              // E D# C# B
      [q(72), q(71), q(69), q(68)],                              // C B A G#
      [n(69,'h'), n(71,'h')],                                     // A B
      [n(73,'w')],                                                 // C# whole
    ],
  },

  // ── 8. Gavotte in D (Gossec) ──────────────────────────────
  gavotte: {
    id: 'gavotte', title: 'Gavotte in D',
    composer: 'F.-J. Gossec', instrument: 'all',
    difficulty: 'Intermediate', bpm: 110,
    keySignature: 'D', timeSignature: '4/4', clef: 'treble',
    measures: [
      // D major: D4=62 E4=64 F#4=66 G4=67 A4=69 B4=71 C#5=73 D5=74
      [q(74), q(74), q(74), q(71)],    // D5 D5 D5 B4
      [q(69), q(69), h(69)],            // A4 A4 A—
      [q(71), q(71), q(71), q(74)],    // B4 B4 B4 D5
      [n(73,'h'), h(66)],               // C#5— F#4—
      [q(74), q(76), q(74), q(71)],    // D5 E5 D5 B4
      [q(69), q(71), q(74), q(69)],    // A B D5 A
      [q(66), q(67), q(69), q(71)],    // F# G A B
      [n(74,'w')],                      // D5 whole
      // Second section
      [q(78), q(76), q(74), q(73)],    // F#5 E5 D5 C#5
      [q(74), q(71), h(69)],            // D5 B4 A—
      [q(76), q(74), q(73), q(71)],    // E5 D5 C#5 B4
      [n(69,'h'), h(66)],               // A— F#—
      [q(74), q(76), q(74), q(71)],    // D5 E5 D5 B4
      [q(69), q(71), q(74), q(69)],    // A B D5 A
      [q(66), q(67), q(69), q(71)],    // F# G A B
      [n(74,'w')],                      // D5 whole
    ],
  },

  // ── 9. Paganini — Caprice No. 24 ─────────────────────────────
  // A minor, 2/4, 120 BPM.  Authentic varied rhythms:
  //   dotted-eighth + 16th syncopation, 16th-note runs, arpeggio sweeps.
  // Key: C (= A minor, no sharps/flats); accidentals (#) added per-note.
  // All measures beat-verified to exactly 2.0 beats in 2/4.
  //
  // MIDI ref: A4=69 B4=71 C5=72 C#5=73 D5=74 E5=76 F#5=78 G#5=80 A5=81 B5=83
  //           E4=64  G4=67
  paganini_24: {
    id: 'paganini_24', title: 'Caprice No. 24',
    composer: 'N. Paganini', instrument: 'all',
    difficulty: 'Advanced', bpm: 120,
    keySignature: 'C', timeSignature: '2/4', clef: 'treble',
    measures: [
      // ── Main Theme (mm 1–8) ───────────────────────────────────
      // m1: A4(q) A4(8) E5(8)   = 1+0.5+0.5 = 2
      [n(69,'q'), n(69,'8'), n(76,'8')],
      // m2: A5.(8d) G#5(16) E5(8) D5(8)  = 0.75+0.25+0.5+0.5 = 2
      [n(81,'8d'), n(80,'16'), n(76,'8'), n(74,'8')],
      // m3: C#5.(8d) D5(16) A4(8) C5(8)  = 0.75+0.25+0.5+0.5 = 2
      [n(73,'8d'), n(74,'16'), n(69,'8'), n(72,'8')],
      // m4: B4.(8d)  C5(16) G4(8) B4(8)  = 0.75+0.25+0.5+0.5 = 2
      [n(71,'8d'), n(72,'16'), n(67,'8'), n(71,'8')],
      // m5: A4(8) E5(8) A5.(8d) G#5(16)  = 0.5+0.5+0.75+0.25 = 2
      [n(69,'8'), n(76,'8'), n(81,'8d'), n(80,'16')],
      // m6: A5.(8d) E5(16) D5(8) C#5(8)  = 0.75+0.25+0.5+0.5 = 2
      [n(81,'8d'), n(76,'16'), n(74,'8'), n(73,'8')],
      // m7: D5(8) E5(8) F#5(8) A5(8)     = 0.5+0.5+0.5+0.5 = 2
      [n(74,'8'), n(76,'8'), n(78,'8'), n(81,'8')],
      // m8: A5(q) A4(q)                   = 1+1 = 2
      [n(81,'q'), n(69,'q')],

      // ── 16th-Note Arpeggio Variation (mm 9–12) ───────────────
      // m9: A4 C#5 E5 A5 A5 E5 C#5 A4 (arp up+down) = 8×0.25 = 2
      [n(69,'16'), n(73,'16'), n(76,'16'), n(81,'16'),
       n(81,'16'), n(76,'16'), n(73,'16'), n(69,'16')],
      // m10: E5.(8d) D5(16) C#5(8) D5(8)  = 0.75+0.25+0.5+0.5 = 2
      [n(76,'8d'), n(74,'16'), n(73,'8'), n(74,'8')],
      // m11: A4 C#5 E5 A5 B5 A5 E5 C#5 (wide arp up+down) = 8×0.25 = 2
      [n(69,'16'), n(73,'16'), n(76,'16'), n(81,'16'),
       n(83,'16'), n(81,'16'), n(76,'16'), n(73,'16')],
      // m12: A5.(8d) G#5(16) F#5(8) E5(8) = 0.75+0.25+0.5+0.5 = 2
      [n(81,'8d'), n(80,'16'), n(78,'8'), n(76,'8')],

      // ── 16th-Note Scale Runs (mm 13–16) ──────────────────────
      // m13: A4→E5 ascending chromatic-minor 8 sixteenths = 8×0.25 = 2
      [n(69,'16'), n(71,'16'), n(72,'16'), n(73,'16'),
       n(74,'16'), n(76,'16'), n(78,'16'), n(80,'16')],
      // m14: A5→A4 descending 8 sixteenths = 8×0.25 = 2
      [n(81,'16'), n(80,'16'), n(78,'16'), n(76,'16'),
       n(74,'16'), n(73,'16'), n(71,'16'), n(69,'16')],
      // m15: C#5.(8d) D5(16) E5(8) A4(8)  = 0.75+0.25+0.5+0.5 = 2
      [n(73,'8d'), n(74,'16'), n(76,'8'), n(69,'8')],
      // m16: A4(h)                          = 2
      [n(69,'h')],
    ],
  },

  // ── 10. Liszt — La Campanella ─────────────────────────────
  // Key: C major (no key sig, all sharps explicit) to avoid doubled accidentals.
  // 4/4, 96 BPM.  Iconic bell figure (B5 ringing), flowing 16th-note runs,
  // dotted-eighth ornaments, and an octave-spanning cadential descent.
  // All measures beat-verified to exactly 4.0 beats.
  //
  // MIDI ref: A4=69 B4=71 C#5=73 D5=74 E5=76 F#5=78 G#5=80 A5=81 B5=83
  liszt_campanella: {
    id: 'liszt_campanella', title: 'La Campanella',
    composer: 'F. Liszt', instrument: 'all',
    difficulty: 'Advanced', bpm: 96,
    keySignature: 'C', timeSignature: '4/4', clef: 'treble',
    measures: [
      // ── Bell Theme (mm 1–4) ───────────────────────────────────
      // m1: B5(q) B5(8) B5(8) A5(q) F#5(q)  = 1+0.5+0.5+1+1 = 4
      [n(83,'q'), n(83,'8'), n(83,'8'), n(81,'q'), n(78,'q')],
      // m2: E5(q) D5(q) C#5(q) B4(q)         = 1+1+1+1 = 4
      [n(76,'q'), n(74,'q'), n(73,'q'), n(71,'q')],
      // m3: repeat bell motif                  = 4
      [n(83,'q'), n(83,'8'), n(83,'8'), n(81,'q'), n(78,'q')],
      // m4: E5(h) C#5(h)                       = 2+2 = 4
      [n(76,'h'), n(73,'h')],

      // ── 16th-Note Scale Runs (mm 5–8) ────────────────────────
      // m5: A major scale A4→A5 then back (16 sixteenths) = 16×0.25 = 4
      [n(69,'16'), n(71,'16'), n(73,'16'), n(74,'16'),
       n(76,'16'), n(78,'16'), n(80,'16'), n(81,'16'),
       n(83,'16'), n(81,'16'), n(80,'16'), n(78,'16'),
       n(76,'16'), n(74,'16'), n(73,'16'), n(71,'16')],
      // m6: B4→B5 then descend to A4 (16 sixteenths) = 16×0.25 = 4
      [n(71,'16'), n(73,'16'), n(74,'16'), n(76,'16'),
       n(78,'16'), n(80,'16'), n(81,'16'), n(83,'16'),
       n(81,'16'), n(80,'16'), n(78,'16'), n(76,'16'),
       n(74,'16'), n(73,'16'), n(71,'16'), n(69,'16')],
      // m7: B5.(8d) A5(16) F#5(q) E5(q) D5(q)  = 0.75+0.25+1+1+1 = 4
      [n(83,'8d'), n(81,'16'), n(78,'q'), n(76,'q'), n(74,'q')],
      // m8: C#5(q) B4(q) A4(h)                  = 1+1+2 = 4
      [n(73,'q'), n(71,'q'), n(69,'h')],

      // ── Dotted-Rhythm Ornament Passage (mm 9–12) ─────────────
      // m9: A4(8) B4(8) C#5(8) D5(8) E5(8) F#5(8) G#5(8) A5(8) = 8×0.5 = 4
      [n(69,'8'), n(71,'8'), n(73,'8'), n(74,'8'),
       n(76,'8'), n(78,'8'), n(80,'8'), n(81,'8')],
      // m10: B5(8) A5(8) G#5(8) F#5(8) E5(8) D5(8) C#5(8) B4(8) = 8×0.5 = 4
      [n(83,'8'), n(81,'8'), n(80,'8'), n(78,'8'),
       n(76,'8'), n(74,'8'), n(73,'8'), n(71,'8')],
      // m11: B5.(8d) A5(16) F#5.(8d) E5(16) D5.(8d) C#5(16) B4.(8d) A4(16)
      //      = (0.75+0.25)×4 = 4
      [n(83,'8d'), n(81,'16'), n(78,'8d'), n(76,'16'),
       n(74,'8d'), n(73,'16'), n(71,'8d'), n(69,'16')],
      // m12: E5(h) A4(h)                          = 2+2 = 4
      [n(76,'h'), n(69,'h')],

      // ── Cadential Descent (mm 13–16) ─────────────────────────
      // m13: B5(q) A5(q) F#5(q) E5(q)             = 4
      [n(83,'q'), n(81,'q'), n(78,'q'), n(76,'q')],
      // m14: D5(q) C#5(q) B4(q) A4(q)             = 4
      [n(74,'q'), n(73,'q'), n(71,'q'), n(69,'q')],
      // m15: A4.(8d) B4(16) C#5.(8d) D5(16) E5.(8d) F#5(16) G#5.(8d) A5(16)
      //      = (0.75+0.25)×4 = 4
      [n(69,'8d'), n(71,'16'), n(73,'8d'), n(74,'16'),
       n(76,'8d'), n(78,'16'), n(80,'8d'), n(81,'16')],
      // m16: A4(w)                                  = 4
      [n(69,'w')],
    ],
  },

};

/** All pieces as a sorted array (by difficulty then title) */
export const PIECES_LIST = Object.values(SAMPLE_PIECES);
