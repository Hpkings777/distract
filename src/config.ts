export type QualityPreset = 'low' | 'balanced' | 'high';
export type LightingPreset = 'day' | 'dusk' | 'night';
export type MapPreset = 'alpine' | 'coastal' | 'urban' | 'desert';
export type CameraViewMode = 'cockpit' | 'chase' | 'hood';
export type TrafficDensity = 'none' | 'light' | 'medium' | 'normal' | 'heavy';
export type TrafficDensityPreset = TrafficDensity;
export type TrafficAggression = 'calm' | 'normal' | 'dynamic' | 'aggressive';
export type TrafficAggressionPreset = TrafficAggression;
export type AppMode = 'demo' | 'calibration' | 'experiment';
export type GameState = 'title' | 'playing' | 'paused' | 'gameover';
export type TouchControlsMode = 'auto' | 'always' | 'hidden';
export type SidePatternType = 'chevron' | 'rings' | 'matrix' | 'wave';
export type StimulusIntensityLevel = 'low' | 'medium' | 'high';

export type AttentionState =
  | 'INITIALIZING'
  | 'CALIBRATING'
  | 'ATTENTIVE'
  | 'DROWSY_WARNING'
  | 'DROWSY_CRITICAL'
  | 'POSSIBLY_DISTRACTED'
  | 'DISTRACTED'
  | 'CAMERA_UNAVAILABLE';

export const CAMERA_VIEW_MODES: Record<
  CameraViewMode,
  { label: string; shortKey: string }
> = {
  cockpit: { label: 'Cockpit View', shortKey: 'C' },
  chase: { label: 'Chase GT View', shortKey: 'C' },
  hood: { label: 'Hood Dash View', shortKey: 'C' },
};

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
    label: 'Performance (60+ FPS Mobile / Integrated)',
    maxPixelRatio: 1.0,
    shadows: false,
    drawDistance: 160,
    sceneryCount: 50,
    antialias: false,
  },
  balanced: {
    label: 'Balanced (Native 1080p PBR)',
    maxPixelRatio: 1.5,
    shadows: true,
    drawDistance: 230,
    sceneryCount: 80,
    antialias: true,
  },
  high: {
    label: 'Ultra AAA (Max Draw & Detail)',
    maxPixelRatio: 2.0,
    shadows: true,
    drawDistance: 300,
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
    label: 'Clear Daylight',
    skyHex: 0x386896,
    fogHex: 0x4b7ba8,
    fogDensity: 0.0032,
    hemiSkyHex: 0xdbeafe,
    hemiGroundHex: 0x334155,
    hemiIntensity: 1.3,
    sunHex: 0xfffbeb,
    sunIntensity: 2.6,
    headlightsActive: false,
  },
  dusk: {
    label: 'Golden Hour Sunset',
    skyHex: 0x182238,
    fogHex: 0x1e2942,
    fogDensity: 0.0038,
    hemiSkyHex: 0xfdba74,
    hemiGroundHex: 0x1e293b,
    hemiIntensity: 1.05,
    sunHex: 0xf97316,
    sunIntensity: 2.3,
    headlightsActive: true,
  },
  night: {
    label: 'Midnight Expressway',
    skyHex: 0x060911,
    fogHex: 0x080c17,
    fogDensity: 0.0044,
    hemiSkyHex: 0x38bdf8,
    hemiGroundHex: 0x090d16,
    hemiIntensity: 0.65,
    sunHex: 0x93c5fd,
    sunIntensity: 1.0,
    headlightsActive: true,
  },
};

export interface MapSettings {
  id: MapPreset;
  label: string;
  shortLabel: string;
  regionCode: string;
  subtitle: string;
  curveScale: number;
  elevationScale: number;
  hillScale: number;
  terrainColorHex: number;
  embankmentColorHex: number;
  vistaColorHex: number;
  waterEnabled: boolean;
  urbanBuildings: boolean;
  desertMesas: boolean;
  defaultLighting: LightingPreset;
}

