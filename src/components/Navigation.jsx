import { NavLink, useLocation } from 'react-router-dom';
import { Music2, Library, Mic2, Gauge, BarChart3, Target, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { useInstrumentStore } from '../store/instrumentStore.js';

const NAV_LINKS = [
  { to: '/',           icon: Music2,    label: 'Home'     },
  { to: '/library',    icon: Library,   label: 'Library'  },
  { to: '/practice',   icon: Mic2,      label: 'Practice' },
  { to: '/tuner',      icon: Gauge,     label: 'Tuner'    },
  { to: '/pitch-quest',icon: Target,    label: 'Quest'    },
  { to: '/report',     icon: BarChart3, label: 'Report'   },
];

const INSTRUMENTS = [
  { key: 'violin', label: 'Violin',      emoji: '🎻' },
  { key: 'viola',  label: 'Viola',       emoji: '🎻' },
  { key: 'cello',  label: 'Cello',       emoji: '🎻' },
  { key: 'bass',   label: 'Double Bass', emoji: '🎸' },
];

/** Compact instrument picker used inside both sidebar and mobile bar */
function InstrumentPicker({ placement = 'sidebar' }) {
  const { instrument, setInstrument } = useInstrumentStore();
  const [open, setOpen] = useState(false);
  const current = INSTRUMENTS.find(i => i.key === instrument);

  const isSidebar = placement === 'sidebar';

  return (
    <div className="relative" onClick={e => e.stopPropagation()}>
      <button
        onClick={() => setOpen(v => !v)}
        className={`
          flex items-center gap-1.5 border border-accent-amber/30 bg-accent-amber/10 text-accent-amber
          font-body font-medium rounded-lg transition-all hover:border-accent-amber/60
          ${isSidebar ? 'px-2.5 py-1.5 text-xs w-full justify-center' : 'px-2 py-1 text-[10px]'}
        `}
      >
        <span className="truncate">{isSidebar ? current.label : current.label.split(' ')[0]}</span>
        <ChevronDown size={10} className="flex-shrink-0" />
      </button>

      {open && (
        <div className={`
          absolute z-50 bg-bg-panel border border-accent-amber/25 rounded-xl overflow-hidden shadow-2xl
          ${isSidebar ? 'bottom-full mb-1 left-0 right-0 w-full' : 'bottom-full mb-2 right-0 w-36'}
        `}>
          {INSTRUMENTS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => { setInstrument(key); setOpen(false); }}
              className={`
                block w-full text-left px-3 py-2.5 font-body text-xs transition-colors
                ${key === instrument
                  ? 'text-accent-amber bg-accent-amber/10'
                  : 'text-text-muted hover:text-text-primary hover:bg-white/5'}
              `}
            >
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Navigation() {
  const { pathname } = useLocation();

  return (
    <>
      {/* ── Desktop Sidebar ─────────────────────────────── */}
      <aside className="hidden md:flex flex-col fixed left-0 top-0 h-full w-[72px] bg-bg-panel border-r border-white/5 z-50">
        {/* Logo */}
        <div className="flex items-center justify-center h-14 border-b border-white/5 flex-shrink-0">
          <Music2 size={22} className="text-accent-amber" />
        </div>

        {/* Nav links */}
        <nav className="flex flex-col items-center gap-0.5 py-3 flex-1 overflow-y-auto">
          {NAV_LINKS.map(({ to, icon: Icon, label }) => {
            const active = pathname === to || (to !== '/' && pathname.startsWith(to));
            return (
              <NavLink
                key={to}
                to={to}
                title={label}
                className={`
                  flex flex-col items-center justify-center w-12 h-12 rounded-xl transition-all duration-150
                  ${active
                    ? 'bg-accent-amber/10 text-accent-amber'
                    : 'text-text-muted hover:text-text-primary hover:bg-white/5'}
                `}
              >
                <Icon size={18} strokeWidth={active ? 2.5 : 1.8} />
                <span className="text-[8px] mt-0.5 font-body tracking-wide uppercase leading-none">{label}</span>
              </NavLink>
            );
          })}
        </nav>

        {/* Global instrument picker — bottom of sidebar */}
        <div className="px-2 py-3 border-t border-white/5 flex-shrink-0">
          <InstrumentPicker placement="sidebar" />
        </div>
      </aside>

      {/* ── Mobile Bottom Bar ───────────────────────────── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-bg-panel border-t border-white/5 z-50">
        <div className="flex justify-around py-1.5 px-1">
          {NAV_LINKS.map(({ to, icon: Icon, label }) => {
            const active = pathname === to || (to !== '/' && pathname.startsWith(to));
            return (
              <NavLink
                key={to}
                to={to}
                className={`flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg transition-all ${active ? 'text-accent-amber' : 'text-text-muted'}`}
              >
                <Icon size={18} strokeWidth={active ? 2.5 : 1.8} />
                <span className="text-[8px] font-body uppercase">{label}</span>
              </NavLink>
            );
          })}
        </div>
        {/* Mobile instrument picker row */}
        <div className="flex justify-end px-3 pb-2">
          <InstrumentPicker placement="mobile" />
        </div>
      </nav>
    </>
  );
}
