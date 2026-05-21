import { createContext, useContext, useState, useCallback } from 'react';

const StatsContext = createContext(null);

/** Anonymous user ID — created once, persisted in localStorage forever */
function getAnonId() {
  const key = 'vc_anon_id';
  let id = localStorage.getItem(key);
  if (!id) {
    id = 'anon_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem(key, id);
  }
  return id;
}

function sessionsKey() {
  return `vc_sessions_${getAnonId()}`;
}

function calcStreak(sessions) {
  if (!sessions.length) return 0;
  const days = [...new Set(sessions.map(s => s.date.slice(0, 10)))].sort().reverse();
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  if (days[0] !== today && days[0] !== yesterday) return 0;
  let streak = 1;
  for (let i = 1; i < days.length; i++) {
    const diff = (new Date(days[i - 1]) - new Date(days[i])) / 86400000;
    if (diff === 1) streak++;
    else break;
  }
  return streak;
}

export function StatsProvider({ children }) {
  const [, forceUpdate] = useState(0);

  function getSessions() {
    try {
      return JSON.parse(localStorage.getItem(sessionsKey()) || '[]');
    } catch {
      return [];
    }
  }

  const saveSession = useCallback((session) => {
    const sessions = getSessions();
    sessions.unshift({
      id:         (crypto.randomUUID?.() ?? Date.now().toString()),
      pieceId:    session.pieceId,
      pieceTitle: session.pieceTitle,
      date:       new Date().toISOString(),
      accuracy:   Math.round(session.accuracy ?? 0),
      duration:   session.duration ?? 0,
      // ── Extended vault stats (optional — Dashboard ignores unknown fields) ──
      pitchPct:    Math.round(session.pitchPct    ?? session.accuracy ?? 0),
      coveragePct: Math.round(session.coveragePct ?? 0),
      avgCents:    Math.round(session.avgCents    ?? 0),
      sharpCount:  session.sharpCount  ?? 0,
      flatCount:   session.flatCount   ?? 0,
      totalNotes:  session.totalNotes  ?? 0,
    });
    localStorage.setItem(sessionsKey(), JSON.stringify(sessions));
    forceUpdate(n => n + 1);
  }, []);

  function getStats() {
    const sessions = getSessions();
    if (!sessions.length) return { streak: 0, hours: 0, accuracy: 0, piecesLearned: 0, sessions: [] };
    return {
      streak:        calcStreak(sessions),
      hours:         +(sessions.reduce((s, r) => s + (r.duration || 0), 0) / 3600).toFixed(1),
      accuracy:      Math.round(sessions.reduce((s, r) => s + r.accuracy, 0) / sessions.length),
      piecesLearned: new Set(sessions.filter(s => s.accuracy >= 75).map(s => s.pieceId)).size,
      sessions,
    };
  }

  return (
    <StatsContext.Provider value={{ getStats, saveSession }}>
      {children}
    </StatsContext.Provider>
  );
}

export function useStats() {
  const ctx = useContext(StatsContext);
  if (!ctx) throw new Error('useStats must be used inside StatsProvider');
  return ctx;
}
