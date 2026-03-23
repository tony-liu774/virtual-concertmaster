# 🎻 The Virtual Concertmaster

AI-powered practice companion for classical string players (Violin, Viola, Cello, Double Bass).

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | Vite 8 + React 19 |
| **Styling** | Tailwind CSS v4 (CSS-first, `@theme` only) |
| **Desktop** | Tauri 2 (macOS / Windows) |
| **State** | Zustand (planned) |
| **Audio** | Web Audio API + Web Workers (planned) |
| **Backend** | Supabase (planned) |

## Design System: "Midnight Conservatory"

All theme tokens live in `src/index.css` via Tailwind v4's `@theme` directive.
**No `tailwind.config.js`. No inline hex codes. Ever.**

## Getting Started

```bash
# Install dependencies
npm install

# Run web dev server
npm run dev

# Run Tauri desktop app (requires Rust)
npm run tauri dev

# Build for production
npm run build
```

## Routes

| Path | Description |
|------|-------------|
| `/` | Home / Landing |
| `/sandbox` | Design System Sandbox (component library) |
