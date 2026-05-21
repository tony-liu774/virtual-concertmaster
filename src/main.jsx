import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import './index.css'

import { StatsProvider } from './contexts/StatsContext.jsx'
import App from './App.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Library from './pages/Library.jsx'
import Practice from './pages/Practice.jsx'
import Tuner from './pages/Tuner.jsx'
import Report from './pages/Report.jsx'
import PitchQuest from './pages/PitchQuest.jsx'
import Sandbox from './pages/Sandbox.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <StatsProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<App />}>
            <Route path="/"         element={<Dashboard />} />
            <Route path="/library"  element={<Library />} />
            <Route path="/practice" element={<Practice />} />
            <Route path="/tuner"    element={<Tuner />} />
            <Route path="/report"      element={<Report />} />
            <Route path="/pitch-quest" element={<PitchQuest />} />
          </Route>
          <Route path="/sandbox" element={<Sandbox />} />
          <Route path="*"        element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </StatsProvider>
  </StrictMode>,
)
