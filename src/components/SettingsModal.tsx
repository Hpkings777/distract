import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import {
  CAMERA_VIEW_MODES,
  LIGHTING_PRESETS,
  MAP_PRESETS,
  QUALITY_PRESETS,
  TRAFFIC_DENSITY_COUNTS,
} from '../config.ts';
import type {
  AccessibilitySettings,
  AudioSettings,
  CameraViewMode,
  LightingPreset,
  MapPreset,
  QualityPreset,
  SideDisplayConfig,
  SidePatternType,
  StimulusIntensityLevel,
  TouchControlsMode,
  TrafficAggressionPreset,
  TrafficConfig,
  TrafficDensityPreset,
} from '../config.ts';
import type {
  ControllerCalibrationSettings,
  LiveInputTelemetry,
} from '../controls.ts';
import type { AttentionSnapshot } from '../attention-monitor.ts';
import type { NetworkTelemetry } from '../network.ts';
import type { RendererDiagnostics } from '../scene.ts';

export type SettingsTabId =
  | 'world'
  | 'display'
  | 'controls'
  | 'sidedisplays'
  | 'camera'
  | 'audio'
  | 'accessibility';

interface SettingsModalProps {
  initialTab?: SettingsTabId;
  onClose: () => void;
  mapPreset: MapPreset;
  onChangeMap: (m: MapPreset) => void;
  trafficConfig: TrafficConfig;
  onUpdateTrafficConfig: (partial: Partial<TrafficConfig>) => void;
  cameraView: CameraViewMode;
  onChangeCameraView: (view: CameraViewMode) => void;
  qualityPreset: QualityPreset;
  onChangeQuality: (q: QualityPreset) => void;
  lightingPreset: LightingPreset;
  onChangeLighting: (l: LightingPreset) => void;
  rendererDiagnostics: RendererDiagnostics;
  controllerSettings: ControllerCalibrationSettings;
  onUpdateControllerSettings: (
    partial: Partial<ControllerCalibrationSettings>,
  ) => void;
  onCalibrateWheelCenter: () => void;
  inputTelemetry: LiveInputTelemetry;
  sideConfig: SideDisplayConfig;
  onUpdateSideConfig: (partial: Partial<SideDisplayConfig>) => void;
  networkTelemetry: NetworkTelemetry;
  onReconnectNetwork: () => void;
  onTriggerTestStimulus: (side: 'left' | 'right') => void;
  webcamActive: boolean;
  onToggleWebcam: (enable: boolean) => void;
  onResetPoseCalibration: () => void;
  attention: AttentionSnapshot;
  audioSettings: AudioSettings;
  onUpdateAudioSettings: (partial: Partial<AudioSettings>) => void;
  accessibilitySettings: AccessibilitySettings;
  onUpdateAccessibilitySettings: (
    partial: Partial<AccessibilitySettings>,
  ) => void;
}

const TABS: Array<{ id: SettingsTabId; label: string }> = [
  { id: 'world', label: 'Map & Traffic' },
  { id: 'display', label: 'Graphics & View' },
  { id: 'controls', label: 'Controls & Wheel' },
  { id: 'sidedisplays', label: 'Side Displays' },
  { id: 'camera', label: 'Gaze & Webcam' },
  { id: 'audio', label: 'Audio' },
  { id: 'accessibility', label: 'Accessibility' },
];

