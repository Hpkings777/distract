import {
  DEFAULT_TRAFFIC_CONFIG,
  MAP_PRESETS,
  ROAD_CONFIG,
  TRAFFIC_DENSITY_COUNTS,
} from './config.ts';
import type { MapPreset, TrafficConfig } from './config.ts';

export interface RoadSample {
  s: number;
  centerX: number;
  elevationY: number;
  headingRad: number;
  pitchRad: number;
  curvature: number;
}

export type HazardType =
  | 'sedan'
  | 'suv'
  | 'truck'
  | 'work_zone'
  | 'braking_car'
  | 'coupe'
  | 'patrol';

export interface RoadHazard {
  id: number;
  type: HazardType;
  s: number; // longitudinal distance along road (meters)
  laneIndex: 0 | 1; // 0 = left lane (-1.8m), 1 = right lane (+1.8m)
  lateralOffset: number; // meters from road center
  speed: number; // forward speed along road (m/s)
  baseSpeed: number; // preferred cruise speed (m/s)
  width: number;
  length: number;
  colorHex: number;
  telegraphActive: boolean;
  brakeTriggered: boolean;
  passed: boolean;
  collided: boolean;
  nearMissed: boolean;
  laneChangeTimer?: number;
  targetLateralOffset?: number;
  turnSignal?: 'none' | 'left' | 'right';
}

let activeRoadMapPreset: MapPreset = 'alpine';

export function setActiveRoadMapPreset(preset: MapPreset): void {
  activeRoadMapPreset = preset;
}

export function getActiveRoadMapPreset(): MapPreset {
  return activeRoadMapPreset;
}

/**
 * Deterministic, C2-continuous road centerline generator as a function of arc-length s (meters).
 * Uses zero-origin harmonic waves paired with exact analytical product-rule derivatives
 * so there is never any sideways warp at the start or normal mismatch on curves.
 */
export function getRoadSample(
  s: number,
  mapOverride?: MapPreset,
): RoadSample {
  const mapCfg = MAP_PRESETS[mapOverride ?? activeRoadMapPreset];
  const cScale = mapCfg.curveScale;
  const eScale = mapCfg.elevationScale;

  // Smooth C2 quintic ramp from s = 25m to s = 95m so the initial launch corridor is dead straight
  const rampStart = 25;
  const rampSpan = 70;
  const u = Math.min(1, Math.max(0, (s - rampStart) / rampSpan));
  const u2 = u * u;
  const u3 = u2 * u;
  const u4 = u3 * u;
  const u5 = u4 * u;

  // Quintic smoothstep: fade(u) = 6u^5 - 15u^4 + 10u^3
  const fade = 6 * u5 - 15 * u4 + 10 * u3;
  const dfade =
    u > 0 && u < 1 ? (30 * u4 - 60 * u3 + 30 * u2) / rampSpan : 0;
  const d2fade =
    u > 0 && u < 1
      ? (120 * u3 - 180 * u2 + 60 * u) / (rampSpan * rampSpan)
      : 0;

  const ds = Math.max(0, s - rampStart);
  const k1 = 0.0075;
  const k2 = 0.0038;
  const k3 = 0.0145;

  const a1 = 22.0 * cScale;
  const a2 = 32.0 * cScale;
  const a3 = 6.8 * cScale;

  // Pure sine waves anchored at ds = 0 so f(rampStart) === 0
  const f =
    Math.sin(ds * k1) * a1 +
    Math.sin(ds * k2) * a2 +
    Math.sin(ds * k3) * a3;

  const df =
    Math.cos(ds * k1) * a1 * k1 +
    Math.cos(ds * k2) * a2 * k2 +
    Math.cos(ds * k3) * a3 * k3;

  const d2f =
    -Math.sin(ds * k1) * a1 * k1 * k1 -
    Math.sin(ds * k2) * a2 * k2 * k2 -
    Math.sin(ds * k3) * a3 * k3 * k3;

  // Exact product rule derivatives: X(s) = fade(s) * f(s)
  const centerX = fade * f;
  const dxds = fade * df + dfade * f;
  const d2xds2 = fade * d2f + 2 * dfade * df + d2fade * f;

  // Vertical elevation wave & exact slope derivative dy/ds
  const ke1 = 0.0058;
  const ke2 = 0.012;
  const ae1 = 1.65 * eScale;
  const ae2 = 0.65 * eScale;

  const fy = Math.sin(ds * ke1) * ae1 + Math.sin(ds * ke2) * ae2;
  const dfy =
    Math.cos(ds * ke1) * ae1 * ke1 + Math.cos(ds * ke2) * ae2 * ke2;

  const elevationY = fade * fy;
  const dyds = fade * dfy + dfade * fy;

  const headingRad = Math.atan(dxds);
  const pitchRad = Math.atan(dyds);
  const curvature = d2xds2;

  return {
    s,
    centerX: centerX || 0,
    elevationY: elevationY || 0,
    headingRad: headingRad || 0,
    pitchRad: pitchRad || 0,
    curvature: curvature || 0,
  };
}

/**
 * Computes lane metrics given vehicle lateral offset from road center.
 * Right lane center is +1.8m, Left lane center is -1.8m.
 */
