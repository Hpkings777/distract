export type QualityPreset = 'low' | 'balanced' | 'high';
export type LightingPreset = 'day' | 'dusk' | 'night';
export type AppMode = 'demo' | 'calibration' | 'experiment';
export type GameState = 'title' | 'playing' | 'paused' | 'gameover';
export type TouchControlsMode = 'auto' | 'always' | 'hidden';
export type SidePatternType = 'chevron' | 'rings' | 'matrix' | 'wave';
export type StimulusIntensityLevel = 'low' | 'medium' | 'high';

export type AttentionState =
  | 'INITIALIZING'
  | 'CALIBRATING'
  | 'ATTENTIVE'
  | 'POSSIBLY_DISTRACTED'
  | 'DISTRACTED'
  | 'CAMERA_UNAVAILABLE';

export interface QualitySettings {
  label: string;
  maxPixelRatio: number;
  shadows: boolean;
  drawDistance: number;
  sceneryCount: number;
  antialias: boolean;
}

export const QUALITY_PRESETS: Record<QualityPreset, QualitySettings> = {
  low: {
    label: 'Low (Integrated GPU / Mobile)',
    maxPixelRatio: 1.0,
    shadows: false,
    drawDistance: 140,
    sceneryCount: 45,
    antialias: false,
  },
  balanced: {
    label: 'Medium (Balanced)',
    maxPixelRatio: 1.5,
    shadows: true,
    drawDistance: 210,
    sceneryCount: 75,
    antialias: true,
  },
  high: {
    label: 'High Fidelity',
    maxPixelRatio: 2.0,
    shadows: true,
    drawDistance: 280,
    sceneryCount: 110,
    antialias: true,
  },
};

export interface LightingSettings {
  label: string;
  skyHex: number;
  fogHex: number;
  fogDensity: number;
  hemiSkyHex: number;
  hemiGroundHex: number;
  hemiIntensity: number;
  sunHex: number;
  sunIntensity: number;
  headlightsActive: boolean;
}

export const LIGHTING_PRESETS: Record<LightingPreset, LightingSettings> = {
  day: {
    label: 'Daylight Clear',
    skyHex: 0x386694,
    fogHex: 0x4876a3,
    fogDensity: 0.0038,
    hemiSkyHex: 0xbae6fd,
    hemiGroundHex: 0x334155,
    hemiIntensity: 1.25,
    sunHex: 0xfffbeb,
    sunIntensity: 2.5,
    headlightsActive: false,
  },
  dusk: {
    label: 'Golden Dusk',
    skyHex: 0x161f33,
    fogHex: 0x1b2439,
    fogDensity: 0.0045,
    hemiSkyHex: 0xfdba74,
    hemiGroundHex: 0x1e293b,
    hemiIntensity: 0.95,
    sunHex: 0xf97316,
    sunIntensity: 2.1,
    headlightsActive: true,
  },
  night: {
    label: 'Night Highway',
    skyHex: 0x070b14,
    fogHex: 0x080d18,
    fogDensity: 0.0052,
    hemiSkyHex: 0x38bdf8,
    hemiGroundHex: 0x0f172a,
    hemiIntensity: 0.55,
    sunHex: 0x93c5fd,
    sunIntensity: 0.9,
    headlightsActive: true,
  },
};

export const ROAD_CONFIG = {
  laneWidth: 3.6, // meters per lane (2 lanes total = 7.2m carriageway)
  numLanes: 2,
  totalRoadWidth: 7.2,
  shoulderWidth: 1.4,
  guardrailOffset: 5.0, // meters from road center
  segmentLength: 2.5,
  visibleSegments: 90,
  playerDefaultLaneOffset: 1.8, // center of right-hand lane (+1.8m from centerline)
  safeLaneTolerance: 1.15, // meters from lane center before lane departure warning
};

/**
 * Coherent Vehicle-Dynamics Parameters.
 * NOTE ON APPROXIMATIONS:
 * - Mass (1420 kg), aerodynamic drag (Cd*A ~ 0.67 m^2), and rolling resistance (Crr = 0.014)
 *   follow standard compact sedan longitudinal equations: F_net = F_trac - F_brake - F_aero - F_roll.
 * - Lateral dynamics use a bounded single-track bicycle approximation with tire grip saturation
 *   (mu = 0.92 * g) and a progressive high-speed understeer gradient rather than a full Pacejka
 *   magic-formula slip-angle solver, ensuring predictable stability on keyboards and mobile touchscreens.
 */
