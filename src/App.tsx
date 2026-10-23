import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  CAMERA_VIEW_MODES,
  DEFAULT_ACCESSIBILITY_SETTINGS,
  DEFAULT_AUDIO_SETTINGS,
  DEFAULT_SIDE_DISPLAY_CONFIG,
  DEFAULT_TRAFFIC_CONFIG,
  EXPERIMENT_CONFIG,
  MAP_PRESETS,
  ROAD_CONFIG,
  TRAFFIC_DENSITY_COUNTS,
} from './config.ts';
import type {
  AccessibilitySettings,
  AppMode,
  AttentionState,
  AudioSettings,
  CameraViewMode,
  GameState,
  LightingPreset,
  MapPreset,
  QualityPreset,
  SideDisplayConfig,
  TrafficConfig,
  TrafficDensityPreset,
} from './config.ts';
import { generateInitialHazards } from './road.ts';
import type { RoadHazard } from './road.ts';
import {
  createInitialVehicleState,
  stepVehicleSimulation,
} from './vehicle.ts';
import type { VehicleState } from './vehicle.ts';
import {
  DEFAULT_CONTROLLER_SETTINGS,
  InputAdapter,
} from './controls.ts';
import type {
  ControllerCalibrationSettings,
  LiveInputTelemetry,
} from './controls.ts';
import { AttentionMonitor } from './attention-monitor.ts';
import type { AttentionSnapshot } from './attention-monitor.ts';
import { ExperimentManager } from './experiment.ts';
import type { SideStimulusState, TrialSummary } from './experiment.ts';
import { WebcamHeadTracker } from './webcam-tracker.ts';
import { SoundEngine } from './audio.ts';
import { DrivingSceneRenderer } from './scene.ts';
import type { RendererDiagnostics } from './scene.ts';
import { SideDisplayNetworkManager } from './network.ts';
import type {
  NetworkTelemetry,
  SynchronizedStimulusPayload,
} from './network.ts';
import { SidePatternVisual } from './components/SidePatternCanvas.tsx';
import { TouchControlsOverlay } from './components/TouchControlsOverlay.tsx';
import { SettingsModal } from './components/SettingsModal.tsx';
import type { SettingsTabId } from './components/SettingsModal.tsx';
import { AutomotiveHud } from './components/AutomotiveHud.tsx';

const REFERENCE_BASELINE_SUMMARY: TrialSummary = {
  trialType: 'baseline',
  durationSec: 45.0,
  distanceMeters: 890,
  avgSpeedKmh: 72,
  meanLaneDeviationMeters: 0.24,
  maxLaneDeviationMeters: 0.68,
  outOfLanePercent: 3,
  collisionsCount: 0,
  guardrailHitsCount: 0,
  nearMissesCount: 1,
  distractionEventsCount: 0,
  totalDistractedTimeSec: 0,
  avgLaneRecoveryTimeMs: null,
  sideStimulusEventsCount: 0,
  events: [],
};

interface InterfaceHudSnapshot {
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
  collisionsCount: number;
  nearMissesCount: number;
  distractionCount: number;
  stimulus: SideStimulusState;
  inputTelemetry: LiveInputTelemetry;
  rendererDiagnostics: RendererDiagnostics;
  upcomingHazards: Array<{
    s: number;
    laneIndex: number;
    speed: number;
    type: string;
  }>;
}

function SideDisplayCompanionView({
  side,
  roomId,
}: {
  side: 'left' | 'right';
  roomId: string;
}) {
  const [payload, setPayload] = useState<SynchronizedStimulusPayload>({
    leftActive: false,
    rightActive: false,
    leftPattern: 'chevron',
    rightPattern: 'rings',
    leftIntensity: 'medium',
    rightIntensity: 'medium',
    leftColor: '#f59e0b',
    rightColor: '#06b6d4',
    symbolLabel: 'STANDBY',
    eventId: 0,
    authoritativeTimeMs: Date.now(),
  });

  const [netTelemetry, setNetTelemetry] = useState<NetworkTelemetry>({
    relayConnected: false,
    roomId,
    lanUrls: [],
    appUrl: null,
    left: { status: 'disconnected', latencyMs: null, transport: 'none', count: 0 },
    right: { status: 'disconnected', latencyMs: null, transport: 'none', count: 0 },
  });

  const netRef = useRef<SideDisplayNetworkManager | null>(null);

  useEffect(() => {
    const mgr = new SideDisplayNetworkManager(
      side,
      roomId,
      (incoming) => setPayload(incoming),
      (tel) => setNetTelemetry(tel),
    );
    netRef.current = mgr;
    return () => mgr.dispose();
  }, [side, roomId]);

  const isActive = side === 'left' ? payload.leftActive : payload.rightActive;
  const pattern = side === 'left' ? payload.leftPattern : payload.rightPattern;
  const intensity =
    side === 'left' ? payload.leftIntensity : payload.rightIntensity;
  const colorHex = side === 'left' ? payload.leftColor : payload.rightColor;

  return (
    <main className="w-screen h-screen bg-[#060911] text-slate-100 flex flex-col items-center justify-between p-5 sm:p-8 select-none overflow-hidden">
      <div className="w-full flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/90 pb-3.5">
        <div>
          <div className="text-[11px] font-mono-tabular uppercase tracking-widest text-amber-400">
            DISTRACT · PERIPHERAL STIMULUS DISPLAY ({side.toUpperCase()}) · ROOM:{' '}
            {roomId}
          </div>
          <h1 className="text-lg sm:text-xl font-display font-bold text-white mt-0.5 uppercase">
            Synchronized Visual Attractor
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`px-2.5 py-1 rounded-sm text-xs font-mono-tabular border ${
              netTelemetry.relayConnected
                ? 'bg-emerald-950/90 border-emerald-500/60 text-emerald-300'
                : 'bg-amber-950/90 border-amber-500/60 text-amber-300'
            }`}
          >
            {netTelemetry.relayConnected ? 'SYNCED' : 'LOCAL STANDBY'}
          </span>

          <button
            type="button"
            onClick={() => netRef.current?.reconnect()}
            className="px-3 py-1.5 rounded-sm bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 border border-slate-700 cursor-pointer"
          >
            Reconnect
          </button>

          <button
            type="button"
            onClick={() =>
              setPayload((prev) => ({
                ...prev,
                leftActive: side === 'left' ? !prev.leftActive : prev.leftActive,
                rightActive:
                  side === 'right' ? !prev.rightActive : prev.rightActive,
                symbolLabel: isActive ? 'STANDBY' : 'MANUAL TEST PULSE',
              }))
            }
            className="px-3.5 py-1.5 rounded-sm bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-display font-bold cursor-pointer"
          >
            {isActive ? 'Stop Test Stimulus' : 'Trigger Test Stimulus'}
          </button>
        </div>
      </div>

      <div className="flex-1 w-full flex flex-col items-center justify-center relative">
        <SidePatternVisual
          active={isActive}
          pattern={pattern}
          intensity={intensity}
          colorHex={colorHex}
        />
        {isActive ? (
          <p className="mt-4 font-display text-2xl font-bold tracking-wider text-amber-300">
            {payload.symbolLabel}
          </p>
        ) : (
          <p className="mt-3 text-xs sm:text-sm text-slate-400 max-w-md text-center">
            Waiting for synchronized distraction stimulus event from the main
            driving simulator.
          </p>
        )}
      </div>

      <div className="w-full text-center text-xs text-slate-500 border-t border-slate-800/90 pt-3">
        Position this screen to the {side} of the driver. Pattern:{' '}
        <span className="text-slate-300 uppercase font-mono-tabular">
          {pattern}
        </span>{' '}
        · Intensity:{' '}
        <span className="text-slate-300 uppercase font-mono-tabular">
          {intensity}
        </span>
      </div>
    </main>
  );
}

