# Milestone 4: Sheet Music & Practice View

## Goal

Render sheet music from MusicXML files using VexFlow, implement a predictive cursor that tracks playback position, and build the main practice view layout.

## Scope

- MusicXML file loading and parsing
- VexFlow-based sheet music rendering
- Predictive cursor (glowing amber ball)
- Practice view page layout with transport controls
- Music library management (local file selection)

---

### Task 1: MusicXML Parser & Music Library

**Description**: Build a MusicXML parser that extracts note data, time signatures, tempo, and measure structure into an internal representation suitable for both rendering and pitch comparison.

**Agent type**: coder

**Subtasks (ordered)**:
1. Verify repo location (`pwd` and `git remote -v`)
2. Create `src/lib/musicXmlParser.js`:
   - Parse MusicXML (XML) files using DOMParser
   - Extract: parts, measures, notes (pitch, duration, ties), time signatures, key signatures, tempo markings
   - Output a normalized internal format: `{ parts: [{ measures: [{ notes: [{ pitch, duration, startBeat }] }] }], metadata: { title, composer, tempo, timeSignature } }`
3. Create `src/lib/musicLibrary.js`:
   - File picker integration using `<input type="file" accept=".xml,.musicxml">`
   - Store parsed pieces in IndexedDB for persistence
   - List/load/delete operations
4. Create `src/pages/Library.jsx`:
   - Grid of piece cards showing title, composer, last practiced
   - "Import MusicXML" button using the file picker
   - Click card to navigate to practice view
5. Add `/library` route to `src/main.jsx`
6. Include 1-2 sample MusicXML files in `public/samples/` for testing

**Acceptance criteria**:
- MusicXML files parse correctly into the internal format
- Pieces persist in IndexedDB across page reloads
- Library page shows imported pieces with metadata
- Sample files load and parse without errors

**Dependencies**: Milestone 1 (all tasks)

**Changes must be on a feature branch with a GitHub PR created via `gh pr create`.**

---

### Task 2: VexFlow Sheet Music Rendering

**Description**: Render parsed MusicXML data as beautiful sheet music using VexFlow, with proper sizing for the Midnight Conservatory dark theme.

**Agent type**: coder

**Subtasks (ordered)**:
1. Verify repo location
2. Install VexFlow: `npm install vexflow`
3. Create `src/components/SheetMusic.jsx`:
   - Accept parsed music data as props
   - Initialize VexFlow renderer targeting an SVG element
   - Render staves, clefs, key signatures, time signatures
   - Render notes with correct durations, beaming, ties
   - Handle multi-measure layout with line breaks based on container width
4. Style the VexFlow SVG output for dark theme:
   - Override VexFlow default colors to use theme tokens (ivory notes on dark background)
   - Ensure SVG has `max-w` and `max-h` constraints
5. Handle responsive resizing: re-render on container resize using ResizeObserver
6. Create `src/pages/Practice.jsx` with basic layout:
   - Sheet music display area (top 60% of viewport)
   - Transport controls bar (bottom): Play, Stop, Tempo slider
   - Piece title and metadata header
7. Add `/practice/:pieceId` route to `src/main.jsx`

**Acceptance criteria**:
- Sheet music renders correctly from parsed MusicXML data
- Dark theme styling applied (no white backgrounds in notation)
- SVG properly constrained with max dimensions
- Responsive to window resizes
- Practice page layout established with sheet music and transport controls

**Dependencies**: Task 1 (MusicXML Parser)

**Changes must be on a feature branch with a GitHub PR created via `gh pr create`.**

---

### Task 3: Predictive Cursor

**Description**: Implement the glowing amber ball cursor that tracks the current playback position in the sheet music, moving predictively based on tempo.

**Agent type**: coder

**Subtasks (ordered)**:
1. Verify repo location
2. Create `src/hooks/useCursor.js`:
   - Track current beat position based on tempo and elapsed time
   - Map beat position to the corresponding note/measure in the parsed music data
   - Provide `start()`, `stop()`, `reset()`, `seekTo(beat)` controls
3. Create `src/components/Cursor.jsx`:
   - Glowing amber ball (`bg-accent-amber` with `animate-glow-pulse`)
   - Positioned absolutely over the sheet music SVG
   - Smooth CSS transitions between note positions (no jumping)
   - Calculate position from VexFlow note bounding boxes
4. Integrate cursor with the Practice page:
   - Play button starts cursor movement
   - Stop button stops and resets cursor
   - Tempo slider adjusts cursor speed in real-time
5. Wire cursor position to `useUIStore` so other components can read current position

**Acceptance criteria**:
- Cursor moves smoothly across notes at the correct tempo
- Cursor position matches the expected note at any given time
- Glow animation renders at 60FPS without jank
- Tempo changes take effect immediately
- Cursor resets cleanly on stop

**Dependencies**: Task 2 (VexFlow Rendering)

**Changes must be on a feature branch with a GitHub PR created via `gh pr create`.**
