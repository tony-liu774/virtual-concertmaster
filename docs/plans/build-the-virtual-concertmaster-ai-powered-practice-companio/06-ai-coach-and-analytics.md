# Milestone 6: AI Coach & Analytics

## Goal

Implement the AI coaching debrief, crimson heat map overlay on error-heavy measures, and the smart loop feature that extracts problem sections for focused practice.

## Scope

- Post-session AI coaching via LLM backend
- Heat map overlay on sheet music showing error density
- Smart loop: extract error-heavy measures, reduce tempo, loop
- Session history and progress tracking

---

### Task 1: AI Coach Debrief

**Description**: When practice stops, send the accumulated session error log to an LLM backend and display an encouraging, concise coaching debrief in the Midnight Conservatory style.

**Agent type**: coder

**Subtasks (ordered)**:
1. Verify repo location (`pwd` and `git remote -v`)
2. Create `src/lib/coachApi.js`:
   - Function to send session error JSON to LLM backend endpoint
   - System prompt: "You are an encouraging masterclass professor. Give feedback in max 2 sentences. Focus on one specific improvement."
   - Include context: piece name, duration, overall accuracy percentage, worst measures
   - Handle API errors gracefully (show fallback message if LLM unavailable)
3. Create `src/components/CoachDebrief.jsx`:
   - Modal that appears when practice session ends
   - Shows: session duration, overall accuracy, AI coaching text
   - Loading state while waiting for LLM response (subtle breath animation)
   - "Practice Again" and "View Details" action buttons
   - Styled as a premium panel card with Midnight Conservatory tokens
4. Create `src/lib/sessionHistory.js`:
   - Store completed sessions in IndexedDB: `{ id, pieceId, date, duration, accuracy, errors, coachFeedback }`
   - Retrieve session history for a given piece
5. Integrate into Practice page: show CoachDebrief modal on practice stop
6. Add environment variable for LLM API endpoint (`VITE_LLM_API_URL`)

**Acceptance criteria**:
- AI generates concise, encouraging feedback (max 2 sentences)
- Debrief modal appears smoothly after practice stops
- Session data persists in IndexedDB
- Graceful fallback when LLM API is unavailable
- No inline hex codes, all theme tokens

**Dependencies**: Milestone 5, Task 2 (Live Pitch Feedback with session error logging)

**Changes must be on a feature branch with a GitHub PR created via `gh pr create`.**

---

### Task 2: Heat Map Overlay

**Description**: Overlay a crimson heat map on the sheet music showing which measures had the most pitch errors, giving players an immediate visual summary of their problem areas.

**Agent type**: coder

**Subtasks (ordered)**:
1. Verify repo location
2. Create `src/components/HeatMapOverlay.jsx`:
   - Accept session error data grouped by measure
   - For each measure, calculate error density (errors per beat)
   - Render semi-transparent colored rectangles over the VexFlow SVG:
     - No errors: no overlay
     - Low errors: subtle amber tint (`bg-accent-amber/10`)
     - High errors: crimson overlay (`bg-feedback-error/20` to `bg-feedback-error/40`)
   - Overlay must align precisely with VexFlow measure bounding boxes
3. Add toggle in the post-practice view to show/hide heat map
4. Create `src/utils/errorAnalysis.js`:
   - `groupErrorsByMeasure(errors)` -- aggregate errors per measure
   - `getMeasureErrorDensity(errors, totalBeats)` -- normalize error count
   - `getWorstMeasures(errors, topN)` -- return the N worst measures
5. Integrate with CoachDebrief "View Details" flow: clicking shows heat map on sheet music

**Acceptance criteria**:
- Heat map colors accurately reflect error density per measure
- Overlay aligns with sheet music measures (no visual offset)
- Toggle works smoothly (fade in/out)
- Worst measures are visually prominent in crimson

**Dependencies**: Task 1 (AI Coach Debrief)

**Changes must be on a feature branch with a GitHub PR created via `gh pr create`.**

---

### Task 3: Smart Loop Practice

**Description**: Extract the worst-performing measures, reduce tempo by 15%, and create an automatic practice loop so players can drill their problem spots.

**Agent type**: coder

**Subtasks (ordered)**:
1. Verify repo location
2. Create `src/hooks/useSmartLoop.js`:
   - Accept worst measures from error analysis
   - Set loop boundaries (start beat of first red measure to end beat of last red measure)
   - Reduce tempo by 15% from the original
   - Provide `startLoop()`, `stopLoop()`, `adjustTempo(delta)` controls
   - Auto-loop: when cursor reaches end of loop region, jump back to start
3. Update `src/components/SheetMusic.jsx`:
   - Highlight loop region with a subtle amber bracket/border
   - Dim measures outside the loop region (reduce opacity)
4. Add "Smart Loop" button to post-practice heat map view:
   - One-click to enter loop mode on worst measures
   - Show current loop tempo and allow manual adjustment
5. Integrate with cursor: cursor only moves within loop bounds
6. When player improves (errors decrease below threshold), offer to expand loop or increase tempo

**Acceptance criteria**:
- Smart loop correctly identifies and isolates worst measures
- Tempo is reduced by 15% automatically
- Cursor loops back seamlessly at region boundary
- Loop region is clearly highlighted on sheet music
- Player can manually adjust loop bounds and tempo

**Dependencies**: Task 2 (Heat Map Overlay), Milestone 4 Task 3 (Predictive Cursor)

**Changes must be on a feature branch with a GitHub PR created via `gh pr create`.**
