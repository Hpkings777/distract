import React from 'react';
import type { AttentionSnapshot } from '../attention-monitor.ts';
import type { SideStimulusState } from '../experiment.ts';
import type { LiveInputTelemetry } from '../controls.ts';
import type { AppMode, AttentionState } from '../config.ts';
import { EXPERIMENT_CONFIG } from '../config.ts';

export interface AutomotiveHudProps {
  speedKmh: number;
  gear: number;
  rpmNormalized: number;
  lateralAccelG: number;
  longitudinalAccelG: number;
  distanceMeters: number;
  laneDeviationMeters: number;
  lateralOffset: number;
  isOutOfLane: boolean;
  isOnShoulder: boolean;
  attention: AttentionSnapshot;
  trialElapsedSec: number;
  trialType: 'baseline' | 'distracted';
  appMode: AppMode;
  collisionsCount: number;
  distractionCount: number;
  stimulus: SideStimulusState;
  inputTelemetry: LiveInputTelemetry;
  audioMuted: boolean;
  isLookAwayActive: boolean;
  highContrast: boolean;
  showTouchControls: boolean;
  onOpenSettings: () => void;
  onToggleMute: () => void;
  onRestartRun: () => void;
  onTogglePause: () => void;
  onToggleLookAway: () => void;
  onFinishTrial: () => void;
}

