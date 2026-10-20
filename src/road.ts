import { ROAD_CONFIG } from './config.ts';

export interface RoadSample {
  s: number;
  centerX: number;
  elevationY: number;
  headingRad: number;
  curvature: number;
}

export type HazardType = 'sedan' | 'truck' | 'work_zone' | 'braking_car';

export interface RoadHazard {
  id: number;
  type: HazardType;
  s: number; // longitudinal distance along road (meters)
  laneIndex: 0 | 1; // 0 = left lane (-1.8m), 1 = right lane (+1.8m)
  lateralOffset: number; // meters from road center
  speed: number; // forward speed along road (m/s)
  width: number;
  length: number;
  colorHex: number;
  telegraphActive: boolean;
  brakeTriggered: boolean;
  passed: boolean;
  collided: boolean;
  nearMissed: boolean;
}

/**
 * Deterministic, smooth road centerline generator as a function of arc-length s (meters).
 * Combines gentle highway curves and subtle vertical undulations.
 */
export function getRoadSample(s: number): RoadSample {
  // Keep initial 60m straight so the driver spawns aligned on a clear vista
  const fade = Math.min(1, Math.max(0, (s - 35) / 50));
  const k1 = 0.009;
  const k2 = 0.0042;
  const k3 = 0.016;

  const centerX =
    fade *
    (Math.sin(s * k1) * 18 +
      Math.cos(s * k2 - 0.7) * 28 +
      Math.sin(s * k3 + 1.4) * 6.5);

  const dxds =
    fade *
    (Math.cos(s * k1) * 18 * k1 -
      Math.sin(s * k2 - 0.7) * 28 * k2 +
      Math.cos(s * k3 + 1.4) * 6.5 * k3);

  const d2xds2 =
    fade *
    (-Math.sin(s * k1) * 18 * k1 * k1 -
      Math.cos(s * k2 - 0.7) * 28 * k2 * k2 -
      Math.sin(s * k3 + 1.4) * 6.5 * k3 * k3);

  const elevationY =
    fade * (Math.sin(s * 0.0065) * 1.4 + Math.cos(s * 0.013) * 0.55);

  const headingRad = Math.atan(dxds);
  const curvature = d2xds2;

  return {
    s,
    centerX: centerX || 0,
    elevationY: elevationY || 0,
    headingRad: headingRad || 0,
    curvature: curvature || 0,
  };
}

/**
 * Computes lane metrics given vehicle lateral offset from road center.
 * Right lane center is +1.8m, Left lane center is -1.8m.
 */
export function evaluateLanePosition(lateralOffset: number, targetLane: 0 | 1 = 1) {
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
  const isHittingGuardrail = Math.abs(lateralOffset) >= ROAD_CONFIG.guardrailOffset - 0.6;

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
  0x38bdf8, // sky blue
  0xf59e0b, // amber
  0xe11d48, // crimson
  0x10b981, // emerald
  0xa855f7, // violet
  0xe2e8f0, // silver
];

export function generateInitialHazards(seed = 1042, count = 24): RoadHazard[] {
  const rng = createSeededRng(seed);
  const hazards: RoadHazard[] = [];
  let currentS = 68; // First hazard starts 68m ahead so first few seconds are completely clear

  for (let i = 0; i < count; i++) {
    const roll = rng();
    let type: HazardType = 'sedan';
    if (roll < 0.32) type = 'sedan';
    else if (roll < 0.56) type = 'braking_car';
    else if (roll < 0.8) type = 'work_zone';
    else type = 'truck';

    // Place slightly more hazards in lane 1 (driver's default right lane) to require active lane shifts
    const laneIndex: 0 | 1 = i % 3 === 1 ? 0 : 1;
    const lateralOffset =
      laneIndex === 1
        ? ROAD_CONFIG.playerDefaultLaneOffset
        : -ROAD_CONFIG.playerDefaultLaneOffset;

    const speed =
      type === 'work_zone'
        ? 0
        : type === 'truck'
        ? 10.5 + rng() * 3.0
        : type === 'braking_car'
        ? 15.0 + rng() * 3.0
        : 13.5 + rng() * 4.5;

    const width = type === 'truck' ? 2.3 : type === 'work_zone' ? 2.2 : 1.85;
    const length = type === 'truck' ? 7.2 : type === 'work_zone' ? 5.0 : 4.2;

    hazards.push({
      id: i + 1,
      type,
      s: currentS,
      laneIndex,
      lateralOffset,
      speed,
      width,
      length,
      colorHex: VEHICLE_PALETTE[i % VEHICLE_PALETTE.length],
      telegraphActive: false,
      brakeTriggered: false,
      passed: false,
      collided: false,
      nearMissed: false,
    });

    currentS += 48 + rng() * 34;
  }

  return hazards;
}
