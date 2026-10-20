import React, { useEffect, useState } from 'react';
import type { SidePatternType, StimulusIntensityLevel } from '../config.ts';

interface SidePatternVisualProps {
  active: boolean;
  pattern: SidePatternType;
  intensity: StimulusIntensityLevel;
  colorHex: string;
  compact?: boolean;
}

export const SidePatternVisual: React.FC<SidePatternVisualProps> = ({
  active,
  pattern,
  intensity,
  colorHex,
  compact = false,
}) => {
  const [tick, setTick] = useState(0);

  const speedMult =
    intensity === 'high' ? 1.5 : intensity === 'low' ? 0.65 : 1.0;

  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => {
      setTick((t) => (t + 1) % 360);
    }, 45);
    return () => window.clearInterval(id);
  }, [active]);

  if (!active) {
    return (
      <div className="flex flex-col items-center justify-center w-full h-full opacity-45">
        <div
          className={`${
            compact ? 'w-7 h-7' : 'w-20 h-20'
          } rounded-full border border-dashed border-slate-600 flex items-center justify-center`}
        >
          <span className="font-mono-tabular text-[9px] text-slate-400">
            IDLE
          </span>
        </div>
      </div>
    );
  }

  const phase = tick * speedMult;

  return (
    <div className="flex flex-col items-center justify-center w-full h-full">
      <svg
        viewBox="0 0 200 200"
        className={compact ? 'w-14 h-14' : 'w-64 h-64 md:w-80 md:h-80'}
        aria-label={`Visual stimulus pattern ${pattern}`}
      >
        {pattern === 'chevron' && (
          <g>
            {[0, 1, 2].map((i) => {
              const offset = ((phase * 5 + i * 55) % 160) - 20;
              return (
                <polyline
                  key={i}
                  points={`35,${offset + 45} 100,${offset} 165,${offset + 45}`}
                  fill="none"
                  stroke={i % 2 === 0 ? colorHex : '#f8fafc'}
                  strokeWidth="12"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              );
            })}
          </g>
        )}

        {pattern === 'rings' && (
          <g>
            <circle
              cx="100"
              cy="100"
              r={20 + ((phase * 4) % 72)}
              fill="none"
              stroke={colorHex}
              strokeWidth="10"
            />
            <circle
              cx="100"
              cy="100"
              r={15 + (((phase + 9) * 4) % 72)}
              fill="none"
              stroke="#38bdf8"
              strokeWidth="6"
            />
            <polygon
              points="100,32 162,145 38,145"
              fill="none"
              stroke="#f8fafc"
              strokeWidth="6"
              transform={`rotate(${(phase * 8) % 360} 100 100)`}
            />
          </g>
        )}

        {pattern === 'matrix' && (
          <g>
            {[0, 1, 2, 3].map((row) =>
              [0, 1, 2, 3].map((col) => {
                const on =
                  Math.floor(phase / 2 + row * 3 + col * 2) % 3 === 0;
                return (
                  <rect
                    key={`${row}-${col}`}
                    x={28 + col * 38}
                    y={28 + row * 38}
                    width="28"
                    height="28"
                    rx="5"
                    fill={on ? colorHex : '#1e293b'}
                  />
                );
              }),
            )}
          </g>
        )}

        {pattern === 'wave' && (
          <g>
            {[0, 1, 2, 3, 4].map((bar) => {
              const h =
                30 +
                Math.abs(Math.sin((phase * 0.25) + bar * 0.9)) * 120;
              return (
                <rect
                  key={bar}
                  x={26 + bar * 32}
                  y={100 - h / 2}
                  width="20"
                  height={h}
                  rx="8"
                  fill={bar % 2 === 0 ? colorHex : '#38bdf8'}
                />
              );
            })}
          </g>
        )}
      </svg>
    </div>
  );
};
