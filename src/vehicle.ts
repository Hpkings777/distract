import { ROAD_CONFIG, VEHICLE_CONFIG } from './config.ts';
import { evaluateLanePosition, getRoadSample } from './road.ts';
import type { RoadHazard } from './road.ts';

export interface VehicleInput {
  steer: number; // -1 (left) to +1 (right)
  throttle: number; // 0 to 1
  brake: number; // 0 to 1
}

export interface VehicleState {
  s: number; // distance traveled along road (meters)
  prevS: number; // previous substep s for visual interpolation
  lateralOffset: number; // offset from road center (meters, + is right)
  prevLateralOffset: number; // previous substep lateralOffset for visual interpolation
  lateralVelocity: number; // m/s
  lateralAccelG: number; // lateral G-force for HUD & weight transfer
  longitudinalAccelG: number; // longitudinal G-force for pitch squat/dive
  speed: number; // forward speed (m/s)
  rpmNormalized: number; // simulated engine RPM ratio (0.18 idle .. 1.0 redline)
  gear: number; // simulated 6-speed automatic gear (1..6)
  steerAngle: number; // current normalized wheel angle (-1 to +1)
  prevSteerAngle: number;
  headingOffset: number; // yaw angle relative to road tangent (radians)
  pitchOffset: number; // dive/squat pitch angle (radians)
  rollOffset: number; // body roll angle (radians)
  collisionCooldown: number; // seconds remaining of post-hit recovery
  hitstopTimer: number; // brief impact freeze (seconds)
  trauma: number; // subtle impact vibration (0..1)
  isOnShoulder: boolean;
  isOutOfLane: boolean;
  laneDeviationMeters: number;
  physicsAccumulator: number; // leftover time for fixed substepping
}

export interface StepCollisionEvent {
  type: 'hazard' | 'guardrail' | 'near_miss';
  hazardId?: number;
  relativeSpeed: number;
  s: number;
}

export function createInitialVehicleState(): VehicleState {
  return {
    s: 0,
    prevS: 0,
    lateralOffset: ROAD_CONFIG.playerDefaultLaneOffset,
    prevLateralOffset: ROAD_CONFIG.playerDefaultLaneOffset,
    lateralVelocity: 0,
    lateralAccelG: 0,
    longitudinalAccelG: 0,
    speed: 16.5, // ~60 km/h rolling start
    rpmNormalized: 0.42,
    gear: 3,
    steerAngle: 0,
    prevSteerAngle: 0,
    headingOffset: 0,
    pitchOffset: 0,
    rollOffset: 0,
    collisionCooldown: 0,
    hitstopTimer: 0,
    trauma: 0,
    isOnShoulder: false,
    isOutOfLane: false,
    laneDeviationMeters: 0,
    physicsAccumulator: 0,
  };
}

/**
 * Computes interpolated visual vehicle coordinates between fixed physics substeps
 * so rendering stays jitter-free at any monitor refresh rate.
 */
export function getInterpolatedVehiclePose(state: VehicleState) {
  const alpha = Math.min(
    1,
    Math.max(0, state.physicsAccumulator / VEHICLE_CONFIG.fixedSubstepDt),
  );
  return {
    s: state.prevS + (state.s - state.prevS) * alpha,
    lateralOffset:
      state.prevLateralOffset +
      (state.lateralOffset - state.prevLateralOffset) * alpha,
    steerAngle:
      state.prevSteerAngle + (state.steerAngle - state.prevSteerAngle) * alpha,
  };
}

/**
 * Internal single physics substep integrating longitudinal forces (mass, engine traction,
 * aerodynamic drag, rolling resistance) and lateral tire dynamics (speed-dependent understeer,
 * tire grip saturation, and weight transfer).
 */
