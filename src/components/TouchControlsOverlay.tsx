import React, { useRef, useState } from 'react';
import type { InputAdapter } from '../controls.ts';

interface TouchControlsOverlayProps {
  inputAdapterRef: React.RefObject<InputAdapter | null>;
  isLookAwayActive: boolean;
}

/**
 * Multi-touch on-screen driving controls for mobile and tablet browsers.
 * Supports simultaneous steering (left thumb drag dial) and throttle/brake pedals (right thumb).
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
      className="fixed inset-x-0 bottom-3 sm:bottom-5 z-20 pointer-events-none flex items-end justify-between px-3 sm:px-5 select-none touch-none"
    >
      {/* Left Thumb: Simultaneous Drag Steering Wheel / Slider */}
      <div className="flex flex-col items-center gap-2 pointer-events-auto touch-none">
        <div
          ref={steerZoneRef}
          role="slider"
          aria-label="Touch Steering Control"
          aria-valuemin={-100}
          aria-valuemax={100}
          aria-valuenow={Math.round(visualSteer * 100)}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            steerPointerIdRef.current = e.pointerId;
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
          className="w-36 h-24 rounded-2xl bg-[#090d16]/85 border-2 border-slate-600/80 flex flex-col items-center justify-center relative cursor-pointer touch-none shadow-xl"
        >
          <div className="text-[10px] font-mono-tabular uppercase tracking-wider text-slate-400 mb-1">
            DRAG TO STEER
          </div>
          <div className="w-28 h-3 rounded-full bg-slate-800 relative">
            <div
              className="w-7 h-7 rounded-full bg-amber-400 border-2 border-slate-950 shadow-md absolute -top-2"
              style={{
                left: `calc(50% + ${visualSteer * 42}px - 14px)`,
              }}
            />
          </div>
          <div className="flex justify-between w-28 text-[9px] font-mono-tabular text-slate-400 mt-2">
            <span>LEFT</span>
            <span>CENTER</span>
            <span>RIGHT</span>
          </div>
        </div>
      </div>

      {/* Right Thumb: Simultaneous Brake & Accelerate Pedals + Glance Button */}
      <div className="flex flex-col items-end gap-1.5 pointer-events-auto touch-none">
        <button
          type="button"
          aria-label="Touch Glance Away Toggle"
          onPointerDown={(e) => {
            e.preventDefault();
            inputAdapterRef.current?.setManualLookAway(
              isLookAwayActive ? 'none' : 'left',
            );
          }}
          className={`h-8 px-3 rounded-lg border text-[11px] font-display font-bold uppercase tracking-wide touch-none cursor-pointer shadow-md ${
            isLookAwayActive
              ? 'bg-rose-600 border-rose-400 text-white'
              : 'bg-[#090d16]/90 border-slate-600 text-slate-200'
          }`}
        >
          {isLookAwayActive ? 'Eyes Forward' : 'Glance Away'}
        </button>

        <div className="flex items-end gap-2">
          <button
            type="button"
            aria-label="Touch Brake Pedal"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
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
            className={`w-18 sm:w-20 h-16 sm:h-20 rounded-2xl border-2 flex flex-col items-center justify-center font-display font-bold text-xs tracking-wider touch-none cursor-pointer shadow-xl ${
              brakePressed
                ? 'bg-rose-600 border-rose-300 text-white scale-95'
                : 'bg-[#090d16]/85 border-rose-500/70 text-rose-300'
            }`}
          >
            <span>BRAKE</span>
            <span className="text-[9px] font-mono-tabular opacity-75 mt-0.5">
              HOLD
            </span>
          </button>

          <button
            type="button"
            aria-label="Touch Accelerate Pedal"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
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
            className={`w-18 sm:w-20 h-20 sm:h-24 rounded-2xl border-2 flex flex-col items-center justify-center font-display font-bold text-xs tracking-wider touch-none cursor-pointer shadow-xl ${
              throttlePressed
                ? 'bg-emerald-500 border-emerald-200 text-slate-950 scale-95'
                : 'bg-[#090d16]/85 border-emerald-500/70 text-emerald-300'
            }`}
          >
            <span>ACCEL</span>
            <span className="text-[9px] font-mono-tabular opacity-75 mt-0.5">
              BOOST
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
