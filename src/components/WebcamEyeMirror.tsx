import React, { useEffect, useRef, useState } from 'react';
import type { AttentionSnapshot } from '../attention-monitor.ts';
import type { WebcamHeadTracker } from '../webcam-tracker.ts';

export interface WebcamEyeMirrorProps {
  attention: AttentionSnapshot;
  webcamTracker: WebcamHeadTracker | null;
  onToggleWebcam: () => void;
  onToggleSimulatedEyes: () => void;
  isSimulatedClosed: boolean;
}

export const WebcamEyeMirror: React.FC<WebcamEyeMirrorProps> = ({
  attention,
  webcamTracker,
  onToggleWebcam,
  onToggleSimulatedEyes,
  isSimulatedClosed,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamActive = webcamTracker?.isRunning() ?? false;

  // Sync the video element's stream to the local <video> element
  useEffect(() => {
    if (!videoRef.current || !webcamTracker) return;

    const stream = webcamTracker.getMediaStream();
    if (stream && streamActive) {
      if (videoRef.current.srcObject !== stream) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }
    } else {
      videoRef.current.srcObject = null;
    }
  }, [webcamTracker, streamActive]);

  const isClosed = attention.eyesClosed;
  const isCritical = attention.emergencySlowdownActive; // >= 5.0s
  const isWarning = isClosed && !isCritical;
  const progressRatio = Math.min(1, attention.closureDurationSec / attention.thresholdSec);
  const remainingSec = Math.max(0, attention.thresholdSec - attention.closureDurationSec);

  return (
    <div
      data-testid="webcam-eye-mirror"
      className="relative flex flex-col items-center pointer-events-auto select-none"
    >
      {/* Automotive Digital Interior Rearview Mirror Chassis */}
      <div
        className={`relative w-[340px] sm:w-[380px] h-[92px] sm:h-[104px] rounded-t-xl rounded-b-2xl p-1.5 transition-all duration-300 shadow-2xl backdrop-blur-md overflow-hidden ${
          isCritical
            ? 'bg-rose-950/95 border-2 border-rose-500 shadow-[0_0_35px_rgba(244,63,94,0.65)] ring-2 ring-rose-500/80 animate-pulse'
            : isWarning
            ? 'bg-amber-950/90 border-2 border-amber-400 shadow-[0_0_20px_rgba(251,191,36,0.45)]'
            : 'bg-[#050811]/92 border border-slate-700/80 hover:border-slate-500 shadow-[0_12px_28px_rgba(0,0,0,0.85)]'
        }`}
      >
        {/* Top Mirror Header Strip */}
        <div className="flex items-center justify-between px-2 py-0.5 mb-1 bg-black/60 rounded-t-md text-[9px] font-mono-tabular tracking-wider border-b border-white/10">
          <div className="flex items-center gap-1.5">
            <span
              className={`inline-block w-2 h-2 rounded-full ${
                isCritical
                  ? 'bg-rose-500 animate-ping'
                  : isWarning
                  ? 'bg-amber-400 animate-pulse'
                  : streamActive
                  ? 'bg-emerald-400'
                  : 'bg-sky-400'
              }`}
            />
            <span className="font-bold text-slate-200">
              {streamActive ? 'WEBCAM DMS EYE MONITOR' : 'SIMULATED DMS SENSOR'}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`px-1.5 py-0.2 rounded font-bold uppercase ${
                isCritical
                  ? 'bg-rose-600 text-white'
                  : isWarning
                  ? 'bg-amber-500/30 text-amber-300'
                  : 'bg-emerald-500/20 text-emerald-300'
              }`}
            >
              {isCritical
                ? 'CRITICAL ALERT (>5s)'
                : isClosed
                ? `CLOSURE ${(attention.closureDurationSec).toFixed(1)}s`
                : `OPEN (${Math.round(attention.eyeOpenness * 100)}%)`}
            </span>
          </div>
        </div>

        {/* Video / Eyes Band Viewing Port (Cropped specifically to the Eyes) */}
        <div className="relative w-full h-[52px] sm:h-[60px] bg-slate-950 rounded overflow-hidden border border-white/10">
          {streamActive ? (
            // Live Webcam Feed cropped to Eyes Region (mirrored)
            <div className="w-full h-full relative overflow-hidden flex items-center justify-center">
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                className="w-full h-[180%] object-cover -scale-x-100 filter brightness-105 contrast-110"
                style={{ objectPosition: 'center 40%' }}
              />
            </div>
          ) : (
            // Synthetic Stylized Driver Eyes Visual when Webcam is Off
            <div className="w-full h-full flex items-center justify-around px-8 bg-gradient-to-b from-slate-900 to-slate-950">
              {/* Left Eye Representation */}
              <div className="relative flex flex-col items-center">
                <div
                  className={`w-16 h-7 rounded-full border flex items-center justify-center transition-all duration-200 ${
                    isClosed
                      ? 'border-rose-400/80 bg-rose-950/40 scale-y-[0.18]'
                      : 'border-emerald-400/80 bg-slate-900/80 shadow-[0_0_12px_rgba(16,185,129,0.3)]'
                  }`}
                >
                  {!isClosed && (
                    <div className="w-5 h-5 rounded-full bg-sky-300/90 flex items-center justify-center">
                      <div className="w-2.5 h-2.5 rounded-full bg-slate-950" />
                    </div>
                  )}
                </div>
                <span className="text-[8px] font-mono-tabular text-slate-400 mt-0.5">
                  L-EYE
                </span>
              </div>

              {/* Nose Bridge Divider */}
              <div className="w-0.5 h-6 bg-slate-800" />

              {/* Right Eye Representation */}
              <div className="relative flex flex-col items-center">
                <div
                  className={`w-16 h-7 rounded-full border flex items-center justify-center transition-all duration-200 ${
                    isClosed
                      ? 'border-rose-400/80 bg-rose-950/40 scale-y-[0.18]'
                      : 'border-emerald-400/80 bg-slate-900/80 shadow-[0_0_12px_rgba(16,185,129,0.3)]'
                  }`}
                >
                  {!isClosed && (
                    <div className="w-5 h-5 rounded-full bg-sky-300/90 flex items-center justify-center">
                      <div className="w-2.5 h-2.5 rounded-full bg-slate-950" />
                    </div>
                  )}
                </div>
                <span className="text-[8px] font-mono-tabular text-slate-400 mt-0.5">
                  R-EYE
                </span>
              </div>
            </div>
          )}

          {/* Computer Vision Optical HUD Reticle Overlay */}
          <div className="absolute inset-0 pointer-events-none flex items-center justify-between px-6 sm:px-10">
            {/* Left Eye Reticle */}
            <div
              className={`w-14 sm:w-16 h-8 sm:h-9 border border-dashed rounded transition-colors ${
                isCritical
                  ? 'border-rose-400 bg-rose-500/10'
                  : isClosed
                  ? 'border-amber-400 bg-amber-500/10'
                  : 'border-emerald-400/70 bg-emerald-500/5'
              } flex items-end justify-start p-0.5`}
            >
              <span className="text-[7px] font-mono font-bold text-white drop-shadow">
                {isClosed ? 'CLOSED' : 'OPEN'}
              </span>
            </div>

            {/* Center HUD Reticle Crosshair */}
            <div className="flex flex-col items-center opacity-60">
              <div className="w-2.5 h-0.5 bg-sky-400" />
              <div className="w-0.5 h-2.5 bg-sky-400" />
            </div>

            {/* Right Eye Reticle */}
            <div
              className={`w-14 sm:w-16 h-8 sm:h-9 border border-dashed rounded transition-colors ${
                isCritical
                  ? 'border-rose-400 bg-rose-500/10'
                  : isClosed
                  ? 'border-amber-400 bg-amber-500/10'
                  : 'border-emerald-400/70 bg-emerald-500/5'
              } flex items-end justify-end p-0.5`}
            >
              <span className="text-[7px] font-mono font-bold text-white drop-shadow">
                {isClosed ? 'CLOSED' : 'OPEN'}
              </span>
            </div>
          </div>

          {/* 5-Second Threshold Progress Bar (Fills up when eyes are shut) */}
          {isClosed && (
            <div className="absolute bottom-0 inset-x-0 h-1.5 bg-black/80">
              <div
                className={`h-full transition-all duration-75 ${
                  isCritical ? 'bg-rose-500 animate-pulse' : 'bg-amber-400'
                }`}
                style={{ width: `${progressRatio * 100}%` }}
              />
            </div>
          )}

          {/* Critical 5s Alert Banner Overlay */}
          {isCritical && (
            <div className="absolute inset-0 bg-rose-950/90 flex flex-col items-center justify-center text-white px-2 text-center animate-pulse">
              <div className="font-display font-black text-[11px] sm:text-xs tracking-wider uppercase text-rose-200">
                ⚠️ EYES CLOSED &gt; 5.0s — SLOWING VEHICLE! ⚠️
              </div>
              <div className="text-[9px] font-mono text-rose-300">
                WAKE UP! EMERGENCY ADAS BRAKING APPLIED
              </div>
            </div>
          )}
        </div>

        {/* Bottom Interactive Control Strip */}
        <div className="flex items-center justify-between pt-1 px-1 text-[9px] font-mono-tabular">
          {/* Toggle Real Webcam */}
          <button
            type="button"
            onClick={onToggleWebcam}
            className={`px-2 py-0.5 rounded text-[8px] sm:text-[9px] font-semibold border transition-all cursor-pointer flex items-center gap-1 ${
              streamActive
                ? 'bg-emerald-950/80 border-emerald-500 text-emerald-200 hover:bg-emerald-900'
                : 'bg-slate-800/90 border-slate-600 text-slate-200 hover:border-sky-400 hover:text-white'
            }`}
          >
            <span>{streamActive ? '📷 Webcam: ON' : '📷 Enable Webcam'}</span>
          </button>

          {/* Countdown or Status Text */}
          <div className="text-center font-bold">
            {isCritical ? (
              <span className="text-rose-400 uppercase font-black">
                BRAKING ACTIVE
              </span>
            ) : isClosed ? (
              <span className="text-amber-300">
                5s Alert in: {remainingSec.toFixed(1)}s
              </span>
            ) : (
              <span className="text-slate-400">
                {streamActive ? 'Face Detected' : 'Press [E] to Test'}
              </span>
            )}
          </div>

          {/* Test Eyes Open / Closed Button */}
          <button
            type="button"
            onClick={onToggleSimulatedEyes}
            title="Toggle eyes closed to test 5s threshold and vehicle slowdown"
            className={`px-2 py-0.5 rounded text-[8px] sm:text-[9px] font-semibold border transition-all cursor-pointer flex items-center gap-1 ${
              isClosed
                ? 'bg-rose-900 border-rose-400 text-white shadow-md'
                : 'bg-slate-800/90 border-slate-600 text-slate-200 hover:border-amber-400 hover:text-amber-200'
            }`}
          >
            <span>{isClosed ? '👁️ Eyes: CLOSED' : '👁️ Eyes: OPEN'}</span>
            <span className="text-[8px] text-slate-400 font-normal">[E]</span>
          </button>
        </div>
      </div>

      {/* Mirror Center Mounting Stem / Bracket (Matches user's drawn notch at bottom) */}
      <div className="w-5 h-2 bg-gradient-to-b from-slate-700 to-slate-900 border-x border-b border-slate-600 rounded-b-sm shadow-md" />
    </div>
  );
};