export function evaluateLanePosition(
  lateralOffset: number,
  targetLane: 0 | 1 = 1,
) {
  const targetCenter =
    targetLane === 1
      ? ROAD_CONFIG.playerDefaultLaneOffset
      : -ROAD_CONFIG.playerDefaultLaneOffset;

  const deviationFromTargetLane = Math.abs(lateralOffset - targetCenter);
  const nearestLaneCenter =
    lateralOffset >= 0
      ? ROAD_CONFIG.playerDefaultLaneOffset
      : -ROAD_CONFIG.playerDefaultLaneOffset;
  const deviationFromNearestLane = Math.abs(lateralOffset - nearestLaneCenter);

  const halfRoad = ROAD_CONFIG.totalRoadWidth * 0.5;
  const isOutOfLane = deviationFromTargetLane > ROAD_CONFIG.safeLaneTolerance;
  const isOnShoulder = Math.abs(lateralOffset) > halfRoad - 0.35;
  const isHittingGuardrail =
    Math.abs(lateralOffset) >= ROAD_CONFIG.guardrailOffset - 0.6;

  return {
    targetCenter,
    deviationFromTargetLane,
    deviationFromNearestLane,
    isOutOfLane,
    isOnShoulder,
    isHittingGuardrail,
  };
}

/**
 * Deterministic pseudo-random generator (Mulberry32) so baseline and distracted trials
 * can face comparable road hazard sequences.
 */
export function createSeededRng(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VEHICLE_PALETTE = [
  0x1e3a8a, // midnight sapphire metallic
  0x0284c7, // performance cyan metallic
  0xd97706, // solaris amber gold
  0xdc2626, // corsa crimson red
  0x059669, // british racing green
  0x475569, // gunmetal titanium
  0xf8fafc, // championship pearl white
  0x312e81, // deep indigo metallic
];

export function generateInitialHazards(
  seed = 1042,
  count?: number,
  trafficConfig: TrafficConfig = DEFAULT_TRAFFIC_CONFIG,
): RoadHazard[] {
  const effectiveCount =
    count !== undefined
      ? count
      : TRAFFIC_DENSITY_COUNTS[trafficConfig.density];

  if (effectiveCount <= 0) {
    return [];
  }

  const rng = createSeededRng(seed);
  const hazards: RoadHazard[] = [];
  const spacingScale =
    trafficConfig.density === 'heavy'
      ? 0.72
      : trafficConfig.density === 'light'
      ? 1.38
      : 1.0;

  let currentS = 72; // First vehicle starts 72m ahead so initial launch is 100% clear

  for (let i = 0; i < effectiveCount; i++) {
    const roll = rng();
    let type: HazardType = 'sedan';
    if (roll < 0.22) type = 'sedan';
    else if (roll < 0.42) type = 'coupe';
    else if (roll < 0.60) type = 'suv';
    else if (roll < 0.76) type = 'braking_car';
    else if (roll < 0.87) {
      type = trafficConfig.allowWorkZones ? 'work_zone' : 'patrol';
    } else if (roll < 0.93) {
      type = 'patrol';
    } else {
      type = 'truck';
    }

    // Alternate lanes with slight bias towards lane 1 (driver's lane)
    const laneIndex: 0 | 1 = i % 3 === 1 ? 0 : 1;
    const lateralOffset =
      laneIndex === 1
        ? ROAD_CONFIG.playerDefaultLaneOffset
        : -ROAD_CONFIG.playerDefaultLaneOffset;

    const speedMult = trafficConfig.speedMultiplier ?? 1.0;
    const rawSpeed =
      type === 'work_zone'
        ? 0
        : type === 'truck'
        ? 11.8 + rng() * 2.6
        : type === 'braking_car'
        ? 15.8 + rng() * 2.4
        : type === 'coupe' || type === 'patrol'
        ? 16.5 + rng() * 4.2
        : type === 'suv'
        ? 14.5 + rng() * 3.4
        : 15.0 + rng() * 3.8;

    const speed = type === 'work_zone' ? 0 : rawSpeed * speedMult;

    const width =
      type === 'truck'
        ? 2.38
        : type === 'work_zone'
        ? 2.2
        : type === 'suv'
        ? 1.98
        : type === 'coupe'
        ? 1.92
        : 1.86;

    const length =
      type === 'truck'
        ? 7.5
        : type === 'work_zone'
        ? 5.0
        : type === 'suv'
        ? 4.65
        : type === 'coupe'
        ? 4.35
        : 4.4;

    hazards.push({
      id: i + 1,
      type,
      s: currentS,
      laneIndex,
      lateralOffset,
      speed,
      baseSpeed: speed,
      width,
      length,
      colorHex: VEHICLE_PALETTE[i % VEHICLE_PALETTE.length],
      telegraphActive: false,
      brakeTriggered: false,
      passed: false,
      collided: false,
      nearMissed: false,
      laneChangeTimer: 0,
      targetLateralOffset: lateralOffset,
      turnSignal: 'none',
    });

    currentS += (46 + rng() * 34) * spacingScale;
  }

  return hazards;
}