export const SettingsModal: React.FC<SettingsModalProps> = ({
  initialTab = 'world',
  onClose,
  mapPreset,
  onChangeMap,
  trafficConfig,
  onUpdateTrafficConfig,
  cameraView,
  onChangeCameraView,
  qualityPreset,
  onChangeQuality,
  lightingPreset,
  onChangeLighting,
  rendererDiagnostics,
  controllerSettings,
  onUpdateControllerSettings,
  onCalibrateWheelCenter,
  inputTelemetry,
  sideConfig,
  onUpdateSideConfig,
  networkTelemetry,
  onReconnectNetwork,
  onTriggerTestStimulus,
  webcamActive,
  onToggleWebcam,
  onResetPoseCalibration,
  attention,
  audioSettings,
  onUpdateAudioSettings,
  accessibilitySettings,
  onUpdateAccessibilitySettings,
}) => {
  const [activeTab, setActiveTab] = useState<SettingsTabId>(initialTab);
  const [leftQrDataUrl, setLeftQrDataUrl] = useState<string>('');
  const [rightQrDataUrl, setRightQrDataUrl] = useState<string>('');

  const baseOrigin =
    networkTelemetry.lanUrls[0] ||
    networkTelemetry.appUrl ||
    (typeof window !== 'undefined'
      ? window.location.origin
      : 'http://localhost:3000');

  const leftDisplayUrl = `${baseOrigin}/?side=left&room=${encodeURIComponent(
    sideConfig.roomId,
  )}`;
  const rightDisplayUrl = `${baseOrigin}/?side=right&room=${encodeURIComponent(
    sideConfig.roomId,
  )}`;

  useEffect(() => {
    let mounted = true;
    QRCode.toDataURL(leftDisplayUrl, {
      width: 148,
      margin: 1,
      color: { dark: '#090d16', light: '#f8fafc' },
    })
      .then((url) => {
        if (mounted) setLeftQrDataUrl(url);
      })
      .catch(() => {});

    QRCode.toDataURL(rightDisplayUrl, {
      width: 148,
      margin: 1,
      color: { dark: '#090d16', light: '#f8fafc' },
    })
      .then((url) => {
        if (mounted) setRightQrDataUrl(url);
      })
      .catch(() => {});

    return () => {
      mounted = false;
    };
  }, [leftDisplayUrl, rightDisplayUrl]);

  const openSideUrl = (url: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.click();
  };

  const renderConnectionBadge = (
    side: 'left' | 'right',
    info: NetworkTelemetry['left'],
  ) => {
    const isConnected = info.status === 'connected';
    const isLagging = info.status === 'lagging';
    return (
      <div
        data-testid={`side-status-${side}`}
        className={`px-2.5 py-1 rounded-sm text-xs font-mono-tabular border ${
          isConnected
            ? 'bg-emerald-950/90 border-emerald-500/60 text-emerald-300'
            : isLagging
            ? 'bg-amber-950/90 border-amber-500/60 text-amber-300'
            : 'bg-slate-900 border-slate-700 text-slate-400'
        }`}
      >
        {isConnected
          ? `CONNECTED (${info.transport.toUpperCase()}${
              info.latencyMs !== null ? ` · ${info.latencyMs}ms` : ''
            })`
          : isLagging
          ? `LAGGING (${info.latencyMs ?? '>180'}ms)`
          : 'DISCONNECTED'}
      </div>
    );
  };

  return (
    <div
      role="dialog"
      aria-label="Simulator Settings"
      className="fixed inset-0 z-40 bg-[#060911]/90 flex items-center justify-center p-3 sm:p-6 overflow-y-auto"
    >
      <div className="w-full max-w-4xl bg-[#0a0f1d] border border-slate-700/90 rounded-sm shadow-2xl overflow-hidden my-auto flex flex-col max-h-[92vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 bg-[#060911]">
          <div>
            <div className="text-[10px] font-mono-tabular uppercase tracking-widest text-amber-400">
              SYSTEM TELEMETRY, ENVIRONMENT &amp; TRAFFIC CONTROL
            </div>
            <h2 className="text-xl font-display font-bold text-white uppercase tracking-wide">
              Simulator Configuration
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-sm bg-amber-500 hover:bg-amber-400 text-slate-950 font-display font-bold text-xs uppercase tracking-wider cursor-pointer whitespace-nowrap"
          >
            Apply &amp; Return
          </button>
        </div>

        {/* Navigation Tabs */}
        <div
          role="tablist"
          aria-label="Settings Categories"
          className="flex items-center gap-1 px-4 py-2 bg-slate-950 border-b border-slate-800 overflow-x-auto"
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={activeTab === t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-3.5 py-1.5 rounded-sm text-xs font-mono-tabular font-semibold uppercase tracking-wider transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === t.id
                  ? 'bg-amber-500 text-slate-950 font-bold'
                  : 'text-slate-300 hover:bg-slate-800/80'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab Body */}
        <div className="p-5 overflow-y-auto space-y-5 text-sm">
          {/* 0. MAP & TRAFFIC CONTROL */}
          {activeTab === 'world' && (
            <div className="space-y-5">
              {/* Highway Map / Biome Selector */}
              <div className="bg-slate-950 border border-slate-800 rounded-sm p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-mono-tabular uppercase text-amber-400 font-semibold">
                    HIGHWAY ROUTE &amp; 3D ENVIRONMENT MAP
                  </span>
                  <span className="text-xs font-mono-tabular text-slate-400">
                    Active: {MAP_PRESETS[mapPreset].label}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {(Object.keys(MAP_PRESETS) as MapPreset[]).map((m) => {
                    const preset = MAP_PRESETS[m];
                    const selected = mapPreset === m;
                    return (
                      <button
                        key={m}
                        type="button"
                        data-testid={`settings-map-${m}`}
                        onClick={() => onChangeMap(m)}
                        className={`p-3.5 rounded-sm border text-left cursor-pointer transition-colors ${
                          selected
                            ? 'bg-amber-500/15 border-amber-400 text-white'
                            : 'bg-slate-900/80 border-slate-800 text-slate-300 hover:border-slate-600'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-display font-bold text-sm uppercase tracking-wide">
                            {preset.label}
                          </span>
                          <span className="text-[10px] font-mono-tabular px-1.5 py-0.5 rounded-sm bg-slate-950 border border-slate-700 text-amber-300">
                            {preset.shortLabel}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 mt-1">
                          {preset.subtitle}
                        </p>
                        <div className="text-[10px] font-mono-tabular text-slate-500 mt-1.5">
                          Curve Intensity: {preset.curveScale.toFixed(2)}x ·
                          Elevation Grade: {preset.hillScale.toFixed(1)}x
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Traffic Density & AI Vehicle Control */}
              <div className="bg-slate-950 border border-slate-800 rounded-sm p-4 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-mono-tabular uppercase text-sky-400 font-semibold">
                      HIGHWAY TRAFFIC DENSITY &amp; AI FLOW CONTROL
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      Control the volume, speed, braking behavior, and roadwork
                      hazards on the highway
                    </div>
                  </div>
                  <span
                    data-testid="traffic-density-badge"
                    className="px-2.5 py-1 rounded-sm bg-slate-900 border border-slate-700 text-xs font-mono-tabular text-emerald-300"
                  >
                    {TRAFFIC_DENSITY_COUNTS[trafficConfig.density]} ACTIVE VEHICLES
                  </span>
                </div>

                {/* Density Buttons */}
                <div>
                  <div className="text-[11px] font-mono-tabular uppercase text-slate-400 mb-2">
                    TRAFFIC VOLUME DENSITY
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {(
                      [
                        { id: 'none', label: 'Off (Empty Road)', desc: '0 AI Vehicles' },
                        { id: 'light', label: 'Light Flow', desc: '10 AI Vehicles' },
                        { id: 'normal', label: 'Normal Highway', desc: '22 AI Vehicles' },
                        { id: 'heavy', label: 'Heavy Rush Hour', desc: '36 AI Vehicles' },
                      ] as Array<{
                        id: TrafficDensityPreset;
                        label: string;
                        desc: string;
                      }>
                    ).map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        data-testid={`traffic-density-${opt.id}`}
                        onClick={() =>
                          onUpdateTrafficConfig({ density: opt.id })
                        }
                        className={`p-2.5 rounded-sm border text-left cursor-pointer transition-colors ${
                          trafficConfig.density === opt.id
                            ? 'bg-sky-500/20 border-sky-400 text-white'
                            : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-600'
                        }`}
                      >
                        <div className="font-display font-bold text-xs uppercase">
                          {opt.label}
                        </div>
                        <div className="text-[10px] font-mono-tabular text-slate-400 mt-0.5">
                          {opt.desc}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Traffic Braking Behavior & Speed Multiplier */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-slate-800/80">
                  <div>
                    <div className="text-[11px] font-mono-tabular uppercase text-slate-400 mb-2">
                      EMERGENCY BRAKING FREQUENCY
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {(
                        [
                          { id: 'calm', label: 'Calm' },
                          { id: 'normal', label: 'Normal' },
                          { id: 'aggressive', label: 'Sudden Stops' },
                        ] as Array<{
                          id: TrafficAggressionPreset;
                          label: string;
                        }>
                      ).map((agg) => (
                        <button
                          key={agg.id}
                          type="button"
                          onClick={() =>
                            onUpdateTrafficConfig({ aggression: agg.id })
                          }
                          className={`py-2 px-2 rounded-sm text-xs font-semibold border cursor-pointer ${
                            trafficConfig.aggression === agg.id
                              ? 'bg-amber-500 text-slate-950 border-amber-400'
                              : 'bg-slate-900 text-slate-300 border-slate-800'
                          }`}
                        >
                          {agg.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex flex-col justify-between">
                    <label className="flex items-center justify-between gap-3 text-xs">
                      <span className="text-slate-300 font-mono-tabular">
                        TRAFFIC SPEED SCALE:{' '}
                        {Math.round(trafficConfig.speedMultiplier * 100)}%
                      </span>
                      <input
                        type="range"
                        min="0.6"
                        max="1.4"
                        step="0.1"
                        value={trafficConfig.speedMultiplier}
                        onChange={(e) =>
                          onUpdateTrafficConfig({
                            speedMultiplier: parseFloat(e.target.value),
                          })
                        }
                        className="w-36 accent-sky-400"
                      />
                    </label>

                    <label className="flex items-center justify-between gap-3 text-xs pt-2 cursor-pointer">
                      <span className="text-slate-300">
                        Include Work Zones &amp; Arrow Board Trucks
                      </span>
                      <input
                        type="checkbox"
                        checked={trafficConfig.allowWorkZones}
                        onChange={(e) =>
                          onUpdateTrafficConfig({
                            allowWorkZones: e.target.checked,
                          })
                        }
                        className="w-4 h-4 accent-amber-400"
                      />
                    </label>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 1. DISPLAY, CAMERA VIEW & GRAPHICS */}
          {activeTab === 'display' && (
            <div className="space-y-5">
              {/* Camera View Mode Selector */}
              <div className="bg-slate-950 border border-slate-800 rounded-sm p-4">
                <div className="text-xs font-mono-tabular uppercase text-amber-400 mb-2.5 font-semibold">
                  DRIVING CAMERA PERSPECTIVE (SHORTCUT: [C])
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  {(['cockpit', 'chase', 'hood'] as CameraViewMode[]).map(
                    (v) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => onChangeCameraView(v)}
                        className={`p-3 rounded-sm border text-left cursor-pointer transition-colors ${
                          cameraView === v
                            ? 'bg-amber-500/15 border-amber-400 text-white'
                            : 'bg-slate-900/80 border-slate-800 text-slate-300 hover:border-slate-600'
                        }`}
                      >
                        <div className="font-display font-bold text-sm uppercase">
                          {CAMERA_VIEW_MODES[v].label}
                        </div>
                        <div className="text-xs text-slate-400 mt-1">
                          {v === 'cockpit'
                            ? '3D interior dash, steering wheel & mirrors'
                            : v === 'chase'
                            ? '3rd-person view of GT widebody sports coupe'
                            : 'Low front hood sense-of-speed view'}
                        </div>
                      </button>
                    ),
                  )}
                </div>
              </div>

              {/* Renderer & Performance Diagnostics */}
              <div className="bg-slate-950 border border-slate-800 rounded-sm p-4">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <span className="text-xs font-mono-tabular uppercase text-sky-400 font-semibold">
                    RENDERER BACKEND &amp; PERFORMANCE STATUS
                  </span>
                  <span
                    data-testid="renderer-backend-status"
                    className="px-2.5 py-0.5 rounded-sm bg-slate-900 border border-slate-700 text-xs font-mono-tabular text-emerald-300"
                  >
                    {rendererDiagnostics.activeBackend} ·{' '}
                    {rendererDiagnostics.frameTimeMs}ms (
                    {rendererDiagnostics.fps} FPS)
                  </span>
                </div>
                <p className="text-xs text-slate-400">
                  {rendererDiagnostics.webgpuNote}
                </p>
              </div>

              {/* Graphics Quality Preset */}
              <div className="bg-slate-950 border border-slate-800 rounded-sm p-4">
                <div className="text-xs font-mono-tabular uppercase text-slate-400 mb-2.5">
                  GRAPHICS QUALITY PRESET
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  {(['low', 'balanced', 'high'] as QualityPreset[]).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => onChangeQuality(p)}
                      className={`p-3 rounded-sm border text-left cursor-pointer transition-colors ${
                        qualityPreset === p
                          ? 'bg-amber-500/15 border-amber-400 text-white'
                          : 'bg-slate-900/80 border-slate-800 text-slate-300 hover:border-slate-600'
                      }`}
                    >
                      <div className="font-display font-bold text-sm">
                        {QUALITY_PRESETS[p].label}
                      </div>
                      <div className="text-xs text-slate-400 mt-1 font-mono-tabular">
                        Max DPR: {QUALITY_PRESETS[p].maxPixelRatio}x · Draw:{' '}
                        {QUALITY_PRESETS[p].drawDistance}m
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Atmospheric Lighting Preset */}
              <div className="bg-slate-950 border border-slate-800 rounded-sm p-4">
                <div className="text-xs font-mono-tabular uppercase text-slate-400 mb-2.5">
                  ATMOSPHERIC LIGHTING &amp; TIME OF DAY
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  {(['day', 'dusk', 'night'] as LightingPreset[]).map((l) => (
                    <button
                      key={l}
                      type="button"
                      onClick={() => onChangeLighting(l)}
                      className={`p-3 rounded-sm border text-left cursor-pointer transition-colors ${
                        lightingPreset === l
                          ? 'bg-sky-500/15 border-sky-400 text-white'
                          : 'bg-slate-900/80 border-slate-800 text-slate-300 hover:border-slate-600'
                      }`}
                    >
                      <div className="font-display font-bold text-sm">
                        {LIGHTING_PRESETS[l].label}
                      </div>
                      <div className="text-xs text-slate-400 mt-1">
                        {LIGHTING_PRESETS[l].headlightsActive
                          ? 'Real-time SpotLight Headlamps Active'
                          : 'High Visibility Daylight'}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 2. CONTROLS & INPUT */}
          {activeTab === 'controls' && (
            <div className="space-y-4">
              <div className="bg-slate-950 border border-slate-800 rounded-sm p-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-mono-tabular uppercase text-sky-400 font-semibold">
                    DETECTED INPUT CAPABILITIES
                  </div>
                  <div className="text-xs text-slate-300 mt-1">
                    Active Input:{' '}
                    <strong className="text-white uppercase">
                      {inputTelemetry.activeSource}
                    </strong>{' '}
                    · Touch Support:{' '}
                    {inputTelemetry.capabilities.hasTouch ? 'Yes' : 'No'} · USB
                    Wheel/Gamepad:{' '}
                    {inputTelemetry.gamepadConnected ? 'Connected' : 'None'}
                  </div>
                </div>
                <span
                  className={`px-2.5 py-1 rounded-sm text-xs font-mono-tabular ${
                    inputTelemetry.steeringChangeDetected
                      ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/50'
                      : 'bg-amber-950 text-amber-300 border border-amber-500/50'
                  }`}
                >
                  {inputTelemetry.steeringChangeDetected
                    ? 'Steering Input Verified'
                    : 'Steer Left/Right to Verify'}
                </span>
              </div>

              <div className="bg-slate-950 border border-slate-800 rounded-sm p-4">
                <div className="text-xs font-mono-tabular uppercase text-slate-400 mb-2">
                  ON-SCREEN TOUCH CONTROLS (MOBILE &amp; TABLET)
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      { id: 'auto', label: 'Auto-Detect (Recommended)' },
                      { id: 'always', label: 'Always Show On-Screen' },
                      { id: 'hidden', label: 'Hide Touch Controls' },
                    ] as Array<{ id: TouchControlsMode; label: string }>
                  ).map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() =>
                        onUpdateAccessibilitySettings({
                          touchControlsMode: opt.id,
                        })
                      }
                      className={`py-2 px-3 rounded-sm text-xs font-semibold border cursor-pointer ${
                        accessibilitySettings.touchControlsMode === opt.id
                          ? 'bg-amber-500 text-slate-950 border-amber-400'
                          : 'bg-slate-900 text-slate-300 border-slate-800'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="bg-slate-950 border border-slate-800 rounded-sm p-4 space-y-3">
                <div className="text-xs font-mono-tabular uppercase text-slate-400">
                  STEERING SENSITIVITY, DEAD ZONE &amp; USB WHEEL CALIBRATION
                </div>
                <div className="text-xs text-slate-400">
                  Controller: {inputTelemetry.gamepadName}
                </div>

                {inputTelemetry.rawAxes.length > 0 && (
                  <div className="flex flex-wrap gap-2 text-xs font-mono-tabular">
                    {inputTelemetry.rawAxes.map((v, i) => (
                      <span
                        key={i}
                        className="px-2 py-0.5 rounded-sm bg-slate-900 border border-slate-700 text-slate-300"
                      >
                        Axis {i}: {v.toFixed(2)}
                      </span>
                    ))}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                  <label className="flex items-center justify-between gap-3 text-xs">
                    <span className="text-slate-300">
                      Steering Dead Zone:{' '}
                      {Math.round(controllerSettings.deadzone * 100)}%
                    </span>
                    <input
                      type="range"
                      min="0"
                      max="0.35"
                      step="0.01"
                      value={controllerSettings.deadzone}
                      onChange={(e) =>
                        onUpdateControllerSettings({
                          deadzone: parseFloat(e.target.value),
                        })
                      }
                      className="w-36 accent-sky-400"
                    />
                  </label>

                  <label className="flex items-center justify-between gap-3 text-xs">
                    <span className="text-slate-300">
                      Steering Sensitivity:{' '}
                      {controllerSettings.sensitivity.toFixed(1)}x
                    </span>
                    <input
                      type="range"
                      min="0.5"
                      max="2.0"
                      step="0.1"
                      value={controllerSettings.sensitivity}
                      onChange={(e) =>
                        onUpdateControllerSettings({
                          sensitivity: parseFloat(e.target.value),
                        })
                      }
                      className="w-36 accent-sky-400"
                    />
                  </label>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800/80">
                  <button
                    type="button"
                    onClick={onCalibrateWheelCenter}
                    className="px-3 py-1.5 rounded-sm bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 cursor-pointer"
                  >
                    Calibrate Current Wheel Center
                  </button>

                  <div className="flex items-center gap-4 text-xs">
                    <label className="flex items-center gap-1.5 cursor-pointer text-slate-300">
                      <input
                        type="checkbox"
                        checked={controllerSettings.invertSteer}
                        onChange={(e) =>
                          onUpdateControllerSettings({
                            invertSteer: e.target.checked,
                          })
                        }
                      />
                      <span>Invert Steering Axis</span>
                    </label>
                    <label className="flex items-center gap-1.5 cursor-pointer text-slate-300">
                      <input
                        type="checkbox"
                        checked={controllerSettings.invertPedals}
                        onChange={(e) =>
                          onUpdateControllerSettings({
                            invertPedals: e.target.checked,
                          })
                        }
                      />
                      <span>Invert Pedal Axes</span>
                    </label>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 3. SIDE DISPLAYS & REMOTE QR CONNECTION */}
          {activeTab === 'sidedisplays' && (
            <div className="space-y-4">
              <div className="bg-slate-950 border border-slate-800 rounded-sm p-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-mono-tabular uppercase text-amber-400 font-semibold">
                    LOW-LATENCY SIDE-DISPLAY SYNCHRONIZATION
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    WebRTC DataChannel + Local WebSocket Relay (
                    {networkTelemetry.relayConnected
                      ? 'Relay Online'
                      : 'Local Broadcast Fallback'}
                    ) · Room:{' '}
                    <span className="font-mono-tabular text-slate-200">
                      {sideConfig.roomId}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer mr-2">
                    <input
                      type="checkbox"
                      checked={sideConfig.showEdgePreviews}
                      onChange={(e) =>
                        onUpdateSideConfig({
                          showEdgePreviews: e.target.checked,
                        })
                      }
                    />
                    <span>Show In-Game Edge Previews</span>
                  </label>
                  <button
                    type="button"
                    onClick={onReconnectNetwork}
                    className="px-3 py-1.5 rounded-sm bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-xs cursor-pointer whitespace-nowrap"
                  >
                    Reconnect &amp; Sync Now
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-slate-950 border border-slate-800 rounded-sm p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-display font-bold text-base text-white">
                      Left Distraction Display
                    </span>
                    {renderConnectionBadge('left', networkTelemetry.left)}
                  </div>

                  <div className="flex items-center gap-3">
                    {leftQrDataUrl && (
                      <img
                        src={leftQrDataUrl}
                        alt="QR Code for Left Side Display"
                        referrerPolicy="no-referrer"
                        className="w-24 h-24 rounded-sm border border-slate-700 shrink-0"
                      />
                    )}
                    <div className="space-y-1.5 min-w-0 flex-1">
                      <div className="text-[11px] text-slate-400">
                        Left Display URL (Scan or Open):
                      </div>
                      <input
                        type="text"
                        readOnly
                        aria-label="Left Display URL"
                        value={leftDisplayUrl}
                        className="w-full px-2 py-1 rounded-sm bg-slate-900 border border-slate-800 text-[11px] font-mono-tabular text-slate-200"
                      />
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => openSideUrl(leftDisplayUrl)}
                          className="px-2.5 py-1 rounded-sm bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 cursor-pointer"
                        >
                          Open Left Window
                        </button>
                        <button
                          type="button"
                          onClick={() => onTriggerTestStimulus('left')}
                          className="px-2.5 py-1 rounded-sm bg-amber-500/20 border border-amber-500/50 text-amber-300 text-xs font-semibold cursor-pointer"
                        >
                          Test Left Pulse
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800/80 text-xs">
                    <label className="block">
                      <span className="text-slate-400 block mb-1">
                        Stimulus Pattern:
                      </span>
                      <select
                        aria-label="Left Display Pattern"
                        value={sideConfig.leftPattern}
                        onChange={(e) =>
                          onUpdateSideConfig({
                            leftPattern: e.target.value as SidePatternType,
                          })
                        }
                        className="w-full px-2 py-1.5 rounded-sm bg-slate-900 border border-slate-700 text-slate-200"
                      >
                        <option value="chevron">Chevron Pulse</option>
                        <option value="rings">Radial Rings</option>
                        <option value="matrix">Optic Matrix</option>
                        <option value="wave">Sine Wave</option>
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-slate-400 block mb-1">
                        Intensity:
                      </span>
                      <select
                        aria-label="Left Display Intensity"
                        value={sideConfig.leftIntensity}
                        onChange={(e) =>
                          onUpdateSideConfig({
                            leftIntensity: e.target
                              .value as StimulusIntensityLevel,
                          })
                        }
                        className="w-full px-2 py-1.5 rounded-sm bg-slate-900 border border-slate-700 text-slate-200"
                      >
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                      </select>
                    </label>
                  </div>
                </div>

                <div className="bg-slate-950 border border-slate-800 rounded-sm p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-display font-bold text-base text-white">
                      Right Distraction Display
                    </span>
                    {renderConnectionBadge('right', networkTelemetry.right)}
                  </div>

                  <div className="flex items-center gap-3">
                    {rightQrDataUrl && (
                      <img
                        src={rightQrDataUrl}
                        alt="QR Code for Right Side Display"
                        referrerPolicy="no-referrer"
                        className="w-24 h-24 rounded-sm border border-slate-700 shrink-0"
                      />
                    )}
                    <div className="space-y-1.5 min-w-0 flex-1">
                      <div className="text-[11px] text-slate-400">
                        Right Display URL (Scan or Open):
                      </div>
                      <input
                        type="text"
                        readOnly
                        aria-label="Right Display URL"
                        value={rightDisplayUrl}
                        className="w-full px-2 py-1 rounded-sm bg-slate-900 border border-slate-800 text-[11px] font-mono-tabular text-slate-200"
                      />
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => openSideUrl(rightDisplayUrl)}
                          className="px-2.5 py-1 rounded-sm bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 cursor-pointer"
                        >
                          Open Right Window
                        </button>
                        <button
                          type="button"
                          onClick={() => onTriggerTestStimulus('right')}
                          className="px-2.5 py-1 rounded-sm bg-sky-500/20 border border-sky-500/50 text-sky-300 text-xs font-semibold cursor-pointer"
                        >
                          Test Right Pulse
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800/80 text-xs">
                    <label className="block">
                      <span className="text-slate-400 block mb-1">
                        Stimulus Pattern:
                      </span>
                      <select
                        aria-label="Right Display Pattern"
                        value={sideConfig.rightPattern}
                        onChange={(e) =>
                          onUpdateSideConfig({
                            rightPattern: e.target.value as SidePatternType,
                          })
                        }
                        className="w-full px-2 py-1.5 rounded-sm bg-slate-900 border border-slate-700 text-slate-200"
                      >
                        <option value="rings">Radial Rings</option>
                        <option value="chevron">Chevron Pulse</option>
                        <option value="matrix">Optic Matrix</option>
                        <option value="wave">Sine Wave</option>
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-slate-400 block mb-1">
                        Intensity:
                      </span>
                      <select
                        aria-label="Right Display Intensity"
                        value={sideConfig.rightIntensity}
                        onChange={(e) =>
                          onUpdateSideConfig({
                            rightIntensity: e.target
                              .value as StimulusIntensityLevel,
                          })
                        }
                        className="w-full px-2 py-1.5 rounded-sm bg-slate-900 border border-slate-700 text-slate-200"
                      >
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                      </select>
                    </label>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 4. CAMERA & ATTENTION MONITORING */}
          {activeTab === 'camera' && (
            <div className="bg-slate-950 border border-slate-800 rounded-sm p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-mono-tabular uppercase text-amber-400 font-semibold">
                    DRIVER ATTENTION &amp; HEAD-POSE MONITORING
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    Current State:{' '}
                    <strong className="text-white">{attention.state}</strong> ·
                    Estimated Head Pose: Yaw {attention.yawDeg.toFixed(0)}° /
                    Pitch {attention.pitchDeg.toFixed(0)}°
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => onToggleWebcam(false)}
                    className={`px-3 py-1.5 rounded-sm text-xs font-semibold cursor-pointer ${
                      !webcamActive
                        ? 'bg-amber-500 text-slate-950'
                        : 'bg-slate-900 text-slate-300 border border-slate-700'
                    }`}
                  >
                    Simulated Gaze Mode
                  </button>
                  <button
                    type="button"
                    onClick={() => onToggleWebcam(true)}
                    className={`px-3 py-1.5 rounded-sm text-xs font-semibold cursor-pointer ${
                      webcamActive
                        ? 'bg-emerald-500 text-slate-950'
                        : 'bg-slate-900 text-slate-300 border border-slate-700'
                    }`}
                  >
                    Enable Local Webcam
                  </button>
                </div>
              </div>

              <div className="text-xs text-slate-300 bg-slate-900/90 border border-slate-800 rounded-sm p-3">
                {attention.statusMessage}
              </div>

              {webcamActive && (
                <button
                  type="button"
                  onClick={onResetPoseCalibration}
                  className="px-4 py-2 rounded-sm bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-xs cursor-pointer"
                >
                  Calibrate Neutral Forward Pose Now
                </button>
              )}
            </div>
          )}

          {/* 5. AUDIO */}
          {activeTab === 'audio' && (
            <div className="bg-slate-950 border border-slate-800 rounded-sm p-4 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono-tabular uppercase text-slate-400">
                  PROCEDURAL WEB AUDIO SYNTHESIZER MIXER
                </span>
                <button
                  type="button"
                  onClick={() =>
                    onUpdateAudioSettings({ muted: !audioSettings.muted })
                  }
                  className={`px-3 py-1 rounded-sm text-xs font-semibold cursor-pointer ${
                    audioSettings.muted
                      ? 'bg-rose-600 text-white'
                      : 'bg-emerald-500 text-slate-950'
                  }`}
                >
                  {audioSettings.muted ? 'Audio Muted' : 'Audio Active'}
                </button>
              </div>

              <div className="space-y-3 text-xs">
                <label className="flex items-center justify-between gap-4">
                  <span className="text-slate-300">
                    Engine RPM Synthesizer Volume:{' '}
                    {Math.round(audioSettings.engineVolume * 100)}%
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={audioSettings.engineVolume}
                    onChange={(e) =>
                      onUpdateAudioSettings({
                        engineVolume: parseFloat(e.target.value),
                      })
                    }
                    className="w-48 accent-amber-400"
                  />
                </label>

                <label className="flex items-center justify-between gap-4">
                  <span className="text-slate-300">
                    Road Rumble &amp; Collision Volume:{' '}
                    {Math.round(audioSettings.roadVolume * 100)}%
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={audioSettings.roadVolume}
                    onChange={(e) =>
                      onUpdateAudioSettings({
                        roadVolume: parseFloat(e.target.value),
                      })
                    }
                    className="w-48 accent-amber-400"
                  />
                </label>

                <label className="flex items-center justify-between gap-4">
                  <span className="text-slate-300">
                    Distraction &amp; Safety Alert Volume:{' '}
                    {Math.round(audioSettings.alertVolume * 100)}%
                  </span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={audioSettings.alertVolume}
                    onChange={(e) =>
                      onUpdateAudioSettings({
                        alertVolume: parseFloat(e.target.value),
                      })
                    }
                    className="w-48 accent-amber-400"
                  />
                </label>
              </div>
            </div>
          )}

          {/* 6. ACCESSIBILITY */}
          {activeTab === 'accessibility' && (
            <div className="bg-slate-950 border border-slate-800 rounded-sm p-4 space-y-3 text-xs">
              <div className="text-xs font-mono-tabular uppercase text-slate-400 mb-1">
                VISUAL &amp; MOTION ACCESSIBILITY
              </div>

              <label className="flex items-center justify-between py-2 border-b border-slate-800/80 cursor-pointer">
                <div>
                  <div className="font-semibold text-white">
                    High-Contrast Instrument HUD
                  </div>
                  <div className="text-slate-400">
                    Increases border luminance and readout contrast on all HUD
                    gauges
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={accessibilitySettings.highContrastHud}
                  onChange={(e) =>
                    onUpdateAccessibilitySettings({
                      highContrastHud: e.target.checked,
                    })
                  }
                  className="w-4 h-4 accent-amber-400"
                />
              </label>

              <label className="flex items-center justify-between py-2 border-b border-slate-800/80 cursor-pointer">
                <div>
                  <div className="font-semibold text-white">
                    Reduced Camera Motion &amp; Tilt
                  </div>
                  <div className="text-slate-400">
                    Suppresses pitch squat/dive, body roll, and rumble-strip
                    vibration
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={accessibilitySettings.reducedMotion}
                  onChange={(e) =>
                    onUpdateAccessibilitySettings({
                      reducedMotion: e.target.checked,
                    })
                  }
                  className="w-4 h-4 accent-amber-400"
                />
              </label>

              <label className="flex items-center justify-between py-2 cursor-pointer">
                <div>
                  <div className="font-semibold text-white">
                    Colorblind-Safe Hazard &amp; Status Markers
                  </div>
                  <div className="text-slate-400">
                    Pairs all status colors with explicit text badges and distinct
                    iconography
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={accessibilitySettings.colorblindSafeMarkers}
                  onChange={(e) =>
                    onUpdateAccessibilitySettings({
                      colorblindSafeMarkers: e.target.checked,
                    })
                  }
                  className="w-4 h-4 accent-amber-400"
                />
              </label>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
