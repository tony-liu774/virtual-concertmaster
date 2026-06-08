# The Virtual Concertmaster -- AI-Powered Practice Companion

## Goal

Build a premium, AI-powered practice companion for classical string players (Violin, Viola, Cello, Double Bass) with strict latency budgets (<30ms mic-to-UI) and 60FPS live audio visualization. The app uses Web Audio API for real-time pitch detection, VexFlow for sheet music rendering, and an LLM backend for coaching feedback.

## Current State

Phase 0 is partially complete:
- Vite + React 19 + Tailwind CSS v4 scaffolded with CSS-first `@theme` config
- Midnight Conservatory design system tokens defined in `src/index.css`
- Design Sandbox page proving all tokens work
- Tauri cross-platform shell configured (optional native builds)
- React Router, ESLint configured
- Missing: Zustand stores, reusable UI component library, Prettier, Supabase auth

## Approach

Build iteratively across 7 milestones, each producing working functionality:

1. **Complete Scaffolding & Core UI** -- Finish Phase 0: Zustand stores, reusable component library, Prettier, project structure
2. **Microphone Onboarding & Audio Pipeline** -- Phase 1a: getUserMedia flow, AudioContext management, mic permission UX
3. **Pitch Detection DSP** -- Phase 1b: pYIN algorithm in Web Worker, vibrato filter, pitch-to-cents conversion
4. **Sheet Music & Practice View** -- Phase 2a: MusicXML parsing, VexFlow rendering, predictive cursor
5. **Ghost Mode & Live Feedback** -- Phase 2b: Distraction-free practice UI, intonation needle, session error logging
6. **AI Coach & Analytics** -- Phase 3: LLM integration for coaching, heat map overlay, smart loop extraction
7. **Auth, Offline & Polish** -- Phase 4: Supabase auth, offline caching with service worker, AudioContext edge cases

## Cross-Milestone Dependencies

- Milestone 2 (Mic Onboarding) must complete before Milestone 3 (DSP) can process live audio
- Milestone 3 (DSP) must complete before Milestone 5 (Live Feedback) can render pitch data
- Milestone 4 (Sheet Music) must complete before Milestone 5 (Ghost Mode) can overlay feedback on notation
- Milestone 5 (Session Logging) must complete before Milestone 6 (AI Coach) can analyze sessions
- Milestone 1 (Scaffolding) should complete first as all milestones depend on shared components and stores

## Tech Stack

- **Frontend**: Vite 8 + React 19 (SPA)
- **State**: Zustand (separate `useUIStore` and `useAudioStore`)
- **Audio**: Web Audio API + Web Workers (pYIN pitch detection offloaded from main thread)
- **Sheet Music**: VexFlow (MusicXML rendering)
- **DB/Auth**: Supabase (Google/Apple OAuth)
- **Styling**: Tailwind CSS v4 (CSS-first, `@theme` in `global.css`)
- **Design**: Midnight Conservatory -- Oxford Blue, Polished Amber, Soft Ivory

## Golden Rules (All Milestones)

1. **Tailwind v4 CSS-First**: NO `tailwind.config.js`. All theme via `@theme` directive.
2. **No Hardcoded Hex**: Zero inline hex codes. Use semantic theme variables only.
3. **SVG Safety**: All `<svg>`, `<img>`, `<canvas>` must have `max-w` and `max-h` classes.
4. **Repo Location**: ALL work in `~/virtual-concertmaster`. Verify with `pwd` and `git remote -v`.
5. **Latency Budget**: <30ms mic-to-UI, 60FPS during live audio.

## Estimated Total Tasks: 21
