# Milestone 2: Microphone Onboarding & Audio Pipeline

## Goal

Implement the getUserMedia onboarding flow with graceful permission handling, establish the AudioContext lifecycle, and create the raw audio data pipeline that feeds into pitch detection.

## Scope

- Microphone permission request with a polished onboarding UI
- AudioContext creation with suspension/resume handling
- Raw audio stream routing to an AnalyserNode
- Permission state tracking in Zustand audio store

---

### Task 1: Microphone Permission Flow

**Description**: Build the getUserMedia onboarding experience that handles all permission states (prompt, granted, denied) with clear user guidance in the Midnight Conservatory style.

**Agent type**: coder

**Subtasks (ordered)**:
1. Verify repo location (`pwd` and `git remote -v`)
2. Create `src/hooks/useMicrophone.js` -- custom hook that wraps `navigator.mediaDevices.getUserMedia({ audio: true })`
3. Handle three states in the hook: `prompt` (not yet asked), `granted` (stream available), `denied` (user blocked or error)
4. On `denied`, detect if it was a user block vs. hardware error and set appropriate message
5. Update `useAudioStore` with `micPermission` state changes from the hook
6. Create `src/pages/MicOnboarding.jsx` -- full-screen onboarding page with:
   - Animated microphone icon (use `animate-breath`)
   - "Allow Microphone Access" primary button
   - Explanation text about why mic is needed
   - Error state with instructions for re-enabling in browser settings
7. Add `/onboarding` route in `src/main.jsx`
8. Test all three permission states render correctly

**Acceptance criteria**:
- Requesting mic permission works and updates Zustand store
- Denied state shows helpful recovery instructions
- All UI uses theme tokens, no inline hex
- Page is accessible (button has aria-label, focus states visible)

**Dependencies**: Milestone 1 (all tasks)

**Changes must be on a feature branch with a GitHub PR created via `gh pr create`.**

---

### Task 2: AudioContext Lifecycle & Stream Routing

**Description**: Create a robust AudioContext manager that handles browser suspension rules, routes the mic stream through an AnalyserNode, and provides raw audio data for downstream DSP.

**Agent type**: coder

**Subtasks (ordered)**:
1. Verify repo location
2. Create `src/lib/audioContext.js` -- singleton AudioContext manager:
   - Lazy creation on first user interaction (satisfies browser autoplay policy)
   - `resume()` wrapper that handles suspended state
   - `suspend()` for when app goes to background
   - Event listeners for `statechange` to track context state
3. Create `src/hooks/useAudioPipeline.js`:
   - Accepts a MediaStream from `useMicrophone`
   - Creates MediaStreamSource -> AnalyserNode chain
   - Exposes `getFloatTimeDomainData()` for the pitch detection worker
   - Configures AnalyserNode with `fftSize: 4096` for sufficient frequency resolution
4. Update `useAudioStore` with `audioContextState` ('suspended' | 'running' | 'closed')
5. Add cleanup: disconnect nodes and close stream tracks on unmount
6. Handle edge case: user navigates away and back -- AudioContext must resume

**Acceptance criteria**:
- AudioContext resumes correctly after browser suspension
- AnalyserNode provides float time-domain data from live mic input
- All resources are properly cleaned up on unmount
- AudioContext state tracked in Zustand store

**Dependencies**: Task 1 (Microphone Permission Flow)

**Changes must be on a feature branch with a GitHub PR created via `gh pr create`.**
