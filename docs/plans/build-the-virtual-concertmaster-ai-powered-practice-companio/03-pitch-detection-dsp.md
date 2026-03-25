# Milestone 3: Pitch Detection DSP

## Goal

Implement the pYIN pitch detection algorithm in a Web Worker to keep DSP off the main thread, add a vibrato filter, and convert raw pitch data into musician-friendly cents deviation from the nearest note.

## Scope

- pYIN pitch detection algorithm in a dedicated Web Worker
- Main thread to worker communication via transferable ArrayBuffers
- Vibrato filter (200ms moving average)
- Pitch-to-note conversion with cents deviation
- Continuous session error logging

---

### Task 1: pYIN Pitch Detection Worker

**Description**: Implement the pYIN pitch detection algorithm inside a Web Worker. This is the core DSP engine -- it must never run on the main thread.

**Agent type**: coder

**Subtasks (ordered)**:
1. Verify repo location (`pwd` and `git remote -v`)
2. Create `src/workers/pitchDetection.worker.js`:
   - Implement YIN autocorrelation-based pitch detection (step-by-step: difference function, cumulative mean normalized difference, absolute threshold, parabolic interpolation)
   - Add probabilistic layer (pYIN): multiple threshold candidates with confidence scores
   - Accept `Float32Array` audio buffer via `postMessage` with transferable
   - Return `{ pitchHz, confidence, timestamp }` back to main thread
3. Configure Vite to handle the worker import (use `new Worker(new URL(...), { type: 'module' })`)
4. Create `src/utils/noteUtils.js`:
   - `hzToMidi(hz)` -- convert frequency to MIDI note number
   - `hzToCents(hz, referenceHz)` -- cents deviation from nearest equal-temperament note
   - `midiToNoteName(midi)` -- e.g., 69 -> "A4"
   - `getNearestNote(hz)` -- returns `{ noteName, cents, midi }`
5. Unit test the note utility functions with known frequencies (A4=440Hz, C4=261.63Hz, etc.)

**Acceptance criteria**:
- Worker processes audio buffers and returns pitch data without blocking main thread
- Pitch detection accuracy within 5 cents for sustained tones in the string instrument range (G2-E7)
- Note utility functions correctly convert between Hz, MIDI, cents, and note names
- Worker handles edge cases: silence (no pitch), very low confidence

**Dependencies**: Milestone 2, Task 2 (AudioContext & Stream Routing)

**Changes must be on a feature branch with a GitHub PR created via `gh pr create`.**

---

### Task 2: Vibrato Filter & Audio Store Integration

**Description**: Add a vibrato-aware moving average filter to smooth pitch data, and wire the complete DSP pipeline into the Zustand audio store for UI consumption.

**Agent type**: coder

**Subtasks (ordered)**:
1. Verify repo location
2. Create `src/utils/vibratoFilter.js`:
   - Implement a 200ms moving average window for center frequency extraction
   - Buffer incoming pitch samples, compute windowed average
   - Output smoothed pitch that represents the "intended" note through vibrato
3. Create `src/hooks/usePitchDetection.js`:
   - Bridge between `useAudioPipeline` (raw audio) and the pitch worker
   - Use `requestAnimationFrame` loop to pull data from AnalyserNode and send to worker
   - Receive pitch results from worker, apply vibrato filter
   - Update `useAudioStore` with `currentPitchHz`, `currentCents`, `currentNote`, `confidence`
4. Implement session error logging in `useAudioStore`:
   - Define error threshold (e.g., >15 cents deviation for >500ms)
   - Append `{ timestamp, measure, expectedNote, detectedCents, duration }` to `sessionErrors[]`
   - Provide `clearSession()` and `exportSession()` actions
5. Create a debug overlay component `src/components/PitchDebug.jsx`:
   - Shows current Hz, note name, cents deviation, confidence
   - Toggleable via keyboard shortcut (Ctrl+D)
   - Useful for development, hidden in production

**Acceptance criteria**:
- Vibrato filter smooths rapid pitch oscillations without adding >10ms latency
- Zustand audio store updates at 60FPS with current pitch data
- Session errors are logged when pitch deviates beyond threshold
- Debug overlay shows real-time pitch data
- Total pipeline latency from mic to store update remains <30ms

**Dependencies**: Task 1 (pYIN Worker)

**Changes must be on a feature branch with a GitHub PR created via `gh pr create`.**
