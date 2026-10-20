import React, { useRef, useState } from 'react';
import type { InputAdapter } from '../controls.ts';
import {
  SteeringWheelIcon,
  GasPedalIcon,
  BrakePedalIcon,
  DriverGazeIcon,
} from './CustomIcons.tsx';

interface TouchControlsOverlayProps {
  inputAdapterRef: React.RefObject<InputAdapter | null>;
  isLookAwayActive: boolean;
}

/**
 * Multi-touch on-screen driving controls for mobile and tablet browsers.
 * Designed with custom sports steering wheel dial and drilled aluminum pedals.
 * All long-press and context menus are strictly suppressed for arcade responsiveness.
 */
export const TouchControlsOverlay: React.FC<TouchControlsOverlayProps> = ({
  inputAdapterRef,
  isLookAwayActive,
}) => {
  const steerZoneRef = useRef<HTMLDivElement | null>(null);
  const steerPointerIdRef = useRef<number | null>(null);
  const [visualSteer, setVisualSteer] = useState(0);
  const [throttlePressed, setThrottlePressed] = useState(false);
  const [brakePressed, setBrakePressed] = useState(false);

  const triggerHaptic = (ms = 15) => {
    try {
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate(ms);
      }
    } catch {
      // Haptics optional
    }
  };

  const updateSteerFromClientX = (clientX: number) => {
    const el = steerZoneRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const center = rect.left + rect.width / 2;
    const half = Math.max(30, rect.width * 0.42);
    const norm = Math.max(-1, Math.min(1, (clientX - center) / half));
    setVisualSteer(norm);
    inputAdapterRef.current?.setTouchSteer(norm, true);
  };

  return (
    <div
      data-testid="touch-controls-overlay"
      onContextMenu={(e) => e.preventDefault()}
      className="fixed inset-x-0 bottom-2.5 sm:bottom-4 z-20 pointer-events-none flex items-end justify-between px-2 sm:px-6 select-none touch-none"
    >
      {/* Left Thumb: Sports Steering Wheel Dial with Rotating Wheel Silhouette */}
      <div className="flex flex-col items-center gap-1.5 pointer-events-auto touch-none">
        <div
          ref={steerZoneRef}
          role="slider"
          aria-label="Touch Steering Wheel Control"
          aria-valuemin={-100}
          aria-valuemax={100}
          aria-valuenow={Math.round(visualSteer * 100)}
          onContextMenu={(e) => e.preventDefault()}
          onPointerDown={(e) => {
            e.preventDefault();
            e.currentTarget.setPointerCapture(e.pointerId);
            steerPointerIdRef.current = e.pointerId;
            triggerHaptic(12);
            updateSteerFromClientX(e.clientX);
          }}
          onPointerMove={(e) => {
            if (steerPointerIdRef.current === e.pointerId) {
              updateSteerFromClientX(e.clientX);
            }
          }}
          onPointerUp={(e) => {
            if (steerPointerIdRef.current === e.pointerId) {
              steerPointerIdRef.current = null;
              setVisualSteer(0);
              inputAdapterRef.current?.setTouchSteer(0, false);
            }
          }}
          onPointerCancel={() => {
            steerPointerIdRef.current = null;
            setVisualSteer(0);
            inputAdapterRef.current?.setTouchSteer(0, false);
          }}
          className="w-36 h-22 sm:w-44 sm:h-26 rounded-3xl bg-[#070b14]/94 backdrop-blur-md border-2 border-slate-600/90 flex flex-col items-center justify-center relative cursor-pointer touch-none shadow-2xl p-2"
        >
          {/* Custom Steering Wheel Icon Rotating with Drag */}
          <div className="flex items-center gap-2 mb-1">
            <SteeringWheelIcon className="w-6 h-6 text-amber-400" steerAngle={visualSteer} />
            <span className="text-[10px] font-mono-tabular uppercase tracking-wider text-slate-200 font-bold">
              {Math.abs(visualSteer) < 0.05
                ? 'STEER'
                : visualSteer < 0
                ? `◄ ${Math.round(Math.abs(visualSteer) * 100)}% L`
                : `${Math.round(visualSteer * 100)}% R ►`}
            </span>
          </div>

          {/* Steer Bar Track with Center Notch */}
          <div className="w-28 sm:w-34 h-3.5 rounded-full bg-slate-950 border border-slate-800 relative flex items-center">
            {/* Center tick */}
            <div className="absolute left-1/2 -translate-x-1/2 w-1.5 h-full bg-amber-500/80 rounded" />
            {/* Draggable Steering Knob */}
            <div
              className="w-8 h-8 rounded-full bg-gradient-to-b from-amber-300 to-amber-500 border-2 border-slate-950 shadow-lg absolute -top-2 flex items-center justify-center transition-transform duration-75"
              style={{
                left: `calc(50% + ${visualSteer * 46}px - 16px)`,
              }}
            >
              <div className="w-2.5 h-2.5 rounded-full bg-slate-950" />
            </div>
          </div>

          <div className="flex justify-between w-28 sm:w-34 text-[8px] font-mono-tabular text-slate-400 mt-1.5 font-bold">
            <span>◄ TURN L</span>
            <span className="text-amber-400">CENTER</span>
            <span>TURN R ►</span>
          </div>
        </div>
      </div>

      {/* Right Thumb: Drilled Metal Pedals + Quick Look-Away Toggle */}
      <div className="flex flex-col items-end gap-1.5 pointer-events-auto touch-none">
        {/* Quick Glance Toggle Button */}
        <button
          type="button"
          aria-label="Touch Glance Away Toggle"
          onContextMenu={(e) => e.preventDefault()}
          onPointerDown={(e) => {
            e.preventDefault();
            triggerHaptic(20);
            inputAdapterRef.current?.setManualLookAway(
              isLookAwayActive ? 'none' : 'left',
            );
          }}
          className={`h-9 px-3 rounded-xl border text-[11px] font-display font-bold uppercase tracking-wider touch-none cursor-pointer shadow-lg flex items-center gap-2 transition-all ${
            isLookAwayActive
              ? 'bg-rose-600 border-rose-300 text-white shadow-[0_0_18px_rgba(244,63,94,0.6)] animate-pulse'
              : 'bg-[#070b14]/94 border-slate-600 hover:border-amber-400 text-slate-200'
          }`}
        >
          <DriverGazeIcon className="w-4 h-4" active={!isLookAwayActive} alert={isLookAwayActive} />
          <span>{isLookAwayActive ? 'EYES AHEAD' : 'LOOK AWAY [Q]'}</span>
        </button>

        {/* Brake & Accelerate Pedals (Dual Thumb Support) */}
        <div className="flex items-end gap-2.5">
          {/* Custom Drilled Aluminum Brake Pedal */}
          <button
            type="button"
            aria-label="Touch Brake Pedal"
            onContextMenu={(e) => e.preventDefault()}
            onPointerDown={(e) => {
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              triggerHaptic(15);
              setBrakePressed(true);
              inputAdapterRef.current?.setTouchPedals(
                throttlePressed ? 1 : 0,
                1,
              );
            }}
            onPointerUp={() => {
              setBrakePressed(false);
              inputAdapterRef.current?.setTouchPedals(
                throttlePressed ? 1 : 0,
                0,
              );
            }}
            onPointerCancel={() => {
              setBrakePressed(false);
              inputAdapterRef.current?.setTouchPedals(
                throttlePressed ? 1 : 0,
                0,
              );
            }}
            className={`w-18 sm:w-20 h-20 sm:h-24 rounded-2xl border-2 flex flex-col items-center justify-between p-2 font-display font-bold text-xs tracking-wider touch-none cursor-pointer shadow-2xl transition-transform ${
              brakePressed
                ? 'bg-rose-600 border-rose-300 text-white scale-95 shadow-[0_0_24px_rgba(244,63,94,0.7)]'
                : 'bg-[#070b14]/94 border-rose-500/80 text-rose-300'
            }`}
          >
            <BrakePedalIcon className="w-7 h-7" pressed={brakePressed} />
            <span>BRAKE</span>
            <span className="text-[8px] font-mono-tabular opacity-75">
              STOP
            </span>
          </button>

          {/* Custom Grooved Aluminum Accelerator Pedal */}
          <button
            type="button"
            aria-label="Touch Accelerate Pedal"
            onContextMenu={(e) => e.preventDefault()}
            onPointerDown={(e) => {
              e.preventDefault();
              e.currentTarget.setPointerCapture(e.pointerId);
              triggerHaptic(15);
              setThrottlePressed(true);
              inputAdapterRef.current?.setTouchPedals(
                1,
                brakePressed ? 1 : 0,
              );
            }}
            onPointerUp={() => {
              setThrottlePressed(false);
              inputAdapterRef.current?.setTouchPedals(
                0,
                brakePressed ? 1 : 0,
              );
            }}
            onPointerCancel={() => {
              setThrottlePressed(false);
              inputAdapterRef.current?.setTouchPedals(
                0,
                brakePressed ? 1 : 0,
              );
            }}
            className={`w-18 sm:w-20 h-24 sm:h-28 rounded-2xl border-2 flex flex-col items-center justify-between p-2 font-display font-bold text-xs tracking-wider touch-none cursor-pointer shadow-2xl transition-transform ${
              throttlePressed
                ? 'bg-emerald-500 border-emerald-200 text-slate-950 scale-95 shadow-[0_0_24px_rgba(16,185,129,0.7)]'
                : 'bg-[#070b14]/94 border-emerald-500/80 text-emerald-300'
            }`}
          >
            <GasPedalIcon className="w-6 h-8" pressed={throttlePressed} />
            <span>GAS</span>
            <span className="text-[8px] font-mono-tabular opacity-75">
              DRIVE
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
