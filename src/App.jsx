function App() {
  return (
    <div className="min-h-screen bg-bg-deep flex flex-col items-center justify-center">
      <h1 className="font-header text-5xl text-accent-amber mb-4">
        🎻 The Virtual Concertmaster
      </h1>
      <p className="text-text-muted text-lg max-w-md text-center">
        AI-powered practice companion for classical string players.
      </p>
      <div className="mt-8 flex gap-4">
        <button className="bg-accent-amber text-bg-deep font-body font-semibold px-6 py-3 rounded-lg hover:opacity-90 transition-opacity cursor-pointer">
          Start Practicing
        </button>
        <button className="border border-text-muted text-text-primary font-body px-6 py-3 rounded-lg hover:border-accent-amber hover:text-accent-amber transition-colors cursor-pointer">
          Learn More
        </button>
      </div>
    </div>
  )
}

export default App