export default function App() {
  const searchParams =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search)
      : new URLSearchParams();
  const sideParam = searchParams.get('side');
  const roomParam = searchParams.get('room') || 'exhibition';
  const autostartParam = searchParams.get('autostart') === '1';

  if (sideParam === 'left' || sideParam === 'right') {
    return <SideDisplayCompanionView side={sideParam} roomId={roomParam} />;
  }

  return <MainSimulatorApp autostart={autostartParam} initialRoom={roomParam} />;
}

function MainSimulatorApp({
  autostart,
  initialRoom,
}: {
  autostart: boolean;
  initialRoom: string;
}) {
  const canvasMountRef = useRef<HTMLDivElement | null>(null);

  const [gameState, setGameState] = useState<GameState>(
    autostart ? 'playing' : 'title',
  );
  const [appMode, setAppMode] = useState<AppMode>('experiment');
  const [trialType, setTrialType] = useState<'baseline' | 'distracted'>(
    'distracted',
  );
  const [mapPreset, setMapPreset] = useState<MapPreset>('alpine');
  const [cameraView, setCameraView] = useState<CameraViewMode>('cockpit');
  const [trafficConfig, setTrafficConfig] = useState<TrafficConfig>(
    DEFAULT_TRAFFIC_CONFIG,
  );
  const [qualityPreset, setQualityPreset] =
    useState<QualityPreset>('balanced');
  const [lightingPreset, setLightingPreset] =
    useState<LightingPreset>('dusk');

  const [showSettingsModal, setShowSettingsModal] = useState<boolean>(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTabId>('world');
  const [leftPreviewCollapsed, setLeftPreviewCollapsed] =
    useState<boolean>(false);
  const [rightPreviewCollapsed, setRightPreviewCollapsed] =
    useState<boolean>(false);

  const [controllerSettings, setControllerSettings] =
    useState<ControllerCalibrationSettings>(DEFAULT_CONTROLLER_SETTINGS);
  const [sideConfig, setSideConfig] = useState<SideDisplayConfig>({
    ...DEFAULT_SIDE_DISPLAY_CONFIG,
    roomId: initialRoom,
  });
  const [audioSettings, setAudioSettings] = useState<AudioSettings>(
    DEFAULT_AUDIO_SETTINGS,
  );
  const [accessibilitySettings, setAccessibilitySettings] =
    useState<AccessibilitySettings>(DEFAULT_ACCESSIBILITY_SETTINGS);
  const [webcamActive, setWebcamActive] = useState<boolean>(false);

  const [networkTelemetry, setNetworkTelemetry] = useState<NetworkTelemetry>({
    relayConnected: false,
    roomId: initialRoom,
    lanUrls: [],
    appUrl: null,
    left: { status: 'disconnected', latencyMs: null, transport: 'none', count: 0 },
    right: { status: 'disconnected', latencyMs: null, transport: 'none', count: 0 },
  });

  const [completedSummary, setCompletedSummary] =
    useState<TrialSummary | null>(null);
  const [savedComparison, setSavedComparison] = useState<{
    baseline: TrialSummary | null;
    distracted: TrialSummary | null;
  }>({ baseline: null, distracted: null });
  const [isSimulatedClosed, setIsSimulatedClosed] = useState(false);

  const [hud, setHud] = useState<InterfaceHudSnapshot>(() => ({
    speedKmh: 76,
    gear: 3,
    rpmNormalized: 0.42,
    lateralAccelG: 0,
    longitudinalAccelG: 0,
    distanceMeters: 0,
    laneDeviationMeters: 0,
    lateralOffset: ROAD_CONFIG.playerDefaultLaneOffset,
    isOutOfLane: false,
    isOnShoulder: false,
    attention: {
      state: 'ATTENTIVE',
      mode: 'simulated',
      eyesClosed: false,
      eyeOpenness: 1.0,
      closureDurationMs: 0,
      closureDurationSec: 0,
      thresholdSec: 5.0,
      emergencySlowdownActive: false,
      yawDeg: 0,
      pitchDeg: 0,
      calibratedYawOffset: 0,
      calibratedPitchOffset: 0,
      confidence: 1,
      sustainedDeviationMs: 0,
      calibrationProgress: 1,
      statusMessage: 'Simulated DMS active',
    },
    trialElapsedSec: 0,
    trialType: 'distracted',
    collisionsCount: 0,
    nearMissesCount: 0,
    distractionCount: 0,
    stimulus: {
      activeSide: 'none',
      patternIndex: 0,
      leftPattern: 'chevron',
      rightPattern: 'rings',
      leftIntensity: 'medium',
      rightIntensity: 'medium',
      colorHex: '#f59e0b',
      symbolLabel: 'STANDBY',
      intensity: 0,
      eventId: 0,
    },
    inputTelemetry: {
      activeSource: 'keyboard',
      gamepadConnected: false,
      gamepadName: 'Keyboard (WASD / Arrows)',
      rawAxes: [],
      normalizedSteer: 0,
      normalizedThrottle: 0,
      normalizedBrake: 0,
      simulatingLookAwayLeft: false,
      simulatingLookAwayRight: false,
      steeringChangeDetected: false,
      capabilities: {
        hasTouch: false,
        hasCoarsePointer: false,
        hasKeyboard: true,
        hasGamepad: false,
        recommendedTouchControls: false,
      },
    },
    rendererDiagnostics: {
      activeBackend: 'WebGL 2',
      webgpuSupported: false,
      webgpuNote: 'WebGL 2 active',
      frameTimeMs: 16.6,
      fps: 60,
      qualityPreset: 'balanced',
      lightingPreset: 'dusk',
      mapPreset: 'alpine',
      cameraView: 'cockpit',
    },
    upcomingHazards: [],
  }));

  // Mutable simulation refs
  const gameStateRef = useRef<GameState>(autostart ? 'playing' : 'title');
  const appModeRef = useRef<AppMode>('experiment');
  const trialTypeRef = useRef<'baseline' | 'distracted'>('distracted');
  const mapPresetRef = useRef<MapPreset>('alpine');
  const cameraViewRef = useRef<CameraViewMode>('cockpit');
  const trafficConfigRef = useRef<TrafficConfig>(DEFAULT_TRAFFIC_CONFIG);
  const accessibilityRef = useRef<AccessibilitySettings>(
    DEFAULT_ACCESSIBILITY_SETTINGS,
  );
  const vehicleRef = useRef<VehicleState>(createInitialVehicleState());
  const hazardsRef = useRef<RoadHazard[]>(
    generateInitialHazards(1042, undefined, DEFAULT_TRAFFIC_CONFIG),
  );
  const inputAdapterRef = useRef<InputAdapter | null>(null);
  const attentionMonitorRef = useRef<AttentionMonitor>(
    new AttentionMonitor('simulated'),
  );
  const webcamTrackerRef = useRef<WebcamHeadTracker>(new WebcamHeadTracker());
  const experimentRef = useRef<ExperimentManager>(new ExperimentManager());
  const soundRef = useRef<SoundEngine>(new SoundEngine());
  const sceneRendererRef = useRef<DrivingSceneRenderer | null>(null);
  const networkRef = useRef<SideDisplayNetworkManager | null>(null);

  useEffect(() => {
    gameStateRef.current = gameState;
    document.body.dataset.state = gameState;
  }, [gameState]);

  useEffect(() => {
    appModeRef.current = appMode;
  }, [appMode]);

  useEffect(() => {
    trialTypeRef.current = trialType;
  }, [trialType]);

  useEffect(() => {
    accessibilityRef.current = accessibilitySettings;
  }, [accessibilitySettings]);

  const openSettingsOnTab = useCallback((tab: SettingsTabId) => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    setSettingsTab(tab);
    setShowSettingsModal(true);
  }, []);

  const handleCycleCameraView = useCallback(() => {
    const order: CameraViewMode[] = ['cockpit', 'chase', 'hood'];
    const nextIdx = (order.indexOf(cameraViewRef.current) + 1) % order.length;
    const nextView = order[nextIdx];
    cameraViewRef.current = nextView;
    setCameraView(nextView);
    sceneRendererRef.current?.setCameraView(nextView);
  }, []);

  const handleChangeCameraView = useCallback((view: CameraViewMode) => {
    cameraViewRef.current = view;
    setCameraView(view);
    sceneRendererRef.current?.setCameraView(view);
  }, []);

  const handleMapChange = useCallback((preset: MapPreset) => {
    mapPresetRef.current = preset;
    setMapPreset(preset);
    const recommendedLighting = MAP_PRESETS[preset].defaultLighting;
    setLightingPreset(recommendedLighting);
    sceneRendererRef.current?.applyMapPreset(preset);
  }, []);

  const handleUpdateTrafficConfig = useCallback(
    (partial: Partial<TrafficConfig>) => {
      const updated: TrafficConfig = {
        ...trafficConfigRef.current,
        ...partial,
      };
      trafficConfigRef.current = updated;
      setTrafficConfig(updated);
      // Regenerate active hazards positioned ahead of current vehicle s
      const baseSeed = trialTypeRef.current === 'baseline' ? 1042 : 2084;
      const freshHazards = generateInitialHazards(baseSeed, undefined, updated);
      const currentS = vehicleRef.current.s;
      for (const h of freshHazards) {
        h.s += currentS;
      }
      hazardsRef.current = freshHazards;
    },
    [],
  );

  const startDrivingSession = useCallback(
    (selectedMode: AppMode, selectedTrialType: 'baseline' | 'distracted') => {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      setAppMode(selectedMode);
      appModeRef.current = selectedMode;
      setTrialType(selectedTrialType);
      trialTypeRef.current = selectedTrialType;

      vehicleRef.current = createInitialVehicleState();
      hazardsRef.current = generateInitialHazards(
        selectedTrialType === 'baseline' ? 1042 : 2084,
        undefined,
        trafficConfigRef.current,
      );
      inputAdapterRef.current?.clearHeldKeys();
      experimentRef.current.startRun(selectedTrialType);

      if (selectedMode === 'calibration') {
        setSettingsTab('controls');
        setShowSettingsModal(true);
      } else {
        setShowSettingsModal(false);
      }

      setGameState('playing');
      document.body.dataset.state = 'playing';
    },
    [],
  );

  const finishCurrentTrialAndShowResults = useCallback(() => {
    const finalSummary = experimentRef.current.finalizeCurrentRun(
      vehicleRef.current.s,
    );
    setCompletedSummary(finalSummary);
    setSavedComparison(experimentRef.current.getSavedComparison());
    inputAdapterRef.current?.clearHeldKeys();
    setShowSettingsModal(false);
    setGameState('gameover');
    document.body.dataset.state = 'gameover';
  }, []);

  const handleRestartRun = useCallback(() => {
    startDrivingSession(appModeRef.current, trialTypeRef.current);
  }, [startDrivingSession]);

  const handleToggleSimulatedEyes = useCallback(() => {
    const next = webcamTrackerRef.current.toggleSimulatedEyesClosed();
    setIsSimulatedClosed(next);
  }, []);

  useEffect(() => {
    const mountEl = canvasMountRef.current;
    if (!mountEl) return;

    const inputAdapter = new InputAdapter();
    inputAdapterRef.current = inputAdapter;

    const renderer = new DrivingSceneRenderer(
      mountEl,
      'balanced',
      'dusk',
      mapPresetRef.current,
    );
    renderer.setCameraView(cameraViewRef.current);
    sceneRendererRef.current = renderer;

    const netMgr = new SideDisplayNetworkManager(
      'main',
      initialRoom,
      undefined,
      (tel) => setNetworkTelemetry(tel),
    );
    networkRef.current = netMgr;

    experimentRef.current.setOnStimulusBroadcast((payload) => {
      netMgr.broadcastStimulus(payload);
    });
    experimentRef.current.startRun(trialTypeRef.current);

    let animFrameId = 0;
    let lastTimeMs = performance.now();
    let lastHudSyncMs = 0;

    const loop = (nowMs: number) => {
      animFrameId = requestAnimationFrame(loop);

      const rawDt = (nowMs - lastTimeMs) / 1000;
      lastTimeMs = nowMs;
      const dt = Math.min(Math.max(rawDt, 0.001), 0.05);
      const timeSec = nowMs / 1000;

      if (gameStateRef.current === 'title') {
        if (
          inputAdapter.consumeJustPressed('Enter') ||
          inputAdapter.consumeJustPressed('Space')
        ) {
          startDrivingSession(appModeRef.current, trialTypeRef.current);
        } else if (inputAdapter.consumeJustPressed('KeyS')) {
          setSettingsTab('world');
          setShowSettingsModal((v) => !v);
        } else if (inputAdapter.consumeJustPressed('KeyC')) {
          handleCycleCameraView();
        }
      } else if (gameStateRef.current === 'playing') {
        if (
          inputAdapter.consumeJustPressed('Escape') ||
          inputAdapter.consumeJustPressed('KeyP')
        ) {
          setShowSettingsModal((open) => {
            if (open) return false;
            setGameState('paused');
            document.body.dataset.state = 'paused';
            return false;
          });
        } else if (inputAdapter.consumeJustPressed('KeyR')) {
          startDrivingSession(appModeRef.current, trialTypeRef.current);
        } else if (inputAdapter.consumeJustPressed('KeyM')) {
          soundRef.current.toggleMute();
          setAudioSettings(soundRef.current.getSettings());
        } else if (inputAdapter.consumeJustPressed('KeyE')) {
          handleToggleSimulatedEyes();
        } else if (inputAdapter.consumeJustPressed('KeyV')) {
          const curSide = experimentRef.current.getStimulus().activeSide;
          experimentRef.current.triggerManualStimulus(
            curSide === 'left' ? 'right' : 'left',
            Math.floor(timeSec),
          );
        } else if (inputAdapter.consumeJustPressed('KeyC')) {
          handleCycleCameraView();
        } else if (inputAdapter.consumeJustPressed('KeyS')) {
          setShowSettingsModal((v) => !v);
        } else if (inputAdapter.consumeJustPressed('KeyF')) {
          const finalSummary = experimentRef.current.finalizeCurrentRun(
            vehicleRef.current.s,
          );
          setCompletedSummary(finalSummary);
          setSavedComparison(experimentRef.current.getSavedComparison());
          inputAdapter.clearHeldKeys();
          setShowSettingsModal(false);
          setGameState('gameover');
          document.body.dataset.state = 'gameover';
        }
      } else if (gameStateRef.current === 'paused') {
        if (
          inputAdapter.consumeJustPressed('Escape') ||
          inputAdapter.consumeJustPressed('KeyP')
        ) {
          setGameState('playing');
          document.body.dataset.state = 'playing';
        }
      }

      inputAdapter.flushJustPressed();

      const { vehicleInput, telemetry } = inputAdapter.sampleInput();

      const monitor = attentionMonitorRef.current;
      const obs = webcamTrackerRef.current.sampleObservation();
      const attentionSnap = monitor.update(obs, nowMs);

      if (gameStateRef.current === 'title') {
        soundRef.current.updateEngineHum(0, false);
        stepVehicleSimulation(
          vehicleRef.current,
          { steer: 0, throttle: 0.35, brake: 0 },
          hazardsRef.current,
          dt,
          true,
          false,
        );
        // Keep demo car cleanly centered in right lane during title screen showcase
        vehicleRef.current.lateralOffset = ROAD_CONFIG.playerDefaultLaneOffset;
        vehicleRef.current.lateralVelocity = 0;
        vehicleRef.current.headingOffsetRad = 0;
      } else if (gameStateRef.current === 'playing') {
        const emergencySlowdown = attentionSnap.emergencySlowdownActive;

        const effectiveInput = {
          steer: vehicleInput.steer,
          throttle: emergencySlowdown ? 0 : vehicleInput.throttle,
          brake: emergencySlowdown
            ? Math.max(0.9, vehicleInput.brake)
            : vehicleInput.brake,
        };

        const collisionEvents = stepVehicleSimulation(
          vehicleRef.current,
          effectiveInput,
          hazardsRef.current,
          dt,
          true,
          emergencySlowdown,
        );

        soundRef.current.updateEngineHum(
          vehicleRef.current.rpmNormalized,
          true,
        );

        for (const ev of collisionEvents) {
          if (ev.type === 'hazard' || ev.type === 'guardrail') {
            soundRef.current.playCollision(0.9);
          }
        }
        if (vehicleRef.current.isOnShoulder) {
          soundRef.current.playRumbleTick();
        }
        if (attentionSnap.emergencySlowdownActive) {
          soundRef.current.playDrowsinessCriticalAlarm();
        } else if (attentionSnap.eyesClosed) {
          soundRef.current.playDistractionBeep(false);
        }

        const enableStimuli =
          appModeRef.current === 'experiment' &&
          trialTypeRef.current === 'distracted';

        experimentRef.current.step(
          dt,
          vehicleRef.current,
          attentionSnap.state,
          collisionEvents,
          enableStimuli,
        );

        if (
          appModeRef.current === 'experiment' &&
          experimentRef.current.getElapsedSec() >=
            EXPERIMENT_CONFIG.trialDurationSec
        ) {
          const finalSummary = experimentRef.current.finalizeCurrentRun(
            vehicleRef.current.s,
          );
          setCompletedSummary(finalSummary);
          setSavedComparison(experimentRef.current.getSavedComparison());
          inputAdapter.clearHeldKeys();
          setShowSettingsModal(false);
          setGameState('gameover');
          document.body.dataset.state = 'gameover';
        }
      } else {
        soundRef.current.updateEngineHum(0, false);
      }

      renderer.renderFrame(
        vehicleRef.current,
        hazardsRef.current,
        attentionSnap.state,
        attentionSnap.yawDeg,
        attentionSnap.pitchDeg,
        gameStateRef.current === 'title',
        timeSec,
        dt,
        accessibilityRef.current.reducedMotion,
      );

      // Expose deterministic inspection hook for testing
      if (typeof window !== 'undefined') {
        (window as unknown as Record<string, unknown>).__SIM_DEBUG__ = {
          gameState: gameStateRef.current,
          mapPreset: mapPresetRef.current,
          cameraView: cameraViewRef.current,
          trafficConfig: trafficConfigRef.current,
          vehicle: vehicleRef.current,
          hazardsCount: hazardsRef.current.length,
        };
      }

      // Sync React HUD state at ~10Hz
      if (nowMs - lastHudSyncMs >= 95) {
        lastHudSyncMs = nowMs;
        const liveSummary = experimentRef.current.getLiveSummary(
          vehicleRef.current.s,
        );
        setHud({
          speedKmh: Math.round(vehicleRef.current.speed * 3.6),
          gear: vehicleRef.current.gear,
          rpmNormalized: vehicleRef.current.rpmNormalized,
          lateralAccelG: vehicleRef.current.lateralAccelG,
          longitudinalAccelG: vehicleRef.current.longitudinalAccelG,
          distanceMeters: Math.round(vehicleRef.current.s),
          laneDeviationMeters: Number(
            vehicleRef.current.laneDeviationMeters.toFixed(2),
          ),
          lateralOffset: Number(vehicleRef.current.lateralOffset.toFixed(2)),
          isOutOfLane: vehicleRef.current.isOutOfLane,
          isOnShoulder: vehicleRef.current.isOnShoulder,
          attention: attentionSnap,
          trialElapsedSec: liveSummary.durationSec,
          trialType: trialTypeRef.current,
          collisionsCount:
            liveSummary.collisionsCount + liveSummary.guardrailHitsCount,
          nearMissesCount: liveSummary.nearMissesCount,
          distractionCount: liveSummary.distractionEventsCount,
          stimulus: experimentRef.current.getStimulus(),
          inputTelemetry: telemetry,
          rendererDiagnostics: renderer.getDiagnostics(),
          upcomingHazards: hazardsRef.current
            .filter(
              (h) =>
                h.s >= vehicleRef.current.s &&
                h.s <= vehicleRef.current.s + 95,
            )
            .map((h) => ({
              s: Math.round(h.s),
              laneIndex: h.laneIndex,
              speed: Number(h.speed.toFixed(1)),
              type: h.type,
            })),
        });
      }
    };

    animFrameId = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(animFrameId);
      inputAdapter.dispose();
      webcamTrackerRef.current.stop();
      netMgr.dispose();
      renderer.dispose();
    };
  }, [initialRoom, startDrivingSession, handleCycleCameraView]);

  const handleQualityChange = (preset: QualityPreset) => {
    setQualityPreset(preset);
    sceneRendererRef.current?.applyQualityPreset(preset);
  };

  const handleLightingChange = (preset: LightingPreset) => {
    setLightingPreset(preset);
    sceneRendererRef.current?.applyLightingPreset(preset);
  };

  const handleUpdateControllerSettings = (
    partial: Partial<ControllerCalibrationSettings>,
  ) => {
    inputAdapterRef.current?.updateSettings(partial);
    if (inputAdapterRef.current) {
      setControllerSettings(inputAdapterRef.current.getSettings());
    }
  };

  const handleUpdateSideConfig = (partial: Partial<SideDisplayConfig>) => {
    experimentRef.current.updateSideConfig(partial);
    const updated = experimentRef.current.getSideConfig();
    setSideConfig(updated);
    if (partial.roomId) {
      networkRef.current?.setRoomId(partial.roomId);
    }
  };

  const handleUpdateAudioSettings = (partial: Partial<AudioSettings>) => {
    soundRef.current.updateSettings(partial);
    setAudioSettings(soundRef.current.getSettings());
  };

  const handleUpdateAccessibilitySettings = (
    partial: Partial<AccessibilitySettings>,
  ) => {
    setAccessibilitySettings((prev) => ({ ...prev, ...partial }));
  };

  const handleToggleWebcamMode = async (enableWebcam: boolean) => {
    if (!enableWebcam) {
      webcamTrackerRef.current.stop();
      attentionMonitorRef.current.setMode('simulated');
      setWebcamActive(false);
      return;
    }

    attentionMonitorRef.current.setMode('webcam');
    const started = await webcamTrackerRef.current.start();
    if (started) {
      setWebcamActive(true);
      attentionMonitorRef.current.resetCalibration();
    } else {
      setWebcamActive(false);
      attentionMonitorRef.current.reportCameraUnavailable(
        'Webcam unavailable or permission denied — Use Simulated Mode or connect a camera',
      );
    }
  };

  const showTouchControls =
    gameState === 'playing' &&
    !showSettingsModal &&
    (accessibilitySettings.touchControlsMode === 'always' ||
      (accessibilitySettings.touchControlsMode === 'auto' &&
        hud.inputTelemetry.capabilities.recommendedTouchControls));

  const isLookAwayActive =
    hud.inputTelemetry.simulatingLookAwayLeft ||
    hud.inputTelemetry.simulatingLookAwayRight;

  const baselineData =
    savedComparison.baseline || REFERENCE_BASELINE_SUMMARY;
  const distractedData =
    savedComparison.distracted || completedSummary || null;

  return (
    <div
      onContextMenu={(e) => e.preventDefault()}
      className="relative w-screen h-screen overflow-hidden bg-[#060911] select-none touch-none"
    >
      {/* Isolated WebGL Mount Container */}
      <div
        ref={canvasMountRef}
        className="absolute inset-0 w-full h-full z-0"
      />

      {/* =====================================================================
          STATE 1: NATIVE MOTORSPORT TITLE LAUNCHER (Live 3D GT Car Showcase)
          ===================================================================== */}
      {gameState === 'title' && (
        <div className="fixed inset-0 z-20 pointer-events-none flex flex-col justify-between p-4 sm:p-6 md:p-10 bg-gradient-to-r from-[#060911]/95 via-[#060911]/65 to-transparent overflow-y-auto">
          {/* Top Minimal Telemetry Bar */}
          <div className="flex items-center justify-between gap-2 pointer-events-auto">
            <div className="flex items-center gap-2 text-[11px] sm:text-xs font-mono-tabular tracking-widest uppercase text-slate-300">
              <span className="inline-block w-2 h-2 bg-amber-400" />
              <span>HUMAN FACTORS &amp; HIGHWAY SAFETY SIMULATOR</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => openSettingsOnTab('world')}
                className="px-3.5 py-1.5 rounded-sm bg-[#060911]/90 hover:bg-slate-900 text-slate-200 border border-slate-700 hover:border-amber-400 text-xs font-mono-tabular font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
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
                <span>Settings &amp; Traffic [S]</span>
              </button>
            </div>
          </div>

          {/* Left-Third Asymmetric Title Lockup & Native Telemetry Configurator */}
          <div className="max-w-xl pointer-events-auto my-auto py-2">
            <svg
              viewBox="0 0 520 112"
              className="w-full max-w-[430px] h-auto mb-2.5"
              role="img"
              aria-label="DISTRACT — Driver Attention & Road Safety Simulator"
            >
              <polygon points="24,12 62,12 44,94 6,94" fill="#f59e0b" />
              <polygon points="72,12 98,12 80,94 54,94" fill="#38bdf8" />
              <path d="M14 53 L94 53" stroke="#060911" strokeWidth="5" />
              <text
                x="114"
                y="66"
                fill="#f8fafc"
                fontFamily="Chakra Petch, sans-serif"
                fontWeight="700"
                fontSize="64"
                letterSpacing="4"
              >
                DISTRACT
              </text>
              <text
                x="116"
                y="93"
                fill="#94a3b8"
                fontFamily="IBM Plex Mono, monospace"
                fontWeight="600"
                fontSize="13"
                letterSpacing="2.2"
              >
                DRIVER ATTENTION &amp; ROAD SAFETY LAB
              </text>
            </svg>

            <p className="text-slate-300 text-xs sm:text-sm leading-relaxed mb-4 max-w-lg">
              Experience how a two-second peripheral glance degrades lane
              keeping, delays braking response, and escalates highway collision
              risk.
            </p>

            {/* 1. Three Exhibition Modes Selector */}
            <div
              className="grid grid-cols-3 gap-2 mb-3"
              role="group"
              aria-label="Select Exhibition Mode"
            >
              <button
                type="button"
                onClick={() => {
                  setAppMode('experiment');
                  setTrialType('distracted');
                }}
                className={`p-2.5 rounded-sm border-l-2 border-y border-r text-left transition-colors cursor-pointer ${
                  appMode === 'experiment'
                    ? 'bg-slate-900/95 border-l-amber-400 border-amber-400/70 text-white'
                    : 'bg-slate-950/85 border-slate-800 text-slate-400 hover:border-slate-600'
                }`}
              >
                <div className="text-[10px] font-mono-tabular uppercase text-amber-400 font-semibold">
                  01 · EXPERIMENT
                </div>
                <div className="text-xs sm:text-sm font-display font-bold mt-0.5 uppercase">
                  Safety Trial
                </div>
              </button>

              <button
                type="button"
                onClick={() => setAppMode('demo')}
                className={`p-2.5 rounded-sm border-l-2 border-y border-r text-left transition-colors cursor-pointer ${
                  appMode === 'demo'
                    ? 'bg-slate-900/95 border-l-sky-400 border-sky-400/70 text-white'
                    : 'bg-slate-950/85 border-slate-800 text-slate-400 hover:border-slate-600'
                }`}
              >
                <div className="text-[10px] font-mono-tabular uppercase text-sky-400 font-semibold">
                  02 · FREE DRIVE
                </div>
                <div className="text-xs sm:text-sm font-display font-bold mt-0.5 uppercase">
                  Open Highway
                </div>
              </button>

              <button
                type="button"
                onClick={() => setAppMode('calibration')}
                className={`p-2.5 rounded-sm border-l-2 border-y border-r text-left transition-colors cursor-pointer ${
                  appMode === 'calibration'
                    ? 'bg-slate-900/95 border-l-emerald-400 border-emerald-400/70 text-white'
                    : 'bg-slate-950/85 border-slate-800 text-slate-400 hover:border-slate-600'
                }`}
              >
                <div className="text-[10px] font-mono-tabular uppercase text-emerald-400 font-semibold">
                  03 · HARDWARE
                </div>
                <div className="text-xs sm:text-sm font-display font-bold mt-0.5 uppercase">
                  Wheel &amp; Gaze
                </div>
              </button>
            </div>

            {/* 2. Highway Route Map Selector & Traffic Control Strip */}
            <div className="bg-[#060911]/92 border border-slate-800 rounded-sm p-2.5 mb-3 space-y-2.5">
              <div className="flex items-center justify-between text-[10px] font-mono-tabular uppercase text-slate-400">
                <span>HIGHWAY ROUTE MAP</span>
                <span className="text-amber-400">
                  {MAP_PRESETS[mapPreset].subtitle}
                </span>
              </div>
              <div
                className="grid grid-cols-2 sm:grid-cols-4 gap-1.5"
                role="group"
                aria-label="Select Highway Map"
              >
                {(Object.keys(MAP_PRESETS) as MapPreset[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    data-testid={`title-map-${m}`}
                    onClick={() => handleMapChange(m)}
                    className={`py-1.5 px-2 rounded-sm border text-left font-mono-tabular text-xs cursor-pointer transition-colors ${
                      mapPreset === m
                        ? 'bg-amber-500/20 border-amber-400 text-white font-bold'
                        : 'bg-slate-900/90 border-slate-800 text-slate-400 hover:border-slate-600'
                    }`}
                  >
                    <div className="text-[10px] uppercase tracking-wider">
                      {MAP_PRESETS[m].shortLabel}
                    </div>
                  </button>
                ))}
              </div>

              {/* Traffic Density & Camera View Quick Toggles */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t border-slate-800/90">
                <div>
                  <div className="text-[9px] font-mono-tabular uppercase text-slate-400 mb-1">
                    TRAFFIC DENSITY ({TRAFFIC_DENSITY_COUNTS[trafficConfig.density]} CARS)
                  </div>
                  <div className="grid grid-cols-4 gap-1">
                    {(['none', 'light', 'normal', 'heavy'] as TrafficDensityPreset[]).map(
                      (d) => (
                        <button
                          key={d}
                          type="button"
                          data-testid={`title-traffic-${d}`}
                          onClick={() =>
                            handleUpdateTrafficConfig({ density: d })
                          }
                          className={`py-1 rounded-sm text-[10px] font-mono-tabular uppercase border cursor-pointer ${
                            trafficConfig.density === d
                              ? 'bg-sky-500 text-slate-950 border-sky-400 font-bold'
                              : 'bg-slate-900 text-slate-300 border-slate-800 hover:border-slate-600'
                          }`}
                        >
                          {d === 'none' ? 'OFF' : d.toUpperCase()}
                        </button>
                      ),
                    )}
                  </div>
                </div>

                <div>
                  <div className="text-[9px] font-mono-tabular uppercase text-slate-400 mb-1">
                    CAMERA PERSPECTIVE [C]
                  </div>
                  <div className="grid grid-cols-3 gap-1">
                    {(['cockpit', 'chase', 'hood'] as CameraViewMode[]).map(
                      (v) => (
                        <button
                          key={v}
                          type="button"
                          data-testid={`title-camera-${v}`}
                          onClick={() => handleChangeCameraView(v)}
                          className={`py-1 rounded-sm text-[10px] font-mono-tabular uppercase border cursor-pointer ${
                            cameraView === v
                              ? 'bg-amber-500 text-slate-950 border-amber-400 font-bold'
                              : 'bg-slate-900 text-slate-300 border-slate-800 hover:border-slate-600'
                          }`}
                        >
                          {v.toUpperCase()}
                        </button>
                      ),
                    )}
                  </div>
                </div>
              </div>
            </div>

            {appMode === 'experiment' && (
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-3 bg-[#060911]/92 border border-slate-800 p-2 rounded-sm">
                <span className="text-[10px] font-mono-tabular uppercase text-slate-400 px-1 shrink-0">
                  TRIAL PROTOCOL:
                </span>
                <div className="flex gap-1.5 flex-1">
                  <button
                    type="button"
                    onClick={() => setTrialType('baseline')}
                    className={`flex-1 py-1.5 px-2.5 rounded-sm text-xs font-mono-tabular font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                      trialType === 'baseline'
                        ? 'bg-emerald-500 text-slate-950 font-bold'
                        : 'text-slate-300 bg-slate-900 hover:bg-slate-800'
                    }`}
                  >
                    RUN A: BASELINE (45s)
                  </button>
                  <button
                    type="button"
                    onClick={() => setTrialType('distracted')}
                    className={`flex-1 py-1.5 px-2.5 rounded-sm text-xs font-mono-tabular font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                      trialType === 'distracted'
                        ? 'bg-amber-500 text-slate-950 font-bold'
                        : 'text-slate-300 bg-slate-900 hover:bg-slate-800'
                    }`}
                  >
                    RUN B: DISTRACTED (45s)
                  </button>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                data-start="true"
                onClick={() => startDrivingSession(appMode, trialType)}
                className="px-6 py-3 rounded-sm bg-amber-500 hover:bg-amber-400 text-slate-950 font-display font-bold text-base sm:text-lg uppercase tracking-wider transition-transform active:scale-95 cursor-pointer whitespace-nowrap"
              >
                {appMode === 'calibration'
                  ? 'OPEN CALIBRATION & DRIVE'
                  : appMode === 'demo'
                  ? 'START FREE DRIVE'
                  : `LAUNCH ${trialType.toUpperCase()} TRIAL`}
              </button>

              <button
                type="button"
                onClick={() => openSettingsOnTab('sidedisplays')}
                className="px-4 py-3 rounded-sm bg-[#060911]/95 hover:bg-slate-900 text-slate-200 border border-slate-700 text-xs font-mono-tabular uppercase tracking-wider transition-colors cursor-pointer whitespace-nowrap"
              >
                Side Displays &amp; QR
              </button>
            </div>
          </div>

          <div className="text-[11px] font-mono-tabular text-slate-400 tracking-wider uppercase">
            [WASD / Arrows] Drive · [C] Camera View · [L / Q / E] Glance Away ·
            [V] Side Pulse · [S] Map &amp; Traffic Settings
          </div>
        </div>
      )}

      {/* =====================================================================
          STATE 2: NATIVE MOTORSPORT TELEMETRY HUD (>= 88% Clear 3D Viewport)
          ===================================================================== */}
      {gameState === 'playing' && (
        <AutomotiveHud
          speedKmh={hud.speedKmh}
          gear={hud.gear}
          rpmNormalized={hud.rpmNormalized}
          lateralAccelG={hud.lateralAccelG}
          longitudinalAccelG={hud.longitudinalAccelG}
          distanceMeters={hud.distanceMeters}
          laneDeviationMeters={hud.laneDeviationMeters}
          lateralOffset={hud.lateralOffset}
          isOutOfLane={hud.isOutOfLane}
          isOnShoulder={hud.isOnShoulder}
          attention={hud.attention}
          trialElapsedSec={hud.trialElapsedSec}
          trialType={hud.trialType}
          appMode={appMode}
          mapPreset={mapPreset}
          cameraView={cameraView}
          trafficConfig={trafficConfig}
          collisionsCount={hud.collisionsCount}
          distractionCount={hud.distractionCount}
          stimulus={hud.stimulus}
          sideConfig={sideConfig}
          networkTelemetry={networkTelemetry}
          leftPreviewCollapsed={leftPreviewCollapsed}
          rightPreviewCollapsed={rightPreviewCollapsed}
          onToggleLeftPreview={() => setLeftPreviewCollapsed((c) => !c)}
          onToggleRightPreview={() => setRightPreviewCollapsed((c) => !c)}
          onGlanceSide={(side) => {
            if (side === 'left') {
              inputAdapterRef.current?.setManualLookAway(
                hud.inputTelemetry.simulatingLookAwayLeft ? 'none' : 'left',
              );
            } else {
              inputAdapterRef.current?.setManualLookAway(
                hud.inputTelemetry.simulatingLookAwayRight ? 'none' : 'right',
              );
            }
          }}
          upcomingHazards={hud.upcomingHazards}
          inputTelemetry={hud.inputTelemetry}
          audioMuted={audioSettings.muted}
          isLookAwayActive={isLookAwayActive}
          highContrast={accessibilitySettings.highContrastHud}
          showTouchControls={showTouchControls}
          webcamTracker={webcamTrackerRef.current}
          onToggleWebcam={() => handleToggleWebcamMode(!webcamActive)}
          onToggleSimulatedEyes={handleToggleSimulatedEyes}
          isSimulatedClosed={isSimulatedClosed}
          onOpenSettings={() => openSettingsOnTab('world')}
          onCycleCameraView={handleCycleCameraView}
          onToggleMute={() => {
            soundRef.current.toggleMute();
            setAudioSettings(soundRef.current.getSettings());
          }}
          onRestartRun={handleRestartRun}
          onTogglePause={() => {
            setGameState('paused');
            document.body.dataset.state = 'paused';
          }}
          onToggleLookAway={handleToggleSimulatedEyes}
          onFinishTrial={finishCurrentTrialAndShowResults}
        />
      )}

      {/* Multi-Touch On-Screen Steering & Pedals Overlay for Mobile / Tablet */}
      {showTouchControls && (
        <TouchControlsOverlay
          inputAdapterRef={inputAdapterRef}
          isLookAwayActive={isLookAwayActive}
        />
      )}

      {/* =====================================================================
          DEDICATED IN-GAME SETTINGS, MAP & TRAFFIC MODAL
          ===================================================================== */}
      {showSettingsModal && (
        <SettingsModal
          initialTab={settingsTab}
          onClose={() => setShowSettingsModal(false)}
          mapPreset={mapPreset}
          onChangeMap={handleMapChange}
          trafficConfig={trafficConfig}
          onUpdateTrafficConfig={handleUpdateTrafficConfig}
          cameraView={cameraView}
          onChangeCameraView={handleChangeCameraView}
          qualityPreset={qualityPreset}
          onChangeQuality={handleQualityChange}
          lightingPreset={lightingPreset}
          onChangeLighting={handleLightingChange}
          rendererDiagnostics={hud.rendererDiagnostics}
          controllerSettings={controllerSettings}
          onUpdateControllerSettings={handleUpdateControllerSettings}
          onCalibrateWheelCenter={() => {
            inputAdapterRef.current?.calibrateCenterFromCurrentGamepad();
            if (inputAdapterRef.current) {
              setControllerSettings(inputAdapterRef.current.getSettings());
            }
          }}
          inputTelemetry={hud.inputTelemetry}
          sideConfig={sideConfig}
          onUpdateSideConfig={handleUpdateSideConfig}
          networkTelemetry={networkTelemetry}
          onReconnectNetwork={() => networkRef.current?.reconnect()}
          onTriggerTestStimulus={(side) =>
            experimentRef.current.triggerManualStimulus(side, 1)
          }
          webcamActive={webcamActive}
          onToggleWebcam={handleToggleWebcamMode}
          onResetPoseCalibration={() =>
            attentionMonitorRef.current.resetCalibration()
          }
          attention={hud.attention}
          audioSettings={audioSettings}
          onUpdateAudioSettings={handleUpdateAudioSettings}
          accessibilitySettings={accessibilitySettings}
          onUpdateAccessibilitySettings={handleUpdateAccessibilitySettings}
        />
      )}

      {/* =====================================================================
          STATE 3: PAUSED MODAL
          ===================================================================== */}
      {gameState === 'paused' && !showSettingsModal && (
        <div
          role="dialog"
          aria-label="Simulation Paused"
          className="fixed inset-0 z-30 bg-[#060911]/85 flex items-center justify-center p-4"
        >
          <div className="w-full max-w-md bg-[#0a0f1d] border border-slate-700 rounded-sm p-6 shadow-2xl">
            <div className="text-xs font-mono-tabular uppercase tracking-widest text-amber-400">
              SIMULATION PAUSED · {MAP_PRESETS[mapPreset].shortLabel}
            </div>
            <h2 className="text-2xl font-display font-bold text-white mt-1 mb-4 uppercase">
              Session Paused
            </h2>

            <div className="grid grid-cols-3 gap-2.5 mb-6 bg-slate-950 p-3 rounded-sm border border-slate-800 font-mono-tabular">
              <div>
                <div className="text-[10px] text-slate-400">DISTANCE</div>
                <div className="text-lg font-bold text-white">
                  {hud.distanceMeters}m
                </div>
              </div>
              <div>
                <div className="text-[10px] text-slate-400">LANE DRIFT</div>
                <div className="text-lg font-bold text-emerald-400">
                  {hud.laneDeviationMeters.toFixed(2)}m
                </div>
              </div>
              <div>
                <div className="text-[10px] text-slate-400">IMPACTS</div>
                <div className="text-lg font-bold text-rose-400">
                  {hud.collisionsCount}
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => {
                  setGameState('playing');
                  document.body.dataset.state = 'playing';
                }}
                className="w-full py-3 rounded-sm bg-amber-500 hover:bg-amber-400 text-slate-950 font-display font-bold text-base uppercase tracking-wider cursor-pointer"
              >
                Resume Driving
              </button>
              <button
                type="button"
                onClick={() => openSettingsOnTab('world')}
                className="w-full py-2.5 rounded-sm bg-slate-800 hover:bg-slate-700 text-slate-100 font-mono-tabular font-semibold text-xs uppercase tracking-wider cursor-pointer"
              >
                Change Map, Traffic &amp; Settings
              </button>
              <button
                type="button"
                onClick={handleRestartRun}
                className="w-full py-2.5 rounded-sm bg-slate-800 hover:bg-slate-700 text-slate-100 font-mono-tabular font-semibold text-xs uppercase tracking-wider cursor-pointer"
              >
                Restart Current Trial
              </button>
              <button
                type="button"
                onClick={finishCurrentTrialAndShowResults}
                className="w-full py-2.5 rounded-sm bg-slate-800 hover:bg-slate-700 text-amber-300 font-mono-tabular font-semibold text-xs uppercase tracking-wider cursor-pointer"
              >
                End Run &amp; Compare Results
              </button>
              <button
                type="button"
                onClick={() => {
                  setGameState('title');
                  document.body.dataset.state = 'title';
                }}
                className="w-full py-2.5 rounded-sm bg-slate-900 hover:bg-slate-800 text-slate-400 font-mono-tabular text-xs uppercase tracking-wider cursor-pointer"
              >
                Return to Title Screen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          STATE 4: GAMEOVER / EXPERIMENT RESULTS & COMPARISON MODAL
          ===================================================================== */}
      {gameState === 'gameover' && completedSummary && (
        <div
          role="dialog"
          aria-label="Experiment Results Summary"
          className="fixed inset-0 z-30 bg-[#060911]/90 flex items-center justify-center p-4 overflow-y-auto"
        >
          <div className="w-full max-w-3xl bg-[#0a0f1d] border border-slate-700 rounded-sm p-6 md:p-8 shadow-2xl my-auto">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-4 mb-5">
              <div>
                <div className="text-xs font-mono-tabular uppercase tracking-widest text-amber-400">
                  TELEMETRY REPORT · {MAP_PRESETS[mapPreset].label.toUpperCase()}
                </div>
                <h2 className="text-2xl md:text-3xl font-display font-bold text-white mt-0.5 uppercase">
                  Attentive Baseline vs. Distracted Driving
                </h2>
              </div>
              <div className="text-xs font-mono-tabular text-slate-400">
                Completed Run: {completedSummary.trialType.toUpperCase()} (
                {completedSummary.durationSec}s ·{' '}
                {completedSummary.distanceMeters}m)
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              <div className="bg-slate-950 border border-slate-800 rounded-sm p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-mono-tabular uppercase text-emerald-400 font-semibold">
                    RUN A · ATTENTIVE BASELINE
                  </span>
                  <span className="text-[11px] text-slate-400">
                    {savedComparison.baseline
                      ? 'Recorded This Session'
                      : 'Reference Baseline'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3 font-mono-tabular">
                  <div>
                    <div className="text-[11px] text-slate-400">
                      Mean Lane Offset
                    </div>
                    <div className="text-xl font-bold text-white">
                      {baselineData.meanLaneDeviationMeters.toFixed(2)} m
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-400">
                      Peak Lane Drift
                    </div>
                    <div className="text-xl font-bold text-white">
                      {baselineData.maxLaneDeviationMeters.toFixed(2)} m
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-400">
                      Time Out of Lane
                    </div>
                    <div className="text-xl font-bold text-emerald-400">
                      {baselineData.outOfLanePercent}%
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-400">
                      Collisions / Hits
                    </div>
                    <div className="text-xl font-bold text-white">
                      {baselineData.collisionsCount +
                        baselineData.guardrailHitsCount}
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-slate-950 border border-amber-500/50 rounded-sm p-4">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-mono-tabular uppercase text-amber-400 font-semibold">
                    {distractedData && distractedData.trialType === 'distracted'
                      ? 'RUN B · DISTRACTED TRIAL'
                      : 'LATEST RECORDED RUN'}
                  </span>
                  <span className="text-[11px] text-slate-300 font-mono-tabular">
                    {completedSummary.distractionEventsCount} Distractions (
                    {completedSummary.totalDistractedTimeSec}s)
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-3 font-mono-tabular">
                  <div>
                    <div className="text-[11px] text-slate-400">
                      Mean Lane Offset
                    </div>
                    <div className="text-xl font-bold text-amber-300">
                      {completedSummary.meanLaneDeviationMeters.toFixed(2)} m
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-400">
                      Peak Lane Drift
                    </div>
                    <div className="text-xl font-bold text-rose-400">
                      {completedSummary.maxLaneDeviationMeters.toFixed(2)} m
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-400">
                      Time Out of Lane
                    </div>
                    <div className="text-xl font-bold text-rose-400">
                      {completedSummary.outOfLanePercent}%
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] text-slate-400">
                      Collisions / Recovery
                    </div>
                    <div className="text-xl font-bold text-white">
                      {completedSummary.collisionsCount +
                        completedSummary.guardrailHitsCount}{' '}
                      hits ·{' '}
                      {completedSummary.avgLaneRecoveryTimeMs !== null
                        ? `${completedSummary.avgLaneRecoveryTimeMs}ms`
                        : 'N/A'}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-slate-900/90 border border-slate-800 rounded-sm p-3.5 mb-6 text-xs text-slate-300 leading-relaxed">
              <strong className="text-white">
                Exhibition Observation Note:
              </strong>{' '}
              Measurements above derive directly from recorded vehicle lane
              offset, speed, and attention state transitions during your run.
              Notice how looking toward peripheral stimuli increases peak
              lateral lane drift and post-glance recovery time.
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2.5">
                <button
                  type="button"
                  data-start="true"
                  onClick={() =>
                    startDrivingSession('experiment', 'distracted')
                  }
                  className="px-5 py-3 rounded-sm bg-amber-500 hover:bg-amber-400 text-slate-950 font-display font-bold text-sm uppercase tracking-wider cursor-pointer whitespace-nowrap"
                >
                  Run Distracted Trial (45s)
                </button>
                <button
                  type="button"
                  onClick={() => startDrivingSession('experiment', 'baseline')}
                  className="px-5 py-3 rounded-sm bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-display font-bold text-sm uppercase tracking-wider cursor-pointer whitespace-nowrap"
                >
                  Run Attentive Baseline (45s)
                </button>
              </div>

              <button
                type="button"
                onClick={() => {
                  setGameState('title');
                  document.body.dataset.state = 'title';
                }}
                className="px-4 py-3 rounded-sm bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-mono-tabular uppercase tracking-wider cursor-pointer whitespace-nowrap"
              >
                Return to Title
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
