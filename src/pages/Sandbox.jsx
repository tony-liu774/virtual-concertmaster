import { Link } from 'react-router-dom'

/**
 * 🎨 Design System Sandbox — "Midnight Conservatory"
 *
 * This page proves every design token is wired correctly.
 * Zero inline hex codes. Zero tailwind.config.js. Pure @theme.
 */
function Sandbox() {
  return (
    <div className="min-h-screen bg-bg-deep px-6 py-12 md:px-12 lg:px-24">
      {/* ── Navigation ─────────────────────────────────── */}
      <nav className="mb-12">
        <Link
          to="/"
          className="text-text-muted hover:text-accent-amber transition-colors text-sm font-body"
        >
          ← Back to Home
        </Link>
      </nav>

      {/* ══════════════════════════════════════════════════
          SECTION 1: The Canvas & Typography
          ══════════════════════════════════════════════════ */}
      <section className="mb-16">
        <p className="text-accent-amber font-body text-xs uppercase tracking-widest mb-2">
          Typography & Canvas
        </p>
        <h1 className="font-header text-5xl md:text-6xl text-text-primary mb-4">
          Midnight Conservatory
        </h1>
        <p className="font-body text-text-muted text-lg max-w-2xl leading-relaxed">
          A premium, distraction-free environment for the serious musician.
          Every color, every typeface, every shadow is intentional — designed
          to disappear so only the music remains.
        </p>
      </section>

      {/* ══════════════════════════════════════════════════
          SECTION 2: Color Palette Swatches
          ══════════════════════════════════════════════════ */}
      <section className="mb-16">
        <p className="text-accent-amber font-body text-xs uppercase tracking-widest mb-6">
          Theme Palette
        </p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <ColorSwatch name="bg-deep" className="bg-bg-deep border border-text-muted/20" />
          <ColorSwatch name="bg-panel" className="bg-bg-panel" />
          <ColorSwatch name="accent-amber" className="bg-accent-amber" dark />
          <ColorSwatch name="text-primary" className="bg-text-primary" dark />
          <ColorSwatch name="text-muted" className="bg-text-muted" dark />
          <ColorSwatch name="feedback-success" className="bg-feedback-success" />
          <ColorSwatch name="feedback-error" className="bg-feedback-error" />
        </div>
      </section>

      {/* ══════════════════════════════════════════════════
          SECTION 3: Buttons
          ══════════════════════════════════════════════════ */}
      <section className="mb-16">
        <p className="text-accent-amber font-body text-xs uppercase tracking-widest mb-6">
          Buttons
        </p>
        <div className="flex flex-wrap gap-4 items-center">
          {/* Primary Amber Button with hover glow */}
          <button className="bg-accent-amber text-bg-deep font-body font-semibold px-6 py-3 rounded-lg hover:shadow-[0_0_20px_var(--color-accent-amber)] transition-shadow cursor-pointer">
            Start Practicing
          </button>

          {/* Secondary / Ghost Button */}
          <button className="border border-text-muted text-text-primary font-body px-6 py-3 rounded-lg hover:border-accent-amber hover:text-accent-amber transition-colors cursor-pointer">
            Browse Library
          </button>

          {/* Disabled state */}
          <button className="bg-bg-panel text-text-muted font-body px-6 py-3 rounded-lg cursor-not-allowed opacity-50">
            Disabled
          </button>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════
          SECTION 4: Feedback Chips
          ══════════════════════════════════════════════════ */}
      <section className="mb-16">
        <p className="text-accent-amber font-body text-xs uppercase tracking-widest mb-6">
          Feedback Chips
        </p>
        <div className="flex flex-wrap gap-3 items-center">
          {/* Emerald — Perfect Pitch */}
          <span className="inline-flex items-center gap-1.5 bg-feedback-success/15 text-feedback-success text-sm font-body font-medium px-3 py-1 rounded-full border border-feedback-success/30">
            <span className="w-2 h-2 rounded-full bg-feedback-success animate-breath" />
            Perfect Pitch
          </span>

          {/* Crimson — Out of Tune */}
          <span className="inline-flex items-center gap-1.5 bg-feedback-error/15 text-feedback-error text-sm font-body font-medium px-3 py-1 rounded-full border border-feedback-error/30">
            <span className="w-2 h-2 rounded-full bg-feedback-error animate-breath" />
            Out of Tune
          </span>

          {/* Amber — Active/Recording */}
          <span className="inline-flex items-center gap-1.5 bg-accent-amber/15 text-accent-amber text-sm font-body font-medium px-3 py-1 rounded-full border border-accent-amber/30">
            <span className="w-2 h-2 rounded-full bg-accent-amber animate-breath" />
            Recording
          </span>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════
          SECTION 5: Panel / Card
          ══════════════════════════════════════════════════ */}
      <section className="mb-16">
        <p className="text-accent-amber font-body text-xs uppercase tracking-widest mb-6">
          Panel Card
        </p>
        <div className="bg-bg-panel rounded-xl p-6 max-w-lg border border-text-muted/10">
          <h3 className="font-header text-xl text-text-primary mb-2">
            Practice Session — Bach Partita No. 2
          </h3>
          <p className="font-body text-text-muted text-sm mb-4">
            Duration: 24 min · Accuracy: 87% · Tempo drift: +3 BPM
          </p>
          <div className="flex gap-3">
            <span className="bg-feedback-success/15 text-feedback-success text-xs font-body px-2.5 py-1 rounded-full">
              Intonation: Good
            </span>
            <span className="bg-feedback-error/15 text-feedback-error text-xs font-body px-2.5 py-1 rounded-full">
              Measures 12–16: Review
            </span>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════
          SECTION 6: SVG Containment Test
          ══════════════════════════════════════════════════ */}
      <section className="mb-16">
        <p className="text-accent-amber font-body text-xs uppercase tracking-widest mb-6">
          SVG Containment Test (w-8 h-8 = 32×32px)
        </p>
        <div className="flex gap-6 items-center">
          {/* Music note SVG — strictly bounded */}
          <div className="bg-bg-panel p-4 rounded-lg border border-text-muted/10">
            <svg
              className="w-8 h-8 max-w-8 max-h-8 text-accent-amber"
              viewBox="0 0 24 24"
              fill="currentColor"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55C7.79 13 6 14.79 6 17s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
            </svg>
            <p className="text-text-muted text-xs mt-2 font-body">Music Note</p>
          </div>

          {/* Microphone SVG — strictly bounded */}
          <div className="bg-bg-panel p-4 rounded-lg border border-text-muted/10">
            <svg
              className="w-8 h-8 max-w-8 max-h-8 text-feedback-success"
              viewBox="0 0 24 24"
              fill="currentColor"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5z" />
              <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
            </svg>
            <p className="text-text-muted text-xs mt-2 font-body">Microphone</p>
          </div>

          {/* Metronome/timer SVG — strictly bounded */}
          <div className="bg-bg-panel p-4 rounded-lg border border-text-muted/10">
            <svg
              className="w-8 h-8 max-w-8 max-h-8 text-feedback-error"
              viewBox="0 0 24 24"
              fill="currentColor"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z" />
            </svg>
            <p className="text-text-muted text-xs mt-2 font-body">Timer</p>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════
          SECTION 7: Breath Animation Demo
          ══════════════════════════════════════════════════ */}
      <section className="mb-16">
        <p className="text-accent-amber font-body text-xs uppercase tracking-widest mb-6">
          Animations
        </p>
        <div className="flex gap-8 items-center">
          <div className="flex flex-col items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-accent-amber animate-breath shadow-[0_0_15px_var(--color-accent-amber)]" />
            <p className="text-text-muted text-xs font-body">Breath (Cursor)</p>
          </div>
          <div className="flex flex-col items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-accent-amber animate-glow-pulse" />
            <p className="text-text-muted text-xs font-body">Glow Pulse</p>
          </div>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────── */}
      <footer className="border-t border-text-muted/10 pt-8 mt-8">
        <p className="text-text-muted text-xs font-body">
          Midnight Conservatory Design System v0.1 · Tailwind CSS v4 · Zero inline hex codes
        </p>
      </footer>
    </div>
  )
}

/**
 * Color swatch component for palette display
 */
function ColorSwatch({ name, className, dark = false }) {
  return (
    <div className="flex flex-col gap-2">
      <div className={`h-16 rounded-lg ${className}`} />
      <p className={`text-xs font-body ${dark ? 'text-text-muted' : 'text-text-muted'}`}>
        {name}
      </p>
    </div>
  )
}

export default Sandbox
