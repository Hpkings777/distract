import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  DEFAULT_ACCESSIBILITY_SETTINGS,
  DEFAULT_AUDIO_SETTINGS,
  DEFAULT_SIDE_DISPLAY_CONFIG,
  EXPERIMENT_CONFIG,
  ROAD_CONFIG,
} from './config.ts';
import type {
  AccessibilitySettings,
  AppMode,
  AttentionState,
  AudioSettings,
  GameState,
  LightingPreset,
  QualityPreset,
  SideDisplayConfig,
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
}

/**
 * Dedicated companion window view when opened with ?side=left or ?side=right.
 * Does NOT load the 3D driving scene — uses lightweight SVG/Canvas stimulus rendering
 * and synchronizes over WebRTC DataChannels + WebSocket relay + BroadcastChannel.
 */
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
    <main className="w-screen h-screen bg-[#070b14] text-slate-100 flex flex-col items-center justify-between p-5 sm:p-8 select-none overflow-hidden">
      <div className="w-full flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/90 pb-3.5">
        <div>
          <div className="text-[11px] font-mono-tabular uppercase tracking-widest text-amber-400">
            DISTRACT · PERIPHERAL STIMULUS DISPLAY ({side.toUpperCase()}) · ROOM:{' '}
            {roomId}
          </div>
          <h1 className="text-lg sm:text-xl font-display font-bold text-white mt-0.5">
            Synchronized Visual Attractor
          </h1>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`px-2.5 py-1 rounded text-xs font-mono-tabular border ${
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
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-200 border border-slate-700 cursor-pointer"
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
            className="px-3.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-display font-bold cursor-pointer"
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
  const [qualityPreset, setQualityPreset] =
    useState<QualityPreset>('balanced');
  const [lightingPreset, setLightingPreset] =
    useState<LightingPreset>('dusk');

  const [showSettingsModal, setShowSettingsModal] = useState<boolean>(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTabId>('display');
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

  const [hud, setHud] = useState<InterfaceHudSnapshot>(() => ({
    speedKmh: 60,
    gear: 3,
    rpmNormalized: 0.42,
    distanceMeters: 0,
    laneDeviationMeters: 0,
    lateralOffset: ROAD_CONFIG.playerDefaultLaneOffset,
    isOutOfLane: false,
    isOnShoulder: false,
    attention: {
      state: 'ATTENTIVE',
      mode: 'simulated',
      yawDeg: 0,
      pitchDeg: 0,
      calibratedYawOffset: 0,
      calibratedPitchOffset: 0,
      confidence: 1,
      sustainedDeviationMs: 0,
      calibrationProgress: 1,
      statusMessage: 'Simulated monitoring active',
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
    },
  }));

  // Mutable simulation refs
  const gameStateRef = useRef<GameState>(autostart ? 'playing' : 'title');
  const appModeRef = useRef<AppMode>('experiment');
  const trialTypeRef = useRef<'baseline' | 'distracted'>('distracted');
  const accessibilityRef = useRef<AccessibilitySettings>(
    DEFAULT_ACCESSIBILITY_SETTINGS,
  );
  const vehicleRef = useRef<VehicleState>(createInitialVehicleState());
  const hazardsRef = useRef<RoadHazard[]>(generateInitialHazards(1042, 24));
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
        24,
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

  useEffect(() => {
    const mountEl = canvasMountRef.current;
    if (!mountEl) return;

    const inputAdapter = new InputAdapter();
    inputAdapterRef.current = inputAdapter;

    const renderer = new DrivingSceneRenderer(mountEl, 'balanced', 'dusk');
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
          setSettingsTab('display');
          setShowSettingsModal((v) => !v);
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
          const isMutedNow = soundRef.current.toggleMute();
          setAudioSettings(soundRef.current.getSettings());
          void isMutedNow;
        } else if (inputAdapter.consumeJustPressed('KeyV')) {
          const curSide = experimentRef.current.getStimulus().activeSide;
          experimentRef.current.triggerManualStimulus(
            curSide === 'left' ? 'right' : 'left',
            Math.floor(timeSec),
          );
        } else if (
          inputAdapter.consumeJustPressed('KeyC') ||
          inputAdapter.consumeJustPressed('KeyS')
        ) {
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
      let attentionSnap: AttentionSnapshot;

      if (monitor.getState().mode === 'webcam') {
        const obs = webcamTrackerRef.current.sampleObservation();
        if (telemetry.simulatingLookAwayLeft) obs.yawDeg = -28;
        if (telemetry.simulatingLookAwayRight) obs.yawDeg = 28;
        attentionSnap = monitor.update(obs, nowMs);
      } else {
        let simYaw = 0;
        if (telemetry.simulatingLookAwayLeft) simYaw = -28;
        else if (telemetry.simulatingLookAwayRight) simYaw = 28;

        attentionSnap = monitor.update(
          {
            yawDeg: simYaw,
            pitchDeg: 0,
            confidence: 0.99,
            source: 'simulated',
          },
          nowMs,
        );
      }

      if (gameStateRef.current === 'title') {
        soundRef.current.updateEngineHum(0, false);
        stepVehicleSimulation(
          vehicleRef.current,
          { steer: 0, throttle: 0.35, brake: 0 },
          hazardsRef.current,
          dt,
          true,
        );
      } else if (gameStateRef.current === 'playing') {
        const distractionDrift =
          attentionSnap.state === 'DISTRACTED' ||
          attentionSnap.state === 'POSSIBLY_DISTRACTED'
            ? (attentionSnap.yawDeg / 28) * 0.25
            : 0;

        const effectiveInput = {
          steer: Math.max(
            -1,
            Math.min(1, vehicleInput.steer + distractionDrift),
          ),
          throttle: vehicleInput.throttle,
          brake: vehicleInput.brake,
        };

        const collisionEvents = stepVehicleSimulation(
          vehicleRef.current,
          effectiveInput,
          hazardsRef.current,
          dt,
          true,
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
        if (attentionSnap.state === 'DISTRACTED') {
          soundRef.current.playDistractionBeep(true);
        } else if (attentionSnap.state === 'POSSIBLY_DISTRACTED') {
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
  }, [initialRoom, startDrivingSession]);

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

  const attentionBadgeStyle = (state: AttentionState) => {
    switch (state) {
      case 'ATTENTIVE':
        return 'bg-emerald-950/90 border-emerald-500/60 text-emerald-300';
      case 'POSSIBLY_DISTRACTED':
        return 'bg-amber-950/90 border-amber-500/70 text-amber-300';
      case 'DISTRACTED':
        return 'bg-rose-950/95 border-rose-500 text-rose-200';
      case 'CALIBRATING':
      case 'INITIALIZING':
        return 'bg-sky-950/90 border-sky-500/60 text-sky-300';
      case 'CAMERA_UNAVAILABLE':
        return 'bg-slate-900/95 border-amber-500/60 text-amber-300';
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

  const highContrastBorder = accessibilitySettings.highContrastHud
    ? 'border-slate-300'
    : 'border-slate-700/80';

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#090d16] select-none touch-none">
      {/* Isolated WebGL Mount Container */}
      <div
        ref={canvasMountRef}
        className="absolute inset-0 w-full h-full z-0"
      />

      {/* =====================================================================
          STATE 1: TITLE SCREEN (Live 3D Highway Flyover + Bespoke SVG Lockup)
          ===================================================================== */}
      {gameState === 'title' && (
        <div className="fixed inset-0 z-20 pointer-events-none flex flex-col justify-between p-4 sm:p-6 md:p-12 bg-gradient-to-r from-[#090d16]/90 via-[#090d16]/60 to-transparent overflow-y-auto">
          {/* Top Minimal Exhibition Identity */}
          <div className="flex items-center justify-between gap-2 pointer-events-auto">
            <div className="text-[11px] sm:text-xs font-mono-tabular tracking-widest uppercase text-slate-300">
              SCIENCE EXHIBITION SIMULATOR · HUMAN FACTORS &amp; ROAD SAFETY
            </div>
            <button
              type="button"
              onClick={() => openSettingsOnTab('display')}
              className="px-3.5 py-1.5 rounded-lg bg-slate-900/90 hover:bg-slate-800 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
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
              <span>Settings &amp; Side Displays [S]</span>
            </button>
          </div>

          {/* Left-Third Asymmetric Title Lockup & Mode Selector */}
          <div className="max-w-xl pointer-events-auto my-auto py-4">
            <svg
              viewBox="0 0 520 118"
              className="w-full max-w-[460px] h-auto mb-3 sm:mb-4"
              role="img"
              aria-label="DISTRACT — Driver Attention & Road Safety Simulator"
            >
              <polygon points="28,14 66,14 48,96 10,96" fill="#f59e0b" />
              <polygon points="76,14 102,14 84,96 58,96" fill="#38bdf8" />
              <path d="M18 55 L98 55" stroke="#090d16" strokeWidth="5" />
              <text
                x="118"
                y="68"
                fill="#f8fafc"
                fontFamily="Chakra Petch, sans-serif"
                fontWeight="700"
                fontSize="64"
                letterSpacing="4"
              >
                DISTRACT
              </text>
              <text
                x="120"
                y="96"
                fill="#94a3b8"
                fontFamily="IBM Plex Mono, monospace"
                fontWeight="600"
                fontSize="13.5"
                letterSpacing="2.2"
              >
                DRIVER ATTENTION &amp; ROAD SAFETY LAB
              </text>
            </svg>

            <p className="text-slate-200 text-sm sm:text-base leading-relaxed mb-4 sm:mb-6 max-w-lg">
              Experience how taking your eyes off the road for just two seconds
              degrades lane keeping, delays hazard braking reaction, and
              increases collision risk.
            </p>

            {/* Three Exhibition Modes Selector */}
            <div
              className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-2.5 mb-4"
              role="group"
              aria-label="Select Exhibition Mode"
            >
              <button
                type="button"
                onClick={() => {
                  setAppMode('experiment');
                  setTrialType('distracted');
                }}
                className={`p-2.5 sm:p-3 rounded-lg border text-left transition-colors cursor-pointer ${
                  appMode === 'experiment'
                    ? 'bg-slate-900/95 border-amber-400 text-white'
                    : 'bg-slate-950/85 border-slate-800 text-slate-300 hover:border-slate-600'
                }`}
              >
                <div className="text-xs font-mono-tabular uppercase text-amber-400 font-semibold">
                  01 · EXPERIMENT
                </div>
                <div className="text-sm font-bold mt-0.5">
                  Timed Safety Trial
                </div>
                <div className="text-xs text-slate-400 mt-0.5">
                  Compare Baseline vs. Distracted driving
                </div>
              </button>

              <button
                type="button"
                onClick={() => setAppMode('demo')}
                className={`p-2.5 sm:p-3 rounded-lg border text-left transition-colors cursor-pointer ${
                  appMode === 'demo'
                    ? 'bg-slate-900/95 border-sky-400 text-white'
                    : 'bg-slate-950/85 border-slate-800 text-slate-300 hover:border-slate-600'
                }`}
              >
                <div className="text-xs font-mono-tabular uppercase text-sky-400 font-semibold">
                  02 · DEMO
                </div>
                <div className="text-sm font-bold mt-0.5">Free Drive Demo</div>
                <div className="text-xs text-slate-400 mt-0.5">
                  Continuous highway &amp; simulated alerts
                </div>
              </button>

              <button
                type="button"
                onClick={() => setAppMode('calibration')}
                className={`p-2.5 sm:p-3 rounded-lg border text-left transition-colors cursor-pointer ${
                  appMode === 'calibration'
                    ? 'bg-slate-900/95 border-emerald-400 text-white'
                    : 'bg-slate-950/85 border-slate-800 text-slate-300 hover:border-slate-600'
                }`}
              >
                <div className="text-xs font-mono-tabular uppercase text-emerald-400 font-semibold">
                  03 · CALIBRATION
                </div>
                <div className="text-sm font-bold mt-0.5">
                  Wheel &amp; Camera
                </div>
                <div className="text-xs text-slate-400 mt-0.5">
                  USB steering axes, touch &amp; QR setup
                </div>
              </button>
            </div>

            {appMode === 'experiment' && (
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-4 sm:mb-5 bg-slate-950/90 border border-slate-800 p-2 rounded-lg">
                <span className="text-xs text-slate-400 px-1 sm:px-2 shrink-0">
                  Trial Condition:
                </span>
                <div className="flex flex-col sm:flex-row gap-1.5 flex-1">
                  <button
                    type="button"
                    onClick={() => setTrialType('baseline')}
                    className={`flex-1 py-1.5 px-3 rounded text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                      trialType === 'baseline'
                        ? 'bg-emerald-500 text-slate-950'
                        : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    Run A: Attentive Baseline (45s)
                  </button>
                  <button
                    type="button"
                    onClick={() => setTrialType('distracted')}
                    className={`flex-1 py-1.5 px-3 rounded text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                      trialType === 'distracted'
                        ? 'bg-amber-500 text-slate-950'
                        : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    Run B: Distracted + Side Stimuli (45s)
                  </button>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
              <button
                type="button"
                data-start="true"
                onClick={() => startDrivingSession(appMode, trialType)}
                className="px-6 sm:px-7 py-3 sm:py-3.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-display font-bold text-base sm:text-lg tracking-wide transition-transform active:scale-95 cursor-pointer whitespace-nowrap"
              >
                {appMode === 'calibration'
                  ? 'OPEN CALIBRATION & DRIVE'
                  : appMode === 'demo'
                  ? 'START DEMO DRIVE'
                  : `START ${trialType.toUpperCase()} TRIAL`}
              </button>

              <button
                type="button"
                onClick={() => openSettingsOnTab('sidedisplays')}
                className="px-4 py-3 sm:py-3.5 rounded-lg bg-slate-900/95 hover:bg-slate-800 text-slate-200 border border-slate-700 text-xs sm:text-sm font-medium transition-colors cursor-pointer whitespace-nowrap"
              >
                Connect Side Displays / QR
              </button>
            </div>
          </div>

          <div className="text-xs font-mono-tabular text-slate-300 tracking-wide">
            WASD / Arrows Drive · Hold L (or Q/E) Look Away · V Side Stimulus · S
            Settings · P Pause · R Restart
          </div>
        </div>
      )}

      {/* =====================================================================
          STATE 2: GAME-NATIVE MINIMAL DRIVING HUD (>= 88% Clear Viewport)
          ===================================================================== */}
      {gameState === 'playing' && (
        <div className="fixed inset-0 z-10 pointer-events-none flex flex-col justify-between p-3 sm:p-5">
          {/* TOP PERIMETER: Compact Run Timer + Center Safety Alert + Top-Right Game Icons */}
          <div className="flex items-start justify-between gap-3">
            {/* Top-Left Compact Telemetry Pill */}
            <div
              className={`bg-[#090d16]/85 border ${highContrastBorder} rounded-xl px-3.5 py-2 flex items-center gap-3 pointer-events-auto shadow-lg`}
            >
              <div>
                <div className="text-[10px] font-mono-tabular uppercase tracking-wider text-slate-400">
                  {appMode === 'experiment'
                    ? `TRIAL · ${hud.trialType.toUpperCase()}`
                    : `MODE · ${appMode.toUpperCase()}`}
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="font-display font-bold text-lg sm:text-xl text-white font-mono-tabular">
                    {appMode === 'experiment'
                      ? `${Math.max(
                          0,
                          Math.ceil(
                            EXPERIMENT_CONFIG.trialDurationSec -
                              hud.trialElapsedSec,
                          ),
                        )}s`
                      : `${hud.trialElapsedSec.toFixed(0)}s`}
                  </span>
                  <span className="text-xs font-mono-tabular text-slate-400">
                    {hud.distanceMeters}m
                  </span>
                </div>
              </div>

              <div className="h-7 w-px bg-slate-800" />

              <div
                data-testid="attention-status-badge"
                className={`px-2.5 py-1 rounded-lg border ${attentionBadgeStyle(
                  hud.attention.state,
                )}`}
              >
                <div className="text-[9px] font-mono-tabular uppercase tracking-wider opacity-85">
                  GAZE ({hud.attention.mode === 'webcam' ? 'CAM' : 'SIM'})
                </div>
                <div className="text-xs font-display font-bold tracking-wide">
                  {hud.attention.state}
                </div>
              </div>
            </div>

            {/* Top-Center Conspicuous Non-Obstructive Safety Warning */}
            <div className="flex-1 flex justify-center">
              {(hud.attention.state === 'DISTRACTED' ||
                hud.attention.state === 'POSSIBLY_DISTRACTED' ||
                hud.isOutOfLane) && (
                <div
                  role="alert"
                  data-testid="distraction-warning-banner"
                  className={`px-4 py-1.5 rounded-xl border-2 shadow-xl flex items-center gap-2.5 ${
                    hud.attention.state === 'DISTRACTED'
                      ? 'bg-rose-950/95 border-rose-500 text-white'
                      : 'bg-amber-950/95 border-amber-400 text-amber-100'
                  }`}
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="w-5 h-5 shrink-0"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                  >
                    <path d="M12 3L2 21h20L12 3z" />
                    <path d="M12 10v5" />
                    <circle cx="12" cy="18" r="1" fill="currentColor" />
                  </svg>
                  <div>
                    <div className="font-display font-bold text-xs sm:text-sm tracking-wide uppercase">
                      {hud.attention.state === 'DISTRACTED'
                        ? 'EYES ON ROAD — SUSTAINED DISTRACTION DETECTED'
                        : hud.attention.state === 'POSSIBLY_DISTRACTED'
                        ? 'HEAD POSE DEVIATING FROM FORWARD ROAD'
                        : 'LANE DEPARTURE — STEER BACK TO LANE'}
                    </div>
                    <div className="text-[11px] font-mono-tabular opacity-90">
                      Off-Road: {(hud.attention.sustainedDeviationMs / 1000).toFixed(1)}s · Drift: {hud.laneDeviationMeters.toFixed(2)}m
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Top-Right Compact In-Game Icon Bar */}
            <div className="flex items-center gap-1.5 pointer-events-auto">
              <button
                type="button"
                aria-label="Open Simulator Settings [S]"
                tabIndex={-1}
                onClick={(e) => {
                  e.currentTarget.blur();
                  openSettingsOnTab('display');
                }}
                className="h-9 px-2.5 rounded-lg bg-[#090d16]/85 border border-slate-700 hover:border-amber-400 text-slate-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
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

              <button
                type="button"
                aria-label={
                  audioSettings.muted ? 'Unmute Audio [M]' : 'Mute Audio [M]'
                }
                tabIndex={-1}
                onClick={(e) => {
                  e.currentTarget.blur();
                  soundRef.current.toggleMute();
                  setAudioSettings(soundRef.current.getSettings());
                }}
                className="w-9 h-9 rounded-lg bg-[#090d16]/85 border border-slate-700 hover:border-slate-500 flex items-center justify-center text-slate-200 cursor-pointer"
              >
                {audioSettings.muted ? (
                  <svg
                    viewBox="0 0 24 24"
                    className="w-4 h-4"
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
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M11 5L6 9H2v6h4l5 4V5z" />
                    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                  </svg>
                )}
              </button>

              <button
                type="button"
                aria-label="Restart Run [R]"
                tabIndex={-1}
                onClick={(e) => {
                  e.currentTarget.blur();
                  handleRestartRun();
                }}
                className="w-9 h-9 rounded-lg bg-[#090d16]/85 border border-slate-700 hover:border-slate-500 flex items-center justify-center text-slate-200 cursor-pointer"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                  <path d="M3 3v5h5" />
                </svg>
              </button>

              <button
                type="button"
                aria-label="Pause Simulation [P]"
                tabIndex={-1}
                onClick={(e) => {
                  e.currentTarget.blur();
                  setGameState('paused');
                  document.body.dataset.state = 'paused';
                }}
                className="w-9 h-9 rounded-lg bg-[#090d16]/85 border border-slate-700 hover:border-slate-500 flex items-center justify-center text-slate-200 cursor-pointer"
              >
                <svg
                  viewBox="0 0 24 24"
                  className="w-4 h-4"
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

          {/* MIDDLE PERIMETER: Compact Collapsible Left & Right Side-Display Previews */}
          {sideConfig.showEdgePreviews && (
            <div className="my-auto flex items-center justify-between pointer-events-none">
              {/* Left Side-Display Compact Preview */}
              <div className="flex items-center pointer-events-auto">
                {!leftPreviewCollapsed && (
                  <div
                    data-testid="left-display-preview"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      inputAdapterRef.current?.setManualLookAway(
                        hud.inputTelemetry.simulatingLookAwayLeft
                          ? 'none'
                          : 'left',
                      );
                    }}
                    className={`w-20 p-2 rounded-r-xl bg-[#090d16]/85 border-y border-r ${
                      hud.stimulus.activeSide === 'left'
                        ? 'border-amber-400 shadow-lg'
                        : 'border-slate-700/80'
                    } flex flex-col items-center cursor-pointer`}
                  >
                    <div className="flex items-center justify-between w-full text-[9px] font-mono-tabular text-slate-400 mb-1">
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
                      active={hud.stimulus.activeSide === 'left'}
                      pattern={sideConfig.leftPattern}
                      intensity={sideConfig.leftIntensity}
                      colorHex="#f59e0b"
                      compact
                    />
                    <div className="text-[9px] font-mono-tabular text-slate-400 mt-1">
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
                  onClick={() => setLeftPreviewCollapsed((c) => !c)}
                  className="h-10 w-5 rounded-r bg-slate-900/90 border-y border-r border-slate-700 text-slate-400 hover:text-white text-xs flex items-center justify-center cursor-pointer"
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
                  onClick={() => setRightPreviewCollapsed((c) => !c)}
                  className="h-10 w-5 rounded-l bg-slate-900/90 border-y border-l border-slate-700 text-slate-400 hover:text-white text-xs flex items-center justify-center cursor-pointer"
                >
                  {rightPreviewCollapsed ? '‹' : '›'}
                </button>
                {!rightPreviewCollapsed && (
                  <div
                    data-testid="right-display-preview"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      inputAdapterRef.current?.setManualLookAway(
                        hud.inputTelemetry.simulatingLookAwayRight
                          ? 'none'
                          : 'right',
                      );
                    }}
                    className={`w-20 p-2 rounded-l-xl bg-[#090d16]/85 border-y border-l ${
                      hud.stimulus.activeSide === 'right'
                        ? 'border-sky-400 shadow-lg'
                        : 'border-slate-700/80'
                    } flex flex-col items-center cursor-pointer`}
                  >
                    <div className="flex items-center justify-between w-full text-[9px] font-mono-tabular text-slate-400 mb-1">
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
                      active={hud.stimulus.activeSide === 'right'}
                      pattern={sideConfig.rightPattern}
                      intensity={sideConfig.rightIntensity}
                      colorHex="#06b6d4"
                      compact
                    />
                    <div className="text-[9px] font-mono-tabular text-slate-400 mt-1">
                      [E] Glance
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* BOTTOM PERIMETER: Game-Native Automotive Instrument Cluster */}
          <div
            className={`flex items-end gap-2.5 mt-auto ${
              showTouchControls
                ? 'justify-center pb-24 sm:pb-0'
                : 'justify-between'
            }`}
          >
            {/* Bottom-Left Automotive Speed, Gear & RPM Cluster */}
            <div
              className={`bg-[#090d16]/85 border ${highContrastBorder} rounded-xl px-3.5 py-2 shadow-lg pointer-events-auto flex items-center gap-3`}
            >
              <div>
                <div className="text-[10px] font-mono-tabular uppercase tracking-widest text-slate-400">
                  SPEED
                </div>
                <div className="flex items-baseline gap-1">
                  <span
                    data-testid="speed-readout"
                    className="font-display font-bold text-2xl sm:text-3xl text-white font-mono-tabular leading-none hud-text-stroke"
                  >
                    {hud.speedKmh}
                  </span>
                  <span className="text-[10px] font-mono-tabular text-amber-400 font-semibold">
                    KM/H
                  </span>
                </div>
              </div>

              {/* Drive Gear & RPM Bar */}
              <div className="flex flex-col gap-1 w-20 sm:w-24">
                <div className="flex items-center justify-between text-[10px] font-mono-tabular">
                  <span className="text-slate-400">GEAR</span>
                  <span className="text-amber-400 font-bold">D{hud.gear}</span>
                </div>
                <div className="w-full h-1.5 bg-slate-800 rounded overflow-hidden">
                  <div
                    className={`h-full ${
                      hud.rpmNormalized > 0.85 ? 'bg-rose-500' : 'bg-sky-400'
                    }`}
                    style={{
                      width: `${Math.round(hud.rpmNormalized * 100)}%`,
                    }}
                  />
                </div>
                <div className="text-[9px] font-mono-tabular text-slate-400 truncate">
                  {hud.inputTelemetry.activeSource.toUpperCase()} INPUT
                </div>
              </div>
            </div>

            {/* Bottom-Right Compact Lane Status & Trial Controls */}
            <div
              className={`bg-[#090d16]/85 border ${highContrastBorder} rounded-xl px-3.5 py-2 shadow-lg pointer-events-auto flex items-center gap-3`}
            >
              <div>
                <div className="text-[10px] font-mono-tabular uppercase tracking-widest text-slate-400">
                  LANE DRIFT
                </div>
                <div className="flex items-baseline gap-1">
                  <span
                    data-testid="lane-deviation-readout"
                    className={`font-display font-bold text-2xl sm:text-3xl font-mono-tabular leading-none ${
                      hud.isOutOfLane ? 'text-rose-400' : 'text-emerald-400'
                    }`}
                  >
                    {hud.laneDeviationMeters.toFixed(2)}m
                  </span>
                  <span className="text-[10px] font-mono-tabular text-slate-300">
                    {hud.isOutOfLane ? 'DEPART' : 'OK'}
                  </span>
                </div>
              </div>

              {!showTouchControls && (
                <div className="hidden sm:flex gap-3 text-xs font-mono-tabular border-l border-slate-800 pl-3">
                  <div>
                    <div className="text-[9px] text-slate-400">HITS</div>
                    <div className="text-sm font-bold text-white">
                      {hud.collisionsCount}
                    </div>
                  </div>
                  <div>
                    <div className="text-[9px] text-slate-400">GLANCES</div>
                    <div className="text-sm font-bold text-amber-400">
                      {hud.distractionCount}
                    </div>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-1.5">
                {!showTouchControls && (
                  <button
                    type="button"
                    tabIndex={-1}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      inputAdapterRef.current?.setManualLookAway(
                        isLookAwayActive ? 'none' : 'left',
                      );
                    }}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap ${
                      isLookAwayActive
                        ? 'bg-rose-600 text-white'
                        : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                    }`}
                  >
                    {isLookAwayActive ? 'Look Forward' : 'Look Away [L]'}
                  </button>
                )}

                <button
                  type="button"
                  tabIndex={-1}
                  onClick={finishCurrentTrialAndShowResults}
                  className="px-2.5 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-display font-bold text-xs cursor-pointer whitespace-nowrap"
                >
                  Results [F]
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Multi-Touch On-Screen Steering & Pedals Overlay for Mobile / Tablet */}
      {showTouchControls && (
        <TouchControlsOverlay
          inputAdapterRef={inputAdapterRef}
          isLookAwayActive={isLookAwayActive}
        />
      )}

      {/* =====================================================================
          DEDICATED IN-GAME SETTINGS & CONNECTION MODAL
          ===================================================================== */}
      {showSettingsModal && (
        <SettingsModal
          initialTab={settingsTab}
          onClose={() => setShowSettingsModal(false)}
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
          className="fixed inset-0 z-30 bg-[#090d16]/85 flex items-center justify-center p-4"
        >
          <div className="w-full max-w-md bg-[#0f172a] border border-slate-700 rounded-xl p-6 shadow-2xl">
            <div className="text-xs font-mono-tabular uppercase tracking-widest text-amber-400">
              SIMULATION PAUSED
            </div>
            <h2 className="text-2xl font-display font-bold text-white mt-1 mb-4">
              Session Paused
            </h2>

            <div className="grid grid-cols-3 gap-2.5 mb-6 bg-slate-950 p-3 rounded-lg border border-slate-800 font-mono-tabular">
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

            <div className="flex flex-col gap-2.5">
              <button
                type="button"
                onClick={() => {
                  setGameState('playing');
                  document.body.dataset.state = 'playing';
                }}
                className="w-full py-3 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-display font-bold text-base cursor-pointer"
              >
                Resume Driving
              </button>
              <button
                type="button"
                onClick={() => openSettingsOnTab('display')}
                className="w-full py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 font-semibold text-sm cursor-pointer"
              >
                Settings &amp; Side Displays
              </button>
              <button
                type="button"
                onClick={handleRestartRun}
                className="w-full py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 font-semibold text-sm cursor-pointer"
              >
                Restart Current Trial
              </button>
              <button
                type="button"
                onClick={finishCurrentTrialAndShowResults}
                className="w-full py-2.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-amber-300 font-semibold text-sm cursor-pointer"
              >
                End Run &amp; Compare Results
              </button>
              <button
                type="button"
                onClick={() => {
                  setGameState('title');
                  document.body.dataset.state = 'title';
                }}
                className="w-full py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-400 text-sm cursor-pointer"
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
          className="fixed inset-0 z-30 bg-[#090d16]/90 flex items-center justify-center p-4 overflow-y-auto"
        >
          <div className="w-full max-w-3xl bg-[#0f172a] border border-slate-700 rounded-xl p-6 md:p-8 shadow-2xl my-auto">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-4 mb-5">
              <div>
                <div className="text-xs font-mono-tabular uppercase tracking-widest text-amber-400">
                  EXHIBITION TELEMETRY REPORT · OBJECTIVE SESSION SUMMARY
                </div>
                <h2 className="text-2xl md:text-3xl font-display font-bold text-white mt-0.5">
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
              <div className="bg-slate-950 border border-slate-800 rounded-lg p-4">
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

              <div className="bg-slate-950 border border-amber-500/50 rounded-lg p-4">
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

            <div className="bg-slate-900/90 border border-slate-800 rounded-lg p-3.5 mb-6 text-xs text-slate-300 leading-relaxed">
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
                  className="px-5 py-3 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-display font-bold text-sm cursor-pointer whitespace-nowrap"
                >
                  Run Distracted Trial (45s)
                </button>
                <button
                  type="button"
                  onClick={() => startDrivingSession('experiment', 'baseline')}
                  className="px-5 py-3 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-display font-bold text-sm cursor-pointer whitespace-nowrap"
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
                className="px-4 py-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-medium cursor-pointer whitespace-nowrap"
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