export const AutomotiveHud: React.FC<AutomotiveHudProps> = ({
  speedKmh,
  gear,
  rpmNormalized,
  lateralAccelG,
  longitudinalAccelG,
  distanceMeters,
  laneDeviationMeters,
  lateralOffset,
  isOutOfLane,
  isOnShoulder,
  attention,
  trialElapsedSec,
  trialType,
  appMode,
  collisionsCount,
  distractionCount,
  stimulus,
  inputTelemetry,
  audioMuted,
  isLookAwayActive,
  highContrast,
  showTouchControls,
  onOpenSettings,
  onToggleMute,
  onRestartRun,
  onTogglePause,
  onToggleLookAway,
  onFinishTrial,
}) => {
  // Speedometer circular arc math (from -130 deg to +130 deg, total 260 deg)
  const maxDialSpeed = 140;
  const clampedSpeed = Math.max(0, Math.min(maxDialSpeed, speedKmh));
  const speedRatio = clampedSpeed / maxDialSpeed;
  const startAngleDeg = -130;
  const currentAngleDeg = startAngleDeg + speedRatio * 260;
  const currentAngleRad = (currentAngleDeg * Math.PI) / 180;

  // Dial radius 48, center at (64, 64)
  const dialRadius = 46;
  const needleX = 64 + Math.cos(currentAngleRad) * (dialRadius - 6);
  const needleY = 64 + Math.sin(currentAngleRad) * (dialRadius - 6);

  // G-Force friction circle offset (-1G to +1G mapped to -16px .. +16px)
  const gDotX = 32 + Math.max(-1, Math.min(1, lateralAccelG)) * 16;
  const gDotY = 32 - Math.max(-1, Math.min(1, longitudinalAccelG)) * 16;

  // Segmented RPM Rev Lights (8 LED segments)
  const revSegments = 8;
  const activeSegments = Math.round(rpmNormalized * revSegments);
  const isRedline = rpmNormalized > 0.88;

  // Attention status styling
  const getAttentionTheme = (state: AttentionState) => {
    switch (state) {
      case 'ATTENTIVE':
        return {
          border: 'border-emerald-500/70',
          bg: 'bg-emerald-950/85',
          text: 'text-emerald-300',
          glow: 'shadow-[0_0_15px_rgba(16,185,129,0.25)]',
          label: 'ROAD FOCUSED',
        };
      case 'POSSIBLY_DISTRACTED':
        return {
          border: 'border-amber-400',
          bg: 'bg-amber-950/90',
          text: 'text-amber-300',
          glow: 'shadow-[0_0_20px_rgba(245,158,11,0.35)]',
          label: 'GAZE DEVIATING',
        };
      case 'DISTRACTED':
        return {
          border: 'border-rose-500 animate-pulse',
          bg: 'bg-rose-950/95',
          text: 'text-rose-200',
          glow: 'shadow-[0_0_25px_rgba(244,63,94,0.5)]',
          label: 'EYES OFF ROAD',
        };
      default:
        return {
          border: 'border-sky-500/70',
          bg: 'bg-sky-950/85',
          text: 'text-sky-300',
          glow: 'shadow-none',
          label: state,
        };
    }
  };

  const attTheme = getAttentionTheme(attention.state);

  // Pupil horizontal position based on yaw
  const pupilOffsetX = Math.max(-10, Math.min(10, (attention.yawDeg / 28) * 10));
  const pupilOffsetY = Math.max(-4, Math.min(4, (attention.pitchDeg / 20) * 4));

  // Lane Radar Position (-4m to +4m mapped to 0% .. 100%)
  const laneNorm = Math.max(0, Math.min(1, (lateralOffset + 4.2) / 8.4));

  return (
    <div className="fixed inset-0 z-10 pointer-events-none flex flex-col justify-between p-2.5 sm:p-4 select-none touch-none">
      {/* =====================================================================
          TOP PERIMETER: Cyber-Automotive Telemetry Bar & Eye Attention Radar
          ===================================================================== */}
      <div className="flex items-start justify-between gap-2.5">
        {/* Top-Left: Trial Countdown & Session Badge */}
        <div className="flex items-center gap-2 pointer-events-auto">
          <div
            className={`bg-[#070b14]/90 backdrop-blur-md border ${
              highContrast ? 'border-slate-300' : 'border-slate-700/80'
            } rounded-2xl p-2 sm:px-3 sm:py-2 shadow-2xl flex items-center gap-3`}
          >
            <div>
              <div className="text-[9px] font-mono-tabular uppercase tracking-widest text-slate-400">
                {appMode === 'experiment'
                  ? `TRIAL · ${trialType.toUpperCase()}`
                  : `MODE · ${appMode.toUpperCase()}`}
              </div>
              <div className="flex items-baseline gap-1.5">
                <span className="font-display font-bold text-xl sm:text-2xl text-white font-mono-tabular leading-none">
                  {appMode === 'experiment'
                    ? `${Math.max(
                        0,
                        Math.ceil(
                          EXPERIMENT_CONFIG.trialDurationSec - trialElapsedSec,
                        ),
                      )}s`
                    : `${trialElapsedSec.toFixed(0)}s`}
                </span>
                <span className="text-[10px] font-mono-tabular text-slate-400">
                  {distanceMeters}m
                </span>
              </div>
            </div>

            <div className="h-7 w-px bg-slate-800" />

            {/* Diegetic Eye Gaze Pupil Radar */}
            <div className="flex items-center gap-2">
              <svg
                viewBox="0 0 36 24"
                className="w-9 h-6 shrink-0"
                role="img"
                aria-label="Driver Eye Gaze State"
              >
                {/* Sclera Eyeball outline */}
                <path
                  d="M2 12 Q 18 1, 34 12 Q 18 23, 2 12 Z"
                  fill="#090d16"
                  stroke={
                    attention.state === 'DISTRACTED'
                      ? '#f43f5e'
                      : attention.state === 'POSSIBLY_DISTRACTED'
                      ? '#fbbf24'
                      : '#38bdf8'
                  }
                  strokeWidth="2"
                />
                {/* Iris */}
                <circle
                  cx={18 + pupilOffsetX}
                  cy={12 + pupilOffsetY}
                  r="5.5"
                  fill={
                    attention.state === 'DISTRACTED'
                      ? '#e11d48'
                      : attention.state === 'POSSIBLY_DISTRACTED'
                      ? '#f59e0b'
                      : '#0284c7'
                  }
                />
                {/* Pupil */}
                <circle
                  cx={18 + pupilOffsetX}
                  cy={12 + pupilOffsetY}
                  r="2.8"
                  fill="#030712"
                />
                {/* Reflection highlight */}
                <circle
                  cx={16.5 + pupilOffsetX}
                  cy={10.5 + pupilOffsetY}
                  r="1.2"
                  fill="#ffffff"
                />
              </svg>

              <div
                className={`px-2 py-0.5 rounded-lg border ${attTheme.border} ${attTheme.bg} ${attTheme.glow}`}
              >
                <div className="text-[8px] font-mono-tabular uppercase tracking-wider opacity-75">
                  GAZE ({attention.mode === 'webcam' ? 'CAM' : 'SIM'})
                </div>
                <div
                  className={`text-[11px] font-display font-bold tracking-wide ${attTheme.text}`}
                >
                  {attTheme.label}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Top-Center Warning Banner on Distraction or Lane Drift */}
        <div className="flex-1 flex justify-center px-1">
          {(attention.state === 'DISTRACTED' ||
            attention.state === 'POSSIBLY_DISTRACTED' ||
            isOutOfLane) && (
            <div
              role="alert"
              className={`px-3.5 py-1.5 sm:px-5 sm:py-2 rounded-2xl border-2 shadow-2xl flex items-center gap-2.5 backdrop-blur-md ${
                attention.state === 'DISTRACTED'
                  ? 'bg-rose-950/95 border-rose-500 text-white'
                  : 'bg-amber-950/95 border-amber-400 text-amber-100'
              }`}
            >
              <svg
                viewBox="0 0 24 24"
                className="w-5 h-5 shrink-0 animate-bounce"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <path d="M12 2L1 21h22L12 2z" />
                <path d="M12 9v5" />
                <circle cx="12" cy="18" r="1.2" fill="currentColor" />
              </svg>
              <div>
                <div className="font-display font-bold text-xs sm:text-sm tracking-wider uppercase">
                  {attention.state === 'DISTRACTED'
                    ? 'EYES ON ROAD · CRITICAL DISTRACTION'
                    : attention.state === 'POSSIBLY_DISTRACTED'
                    ? 'HEAD POSE DEVIATING FROM ROADWAY'
                    : 'LANE DEPARTURE · STEER TO CENTER'}
                </div>
                <div className="text-[10px] font-mono-tabular opacity-90">
                  Off-Road: {(attention.sustainedDeviationMs / 1000).toFixed(1)}s
                  · Drift: {laneDeviationMeters.toFixed(2)}m
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Top-Right: Bespoke Custom Action Bar */}
        <div className="flex items-center gap-1 sm:gap-1.5 pointer-events-auto">
          {/* Settings Button */}
          <button
            type="button"
            aria-label="Open Simulator Settings [S]"
            onClick={onOpenSettings}
            className="h-9 px-2.5 sm:px-3 rounded-xl bg-[#070b14]/90 border border-slate-700/80 hover:border-amber-400 text-slate-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-lg transition-colors active:scale-95"
          >
            <svg
              viewBox="0 0 24 24"
              className="w-4 h-4 text-amber-400"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            <span className="hidden sm:inline">Settings</span>
          </button>

          {/* Audio Mute Toggle */}
          <button
            type="button"
            aria-label={audioMuted ? 'Unmute Audio [M]' : 'Mute Audio [M]'}
            onClick={onToggleMute}
            className="w-9 h-9 rounded-xl bg-[#070b14]/90 border border-slate-700/80 hover:border-slate-500 flex items-center justify-center text-slate-200 cursor-pointer shadow-lg active:scale-95"
          >
            {audioMuted ? (
              <svg
                viewBox="0 0 24 24"
                className="w-4 h-4 text-rose-400"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M11 5L6 9H2v6h4l5 4V5z" />
                <line x1="23" y1="9" x2="17" y2="15" />
                <line x1="17" y1="9" x2="23" y2="15" />
              </svg>
            ) : (
              <svg
                viewBox="0 0 24 24"
                className="w-4 h-4 text-emerald-400"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M11 5L6 9H2v6h4l5 4V5z" />
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
              </svg>
            )}
          </button>

          {/* Restart Button */}
          <button
            type="button"
            aria-label="Restart Run [R]"
            onClick={onRestartRun}
            className="w-9 h-9 rounded-xl bg-[#070b14]/90 border border-slate-700/80 hover:border-slate-500 flex items-center justify-center text-slate-200 cursor-pointer shadow-lg active:scale-95"
          >
            <svg
              viewBox="0 0 24 24"
              className="w-4 h-4 text-sky-400"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
            >
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
          </button>

          {/* Pause Button */}
          <button
            type="button"
            aria-label="Pause Simulation [P]"
            onClick={onTogglePause}
            className="w-9 h-9 rounded-xl bg-[#070b14]/90 border border-slate-700/80 hover:border-slate-500 flex items-center justify-center text-slate-200 cursor-pointer shadow-lg active:scale-95"
          >
            <svg
              viewBox="0 0 24 24"
              className="w-4 h-4 text-amber-400"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
            >
              <rect x="6" y="4" width="4" height="16" rx="1" />
              <rect x="14" y="4" width="4" height="16" rx="1" />
            </svg>
          </button>
        </div>
      </div>

      {/* =====================================================================
          BOTTOM PERIMETER: High-End Racing Instrument Cluster & Telemetry
          ===================================================================== */}
      <div
        className={`flex items-end gap-3 mt-auto ${
          showTouchControls ? 'justify-center pb-24 sm:pb-2' : 'justify-between'
        }`}
      >
        {/* Left Module: Glowing Arc Speedometer + F1 Rev Lights + Digital Gauge */}
        <div
          className={`bg-[#070b14]/92 backdrop-blur-md border ${
            highContrast ? 'border-slate-300' : 'border-slate-700/90'
          } rounded-3xl p-3 shadow-2xl pointer-events-auto flex items-center gap-3`}
        >
          {/* Circular SVG Speedometer Dial */}
          <div className="relative w-28 h-28 shrink-0 flex items-center justify-center">
            <svg viewBox="0 0 128 128" className="w-full h-full">
              {/* Dial Track Arc */}
              <circle
                cx="64"
                cy="64"
                r="46"
                fill="none"
                stroke="#1e293b"
                strokeWidth="7"
                strokeDasharray="210 360"
                strokeDashoffset="-25"
                strokeLinecap="round"
              />
              {/* Dial Value Glow Arc */}
              <circle
                cx="64"
                cy="64"
                r="46"
                fill="none"
                stroke={
                  speedKmh > 100
                    ? '#ef4444'
                    : speedKmh > 75
                    ? '#f59e0b'
                    : '#0ea5e9'
                }
                strokeWidth="7"
                strokeDasharray={`${Math.round(speedRatio * 210)} 360`}
                strokeDashoffset="-25"
                strokeLinecap="round"
                className="transition-all duration-75"
              />
              {/* Central Needle Line */}
              <line
                x1="64"
                y1="64"
                x2={needleX}
                y2={needleY}
                stroke="#f8fafc"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
              {/* Center Hub */}
              <circle cx="64" cy="64" r="5" fill="#f59e0b" />
            </svg>

            {/* Inset Digital Readout */}
            <div className="absolute inset-0 flex flex-col items-center justify-center pt-5">
              <span
                data-testid="speed-readout"
                className="font-display font-bold text-3xl sm:text-4xl text-white font-mono-tabular leading-none tracking-tight"
              >
                {speedKmh}
              </span>
              <span className="text-[10px] font-mono-tabular font-bold text-amber-400 tracking-wider">
                KM/H
              </span>
            </div>
          </div>

          {/* Right Sub-Panel: Gear Indicator + F1 Segmented Rev Lights */}
          <div className="flex flex-col gap-1.5">
            {/* Gear & Drive Mode */}
            <div className="flex items-center justify-between text-xs font-mono-tabular">
              <span className="text-slate-400">GEAR</span>
              <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold border border-amber-500/40 text-sm">
                D{gear}
              </span>
            </div>

            {/* F1 Rev Lights (8 LED segments) */}
            <div>
              <div className="flex items-center gap-1 w-28 h-2.5 bg-slate-950 p-0.5 rounded border border-slate-800">
                {Array.from({ length: revSegments }).map((_, idx) => {
                  const active = idx < activeSegments;
                  const isRed = idx >= 6;
                  const isYellow = idx >= 4 && idx < 6;
                  const colorClass = isRed
                    ? 'bg-rose-500 shadow-[0_0_8px_#f43f5e]'
                    : isYellow
                    ? 'bg-amber-400 shadow-[0_0_6px_#fbbf24]'
                    : 'bg-emerald-400 shadow-[0_0_6px_#34d399]';
                  return (
                    <div
                      key={idx}
                      className={`flex-1 h-full rounded-sm transition-colors ${
                        active
                          ? isRedline && isRed
                            ? 'bg-white animate-ping'
                            : colorClass
                          : 'bg-slate-800/80'
                      }`}
                    />
                  );
                })}
              </div>
              <div className="flex justify-between text-[8px] font-mono-tabular text-slate-500 mt-0.5">
                <span>1K</span>
                <span>4K</span>
                <span className="text-rose-400">7K RPM</span>
              </div>
            </div>

            <div className="text-[9px] font-mono-tabular text-slate-400 uppercase truncate">
              {inputTelemetry.activeSource} ACTIVE
            </div>
          </div>
        </div>

        {/* Center Module: Real-Time Friction Circle G-Meter (Compact) */}
        {!showTouchControls && (
          <div
            className={`hidden md:flex flex-col items-center justify-center bg-[#070b14]/92 backdrop-blur-md border ${
              highContrast ? 'border-slate-300' : 'border-slate-700/90'
            } rounded-3xl p-2.5 shadow-2xl pointer-events-auto`}
          >
            <div className="text-[9px] font-mono-tabular uppercase tracking-widest text-slate-400 mb-1">
              G-FORCE METER
            </div>
            <div className="relative w-16 h-16 rounded-full border border-slate-700 bg-slate-950 flex items-center justify-center">
              {/* Inner 0.5G ring */}
              <div className="w-8 h-8 rounded-full border border-slate-800" />
              {/* Crosshair lines */}
              <div className="absolute inset-x-0 top-1/2 h-px bg-slate-800" />
              <div className="absolute inset-y-0 left-1/2 w-px bg-slate-800" />
              {/* G-Dot */}
              <div
                className="w-2.5 h-2.5 rounded-full bg-amber-400 shadow-[0_0_10px_#f59e0b] absolute -translate-x-1/2 -translate-y-1/2 transition-transform duration-75"
                style={{
                  left: `${gDotX}px`,
                  top: `${gDotY}px`,
                }}
              />
            </div>
            <div className="text-[9px] font-mono-tabular text-slate-300 mt-1">
              {Math.abs(lateralAccelG).toFixed(2)}G LAT
            </div>
          </div>
        )}

        {/* Right Module: Diegetic Lane Deviation Corridor & Action Triggers */}
        <div
          className={`bg-[#070b14]/92 backdrop-blur-md border ${
            highContrast ? 'border-slate-300' : 'border-slate-700/90'
          } rounded-3xl p-3 shadow-2xl pointer-events-auto flex items-center gap-3.5`}
        >
          {/* Lane Corridor Graphic */}
          <div className="flex flex-col gap-1 w-32 sm:w-36">
            <div className="flex items-center justify-between text-[10px] font-mono-tabular">
              <span className="text-slate-400">LANE CORRIDOR</span>
              <span
                className={`font-bold ${
                  isOutOfLane
                    ? 'text-rose-400'
                    : isOnShoulder
                    ? 'text-amber-400'
                    : 'text-emerald-400'
                }`}
              >
                {isOutOfLane ? 'DEPARTURE' : 'IN LANE'}
              </span>
            </div>

            {/* Corridor track */}
            <div className="w-full h-5 rounded-lg bg-slate-950 border border-slate-800 relative overflow-hidden flex items-center">
              {/* Center dashed line */}
              <div className="absolute left-1/2 -translate-x-1/2 inset-y-0 w-0.5 border-r border-dashed border-yellow-400/60" />
              {/* Left lane target */}
              <div className="absolute left-[28%] inset-y-0 w-px bg-slate-800" />
              {/* Right lane target (driver default) */}
              <div className="absolute left-[72%] inset-y-0 w-px bg-emerald-500/40" />

              {/* Dynamic Vehicle Marker */}
              <div
                className={`w-3.5 h-3.5 rounded-full border-2 absolute top-1/2 -translate-y-1/2 -translate-x-1/2 transition-all duration-75 ${
                  isOutOfLane
                    ? 'bg-rose-500 border-white shadow-[0_0_12px_#f43f5e]'
                    : 'bg-emerald-400 border-slate-950 shadow-[0_0_8px_#34d399]'
                }`}
                style={{
                  left: `${Math.round(laneNorm * 100)}%`,
                }}
              />
            </div>

            <div className="flex justify-between items-baseline text-[10px] font-mono-tabular text-slate-400">
              <span>Drift:</span>
              <span
                data-testid="lane-deviation-readout"
                className={`font-bold font-mono-tabular text-sm ${
                  isOutOfLane ? 'text-rose-400' : 'text-emerald-400'
                }`}
              >
                {laneDeviationMeters.toFixed(2)}m
              </span>
            </div>
          </div>

          {/* Quick Glances & Hits statistics */}
          {!showTouchControls && (
            <div className="hidden sm:flex flex-col gap-1 border-l border-slate-800 pl-3 font-mono-tabular text-xs">
              <div className="flex items-center justify-between gap-3">
                <span className="text-[10px] text-slate-400">IMPACTS:</span>
                <span className="font-bold text-white">{collisionsCount}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-[10px] text-slate-400">GLANCES:</span>
                <span className="font-bold text-amber-400">
                  {distractionCount}
                </span>
              </div>
            </div>
          )}

          {/* Look Away [L] and Results [F] Buttons */}
          <div className="flex items-center gap-2">
            {!showTouchControls && (
              <button
                type="button"
                tabIndex={-1}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onToggleLookAway();
                }}
                className={`px-3 py-2 rounded-xl text-xs font-semibold cursor-pointer whitespace-nowrap shadow-lg transition-transform active:scale-95 ${
                  isLookAwayActive
                    ? 'bg-rose-600 text-white shadow-[0_0_15px_rgba(244,63,94,0.4)]'
                    : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
                }`}
              >
                {isLookAwayActive ? 'Eyes Ahead' : 'Look Away [L]'}
              </button>
            )}

            <button
              type="button"
              tabIndex={-1}
              onClick={onFinishTrial}
              className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-display font-bold text-xs cursor-pointer whitespace-nowrap shadow-lg active:scale-95"
            >
              Results [F]
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
