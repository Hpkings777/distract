import React from 'react';
import type { AttentionSnapshot } from '../attention-monitor.ts';
import type { SideStimulusState } from '../experiment.ts';
import type { LiveInputTelemetry } from '../controls.ts';
import type {
  AppMode,
  AttentionState,
  CameraViewMode,
  MapPreset,
  SideDisplayConfig,
  TrafficConfig,
} from '../config.ts';
import {
  CAMERA_VIEW_MODES,
  EXPERIMENT_CONFIG,
  MAP_PRESETS,
  ROAD_CONFIG,
} from '../config.ts';
import type { NetworkTelemetry } from '../network.ts';
import { SidePatternVisual } from './SidePatternCanvas.tsx';
import { ForwardRadarScope } from './CustomIcons.tsx';
import { WebcamEyeMirror } from './WebcamEyeMirror.tsx';
import type { WebcamHeadTracker } from '../webcam-tracker.ts';

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
  mapPreset: MapPreset;
  cameraView: CameraViewMode;
  trafficConfig: TrafficConfig;
  collisionsCount: number;
  distractionCount: number;
  stimulus: SideStimulusState;
  sideConfig: SideDisplayConfig;
  networkTelemetry: NetworkTelemetry;
  leftPreviewCollapsed: boolean;
  rightPreviewCollapsed: boolean;
  onToggleLeftPreview: () => void;
  onToggleRightPreview: () => void;
  onGlanceSide: (side: 'left' | 'right') => void;
  upcomingHazards: Array<{
    s: number;
    laneIndex: number;
    speed: number;
    type: string;
  }>;
  inputTelemetry: LiveInputTelemetry;
  audioMuted: boolean;
  isLookAwayActive: boolean;
  highContrast: boolean;
  showTouchControls: boolean;
  webcamTracker?: WebcamHeadTracker | null;
  onToggleWebcam?: () => void;
  onToggleSimulatedEyes?: () => void;
  isSimulatedClosed?: boolean;
  onOpenSettings: () => void;
  onCycleCameraView: () => void;
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
  mapPreset,
  cameraView,
  trafficConfig,
  collisionsCount,
  distractionCount,
  stimulus,
  sideConfig,
  networkTelemetry,
  leftPreviewCollapsed,
  rightPreviewCollapsed,
  onToggleLeftPreview,
  onToggleRightPreview,
  onGlanceSide,
  upcomingHazards,
  inputTelemetry,
  audioMuted,
  isLookAwayActive,
  highContrast,
  showTouchControls,
  webcamTracker,
  onToggleWebcam,
  onToggleSimulatedEyes,
  isSimulatedClosed,
  onOpenSettings,
  onCycleCameraView,
  onToggleMute,
  onRestartRun,
  onTogglePause,
  onToggleLookAway,
  onFinishTrial,
}) => {
  // Speedometer circular arc math (from -130 deg to +130 deg, total 260 deg)
  const maxDialSpeed = 160;
  const clampedSpeed = Math.max(0, Math.min(maxDialSpeed, speedKmh));
  const speedRatio = clampedSpeed / maxDialSpeed;
  const startAngleDeg = -130;
  const currentAngleDeg = startAngleDeg + speedRatio * 260;
  const currentAngleRad = (currentAngleDeg * Math.PI) / 180;

  // Dial radius 42, center at (54, 54)
  const dialRadius = 42;
  const needleX = 54 + Math.cos(currentAngleRad) * (dialRadius - 5);
  const needleY = 54 + Math.sin(currentAngleRad) * (dialRadius - 5);

  // G-Force friction circle offset (-1.2G to +1.2G mapped to -15px .. +15px)
  const gDotX = 26 + Math.max(-1, Math.min(1, lateralAccelG / 1.2)) * 15;
  const gDotY = 26 - Math.max(-1, Math.min(1, longitudinalAccelG / 1.2)) * 15;

  // Segmented RPM Rev Lights (10 LED segments)
  const revSegments = 10;
  const activeSegments = Math.round(rpmNormalized * revSegments);
  const isRedline = rpmNormalized > 0.88;

  const getAttentionTheme = (state: AttentionState) => {
    switch (state) {
      case 'ATTENTIVE':
        return {
          border: 'border-emerald-500/80',
          bg: 'bg-emerald-950/90',
          text: 'text-emerald-300',
          label: 'EYES OPEN',
        };
      case 'DROWSY_WARNING':
      case 'POSSIBLY_DISTRACTED':
        return {
          border: 'border-amber-400',
          bg: 'bg-amber-950/95',
          text: 'text-amber-300',
          label: 'EYES CLOSING',
        };
      case 'DROWSY_CRITICAL':
      case 'DISTRACTED':
        return {
          border: 'border-rose-500',
          bg: 'bg-rose-950/95',
          text: 'text-rose-200',
          label: 'CRITICAL (>5s)',
        };
      default:
        return {
          border: 'border-sky-500/70',
          bg: 'bg-sky-950/90',
          text: 'text-sky-300',
          label: state,
        };
    }
  };

  const attTheme = getAttentionTheme(attention.state);
  const borderClass = highContrast ? 'border-slate-300' : 'border-slate-700/90';

  return (
    <div
      onContextMenu={(e) => e.preventDefault()}
      className="fixed inset-0 z-10 pointer-events-none flex flex-col justify-between p-2.5 sm:p-4 select-none touch-none"
    >
      {/* =====================================================================
          TOP PERIMETER: Native Motorsport Telemetry Bar & DMS Driver Mirror
          ===================================================================== */}
      <div className="flex items-start justify-between gap-2.5">
        {/* Top-Left: Session Clock, Map Tag & Biometric DMS Status */}
        <div
          className={`bg-[#060911]/92 border-l-2 border-l-amber-400 border-y border-r ${borderClass} rounded-sm px-3 py-1.5 flex items-center gap-3 pointer-events-auto shadow-2xl backdrop-blur-md`}
        >
          <div>
            <div className="flex items-center gap-1.5 text-[9px] font-mono-tabular uppercase tracking-widest text-slate-400">
              <span className="text-amber-400 font-bold">
                {MAP_PRESETS[mapPreset].shortLabel}
              </span>
              <span>·</span>
              <span>
                {appMode === 'experiment'
                  ? `TRIAL: ${trialType.toUpperCase()}`
                  : `MODE: ${appMode.toUpperCase()}`}
              </span>
            </div>
            <div className="flex items-baseline gap-2 mt-0.5">
              <span className="font-display font-bold text-lg sm:text-xl text-white font-mono-tabular leading-none">
                {appMode === 'experiment'
                  ? `${Math.max(
                      0,
                      Math.ceil(
                        EXPERIMENT_CONFIG.trialDurationSec - trialElapsedSec,
                      ),
                    )}s`
                  : `${trialElapsedSec.toFixed(0)}s`}
              </span>
              <span className="text-[11px] font-mono-tabular text-slate-400">
                {distanceMeters}m
              </span>
            </div>
          </div>

          <div className="h-7 w-px bg-slate-800" />

          <div
            data-testid="attention-status-badge"
            className={`px-2.5 py-1 rounded-sm border flex items-center gap-2 ${attTheme.border} ${attTheme.bg}`}
          >
            <span
              className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                attention.emergencySlowdownActive
                  ? 'bg-rose-500 animate-ping'
                  : attention.eyesClosed
                  ? 'bg-amber-400 animate-pulse'
                  : 'bg-emerald-400'
              }`}
            />
            <div>
              <div className="text-[8px] font-mono-tabular uppercase tracking-wider text-slate-400">
                DMS ({attention.mode === 'webcam' ? 'CAM' : 'SIM'}) ·{' '}
                {attention.eyesClosed ? 'CLOSED' : 'OPEN'}
              </div>
              <div
                className={`text-[11px] font-display font-bold tracking-wider ${attTheme.text}`}
              >
                {attTheme.label}
              </div>
            </div>
          </div>
        </div>

        {/* Top-Center: Safety Warning Banner & Dedicated Webcam Eye Mirror */}
        <div className="flex-1 flex flex-col items-center px-1">
          {/* Top Alert Banner on Critical Drowsiness, Eye Closure, or Lane Drift */}
          {(attention.emergencySlowdownActive ||
            attention.eyesClosed ||
            isOutOfLane) && (
            <div
              role="alert"
              data-testid="distraction-warning-banner"
              className={`mb-1 px-3.5 py-1 rounded-sm border-l-4 border-y border-r shadow-2xl flex items-center gap-2.5 backdrop-blur-md ${
                attention.emergencySlowdownActive
                  ? 'bg-rose-950/95 border-rose-500 text-white animate-pulse'
                  : 'bg-amber-950/95 border-amber-400 text-amber-100'
              }`}
            >
              <svg
                viewBox="0 0 24 24"
                className="w-4 h-4 shrink-0"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.3"
              >
                <path d="M12 3L2 21h20L12 3z" />
                <path d="M12 10v5" />
                <circle cx="12" cy="18" r="1.2" fill="currentColor" />
              </svg>
              <div>
                <div className="font-display font-bold text-xs tracking-wider uppercase">
                  {attention.emergencySlowdownActive
                    ? '⚠️ CRITICAL DROWSINESS: EYES CLOSED > 5.0s — SLOWING VEHICLE!'
                    : attention.eyesClosed
                    ? `⚠️ EYES CLOSED DETECTED — 5.0s THRESHOLD: ${(
                        attention.thresholdSec - attention.closureDurationSec
                      ).toFixed(1)}s REMAINING`
                    : 'LANE DEPARTURE — STEER BACK TO CARRIAGEWAY'}
                </div>
                <div className="text-[10px] font-mono-tabular opacity-90">
                  {attention.emergencySlowdownActive
                    ? 'ADAS Emergency Deceleration Engaged · Open Eyes to Regain Control'
                    : `Eyes Closed: ${attention.closureDurationSec.toFixed(1)}s · Lateral Drift: ${laneDeviationMeters.toFixed(2)}m`}
                </div>
              </div>
            </div>
          )}

          {/* Dedicated Webcam Eye Mirror (in user marked coordinates) */}
          <WebcamEyeMirror
            attention={attention}
            webcamTracker={webcamTracker ?? null}
            onToggleWebcam={onToggleWebcam ?? (() => {})}
            onToggleSimulatedEyes={onToggleSimulatedEyes ?? (() => {})}
            isSimulatedClosed={isSimulatedClosed ?? false}
          />
        </div>

        {/* Top-Right: Native Hardware Control Strip (Camera View, Settings, Mute, Restart, Pause) */}
        <div className="flex items-center gap-1 sm:gap-1.5 pointer-events-auto">
          {/* Camera View Toggle Button */}
          <button
            type="button"
            aria-label="Switch Camera View [C]"
            data-testid="camera-view-button"
            tabIndex={-1}
            onClick={(e) => {
              e.currentTarget.blur();
              onCycleCameraView();
            }}
            className="h-9 px-2.5 rounded-sm bg-[#060911]/92 border border-slate-700 hover:border-sky-400 text-slate-200 text-xs font-mono-tabular font-semibold flex items-center gap-1.5 cursor-pointer transition-colors"
          >
            <svg
              viewBox="0 0 24 24"
              className="w-4 h-4 text-sky-400"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
              <circle cx="12" cy="13" r="4" />
            </svg>
            <span className="hidden md:inline uppercase">
              {CAMERA_VIEW_MODES[cameraView].label}
            </span>
            <span className="text-[10px] text-slate-400">
              [{CAMERA_VIEW_MODES[cameraView].shortKey}]
            </span>
          </button>

          {/* Settings & Map/Traffic Button */}
          <button
            type="button"
            aria-label="Open Simulator Settings [S]"
            tabIndex={-1}
            onClick={(e) => {
              e.currentTarget.blur();
              onOpenSettings();
            }}
            className="h-9 px-2.5 rounded-sm bg-[#060911]/92 border border-slate-700 hover:border-amber-400 text-slate-200 text-xs font-mono-tabular font-semibold flex items-center gap-1.5 cursor-pointer transition-colors"
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
            <span className="hidden sm:inline uppercase">Settings</span>
          </button>

          {/* Audio Mute Button */}
          <button
            type="button"
            aria-label={audioMuted ? 'Unmute Audio [M]' : 'Mute Audio [M]'}
            tabIndex={-1}
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleMute();
            }}
            className="w-9 h-9 rounded-sm bg-[#060911]/92 border border-slate-700 hover:border-slate-500 flex items-center justify-center text-slate-200 cursor-pointer"
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
              </svg>
            )}
          </button>

          {/* Restart Button */}
          <button
            type="button"
            aria-label="Restart Run [R]"
            tabIndex={-1}
            onClick={(e) => {
              e.currentTarget.blur();
              onRestartRun();
            }}
            className="w-9 h-9 rounded-sm bg-[#060911]/92 border border-slate-700 hover:border-slate-500 flex items-center justify-center text-slate-200 cursor-pointer"
          >
            <svg
              viewBox="0 0 24 24"
              className="w-4 h-4 text-sky-400"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
          </button>

          {/* Pause Button */}
          <button
            type="button"
            aria-label="Pause Simulation [P]"
            tabIndex={-1}
            onClick={(e) => {
              e.currentTarget.blur();
              onTogglePause();
            }}
            className="w-9 h-9 rounded-sm bg-[#060911]/92 border border-slate-700 hover:border-slate-500 flex items-center justify-center text-slate-200 cursor-pointer"
          >
            <svg
              viewBox="0 0 24 24"
              className="w-4 h-4 text-amber-400"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <rect x="6" y="4" width="4" height="16" />
              <rect x="14" y="4" width="4" height="16" />
            </svg>
          </button>
        </div>
      </div>

      {/* =====================================================================
          MIDDLE PERIMETER: Collapsible Peripheral Side-Display Previews
          ===================================================================== */}
      {sideConfig.showEdgePreviews && (
        <div className="my-auto flex items-center justify-between pointer-events-none">
          {/* Left Side-Display Compact Preview */}
          <div className="flex items-center pointer-events-auto">
            {!leftPreviewCollapsed && (
              <div
                data-testid="left-display-preview"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onGlanceSide('left');
                }}
                className={`w-18 p-1.5 rounded-r-sm bg-[#060911]/90 border-y border-r ${
                  stimulus.activeSide === 'left'
                    ? 'border-amber-400 shadow-lg'
                    : 'border-slate-700/80'
                } flex flex-col items-center cursor-pointer`}
              >
                <div className="flex items-center justify-between w-full text-[8px] font-mono-tabular text-slate-400 mb-1">
                  <span>L-DISP</span>
                  <span
                    className={
                      networkTelemetry.left.status === 'connected'
                        ? 'text-emerald-400'
                        : 'text-slate-500'
                    }
                  >
                    {networkTelemetry.left.status === 'connected'
                      ? 'LINK'
                      : 'LOC'}
                  </span>
                </div>
                <SidePatternVisual
                  active={stimulus.activeSide === 'left'}
                  pattern={sideConfig.leftPattern}
                  intensity={sideConfig.leftIntensity}
                  colorHex="#f59e0b"
                  compact
                />
                <div className="text-[8px] font-mono-tabular text-slate-400 mt-1">
                  [Q] Glance
                </div>
              </div>
            )}
            <button
              type="button"
              tabIndex={-1}
              aria-label={
                leftPreviewCollapsed
                  ? 'Expand Left Display Preview'
                  : 'Collapse Left Display Preview'
              }
              onMouseDown={(e) => e.preventDefault()}
              onClick={onToggleLeftPreview}
              className="h-9 w-4 rounded-r-sm bg-slate-900/90 border-y border-r border-slate-700 text-slate-400 hover:text-white text-xs flex items-center justify-center cursor-pointer"
            >
              {leftPreviewCollapsed ? '›' : '‹'}
            </button>
          </div>

          {/* Right Side-Display Compact Preview */}
          <div className="flex items-center pointer-events-auto">
            <button
              type="button"
              tabIndex={-1}
              aria-label={
                rightPreviewCollapsed
                  ? 'Expand Right Display Preview'
                  : 'Collapse Right Display Preview'
              }
              onMouseDown={(e) => e.preventDefault()}
              onClick={onToggleRightPreview}
              className="h-9 w-4 rounded-l-sm bg-slate-900/90 border-y border-l border-slate-700 text-slate-400 hover:text-white text-xs flex items-center justify-center cursor-pointer"
            >
              {rightPreviewCollapsed ? '‹' : '›'}
            </button>
            {!rightPreviewCollapsed && (
              <div
                data-testid="right-display-preview"
                onMouseDown={(e) => {
                  e.preventDefault();
                  onGlanceSide('right');
                }}
                className={`w-18 p-1.5 rounded-l-sm bg-[#060911]/90 border-y border-l ${
                  stimulus.activeSide === 'right'
                    ? 'border-sky-400 shadow-lg'
                    : 'border-slate-700/80'
                } flex flex-col items-center cursor-pointer`}
              >
                <div className="flex items-center justify-between w-full text-[8px] font-mono-tabular text-slate-400 mb-1">
                  <span>R-DISP</span>
                  <span
                    className={
                      networkTelemetry.right.status === 'connected'
                        ? 'text-emerald-400'
                        : 'text-slate-500'
                    }
                  >
                    {networkTelemetry.right.status === 'connected'
                      ? 'LINK'
                      : 'LOC'}
                  </span>
                </div>
                <SidePatternVisual
                  active={stimulus.activeSide === 'right'}
                  pattern={sideConfig.rightPattern}
                  intensity={sideConfig.rightIntensity}
                  colorHex="#06b6d4"
                  compact
                />
                <div className="text-[8px] font-mono-tabular text-slate-400 mt-1">
                  [E] Glance
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* =====================================================================
          BOTTOM PERIMETER: Native Motorsport Telemetry Cluster & Radar
          ===================================================================== */}
      <div
        className={`flex items-end gap-2 sm:gap-3 mt-auto w-full max-w-full ${
          showTouchControls
            ? 'justify-center pb-24 sm:pb-0'
            : 'justify-between'
        }`}
      >
        {/* Bottom-Left: Forward Radar + Radial Speedometer Dial + F1 Shift Lights + G-Circle */}
        <div
          className={`bg-[#060911]/94 border-l-2 border-l-sky-400 border-y border-r ${borderClass} rounded-sm p-2 sm:px-3 sm:py-2 shadow-2xl pointer-events-auto flex items-center gap-2.5 sm:gap-3.5 backdrop-blur-md`}
        >
          {/* Forward Traffic Radar Scope */}
          <div className="hidden lg:block">
            <ForwardRadarScope
              hazards={upcomingHazards}
              playerS={distanceMeters}
              className="w-18 h-18"
            />
          </div>

          {/* Radial SVG Speedometer & Digital Readout */}
          <div className="relative w-22 h-22 sm:w-24 sm:h-24 shrink-0 flex items-center justify-center">
            <svg viewBox="0 0 108 108" className="w-full h-full">
              <circle
                cx="54"
                cy="54"
                r="42"
                fill="none"
                stroke="#1e293b"
                strokeWidth="6"
                strokeDasharray="190 360"
                strokeDashoffset="-22"
                strokeLinecap="butt"
              />
              <circle
                cx="54"
                cy="54"
                r="42"
                fill="none"
                stroke={
                  speedKmh > 110
                    ? '#f43f5e'
                    : speedKmh > 80
                    ? '#f59e0b'
                    : '#38bdf8'
                }
                strokeWidth="6"
                strokeDasharray={`${Math.round(speedRatio * 190)} 360`}
                strokeDashoffset="-22"
                strokeLinecap="butt"
              />
              <line
                x1="54"
                y1="54"
                x2={needleX}
                y2={needleY}
                stroke="#f8fafc"
                strokeWidth="2"
              />
              <circle cx="54" cy="54" r="4" fill="#f59e0b" />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center pt-4">
              <span
                data-testid="speed-readout"
                className="font-display font-bold text-2xl sm:text-3xl text-white font-mono-tabular leading-none tracking-tight"
              >
                {speedKmh}
              </span>
              <span className="text-[9px] font-mono-tabular font-bold text-amber-400 tracking-wider">
                KM/H
              </span>
            </div>
          </div>

          {/* Gear & 10-Segment F1 Rev Lights */}
          <div className="flex flex-col gap-1.5 min-w-[108px] sm:min-w-[124px]">
            <div className="flex items-center justify-between text-[10px] font-mono-tabular">
              <span className="text-slate-400 uppercase">TRANSMISSION</span>
              <span className="px-1.5 py-0.5 rounded-sm bg-amber-500/20 border border-amber-400/50 text-amber-300 font-bold text-xs">
                D{gear}
              </span>
            </div>

            <div className="flex items-center gap-0.5 w-full h-2.5 bg-slate-950 p-0.5 rounded-sm border border-slate-800">
              {Array.from({ length: revSegments }).map((_, idx) => {
                const active = idx < activeSegments;
                const isRed = idx >= 7;
                const isYellow = idx >= 4 && idx < 7;
                const colorClass = isRed
                  ? 'bg-rose-500'
                  : isYellow
                  ? 'bg-amber-400'
                  : 'bg-sky-400';
                return (
                  <div
                    key={idx}
                    className={`flex-1 h-full ${
                      active
                        ? isRedline && isRed
                          ? 'bg-white'
                          : colorClass
                        : 'bg-slate-800/70'
                    }`}
                  />
                );
              })}
            </div>

            <div className="flex items-center justify-between text-[9px] font-mono-tabular text-slate-400">
              <span>{inputTelemetry.activeSource.toUpperCase()}</span>
              <span className={isRedline ? 'text-rose-400 font-bold' : 'text-slate-400'}>
                {Math.round(1000 + rpmNormalized * 7200)} RPM
              </span>
            </div>
          </div>

          {/* Real-Time G-Force Friction Circle */}
          {!showTouchControls && (
            <div className="hidden md:flex flex-col items-center pl-2.5 border-l border-slate-800">
              <div className="text-[8px] font-mono-tabular uppercase tracking-wider text-slate-400 mb-1">
                G-LOAD
              </div>
              <div className="relative w-13 h-13 rounded-full border border-slate-700 bg-slate-950 flex items-center justify-center">
                <div className="w-6 h-6 rounded-full border border-slate-800" />
                <div className="absolute inset-x-0 top-1/2 h-px bg-slate-800" />
                <div className="absolute inset-y-0 left-1/2 w-px bg-slate-800" />
                <div
                  className="w-2 h-2 rounded-full bg-amber-400 absolute -translate-x-1/2 -translate-y-1/2"
                  style={{
                    left: `${gDotX}px`,
                    top: `${gDotY}px`,
                  }}
                />
              </div>
              <div className="text-[8px] font-mono-tabular text-slate-400 mt-0.5">
                {Math.abs(lateralAccelG).toFixed(2)}G
              </div>
            </div>
          )}
        </div>

        {/* Bottom-Right: Lane Corridor Telemetry, Traffic Status & Action Triggers */}
        <div
          className={`bg-[#060911]/94 border-r-2 border-r-amber-400 border-y border-l ${borderClass} rounded-sm p-2 sm:px-3 sm:py-2 shadow-2xl pointer-events-auto flex items-center gap-2.5 sm:gap-3.5 backdrop-blur-md`}
        >
          {/* Graphic Lane Corridor */}
          <div className="hidden sm:flex flex-col items-center">
            <div className="text-[8px] font-mono-tabular uppercase tracking-wider text-slate-400 mb-1">
              CARRIAGEWAY
            </div>
            <div className="w-16 h-8 rounded-sm bg-[#090d16] border border-slate-700 relative flex items-center justify-center overflow-hidden">
              <div className="absolute inset-y-0 left-1 w-0.5 bg-slate-500" />
              <div className="absolute inset-y-0 right-1 w-0.5 bg-slate-500" />
              <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-0.5 border-l border-dashed border-amber-400/60" />
              <div
                className={`w-2.5 h-4 rounded-none border transition-all duration-75 ${
                  isOutOfLane
                    ? 'bg-rose-500 border-white'
                    : isOnShoulder
                    ? 'bg-amber-400 border-slate-950'
                    : 'bg-emerald-400 border-slate-950'
                }`}
                style={{
                  transform: `translateX(${Math.max(
                    -22,
                    Math.min(
                      22,
                      (lateralOffset - ROAD_CONFIG.playerDefaultLaneOffset) * 16,
                    ),
                  )}px)`,
                }}
              />
            </div>
          </div>

          {/* Lane Drift Readout */}
          <div>
            <div className="text-[9px] font-mono-tabular uppercase tracking-widest text-slate-400">
              LANE DRIFT
            </div>
            <div className="flex items-baseline gap-1 my-0.5">
              <span
                data-testid="lane-deviation-readout"
                className={`font-display font-bold text-2xl sm:text-3xl font-mono-tabular leading-none ${
                  isOutOfLane ? 'text-rose-400' : 'text-emerald-400'
                }`}
              >
                {laneDeviationMeters.toFixed(2)}m
              </span>
              <span
                className={`text-[9px] font-mono-tabular font-bold ${
                  isOutOfLane ? 'text-rose-400' : 'text-emerald-400'
                }`}
              >
                {isOutOfLane ? 'DEPART' : 'LOCKED'}
              </span>
            </div>
            <div className="text-[8px] font-mono-tabular text-slate-400 uppercase">
              TRAFFIC: {trafficConfig.density.toUpperCase()} ({upcomingHazards.length} AHEAD)
            </div>
          </div>

          {!showTouchControls && (
            <div className="hidden sm:flex gap-3 text-xs font-mono-tabular border-l border-slate-800 pl-3">
              <div>
                <div className="text-[8px] text-slate-400">IMPACTS</div>
                <div className="text-sm font-bold text-white">
                  {collisionsCount}
                </div>
              </div>
              <div>
                <div className="text-[8px] text-slate-400">GLANCES</div>
                <div className="text-sm font-bold text-amber-400">
                  {distractionCount}
                </div>
              </div>
            </div>
          )}

          {/* Action Triggers: Look Away [L] & Results [F] */}
          <div className="flex items-center gap-1.5">
            {!showTouchControls && onToggleSimulatedEyes && (
              <button
                type="button"
                tabIndex={-1}
                onClick={onToggleSimulatedEyes}
                title="Toggle eyes closed to test 5s threshold and vehicle slowdown"
                className={`h-9 px-2.5 rounded-sm text-xs font-display font-bold flex items-center gap-1.5 cursor-pointer whitespace-nowrap transition-colors ${
                  attention.eyesClosed
                    ? 'bg-rose-600 text-white border border-rose-400 animate-pulse'
                    : 'bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-current" />
                <span>{attention.eyesClosed ? 'Open Eyes [E]' : 'Close Eyes [E]'}</span>
              </button>
            )}

            <button
              type="button"
              tabIndex={-1}
              onClick={onFinishTrial}
              className="h-9 px-3 rounded-sm bg-amber-500 hover:bg-amber-400 text-slate-950 font-display font-bold text-xs cursor-pointer whitespace-nowrap transition-colors"
            >
              Results [F]
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
