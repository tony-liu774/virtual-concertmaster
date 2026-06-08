import { midiToFreq } from './musicTheory.js';
import { buildMusicXml } from './musicXmlBuilder.js';

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const INSTRUMENT_CONFIG = {
  violin: { label: 'Violin', clef: 'treble', minMidi: 55, maxMidi: 76, bpm: 84 },
  viola:  { label: 'Viola', clef: 'alto',   minMidi: 48, maxMidi: 69, bpm: 80 },
  cello:  { label: 'Cello', clef: 'bass',   minMidi: 38, maxMidi: 55, bpm: 76 },
  bass:   { label: 'Double Bass', clef: 'bass', minMidi: 28, maxMidi: 50, bpm: 72 },
};

const DURATION_BY_BEATS = {
  2:   { beats: 2,   code: '2', vex: 'h', label: 'half' },
  1:   { beats: 1,   code: '4', vex: 'q', label: 'quarter' },
  0.5: { beats: 0.5, code: '8', vex: '8', label: 'eighth' },
};

const EVENT_WEIGHTS = [
  { beats: 1,   weight: 52 },
  { beats: 0.5, weight: 32 },
  { beats: 2,   weight: 16 },
];

export const RANDOM_OPTIONS_KEY = 'virtual_concertmaster_random_options';

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function weightedPick(items) {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let roll = Math.random() * total;
  for (const item of items) {
    roll -= item.weight;
    if (roll <= 0) return item;
  }
  return items[items.length - 1];
}

function midiToPitch(midi) {
  const noteIdx = ((midi % 12) + 12) % 12;
  const octave  = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[noteIdx]}${octave}`;
}

function midiToVexKey(midi) {
  const noteIdx = ((midi % 12) + 12) % 12;
  const octave  = Math.floor(midi / 12) - 1;
  return `${NOTE_NAMES[noteIdx].toLowerCase()}/${octave}`;
}

function buildPitchPool(minMidi, maxMidi) {
  const naturalPitchClasses = new Set([0, 2, 4, 5, 7, 9, 11]);
  const pool = [];
  for (let midi = minMidi; midi <= maxMidi; midi++) {
    if (naturalPitchClasses.has(((midi % 12) + 12) % 12)) pool.push(midi);
  }
  return pool;
}

function nearestPoolIndex(pool, midi) {
  let bestIdx = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < pool.length; i++) {
    const distance = Math.abs(pool[i] - midi);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function nextPitch(pool, previousMidi) {
  if (!previousMidi) return pool[randomInt(0, pool.length - 1)];

  const currentIdx = nearestPoolIndex(pool, previousMidi);
  const stepChoices = [-2, -1, 0, 1, 2, 3, -3]
    .map(offset => currentIdx + offset)
    .filter(idx => idx >= 0 && idx < pool.length);

  return pool[stepChoices[randomInt(0, stepChoices.length - 1)]];
}

function buildNoteEvent({ midi, duration, measureIdx }) {
  const name = midiToPitch(midi);
  return {
    isRest: false,
    midi,
    freq: midiToFreq(midi),
    name,
    vexKey: midiToVexKey(midi),
    duration: duration.vex,
    measureIdx,
  };
}

function buildRestEvent({ duration, measureIdx }) {
  return {
    isRest: true,
    name: 'Rest',
    duration: duration.vex,
    measureIdx,
  };
}

function chooseDuration(remainingBeats) {
  const candidates = EVENT_WEIGHTS.filter(item => item.beats <= remainingBeats);
  if (remainingBeats === 0.5) return DURATION_BY_BEATS[0.5];
  const picked = weightedPick(candidates);
  return DURATION_BY_BEATS[picked.beats];
}

/**
 * Generate a fresh sight-reading score.
 *
 * Returns a complete practice-ready piece:
 *   - musicXmlString: rendered by OSMD
 *   - events: note/rest timing stream for the amber cursor
 *   - measures: pitched notes only, used by reporting fallbacks
 */
export function generateRandomScore(options = {}) {
  const instrument = options.instrument ?? 'cello';
  const config = INSTRUMENT_CONFIG[instrument] ?? INSTRUMENT_CONFIG.cello;
  const timeSignature = options.timeSignature ?? (Math.random() < 0.45 ? '3/4' : '4/4');
  const beatsPerMeasure = timeSignature === '3/4' ? 3 : 4;
  const measureCount = options.measureCount ?? randomInt(8, 16);
  const bpm = options.bpm ?? config.bpm;
  const pool = buildPitchPool(config.minMidi, config.maxMidi);

  const allMeasures = [];
  const events = [];
  const measures = [];
  let previousMidi = pool[Math.floor(pool.length / 2)];

  for (let measureIdx = 0; measureIdx < measureCount; measureIdx++) {
    let remaining = beatsPerMeasure;
    const xmlNotes = [];
    const eventMeasure = [];
    const pitchedMeasure = [];

    while (remaining > 0) {
      const duration = chooseDuration(remaining);
      const isRest = Math.random() < 0.12 && remaining !== beatsPerMeasure;

      if (isRest) {
        xmlNotes.push({ pitch: 'rest', duration: duration.code });
        eventMeasure.push(buildRestEvent({ duration, measureIdx }));
      } else {
        previousMidi = nextPitch(pool, previousMidi);
        const pitch = midiToPitch(previousMidi);
        const note = buildNoteEvent({ midi: previousMidi, duration, measureIdx });
        xmlNotes.push({ pitch, duration: duration.code });
        eventMeasure.push(note);
        pitchedMeasure.push(note);
      }

      remaining = Number((remaining - duration.beats).toFixed(2));
    }

    allMeasures.push({ measureNumber: measureIdx + 1, notes: xmlNotes });
    events.push(eventMeasure);
    measures.push(pitchedMeasure);
  }

  const title = `Sight-Reading Quest ${measureCount}`;
  const musicXmlString = buildMusicXml({
    title,
    composer: 'Generated by Virtual Concertmaster',
    partName: config.label,
    software: 'Virtual Concertmaster Random Generator',
    clef: config.clef,
    keySignature: 'C',
    timeSignature,
    allMeasures,
  });

  return {
    id: `random_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
    title,
    composer: `${config.label} Random Study`,
    instrument,
    difficulty: 'Sight Reading',
    bpm,
    keySignature: 'C',
    timeSignature,
    clef: config.clef,
    isGenerated: true,
    generatedAt: new Date().toISOString(),
    musicXmlString,
    events,
    measures,
  };
}
