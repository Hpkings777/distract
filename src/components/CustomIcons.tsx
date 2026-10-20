import React from 'react';

/**
 * Custom Sports Steering Wheel Vector Icon
 */
export const SteeringWheelIcon: React.FC<{
  className?: string;
  steerAngle?: number; // normalized -1 to +1
}> = ({ className = 'w-6 h-6', steerAngle = 0 }) => {
  const rotationDeg = steerAngle * 65;
  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      style={{
        transform: `rotate(${rotationDeg}deg)`,
        transition: 'transform 0.08s ease-out',
      }}
    >
      <defs>
        <radialGradient id="hubGrad" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.4" />
          <stop offset="60%" stopColor="#1e293b" />
          <stop offset="100%" stopColor="#090d16" />
        </radialGradient>
        <linearGradient id="rimGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#f59e0b" />
          <stop offset="50%" stopColor="#0f172a" />
          <stop offset="100%" stopColor="#334155" />
        </linearGradient>
      </defs>
      {/* Outer Grip Rim */}
      <circle
        cx="50"
        cy="50"
        r="44"
        fill="none"
        stroke="#1e293b"
        strokeWidth="10"
      />
      <circle
        cx="50"
        cy="50"
        r="44"
        fill="none"
        stroke="#475569"
        strokeWidth="2"
      />
      {/* 12 O'Clock Racing Alignment Center Stripe */}
      <rect
        x="47"
        y="1"
        width="6"
        height="10"
        rx="2"
        fill="#f59e0b"
      />
      {/* Perforated Grip Notches (9 and 3 o'clock) */}
      <rect x="1" y="44" width="10" height="12" rx="3" fill="#334155" />
      <rect x="89" y="44" width="10" height="12" rx="3" fill="#334155" />
      {/* Three Spokes */}
      <path
        d="M 50 50 L 12 50 M 50 50 L 88 50 M 50 50 L 50 88"
        stroke="#64748b"
        strokeWidth="7"
        strokeLinecap="round"
      />
      {/* Center Hub */}
      <circle cx="50" cy="50" r="16" fill="url(#hubGrad)" stroke="#64748b" strokeWidth="2.5" />
      <circle cx="50" cy="50" r="6" fill="#38bdf8" />
    </svg>
  );
};

/**
 * Custom Floor-Hinged Drilled Aluminum Gas Accelerator Pedal
 */
export const GasPedalIcon: React.FC<{
  className?: string;
  pressed?: boolean;
}> = ({ className = 'w-6 h-6', pressed = false }) => {
  return (
    <svg viewBox="0 0 48 80" className={className}>
      <defs>
        <linearGradient id="pedalGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={pressed ? '#38bdf8' : '#cbd5e1'} />
          <stop offset="50%" stopColor={pressed ? '#0284c7' : '#64748b'} />
          <stop offset="100%" stopColor="#1e293b" />
        </linearGradient>
      </defs>
      {/* Pedal Face Plate */}
      <rect
        x="4"
        y="4"
        width="40"
        height="72"
        rx="8"
        fill="url(#pedalGrad)"
        stroke={pressed ? '#38bdf8' : '#94a3b8'}
        strokeWidth="2.5"
      />
      {/* Drilled Holes with Anti-Slip Grip Inserts */}
      {[16, 28, 40, 52, 64].map((y) => (
        <g key={y}>
          <circle cx="16" cy={y} r="3.5" fill="#090d16" stroke="#475569" strokeWidth="1" />
          <circle cx="32" cy={y} r="3.5" fill="#090d16" stroke="#475569" strokeWidth="1" />
        </g>
      ))}
      {/* Bottom Hinge Flange */}
      <rect x="12" y="72" width="24" height="4" rx="2" fill="#334155" />
    </svg>
  );
};

/**
 * Custom Wide Performance Drilled Aluminum Brake Pedal
 */
export const BrakePedalIcon: React.FC<{
  className?: string;
  pressed?: boolean;
}> = ({ className = 'w-6 h-6', pressed = false }) => {
  return (
    <svg viewBox="0 0 64 64" className={className}>
      <defs>
        <linearGradient id="brakeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={pressed ? '#f43f5e' : '#e2e8f0'} />
          <stop offset="60%" stopColor={pressed ? '#be123c' : '#475569'} />
          <stop offset="100%" stopColor="#0f172a" />
        </linearGradient>
      </defs>
      {/* Wide Heavy-Duty Brake Plate */}
      <rect
        x="4"
        y="8"
        width="56"
        height="48"
        rx="8"
        fill="url(#brakeGrad)"
        stroke={pressed ? '#f43f5e' : '#cbd5e1'}
        strokeWidth="3"
      />
      {/* Diagonal Rubber Friction Cleats */}
      {[16, 26, 36, 46].map((x) => (
        <line
          key={x}
          x1={x}
          y1="16"
          x2={x + 6}
          y2="48"
          stroke="#090d16"
          strokeWidth="3.5"
          strokeLinecap="round"
        />
      ))}
      <circle cx="14" cy="18" r="2.5" fill="#f43f5e" />
      <circle cx="50" cy="18" r="2.5" fill="#f43f5e" />
    </svg>
  );
};