export const VEHICLE_CONFIG = {
  massKg: 1420, // kg (compact passenger vehicle)
  gravity: 9.81, // m/s^2
  maxEngineForceN: 16800, // Newtons peak tractive force
  maxBrakingForceN: 31500, // Newtons peak braking force
  airDensityRho: 1.225, // kg/m^3
  dragAreaCdA: 0.68, // Cd (0.31) * Frontal Area (2.2 m^2)
  rollingResistanceCrr: 0.015, // dimensionless tire rolling resistance
  offroadDragForceN: 12500, // additional drag when tires hit gravel shoulder / rumble strip
  maxSpeed: 33.33, // m/s (~120 km/h)
  cruiseTargetSpeed: 21.67, // m/s (~78 km/h)
  minSpeed: 0,
  // Legacy compatibility properties for unit tests
  acceleration: 11.5,
  brakingDecel: 22.0,
  coastDrag: 2.4,
  offroadDrag: 9.5,
  maxSteerAngle: 0.55, // radians normalized steer authority
  steerRate: 6.2, // rad/s steering actuator rate
  steerReturnRate: 7.2, // self-centering rate
  lateralGrip: 9.2, // lateral velocity damping / cornering stiffness
  lateralSteerAuthority: 11.2, // lateral responsiveness
  tireGripMu: 0.92, // peak lateral tire friction coefficient (limits lateral accel to mu * g)
  understeerGradient: 0.36, // speed-dependent understeer reduction factor
  centrifugalScale: 0.36, // road curve drift push
  pitchStiffness: 11.0, // longitudinal weight-transfer damping
  rollStiffness: 10.5, // lateral weight-transfer body roll damping
  vehicleWidth: 1.85,
  vehicleLength: 4.2,
  collisionCooldown: 1.1, // seconds
  fixedSubstepDt: 1 / 120, // 120Hz fixed physics timestep
};

export const ATTENTION_CONFIG = {
  yawThresholdDeg: 16, // horizontal head turn threshold in degrees
  pitchThresholdDeg: 13, // vertical head pitch threshold in degrees
  possiblyDistractedDelayMs: 450, // grace period before POSSIBLY_DISTRACTED
  distractedDelayMs: 1350, // sustained threshold before DISTRACTED alarm
  recoveryGraceMs: 250, // time required looking forward to clear warning
  minConfidence: 0.45,
  calibrationSamplesRequired: 20,
};

export const EXPERIMENT_CONFIG = {
  trialDurationSec: 45, // 45s per run for crisp science exhibition pacing
  stimulusIntervalSec: 7.0, // how often side stimuli trigger in experiment mode
  stimulusDurationSec: 3.4,
};

export interface SideDisplayConfig {
  leftEnabled: boolean;
  rightEnabled: boolean;
  leftPattern: SidePatternType;
  rightPattern: SidePatternType;
  leftIntensity: StimulusIntensityLevel;
  rightIntensity: StimulusIntensityLevel;
  showEdgePreviews: boolean;
  roomId: string;
}

export const DEFAULT_SIDE_DISPLAY_CONFIG: SideDisplayConfig = {
  leftEnabled: true,
  rightEnabled: true,
  leftPattern: 'chevron',
  rightPattern: 'rings',
  leftIntensity: 'medium',
  rightIntensity: 'medium',
  showEdgePreviews: true,
  roomId: 'exhibition',
};

export interface AudioSettings {
  muted: boolean;
  engineVolume: number; // 0..1
  roadVolume: number; // 0..1
  alertVolume: number; // 0..1
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  muted: false,
  engineVolume: 0.45,
  roadVolume: 0.65,
  alertVolume: 0.8,
};

export interface AccessibilitySettings {
  highContrastHud: boolean;
  reducedMotion: boolean;
  colorblindSafeMarkers: boolean;
  touchControlsMode: TouchControlsMode;
}

export const DEFAULT_ACCESSIBILITY_SETTINGS: AccessibilitySettings = {
  highContrastHud: false,
  reducedMotion: false,
  colorblindSafeMarkers: false,
  touchControlsMode: 'auto',
};
