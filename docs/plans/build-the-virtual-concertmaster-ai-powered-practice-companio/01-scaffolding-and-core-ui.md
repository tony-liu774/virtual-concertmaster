# Milestone 1: Complete Scaffolding & Core UI

## Goal

Finish Phase 0 by establishing the project structure, state management, reusable component library, and development tooling. Every subsequent milestone depends on this foundation.

## Scope

- Organize `src/` into a scalable folder structure
- Install and configure Zustand with separate UI and Audio stores
- Build reusable UI components (Button, Modal, Navigation, Layout) using Midnight Conservatory tokens
- Add Prettier with an ESLint integration rule to enforce consistent formatting
- Add no-inline-hex ESLint rule or convention enforcement

---

### Task 1: Project Structure & Tooling

**Description**: Reorganize the `src/` directory into a scalable structure and add Prettier.

**Agent type**: coder

**Subtasks (ordered)**:
1. Verify repo: run `pwd` and `git remote -v` to confirm `~/virtual-concertmaster`
2. Create folder structure: `src/components/`, `src/pages/`, `src/stores/`, `src/hooks/`, `src/workers/`, `src/utils/`, `src/lib/`
3. Move `src/pages/Sandbox.jsx` into `src/pages/` (already there -- verify path refs)
4. Install Prettier: `npm install -D prettier eslint-config-prettier`
5. Create `.prettierrc` with project conventions (single quotes, semicolons, 2-space indent, trailing commas)
6. Update `eslint.config.js` to extend `eslint-config-prettier` so formatting rules do not conflict
7. Run `npx prettier --write src/` to format existing files
8. Verify `npm run lint` passes with no errors

**Acceptance criteria**:
- `src/` has `components/`, `pages/`, `stores/`, `hooks/`, `workers/`, `utils/`, `lib/` directories
- Prettier formats on save (config present), ESLint and Prettier do not conflict
- `npm run lint` passes cleanly
- Existing app still renders (Home + Sandbox routes work)

**Dependencies**: None

**Changes must be on a feature branch with a GitHub PR created via `gh pr create`.**

---

### Task 2: Zustand State Stores

**Description**: Set up Zustand with two separate stores -- one for UI state, one for Audio/DSP state -- following the principle of never mixing audio-critical state with visual state.

**Agent type**: coder

**Subtasks (ordered)**:
1. Verify repo location
2. Install Zustand: `npm install zustand`
3. Create `src/stores/useUIStore.js` with initial state: `{ isSidebarOpen, currentPage, isPracticing, menuOpacity }`
4. Create `src/stores/useAudioStore.js` with initial state: `{ micPermission ('prompt'|'granted'|'denied'), isListening, currentPitchHz, currentCents, sessionErrors: [], tempo }`
5. Add JSDoc comments to each store documenting the state shape and intended usage
6. Create a simple test/demo: wire `menuOpacity` into the Sandbox page to prove reactivity

**Acceptance criteria**:
- Two separate Zustand stores exist and export typed hooks
- Stores have sensible defaults and JSDoc documentation
- At least one store value is consumed in a rendered component to prove wiring

**Dependencies**: Task 1 (Project Structure & Tooling)

**Changes must be on a feature branch with a GitHub PR created via `gh pr create`.**

---

### Task 3: Reusable UI Component Library

**Description**: Build the base UI components that will be used across all practice views. All components must use Midnight Conservatory theme tokens exclusively -- zero inline hex codes.

**Agent type**: coder

**Subtasks (ordered)**:
1. Verify repo location
2. Create `src/components/Button.jsx` -- Primary (amber bg), Secondary (ghost/outlined), Disabled variants. All use theme tokens.
3. Create `src/components/Modal.jsx` -- Overlay with `bg-bg-deep/80` backdrop, panel card styling, close button, focus trap
4. Create `src/components/Layout.jsx` -- App shell with sidebar nav placeholder and main content area
5. Create `src/components/FeedbackChip.jsx` -- Success/Error/Active variants (extracted from Sandbox patterns)
6. Create `src/components/IconButton.jsx` -- Circular button for toolbar actions (play, stop, mic)
7. Update `src/main.jsx` to wrap routes in `<Layout>` component
8. Update Sandbox page to use the new reusable components instead of inline JSX
9. Verify all components render correctly, no inline hex codes present

**Acceptance criteria**:
- All components use only theme token classes (no hardcoded hex)
- All SVG/img elements within components have `max-w` and `max-h` constraints
- Sandbox page uses the new components
- App renders correctly on all routes

**Dependencies**: Task 1 (Project Structure & Tooling), Task 2 (Zustand State Stores)

**Changes must be on a feature branch with a GitHub PR created via `gh pr create`.**