export const MAP_PRESETS: Record<MapPreset, MapSettings> = {
  alpine: {
    id: 'alpine',
    label: 'Alpine Mountain Pass',
    shortLabel: 'ALPINE PASS',
    regionCode: 'SECTOR A-01 · SWISS ALPS',
    subtitle: 'High-elevation sweeping corners, pine & birch timberline, granite peaks',
    curveScale: 1.0,
    elevationScale: 1.0,
    hillScale: 1.0,
    terrainColorHex: 0x111c24,
    embankmentColorHex: 0x1e293b,
    vistaColorHex: 0x1e2f47,
    waterEnabled: false,
    urbanBuildings: false,
    desertMesas: false,
    defaultLighting: 'dusk',
  },
  coastal: {
    id: 'coastal',
    label: 'Pacific Coastal Highway',
    shortLabel: 'COASTAL HWY',
    regionCode: 'SECTOR C-04 · BIG SUR COAST',
    subtitle: 'Oceanfront cliffside viaducts, open sea horizon, sweeping coastal bends',
    curveScale: 1.18,
    elevationScale: 0.85,
    hillScale: 0.85,
    terrainColorHex: 0x1e2923,
    embankmentColorHex: 0x334139,
    vistaColorHex: 0x1e3a5f,
    waterEnabled: true,
    urbanBuildings: false,
    desertMesas: false,
    defaultLighting: 'day',
  },
  urban: {
    id: 'urban',
    label: 'Metro Bay Expressway',
    shortLabel: 'URBAN METRO',
    regionCode: 'SECTOR M-09 · TOKYO WANGAN',
    subtitle: 'Illuminated high-rise skyline, acoustic barriers, dense overhead gantries',
    curveScale: 0.78,
    elevationScale: 0.45,
    hillScale: 0.45,
    terrainColorHex: 0x0b0f19,
    embankmentColorHex: 0x1e293b,
    vistaColorHex: 0x0f172a,
    waterEnabled: true,
    urbanBuildings: true,
    desertMesas: false,
    defaultLighting: 'night',
  },
  desert: {
    id: 'desert',
    label: 'Red Rock Canyon Interstate',
    shortLabel: 'RED CANYON',
    regionCode: 'SECTOR D-07 · MOJAVE BASIN',
    subtitle: 'Fast long-radius desert sweepers, sandstone mesas, high-visibility vista',
    curveScale: 0.9,
    elevationScale: 1.15,
    hillScale: 1.15,
    terrainColorHex: 0x3b2119,
    embankmentColorHex: 0x5c3024,
    vistaColorHex: 0x6b3426,
    waterEnabled: false,
    urbanBuildings: false,
    desertMesas: true,
    defaultLighting: 'dusk',
  },
};

export interface TrafficConfig {
  density: TrafficDensity;
  aggression: TrafficAggression;
  allowWorkZones: boolean;
  speedMultiplier: number; // 0.6 to 1.4
}

export const DEFAULT_TRAFFIC_CONFIG: TrafficConfig = {
  density: 'normal',
  aggression: 'normal',
  allowWorkZones: true,
  speedMultiplier: 1.0,
};

export const TRAFFIC_DENSITY_COUNTS: Record<TrafficDensity, number> = {
  none: 0,
  light: 10,
  medium: 22,
  normal: 22,
  heavy: 36,
};

export const ROAD_CONFIG = {
  laneWidth: 3.6, // meters per lane (2 lanes total = 7.2m carriageway)
  numLanes: 2,
  totalRoadWidth: 7.2,
  shoulderWidth: 1.4,
  guardrailOffset: 5.0, // meters from road center
  segmentLength: 2.5,
  visibleSegments: 96,
  playerDefaultLaneOffset: 1.8, // center of right-hand lane (+1.8m from centerline)
  safeLaneTolerance: 1.15, // meters from lane center before lane departure warning
};

export const VEHICLE_CONFIG = {
  massKg: 1520, // kg (planted GT sports coupe)
  gravity: 9.81, // m/s^2
  maxEngineForceN: 18400, // Newtons peak tractive force
  maxBrakingForceN: 34500, // Newtons peak carbon-ceramic braking force
  airDensityRho: 1.225, // kg/m^3
  dragAreaCdA: 0.64, // sleek coupe Cd (0.29) * Frontal Area (2.2 m^2)
  rollingResistanceCrr: 0.014, // dimensionless tire rolling resistance
  offroadDragForceN: 12800, // additional drag when tires hit shoulder rumble strip
  maxSpeed: 36.11, // m/s (~130 km/h)
  cruiseTargetSpeed: 21.67, // m/s (~78 km/h)
  minSpeed: 0,
  acceleration: 12.1,
  brakingDecel: 22.5,
  coastDrag: 2.4,
  offroadDrag: 9.5,
  maxSteerAngle: 0.55, // radians normalized steer authority
  steerRate: 6.5, // rad/s progressive steering rack rate
  steerReturnRate: 8.0, // strong self-aligning tire torque
  lateralGrip: 10.2, // planted high-performance tire cornering stiffness
  lateralSteerAuthority: 11.4, // crisp lateral response
  tireGripMu: 0.96, // peak lateral tire friction coefficient
  understeerGradient: 0.34, // progressive high-speed understeer stability
  centrifugalScale: 0.34, // road curve drift push
  pitchStiffness: 12.5, // sport suspension longitudinal pitch damping
  rollStiffness: 12.0, // anti-roll bar lateral weight-transfer damping
  vehicleWidth: 1.88,
  vehicleLength: 4.35,
  collisionCooldown: 1.0, // seconds
  fixedSubstepDt: 1 / 120, // 120Hz fixed physics timestep
};

export const ATTENTION_CONFIG = {
  yawThresholdDeg: 16,
  pitchThresholdDeg: 13,
  possiblyDistractedDelayMs: 450,
  distractedDelayMs: 1350,
  recoveryGraceMs: 250,
  minConfidence: 0.45,
  calibrationSamplesRequired: 20,
  // Driver Monitoring System (DMS) Eye-Closure & Drowsiness configuration:
  eyesClosedThresholdSec: 5.0, // 5 seconds threshold before critical alert & vehicle slowdown
  eyesClosedWarningDelayMs: 400,
  emergencySlowdownDecel: 18.0, // m/s^2 emergency braking deceleration
};

export const EXPERIMENT_CONFIG = {
  trialDurationSec: 45,
  stimulusIntervalSec: 7.0,
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