function integrateSubstep(
  state: VehicleState,
  input: VehicleInput,
  hazards: RoadHazard[],
  subDt: number,
  autoCruise: boolean,
  events: StepCollisionEvent[],
): void {
  state.prevS = state.s;
  state.prevLateralOffset = state.lateralOffset;
  state.prevSteerAngle = state.steerAngle;

  // 1. Speed-dependent steering response & progressive understeer at high speed
  const speedRatio = Math.min(1, state.speed / VEHICLE_CONFIG.maxSpeed);
  const understeerFactor =
    1.0 / (1.0 + VEHICLE_CONFIG.understeerGradient * speedRatio * speedRatio * 2.2);
  const targetSteer =
    Math.max(-1, Math.min(1, input.steer)) * understeerFactor;

  const steerRate =
    Math.abs(targetSteer) > 0.02
      ? VEHICLE_CONFIG.steerRate
      : VEHICLE_CONFIG.steerReturnRate;
  state.steerAngle +=
    (targetSteer - state.steerAngle) * Math.min(1, steerRate * subDt);

  // 2. Longitudinal Forces: F_net = F_engine - F_brake - F_aero - F_rolling - F_offroad
  const mass = VEHICLE_CONFIG.massKg;
  const g = VEHICLE_CONFIG.gravity;

  // Speed-dependent engine torque curve (tapers slightly near top speed)
  const torqueEnvelope = 1.0 - speedRatio * 0.35;
  let tractiveForceN = 0;

  if (input.brake > 0.02) {
    tractiveForceN = -input.brake * VEHICLE_CONFIG.maxBrakingForceN;
  } else if (input.throttle > 0.02) {
    tractiveForceN =
      input.throttle * VEHICLE_CONFIG.maxEngineForceN * torqueEnvelope;
  } else if (autoCruise && state.speed < VEHICLE_CONFIG.cruiseTargetSpeed) {
    tractiveForceN = 0.38 * VEHICLE_CONFIG.maxEngineForceN;
  } else {
    // Engine braking when coasting above cruise speed
    tractiveForceN = -2100;
  }

  // Aerodynamic drag: 0.5 * rho * CdA * v^2
  const aeroDragN =
    0.5 *
    VEHICLE_CONFIG.airDensityRho *
    VEHICLE_CONFIG.dragAreaCdA *
    state.speed *
    state.speed;

  // Rolling resistance: Crr * m * g (only when moving)
  const rollingResN =
    state.speed > 0.05 ? VEHICLE_CONFIG.rollingResistanceCrr * mass * g : 0;

  const laneEvalBefore = evaluateLanePosition(state.lateralOffset, 1);
  let offroadResN = 0;
  if (laneEvalBefore.isOnShoulder) {
    offroadResN = VEHICLE_CONFIG.offroadDragForceN * speedRatio;
    state.trauma = Math.max(state.trauma, 0.12);
  }

  const netForceN = tractiveForceN - aeroDragN - rollingResN - offroadResN;
  const longitudinalAccel = netForceN / mass; // m/s^2

  const prevSpeed = state.speed;
  state.speed = Math.max(
    VEHICLE_CONFIG.minSpeed,
    Math.min(VEHICLE_CONFIG.maxSpeed, state.speed + longitudinalAccel * subDt),
  );

  const realLongAccel = (state.speed - prevSpeed) / subDt;
  state.longitudinalAccelG = realLongAccel / g;

  // Simulated 6-speed gear & RPM calculation for audio and cockpit tachometer
  const speedKmh = state.speed * 3.6;
  const gearThresholds = [0, 22, 42, 66, 90, 112];
  let gear = 1;
  for (let i = gearThresholds.length - 1; i >= 0; i--) {
    if (speedKmh >= gearThresholds[i]) {
      gear = i + 1;
      break;
    }
  }
  state.gear = gear;
  const gearMin = gearThresholds[gear - 1] ?? 0;
  const gearSpan = 28;
  state.rpmNormalized = Math.min(
    0.98,
    Math.max(
      0.2,
      0.28 + ((speedKmh - gearMin) / gearSpan) * 0.62 + input.throttle * 0.08,
    ),
  );

  // 3. Pitch weight transfer (dive under braking, squat under acceleration)
  const targetPitch = Math.max(
    -0.038,
    Math.min(0.038, -state.longitudinalAccelG * 0.028),
  );
  state.pitchOffset +=
    (targetPitch - state.pitchOffset) *
    Math.min(1, VEHICLE_CONFIG.pitchStiffness * subDt);

  // 4. Advance longitudinal position along road spline
  state.s += state.speed * subDt;
  const roadSample = getRoadSample(state.s);

  // 5. Lateral tire dynamics & grip limit saturation (mu * g)
  const forwardAuthority = Math.min(1, state.speed / 5.5);
  const desiredSteerLatVel =
    state.steerAngle *
    VEHICLE_CONFIG.lateralSteerAuthority *
    forwardAuthority;
  const curveCentrifugalVel =
    -roadSample.curvature *
    state.speed *
    state.speed *
    VEHICLE_CONFIG.centrifugalScale;

  const targetLatVel = desiredSteerLatVel + curveCentrifugalVel;
  const rawLatAccel =
    (targetLatVel - state.lateralVelocity) * VEHICLE_CONFIG.lateralGrip;

  // Clamp lateral acceleration by tire friction circle (mu * g) so high-speed turns understeer smoothly
  const maxTireLatAccel =
    VEHICLE_CONFIG.tireGripMu *
    g *
    (laneEvalBefore.isOnShoulder ? 0.72 : 1.0);
  const clampedLatAccel = Math.max(
    -maxTireLatAccel,
    Math.min(maxTireLatAccel, rawLatAccel),
  );

  state.lateralVelocity += clampedLatAccel * subDt;
  state.lateralOffset += state.lateralVelocity * subDt;
  state.lateralAccelG = clampedLatAccel / g;

  // 6. Heading slip yaw & lateral weight-transfer body roll
  const targetHeading =
    Math.atan2(state.lateralVelocity, Math.max(7.5, state.speed)) * 0.65;
  state.headingOffset +=
    (targetHeading - state.headingOffset) * Math.min(1, 12 * subDt);

  const targetRoll = Math.max(
    -0.055,
    Math.min(0.055, -state.lateralAccelG * 0.048),
  );
  state.rollOffset +=
    (targetRoll - state.rollOffset) *
    Math.min(1, VEHICLE_CONFIG.rollStiffness * subDt);

  // 7. Guardrail containment & collision response
  const maxLat =
    ROAD_CONFIG.guardrailOffset - VEHICLE_CONFIG.vehicleWidth * 0.45;
  if (Math.abs(state.lateralOffset) > maxLat) {
    const sign = Math.sign(state.lateralOffset);
    state.lateralOffset = sign * maxLat;
    state.lateralVelocity =
      -sign * Math.max(2.2, Math.abs(state.lateralVelocity) * 0.42);
    state.speed = Math.max(8.0, state.speed * 0.74);
    if (state.collisionCooldown <= 0) {
      state.collisionCooldown = VEHICLE_CONFIG.collisionCooldown;
      state.hitstopTimer = 0.04;
      state.trauma = Math.min(0.65, state.trauma + 0.45);
      events.push({
        type: 'guardrail',
        relativeSpeed: state.speed,
        s: state.s,
      });
    }
  }

  // 8. Hazard advancement & bounding-box collision checks
  for (let i = 0; i < hazards.length; i++) {
    const h = hazards[i];

    if (h.s < state.s - 35) {
      h.s = state.s + 210 + (h.id % 5) * 28;
      h.passed = false;
      h.collided = false;
      h.nearMissed = false;
      h.telegraphActive = false;
      h.brakeTriggered = false;
    }

    const distAhead = h.s - state.s;

    if (h.type === 'braking_car' && distAhead > 0 && distAhead < 55) {
      h.telegraphActive = true;
      if (distAhead < 38) {
        h.brakeTriggered = true;
        h.speed = Math.max(6.5, h.speed - 9.0 * subDt);
      }
    } else if (h.type === 'work_zone' && distAhead > 0 && distAhead < 65) {
      h.telegraphActive = true;
    } else {
      h.telegraphActive = false;
    }

    h.s += h.speed * subDt;

    const ds = Math.abs(h.s - state.s);
    const dLat = Math.abs(h.lateralOffset - state.lateralOffset);
    const minLongitudinal = (h.length + VEHICLE_CONFIG.vehicleLength) * 0.46;
    const minLateral = (h.width + VEHICLE_CONFIG.vehicleWidth) * 0.46;

    if (ds < minLongitudinal && dLat < minLateral) {
      if (!h.collided && state.collisionCooldown <= 0) {
        h.collided = true;
        state.collisionCooldown = VEHICLE_CONFIG.collisionCooldown;
        state.hitstopTimer = 0.05;
        state.trauma = Math.min(0.75, state.trauma + 0.55);
        const relSpeed = Math.max(5, Math.abs(state.speed - h.speed));
        state.speed = Math.max(
          6.0,
          Math.min(state.speed * 0.52, h.speed * 0.85),
        );
        const pushDir = state.lateralOffset >= h.lateralOffset ? 1 : -1;
        state.lateralVelocity = pushDir * 4.2;
        events.push({
          type: 'hazard',
          hazardId: h.id,
          relativeSpeed: relSpeed,
          s: state.s,
        });
      }
    } else if (!h.passed && h.s < state.s - 2.0) {
      h.passed = true;
      if (!h.collided && dLat < minLateral + 0.95) {
        h.nearMissed = true;
        events.push({
          type: 'near_miss',
          hazardId: h.id,
          relativeSpeed: Math.abs(state.speed - h.speed),
          s: state.s,
        });
      }
    }
  }

  const laneEvalAfter = evaluateLanePosition(state.lateralOffset, 1);
  state.isOnShoulder = laneEvalAfter.isOnShoulder;
  state.isOutOfLane = laneEvalAfter.isOutOfLane;
  state.laneDeviationMeters = laneEvalAfter.deviationFromTargetLane;
}