/**
 * Custom Biometric Gaze & Driver Monitoring Reticle Icon
 */
export const DriverGazeIcon: React.FC<{
  className?: string;
  active?: boolean;
  alert?: boolean;
}> = ({ className = 'w-6 h-6', active = true, alert = false }) => {
  const accent = alert ? '#f43f5e' : active ? '#10b981' : '#f59e0b';
  return (
    <svg viewBox="0 0 48 48" className={className}>
      {/* Corner Bracket Reticles */}
      <path d="M 6 16 L 6 6 L 16 6" fill="none" stroke={accent} strokeWidth="2.5" strokeLinecap="round" />
      <path d="M 42 16 L 42 6 L 32 6" fill="none" stroke={accent} strokeWidth="2.5" strokeLinecap="round" />
      <path d="M 6 32 L 6 42 L 16 42" fill="none" stroke={accent} strokeWidth="2.5" strokeLinecap="round" />
      <path d="M 42 32 L 42 42 L 32 42" fill="none" stroke={accent} strokeWidth="2.5" strokeLinecap="round" />

      {/* Iris & Pupil Targeting Circle */}
      <path
        d="M 10 24 Q 24 10 38 24 Q 24 38 10 24 Z"
        fill="none"
        stroke={accent}
        strokeWidth="2"
      />
      <circle cx="24" cy="24" r="6" fill={accent} fillOpacity="0.25" stroke={accent} strokeWidth="2" />
      <circle cx="24" cy="24" r="2.5" fill={accent} />
    </svg>
  );
};

/**
 * Top-Down Forward Radar Scope Widget
 * Displays upcoming vehicles ahead within 100 meters on both lanes
 */
export const ForwardRadarScope: React.FC<{
  hazards: Array<{ s: number; laneIndex: number; speed: number; type: string }>;
  playerS: number;
  className?: string;
}> = ({ hazards, playerS, className = 'w-24 h-24' }) => {
  const range = 80; // meters ahead to show on scope

  return (
    <div
      className={`relative rounded-xl bg-[#070b14]/90 border border-slate-700/80 p-1.5 flex flex-col items-center shadow-lg ${className}`}
    >
      <div className="flex items-center justify-between w-full px-1 text-[8px] font-mono-tabular text-slate-400">
        <span className="text-sky-400 font-bold">RADAR</span>
        <span>{range}m</span>
      </div>

      <div className="relative w-full flex-1 rounded bg-[#090d16] border border-slate-800/80 overflow-hidden flex justify-center">
        {/* Lane Lines */}
        <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-amber-400/40 border-dashed" />
        <div className="absolute inset-y-0 left-1.5 w-px bg-slate-700/50" />
        <div className="absolute inset-y-0 right-1.5 w-px bg-slate-700/50" />

        {/* Range distance rings */}
        <div className="absolute inset-x-0 top-1/4 h-px bg-slate-800" />
        <div className="absolute inset-x-0 top-1/2 h-px bg-slate-800" />
        <div className="absolute inset-x-0 top-3/4 h-px bg-slate-800" />

        {/* Player Car Marker at bottom (Lane 1 = right lane) */}
        <div className="absolute bottom-1 right-2.5 w-2 h-3.5 rounded-sm bg-sky-400 border border-white shadow-[0_0_8px_rgba(56,189,248,0.8)]" />

        {/* Forward Hazard Blips */}
        {hazards.map((h, i) => {
          const dist = h.s - playerS;
          if (dist < 0 || dist > range) return null;
          const topPercent = 100 - (dist / range) * 92 - 6;
          const isLeftLane = h.laneIndex === 0;

          return (
            <div
              key={i}
              className={`absolute w-2 h-2.5 rounded-sm border ${
                h.type === 'work_zone'
                  ? 'bg-amber-400 border-amber-200'
                  : 'bg-rose-500 border-white'
              } shadow-[0_0_6px_rgba(244,63,94,0.7)]`}
              style={{
                top: `${topPercent}%`,
                left: isLeftLane ? '22%' : '65%',
              }}
              title={`${h.type.toUpperCase()}: ${Math.round(dist)}m`}
            />
          );
        })}
      </div>
    </div>
  );
};
