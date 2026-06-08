import { Link } from 'react-router-dom';
import { Library, Mic2, Gauge, BarChart3, Flame, Clock, Target, TrendingUp } from 'lucide-react';
import { useStats } from '../contexts/StatsContext.jsx';

const MODULES = [
  {
    to: '/library',
    icon: Library,
    title: 'Quest Generator',
    desc: 'Choose meter, length, and tempo for an infinite random sight-reading run.',
    tag: 'Random',
  },
  {
    to: '/practice',
    icon: Mic2,
    title: 'Start Quest',
    desc: 'Generate fresh notation, follow the amber cursor, and score your pitch accuracy.',
    tag: 'Live Game',
    featured: true,
  },
  {
    to: '/tuner',
    icon: Gauge,
    title: 'Precision Tuner',
    desc: 'Studio-grade needle tuner with vibrato filtering for string players.',
    tag: 'Live',
  },
  {
    to: '/report',
    icon: BarChart3,
    title: 'Session Report',
    desc: 'Post-session heat maps and feedback to guide your practice.',
    tag: 'Analytics',
  },
];

export default function Dashboard() {
  const { getStats } = useStats();
  const { streak, hours, accuracy, piecesLearned, sessions } = getStats();

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  const STATS = [
    { icon: Flame,      label: 'Day Streak',    value: streak,        unit: streak === 1 ? 'day' : 'days', color: 'text-accent-amber' },
    { icon: Clock,      label: 'Total Practice', value: hours,         unit: 'hours',  color: 'text-feedback-success' },
    { icon: Target,     label: 'Avg Accuracy',   value: accuracy || 0, unit: '%',      color: 'text-accent-amber' },
    { icon: TrendingUp, label: 'Pieces Learned', value: piecesLearned, unit: 'total',  color: 'text-feedback-success' },
  ];

  return (
    <div className="min-h-screen bg-bg-deep px-6 py-8 md:py-12">
      {/* Header */}
      <div className="mb-10">
        <p className="text-text-muted font-body text-sm uppercase tracking-widest mb-1">{greeting}</p>
        <h1 className="font-header text-4xl md:text-5xl text-text-primary">
          The Virtual <span className="text-accent-amber">Concertmaster</span>
        </h1>
        <p className="text-text-muted font-body mt-2 max-w-xl text-sm">
          AI-powered practice companion for bowed string instruments.
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        {STATS.map(({ icon: Icon, label, value, unit, color }) => (
          <div key={label} className="bg-bg-panel rounded-xl p-4 border border-white/5">
            <div className="flex items-center gap-2 mb-2">
              <Icon size={14} className={color} />
              <span className="text-text-muted text-xs font-body uppercase tracking-wide">{label}</span>
            </div>
            <div className="flex items-baseline gap-1">
              <span className={`font-header text-3xl ${color}`}>{value}</span>
              <span className="text-text-muted text-sm font-body">{unit}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Modules */}
      <h2 className="text-accent-amber font-body text-xs uppercase tracking-widest mb-4">Modules</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-10">
        {MODULES.map(({ to, icon: Icon, title, desc, tag, featured }) => (
          <Link
            key={to}
            to={to}
            className={`
              group relative bg-bg-panel rounded-xl p-6 border transition-all duration-300
              ${featured
                ? 'border-accent-amber/40 hover:border-accent-amber hover:shadow-[0_0_30px_var(--color-accent-amber)/20]'
                : 'border-white/5 hover:border-white/15 hover:bg-white/5'
              }
            `}
          >
            {featured && <div className="absolute top-3 right-3 w-2 h-2 rounded-full bg-accent-amber animate-breath" />}
            <div className={`inline-flex items-center justify-center w-10 h-10 rounded-lg mb-4 ${featured ? 'bg-accent-amber/15 text-accent-amber' : 'bg-white/5 text-text-muted group-hover:text-text-primary'}`}>
              <Icon size={20} />
            </div>
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-header text-lg text-text-primary">{title}</h3>
              <span className="text-[10px] font-body uppercase tracking-wider px-2 py-0.5 rounded-full bg-white/5 text-text-muted">{tag}</span>
            </div>
            <p className="text-text-muted text-sm font-body leading-relaxed">{desc}</p>
          </Link>
        ))}
      </div>

      {/* Recent sessions */}
      <h2 className="text-accent-amber font-body text-xs uppercase tracking-widest mb-4">Recent Sessions</h2>
      {sessions.length === 0 ? (
        <div className="bg-bg-panel rounded-xl border border-white/5 px-6 py-12 text-center">
          <Mic2 size={28} className="mx-auto mb-3 text-text-muted/30" />
          <p className="text-text-muted font-body text-sm">No sessions yet.</p>
          <p className="text-text-muted/60 font-body text-xs mt-1">Complete a sight-reading quest to see your history here.</p>
          <Link
            to="/practice"
            className="inline-block mt-4 bg-accent-amber text-bg-deep font-body font-semibold text-sm px-5 py-2.5 rounded-lg hover:shadow-[0_0_16px_var(--color-accent-amber)/40] transition-all"
          >
            Start Quest
          </Link>
        </div>
      ) : (
        <div className="bg-bg-panel rounded-xl border border-white/5 overflow-hidden">
          {sessions.slice(0, 8).map((s, i) => (
            <div key={s.id} className={`flex items-center gap-4 px-6 py-4 ${i < Math.min(sessions.length, 8) - 1 ? 'border-b border-white/5' : ''}`}>
              <div className="flex-1 min-w-0">
                <p className="text-text-primary font-body text-sm truncate">{s.pieceTitle}</p>
                <p className="text-text-muted font-body text-xs mt-0.5">
                  {new Date(s.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  {s.duration > 0 && ` · ${Math.round(s.duration / 60)} min`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-16 h-1.5 bg-white/10 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${s.accuracy >= 90 ? 'bg-feedback-success' : s.accuracy >= 70 ? 'bg-accent-amber' : 'bg-feedback-error'}`}
                    style={{ width: `${s.accuracy}%` }}
                  />
                </div>
                <span className={`text-sm font-body w-10 text-right tabular-nums ${s.accuracy >= 90 ? 'text-feedback-success' : s.accuracy >= 70 ? 'text-accent-amber' : 'text-feedback-error'}`}>
                  {s.accuracy}%
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
