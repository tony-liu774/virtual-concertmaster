const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/**
 * Convert Hz → { name, octave, cents, midi, frequency }
 * @param {number} freq  Detected frequency in Hz
 * @param {number} a4    A4 reference (default 440 Hz)
 */
export function freqToNote(freq, a4 = 440) {
  if (!freq || freq < 20 || freq > 8000) return null;
  const semitones = 12 * Math.log2(freq / a4);
  const midi      = Math.round(semitones) + 69;
  const cents     = (semitones - (midi - 69)) * 100;
  const noteIndex = ((midi % 12) + 12) % 12;
  const octave    = Math.floor(midi / 12) - 1;
  return { name: NOTE_NAMES[noteIndex], octave, cents, midi, frequency: freq };
}

/** MIDI note number → Hz */
export function midiToFreq(midi, a4 = 440) {
  return a4 * Math.pow(2, (midi - 69) / 12);
}

/** Cents deviation → human label */
export function centsLabel(cents) {
  const abs = Math.abs(cents);
  if (abs < 2)  return '✓ In Tune';
  if (cents > 0) return `+${cents.toFixed(1)}¢  Sharp`;
  return `${cents.toFixed(1)}¢  Flat`;
}

/** Intonation bucket from cents deviation */
export function intonationState(cents) {
  const abs = Math.abs(cents);
  if (abs <  5) return 'perfect';
  if (abs < 15) return 'close';
  if (abs < 35) return 'off';
  return 'far';
}

export const INSTRUMENT_RANGES = {
  violin: { min: 190,  max: 3200, label: 'Violin',      clef: 'treble' },
  viola:  { min: 125,  max: 1400, label: 'Viola',       clef: 'alto'   },
  cello:  { min: 60,   max: 700,  label: 'Cello',       clef: 'bass'   },
  bass:   { min: 38,   max: 400,  label: 'Double Bass', clef: 'bass'   },
};

export const OPEN_STRINGS = {
  violin: [{ name: 'G', midi: 55 }, { name: 'D', midi: 62 }, { name: 'A', midi: 69 }, { name: 'E', midi: 76 }],
  viola:  [{ name: 'C', midi: 48 }, { name: 'G', midi: 55 }, { name: 'D', midi: 62 }, { name: 'A', midi: 69 }],
  cello:  [{ name: 'C', midi: 36 }, { name: 'G', midi: 43 }, { name: 'D', midi: 50 }, { name: 'A', midi: 57 }],
  bass:   [{ name: 'E', midi: 28 }, { name: 'A', midi: 33 }, { name: 'D', midi: 38 }, { name: 'G', midi: 43 }],
};