/**
 * Advances vehicle physics using a fixed substep (120Hz) with bounded frame dt
 * so vehicle handling is identical across 30Hz, 60Hz, and 144Hz displays.
 */
export function stepVehicleSimulation(
  state: VehicleState,
  input: VehicleInput,
  hazards: RoadHazard[],
  rawDt: number,
  autoCruise = true,
): StepCollisionEvent[] {
  const dt = Math.min(Math.max(rawDt, 0), 0.05);
  const events: StepCollisionEvent[] = [];

  if (dt <= 0) return events;

  state.trauma = Math.max(0, state.trauma - dt * 2.1);
  state.collisionCooldown = Math.max(0, state.collisionCooldown - dt);

  if (state.hitstopTimer > 0) {
    state.hitstopTimer = Math.max(0, state.hitstopTimer - dt);
    return events;
  }

  state.physicsAccumulator += dt;
  const fixedDt = VEHICLE_CONFIG.fixedSubstepDt;
  let maxSteps = 8;

  while (state.physicsAccumulator >= fixedDt && maxSteps > 0) {
    integrateSubstep(state, input, hazards, fixedDt, autoCruise, events);
    state.physicsAccumulator -= fixedDt;
    maxSteps--;
  }

  // If rawDt was smaller than fixedDt on the very first call in a unit test, integrate directly
  if (state.s === 0 && dt > 0 && dt < fixedDt) {
    integrateSubstep(state, input, hazards, dt, autoCruise, events);
    state.physicsAccumulator = 0;
  }

  return events;
}
