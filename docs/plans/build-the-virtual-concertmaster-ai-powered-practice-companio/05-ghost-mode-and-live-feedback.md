# Milestone 5: Ghost Mode & Live Feedback

## Goal

Build the distraction-free "Ghost" practice mode where UI chrome fades away, and implement the live intonation feedback needle that guides players in real-time.

## Scope

- Ghost mode: menus and controls fade to opacity-0 over 500ms when practice starts
- "Breath" intonation needle: invisible at perfect pitch, shows deviation with color coding
- Real-time pitch comparison against expected notes from sheet music
- Session error logging tied to specific measures

---

### Task 1: Ghost Mode UI

**Description**: Implement the distraction-free practice mode where all non-essential UI elements fade away when the player starts practicing, leaving only the sheet music and feedback indicators.

**Agent type**: coder

**Subtasks (ordered)**:
1. Verify repo location (`pwd` and `git remote -v`)
2. Update `useUIStore` with `isPracticing` and `menuOpacity` state:
   - When `isPracticing` becomes true, animate `menuOpacity` from 1 to 0 over 500ms
   - When `isPracticing` becomes false, animate back to 1 over 300ms
3. Update `src/components/Layout.jsx`:
   - Apply `opacity` and `pointer-events-none` to sidebar/nav when practicing
   - Use CSS transitions (not JS animation) for the fade: `transition-opacity duration-500`
4. Update `src/pages/Practice.jsx`:
   - Transport controls: fade to minimal opacity (0.15) on idle, full opacity on hover
   - Sheet music: stays fully visible
   - Floating "Stop" button: always accessible with subtle opacity
5. Add keyboard shortcut: Space to toggle practice mode, Escape to stop
6. Ensure focus management: when ghost mode activates, focus stays on the practice area

**Acceptance criteria**:
- All chrome (sidebar, nav, full transport bar) fades smoothly over 500ms
- Transport controls reappear on hover with smooth transition
- Escape key reliably exits ghost mode
- Space bar toggles practice on/off
- No layout shifts when elements fade (use opacity, not display:none)

**Dependencies**: Milestone 4, Task 3 (Predictive Cursor) -- needs practice view with cursor working

**Changes must be on a feature branch with a GitHub PR created via `gh pr create`.**

---

### Task 2: Intonation Needle & Live Pitch Feedback

**Description**: Build the "Breath" intonation needle that shows real-time pitch deviation, and connect the pitch detection pipeline to the sheet music to compare played notes against expected notes.

**Agent type**: coder

**Subtasks (ordered)**:
1. Verify repo location
2. Create `src/components/IntonationNeedle.jsx`:
   - Vertical or horizontal needle/gauge centered at 0 cents
   - Invisible (opacity 0) when deviation is within +/-10 cents (perfect pitch zone)
   - Fades in smoothly when deviation exceeds 10 cents
   - Color coding: `text-feedback-error` (Crimson) when drifting sharp/flat, `text-feedback-success` (Emerald) when correcting back toward center
   - Needle position maps linearly from -50 cents to +50 cents
   - Uses `animate-breath` for subtle pulsing when visible
3. Create `src/hooks/usePitchComparison.js`:
   - Takes current cursor position (expected note) and current detected pitch
   - Computes cents deviation between expected and detected
   - Determines if player is sharp, flat, or in tune
   - Feeds deviation data to the intonation needle
4. Wire pitch comparison into session error logging:
   - When deviation exceeds threshold for a sustained period, log to `sessionErrors[]` with measure number and note reference
   - Track cumulative error per measure for heat map data
5. Integrate IntonationNeedle into `Practice.jsx`:
   - Position below or beside the current cursor location
   - Only visible during active practice (ghost mode)
6. Add visual feedback on the cursor itself: cursor color shifts from amber to emerald (in tune) or crimson (out of tune)

**Acceptance criteria**:
- Needle is invisible when playing in tune (within +/-10 cents)
- Needle appears smoothly and shows correct deviation direction
- Color transitions are smooth (no flickering)
- Session errors accumulate correctly with measure references
- Cursor color reflects current intonation state
- All rendering at 60FPS with no dropped frames

**Dependencies**: Milestone 3, Task 2 (Vibrato Filter & Store Integration), Task 1 (Ghost Mode)

**Changes must be on a feature branch with a GitHub PR created via `gh pr create`.**
