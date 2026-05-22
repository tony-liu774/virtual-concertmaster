import { DURATION_BEATS } from './rhythmRepair.js';

const PLACEHOLDER_TITLE = /^(untitled|scanned score|vc[_\s-]*omr[_\s-]*\d+)/i;
const ENGINE_COMPOSER = /^(transcribed by|unknown$)/i;

const EXPECTED_CLEF = {
  violin: 'treble',
  viola: 'alto',
  cello: 'bass',
  bass: 'bass',
};

function expectedMeasureBeats(timeSignature = '4/4') {
  const [beats, beatType] = timeSignature.split('/').map(Number);
  if (!beats || !beatType) return 4;
  return beats * (4 / beatType);
}

function partNameFromXml(xml = '') {
  const match = xml.match(/<part-name>([\s\S]*?)<\/part-name>/i);
  return match ? match[1].trim() : '';
}

export function evaluateScanQuality(piece, { expectedInstrument = 'violin' } = {}) {
  const issues = [];
  const warnings = [];
  const measures = Array.isArray(piece?.measures) ? piece.measures : [];
  const notes = measures.flat();
  const measureCount = measures.length;
  const noteCount = notes.length;
  const expectedBeats = expectedMeasureBeats(piece?.timeSignature);

  if (noteCount === 0) {
    issues.push('No playable notes were detected.');
  }
  if (measureCount === 0) {
    issues.push('No measures were detected.');
  }
  if (measureCount > 0 && noteCount / measureCount > 18) {
    issues.push('The scan is too dense, which usually means notes or barlines were misread.');
  }
  if (measures.some(measure => measure.length > 32)) {
    issues.push('At least one measure contains an impossible number of notes.');
  }

  const invalidDurations = notes.filter(note => !DURATION_BEATS[note.duration]);
  if (invalidDurations.length > 0) {
    issues.push(`${invalidDurations.length} note(s) have unsupported rhythms.`);
  }

  const overfull = measures.filter(measure => {
    const total = measure.reduce((sum, note) => sum + (DURATION_BEATS[note.duration] ?? 0), 0);
    return total > expectedBeats + 0.5;
  });
  if (overfull.length > Math.max(1, measureCount * 0.15)) {
    issues.push('Too many measures contain more rhythm than the time signature allows.');
  }

  if (!piece?.title || PLACEHOLDER_TITLE.test(piece.title)) {
    warnings.push('The title was not reliably read from the page.');
  }
  if (!piece?.composer || ENGINE_COMPOSER.test(piece.composer)) {
    warnings.push('The composer was not reliably read from the page.');
  }
  if (piece?.engineWarning) {
    warnings.push(piece.engineWarning);
  }

  const expectedClef = EXPECTED_CLEF[expectedInstrument];
  if (expectedClef && piece?.clef && piece.clef !== expectedClef) {
    warnings.push(`Expected ${expectedClef} clef for ${expectedInstrument}, but the scan found ${piece.clef}.`);
  }

  const scannedPart = partNameFromXml(piece?.musicXmlString);
  if (scannedPart && expectedInstrument && !scannedPart.toLowerCase().includes(expectedInstrument.toLowerCase())) {
    warnings.push(`The OMR engine labeled the part "${scannedPart}". Verify it before practicing.`);
  }

  const score = Math.max(0, 100 - issues.length * 30 - warnings.length * 8);
  const status = issues.length > 0 || score < 70
    ? 'fail'
    : warnings.length > 0 || score < 92
      ? 'review'
      : 'pass';

  return {
    status,
    score,
    issues,
    warnings,
    metrics: {
      measureCount,
      noteCount,
      averageNotesPerMeasure: measureCount ? Number((noteCount / measureCount).toFixed(1)) : 0,
      repairedRhythms: notes.filter(note => note.omrRhythmRepaired).length,
      scannedPart,
    },
  };
}
