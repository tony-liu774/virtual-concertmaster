export const DURATION_BEATS = {
  wd: 6, w: 4, hd: 3, h: 2, qd: 1.5, q: 1, '8d': 0.75, '8': 0.5, '16': 0.25,
};

const BEATS_DURATION = new Map(Object.entries(DURATION_BEATS).map(([dur, beats]) => [beats, dur]));

function expectedMeasureBeats(timeSignature) {
  const [beats, beatType] = timeSignature.split('/').map(Number);
  if (!beats || !beatType) return 4;
  return beats * (4 / beatType);
}

export function repairLikelyOemerRhythm(measure, timeSignature, skippedNonPitch = false) {
  if (skippedNonPitch || measure.length < 2) return measure;

  const expected = expectedMeasureBeats(timeSignature);
  const beats = measure.map(note => DURATION_BEATS[note.duration] ?? 0);
  const total = beats.reduce((sum, value) => sum + value, 0);
  if (Math.abs(total - expected) < 0.001 || total > expected) return measure;

  const counts = new Map();
  for (const value of beats) {
    if (value > 0) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  const [dominantBeats, dominantCount] = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0] - a[0])[0] ?? [];
  if (!dominantBeats || dominantCount < 2) return measure;

  const repairedIdx = beats.findIndex(value => {
    const repairedTotal = total - value + dominantBeats;
    return value < dominantBeats && Math.abs(repairedTotal - expected) < 0.001;
  });

  if (repairedIdx === -1) return measure;

  const repairedDuration = BEATS_DURATION.get(dominantBeats);
  if (!repairedDuration) return measure;

  return measure.map((note, idx) => (
    idx === repairedIdx
      ? { ...note, duration: repairedDuration, omrRhythmRepaired: true }
      : note
  ));
}
