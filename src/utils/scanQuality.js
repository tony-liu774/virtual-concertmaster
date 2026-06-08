import { DURATION_BEATS } from './rhythmRepair.js';

const PLACEHOLDER_TITLE = /^(untitled|scanned score|vc[_\s-]*omr[_\s-]*\d+)/i;
const ENGINE_COMPOSER = /^(transcribed by|unknown$)/i;
const OMR_ENGINE = /^(oemer|audiveris|remote)$/i;

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

function xmlMetrics(xml = '') {
  const measureCount = (xml.match(/<measure\b/gi) || []).length;
  const noteCount = (xml.match(/<note\b/gi) || []).length;
  return {
    measureCount,
    noteCount,
    averageNotesPerMeasure: measureCount ? Number((noteCount / measureCount).toFixed(1)) : 0,
  };
}

export function isOmrScannedPiece(piece) {
  return !!piece?.isUploaded && OMR_ENGINE.test(piece?.scannedBy ?? '');
}

export function evaluateScanQuality(piece, { expectedInstrument = 'violin' } = {}) {
  const issues = [];
  const warnings = [];
  const addIssue = (message) => {
    if (message && !issues.includes(message)) issues.push(message);
  };
  const addWarning = (message) => {
    if (message && !warnings.includes(message)) warnings.push(message);
  };
  const measures = Array.isArray(piece?.measures) ? piece.measures : [];
  const notes = measures.flat();
  const measureCount = measures.length;
  const noteCount = notes.length;
  const expectedBeats = expectedMeasureBeats(piece?.timeSignature);
  const scannedPart = partNameFromXml(piece?.musicXmlString);
  const xml = xmlMetrics(piece?.musicXmlString);
  const inspection = piece?.engineInspection;

  if (noteCount === 0) {
    addIssue('No playable notes were detected.');
  }
  if (measureCount === 0) {
    addIssue('No measures were detected.');
  }
  if (measureCount > 0 && noteCount / measureCount > 18) {
    addIssue('The scan is too dense, which usually means notes or barlines were misread.');
  }
  if (measures.some(measure => measure.length > 32)) {
    addIssue('At least one measure contains an impossible number of notes.');
  }

  const invalidDurations = notes.filter(note => !DURATION_BEATS[note.duration]);
  if (invalidDurations.length > 0) {
    addIssue(`${invalidDurations.length} note(s) have unsupported rhythms.`);
  }

  const overfull = measures.filter(measure => {
    const total = measure.reduce((sum, note) => sum + (DURATION_BEATS[note.duration] ?? 0), 0);
    return total > expectedBeats + 0.5;
  });
  if (overfull.length > Math.max(1, measureCount * 0.15)) {
    addIssue('Too many measures contain more rhythm than the time signature allows.');
  }

  if (inspection?.suspicious) {
    addIssue(`The OMR engine marked this result suspicious${inspection.reason ? `: ${inspection.reason}` : '.'}`);
  }
  if (inspection?.averageNotesPerMeasure > 18 || inspection?.maxNotesInMeasure > 32) {
    addIssue('The raw OMR output contains an impossible note density.');
  }
  if (xml.averageNotesPerMeasure > 18) {
    addIssue('The MusicXML output is too dense to be trusted.');
  }
  if (xml.noteCount > 140 && xml.measureCount <= 8) {
    addIssue('The scan compressed too many notes into too few measures.');
  }

  if (!piece?.title || PLACEHOLDER_TITLE.test(piece.title)) {
    addWarning('The title was not reliably read from the page.');
  }
  if (!piece?.composer || ENGINE_COMPOSER.test(piece.composer)) {
    addWarning('The composer was not reliably read from the page.');
  }
  if (piece?.engineWarning) {
    addIssue(piece.engineWarning);
  }

  const expectedClef = EXPECTED_CLEF[expectedInstrument];
  if (expectedClef && piece?.clef && piece.clef !== expectedClef) {
    addWarning(`Expected ${expectedClef} clef for ${expectedInstrument}, but the scan found ${piece.clef}.`);
  }

  if (scannedPart && expectedInstrument && !scannedPart.toLowerCase().includes(expectedInstrument.toLowerCase())) {
    const message = `The OMR engine labeled the part "${scannedPart}". Verify it before practicing.`;
    if (isOmrScannedPiece(piece) && scannedPart.toLowerCase() === 'piano') addIssue(message);
    else addWarning(message);
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
      xmlMeasureCount: xml.measureCount,
      xmlNoteCount: xml.noteCount,
      xmlAverageNotesPerMeasure: xml.averageNotesPerMeasure,
    },
  };
}

export function isScanPracticeReady(piece, options) {
  if (!isOmrScannedPiece(piece)) return true;
  return evaluateScanQuality(piece, options).status !== 'fail';
}
