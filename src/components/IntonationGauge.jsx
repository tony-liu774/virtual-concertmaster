/**
 * SVG needle-style intonation gauge.
 * Only renders when |cents| > 10 to reduce visual noise during clean playing.
 */
export default function IntonationGauge({ cents = 0, visible = false }) {
  if (!visible) return null;

  // Clamp cents to ±50 for display
  const clamped = Math.max(-50, Math.min(50, cents));
  // Map ±50 cents → ±70° rotation
  const angleDeg = (clamped / 50) * 70;
  // Convert to SVG arc coordinates
  const cx = 100, cy = 95, r = 70;
  const toRad = (deg) => (deg * Math.PI) / 180;

  // Needle tip coordinates
  const needleAngle = toRad(-90 + angleDeg);
  const nx = cx + r * Math.cos(needleAngle);
  const ny = cy + r * Math.sin(needleAngle);

  // Color based on deviation
  const abs = Math.abs(clamped);
  let color = '#c9a227'; // amber
  if (abs <= 5) color = '#10b981'; // emerald
  else if (abs > 20) color = '#dc2626'; // crimson

  // Arc segments
  function arcPath(startDeg, endDeg) {
    const s = toRad(-90 + startDeg);
    const e = toRad(-90 + endDeg);
    const x1 = cx + r * Math.cos(s);
    const y1 = cy + r * Math.sin(s);
    const x2 = cx + r * Math.cos(e);
    const y2 = cy + r * Math.sin(e);
    return `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`;
  }

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 200 110" className="w-56 h-32">
        {/* Background arc */}
        <path
          d={arcPath(-70, 70)}
          fill="none"
          stroke="#1e293b"
          strokeWidth="14"
          strokeLinecap="round"
        />
        {/* Flat zone (left) */}
        <path
          d={arcPath(-70, -8)}
          fill="none"
          stroke="#dc262640"
          strokeWidth="14"
          strokeLinecap="round"
        />
        {/* Perfect zone (center) */}
        <path
          d={arcPath(-8, 8)}
          fill="none"
          stroke="#10b98150"
          strokeWidth="14"
          strokeLinecap="round"
        />
        {/* Sharp zone (right) */}
        <path
          d={arcPath(8, 70)}
          fill="none"
          stroke="#dc262640"
          strokeWidth="14"
          strokeLinecap="round"
        />

        {/* Tick marks */}
        {[-70, -35, 0, 35, 70].map((deg) => {
          const a = toRad(-90 + deg);
          const x1 = cx + (r - 10) * Math.cos(a);
          const y1 = cy + (r - 10) * Math.sin(a);
          const x2 = cx + (r + 4) * Math.cos(a);
          const y2 = cy + (r + 4) * Math.sin(a);
          return <line key={deg} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#334155" strokeWidth="1.5" />;
        })}

        {/* Glow filter */}
        <defs>
          <filter id="needle-glow">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Needle */}
        <line
          x1={cx} y1={cy}
          x2={nx} y2={ny}
          stroke={color}
          strokeWidth="2.5"
          strokeLinecap="round"
          filter="url(#needle-glow)"
          style={{ transition: 'all 0.08s ease-out' }}
        />

        {/* Center pivot */}
        <circle cx={cx} cy={cy} r="5" fill={color} filter="url(#needle-glow)" />

        {/* Labels */}
        <text x="22" y="108" fill="#dc2626" fontSize="10" fontFamily="monospace" textAnchor="middle">♭ FLAT</text>
        <text x="178" y="108" fill="#dc2626" fontSize="10" fontFamily="monospace" textAnchor="middle">SHARP ♯</text>
        <text x={cx} y="108" fill="#10b981" fontSize="10" fontFamily="monospace" textAnchor="middle">●</text>
      </svg>

      {/* Cents readout */}
      <p className="font-body text-sm mt-1" style={{ color }}>
        {clamped === 0 ? '± 0¢' : clamped > 0 ? `+${clamped.toFixed(1)}¢` : `${clamped.toFixed(1)}¢`}
      </p>
    </div>
  );
}
