import { Link } from 'react-router-dom'

function App() {
  return (
    <div className="min-h-screen bg-bg-deep flex flex-col items-center justify-center px-4">
      <h1 className="font-header text-5xl text-accent-amber mb-4 text-center">
        🎻 The Virtual Concertmaster
      </h1>
      <p className="text-text-muted text-lg max-w-md text-center mb-8">
        AI-powered practice companion for classical string players.
      </p>
      <Link
        to="/sandbox"
        className="bg-accent-amber text-bg-deep font-body font-semibold px-6 py-3 rounded-lg hover:shadow-[0_0_20px_var(--color-accent-amber)] transition-shadow cursor-pointer"
      >
        View Design Sandbox
      </Link>
    </div>
  )
}

export default App
