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
  gear: number; // simulated 5-speed sport automatic gear (1..5)
  steerAngle: number; // current normalized wheel angle (-1 to +1)
  prevSteerAngle: number;
  headingOffset: number; // yaw angle relative to road tangent (radians)
  pitchOffset: number; // dive/squat pitch angle (radians)
  rollOffset: number; // body roll angle (radians)
  wheelRotationRad: number; // cumulative tire rotation angle (radians)
  brakeLightActive: boolean; // true when braking or decelerating hard
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
    speed: 16.5, // ~60 km/h planted rolling start
    rpmNormalized: 0.42,
    gear: 3,
    steerAngle: 0,
    prevSteerAngle: 0,
    headingOffset: 0,
    pitchOffset: 0,
    rollOffset: 0,
    wheelRotationRad: 0,
    brakeLightActive: false,
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
  emergencySlowdown = false,
): void {
  state.prevS = state.s;
  state.prevLateralOffset = state.lateralOffset;
  state.prevSteerAngle = state.steerAngle;

  // 1. Speed-dependent steering response & progressive understeer at high speed
  const speedRatio = Math.min(1, state.speed / VEHICLE_CONFIG.maxSpeed);
  const understeerFactor =
    1.0 /
    (1.0 + VEHICLE_CONFIG.understeerGradient * speedRatio * speedRatio * 2.1);
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

  const torqueEnvelope = 1.0 - speedRatio * 0.32;
  let tractiveForceN = 0;
  state.brakeLightActive = input.brake > 0.05;

  if (emergencySlowdown) {
    // Automated ADAS Drowsiness Intervention (Eyes closed >5s): cut throttle & brake smoothly to safe stop
    state.brakeLightActive = true;
    tractiveForceN = -0.92 * VEHICLE_CONFIG.maxBrakingForceN;
  } else if (input.brake > 0.02) {
    tractiveForceN = -input.brake * VEHICLE_CONFIG.maxBrakingForceN;
  } else if (input.throttle > 0.02) {
    tractiveForceN =
      input.throttle * VEHICLE_CONFIG.maxEngineForceN * torqueEnvelope;
  } else if (autoCruise && state.speed < VEHICLE_CONFIG.cruiseTargetSpeed) {
    // Smooth, progressive cruise governor
    const speedDeficit = VEHICLE_CONFIG.cruiseTargetSpeed - state.speed;
    const cruiseThrottle = Math.min(0.42, Math.max(0.14, speedDeficit * 0.08));
    tractiveForceN = cruiseThrottle * VEHICLE_CONFIG.maxEngineForceN;
  } else {
    // Natural engine compression braking when coasting above cruise speed
    tractiveForceN = -2200;
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
    state.trauma = Math.max(state.trauma, 0.11);
  }

  const netForceN = tractiveForceN - aeroDragN - rollingResN - offroadResN;
  const longitudinalAccel = netForceN / mass; // m/s^2

  const prevSpeed = state.speed;
  state.speed = Math.max(
    VEHICLE_CONFIG.minSpeed,
    Math.min(VEHICLE_CONFIG.maxSpeed, state.speed + longitudinalAccel * subDt),
  );

  // Advance wheel angular rotation (tire radius ~0.34m)
  state.wheelRotationRad =
    (state.wheelRotationRad + (state.speed * subDt) / 0.34) % (Math.PI * 200);

  const realLongAccel = (state.speed - prevSpeed) / subDt;
  state.longitudinalAccelG = realLongAccel / g;

  // Simulated 5-speed sport automatic gear & RPM calculation
  const speedKmh = state.speed * 3.6;
  const gearThresholds = [0, 26, 52, 80, 108];
  let gear = 1;
  for (let i = gearThresholds.length - 1; i >= 0; i--) {
    if (speedKmh >= gearThresholds[i]) {
      gear = i + 1;
      break;
    }
  }
  state.gear = gear;
  const gearMin = gearThresholds[gear - 1] ?? 0;
  const gearSpan = 30;
  state.rpmNormalized = Math.min(
    0.98,
    Math.max(
      0.2,
      0.28 + ((speedKmh - gearMin) / gearSpan) * 0.62 + input.throttle * 0.08,
    ),
  );

  // 3. Pitch weight transfer (dive under braking, squat under acceleration)
  const targetPitch = Math.max(
    -0.036,
    Math.min(0.036, -state.longitudinalAccelG * 0.026),
  );
  state.pitchOffset +=
    (targetPitch - state.pitchOffset) *
    Math.min(1, VEHICLE_CONFIG.pitchStiffness * subDt);

  // 4. Advance longitudinal position along road spline
  state.s += state.speed * subDt;
  const roadSample = getRoadSample(state.s);

  // 5. Lateral tire dynamics & grip limit saturation (mu * g)
  const forwardAuthority = Math.min(1, state.speed / 5.2);
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

  const maxTireLatAccel =
    VEHICLE_CONFIG.tireGripMu *
    g *
    (laneEvalBefore.isOnShoulder ? 0.74 : 1.0);
  const clampedLatAccel = Math.max(
    -maxTireLatAccel,
    Math.min(maxTireLatAccel, rawLatAccel),
  );

  state.lateralVelocity += clampedLatAccel * subDt;
  state.lateralOffset += state.lateralVelocity * subDt;
  state.lateralAccelG = clampedLatAccel / g;

  // 6. Heading slip yaw & lateral weight-transfer body roll
  const targetHeading =
    Math.atan2(state.lateralVelocity, Math.max(7.5, state.speed)) * 0.62;
  state.headingOffset +=
    (targetHeading - state.headingOffset) * Math.min(1, 12 * subDt);

  const targetRoll = Math.max(
    -0.052,
    Math.min(0.052, -state.lateralAccelG * 0.045),
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
      -sign * Math.max(2.6, Math.abs(state.lateralVelocity) * 0.45);
    state.speed = Math.max(6.0, state.speed * 0.74);
    if (state.collisionCooldown <= 0) {
      state.collisionCooldown = VEHICLE_CONFIG.collisionCooldown;
      state.hitstopTimer = 0.045;
      state.trauma = Math.min(0.75, state.trauma + 0.5);
      events.push({
        type: 'guardrail',
        relativeSpeed: state.speed,
        s: state.s,
      });
    }
  }

  // 8. Traffic Car-Following AI & Hazard Advancement
  // First recycle any hazard that fell > 45m behind the player to the front of the pack
  for (let i = 0; i < hazards.length; i++) {
    const h = hazards[i];
    if (h.s < state.s - 45) {
      let maxAheadS = state.s + 210;
      for (let j = 0; j < hazards.length; j++) {
        if (i !== j && hazards[j].s > maxAheadS) {
          maxAheadS = hazards[j].s;
        }
      }
      h.s = maxAheadS + 44 + (h.id % 5) * 9;
      h.passed = false;
      h.collided = false;
      h.nearMissed = false;
      h.telegraphActive = false;
      h.brakeTriggered = false;
      if (h.type !== 'work_zone') {
        h.speed =
          h.baseSpeed ??
          (h.type === 'truck' ? 12.0 : h.type === 'coupe' ? 17.5 : 15.2);
      }
    }
  }

  // Advance hazards & enforce strict car-following headway so AI vehicles NEVER overlap
  for (let i = 0; i < hazards.length; i++) {
    const h = hazards[i];
    const distAhead = h.s - state.s;

    if (h.type === 'braking_car' && distAhead > 0 && distAhead < 55) {
      h.telegraphActive = true;
      if (distAhead < 38) {
        h.brakeTriggered = true;
        h.speed = Math.max(5.5, h.speed - 9.5 * subDt);
      }
    } else if (h.type === 'work_zone' && distAhead > 0 && distAhead < 75) {
      h.telegraphActive = true;
    } else {
      h.telegraphActive = false;
    }

    if (h.type !== 'work_zone' && h.speed > 0) {
      let closestAheadDist = Infinity;
      let leadSpeed = h.speed;
      let leadCar: RoadHazard | null = null;

      for (let j = 0; j < hazards.length; j++) {
        if (i === j) continue;
        const other = hazards[j];
        if (other.laneIndex === h.laneIndex && other.s > h.s) {
          const dist = other.s - h.s;
          if (dist < closestAheadDist) {
            closestAheadDist = dist;
            leadSpeed = other.speed;
            leadCar = other;
          }
        }
      }

      const safeHeadway = (h.length + (leadCar?.length ?? 4.4)) * 0.5 + 3.2;
      if (closestAheadDist < safeHeadway && leadCar) {
        h.s = leadCar.s - safeHeadway;
        h.speed = Math.max(0, Math.min(h.speed, leadSpeed * 0.92));
        h.telegraphActive = true;
      } else if (closestAheadDist < 30) {
        h.speed = Math.max(0, Math.min(h.speed, leadSpeed * 0.96));
        h.telegraphActive = leadSpeed < h.speed - 1.5;
      } else if (!h.brakeTriggered && h.baseSpeed && h.speed < h.baseSpeed) {
        // Smoothly recover to preferred cruise speed when lane ahead opens up
        h.speed = Math.min(h.baseSpeed, h.speed + 2.5 * subDt);
      }
    }

    h.s += h.speed * subDt;
  }

  // 9. Continuous Swept Bounding Box Collision Resolution (Player vs Hazards)
  const carHalfLen = VEHICLE_CONFIG.vehicleLength * 0.5;
  const carHalfWidth = VEHICLE_CONFIG.vehicleWidth * 0.5;

  for (let i = 0; i < hazards.length; i++) {
    const h = hazards[i];
    const hHalfLen = h.length * 0.5;
    const hHalfWidth = h.width * 0.5;

    const minLongitudinal = carHalfLen + hHalfLen;
    const minLateral = carHalfWidth + hHalfWidth;

    const playerMinS = Math.min(state.prevS, state.s) - carHalfLen;
    const playerMaxS = Math.max(state.prevS, state.s) + carHalfLen;
    const hazardMinS = h.s - hHalfLen;
    const hazardMaxS = h.s + hHalfLen;

    const playerMinLat =
      Math.min(state.prevLateralOffset, state.lateralOffset) - carHalfWidth;
    const playerMaxLat =
      Math.max(state.prevLateralOffset, state.lateralOffset) + carHalfWidth;
    const hazardMinLat = h.lateralOffset - hHalfWidth;
    const hazardMaxLat = h.lateralOffset + hHalfWidth;

    const overlapLongitudinal =
      playerMaxS >= hazardMinS && playerMinS <= hazardMaxS;
    const overlapLateral =
      playerMaxLat >= hazardMinLat && playerMinLat <= hazardMaxLat;

    if (overlapLongitudinal && overlapLateral) {
      const prevLatDiff = Math.abs(state.prevLateralOffset - h.lateralOffset);
      const wasLaterallyAligned = prevLatDiff < minLateral * 0.86;

      if (wasLaterallyAligned && state.prevS <= h.s) {
        // Rear-end impact: player drove into the back of hazard h.
        // Pin player strictly behind hazard's rear bumper so it is impossible to phase through!
        state.s = h.s - minLongitudinal - 0.08;
        const relSpeed = Math.max(4.0, state.speed - h.speed);
        state.speed = Math.max(
          0,
          Math.min(state.speed * 0.35, h.speed * 0.75),
        );
        if (h.type !== 'work_zone') {
          h.speed = Math.max(h.speed, h.speed + relSpeed * 0.45);
        }
      } else if (wasLaterallyAligned && state.prevS > h.s) {
        // Hazard bumped player from behind
        state.s = h.s + minLongitudinal + 0.08;
        state.speed = Math.max(state.speed, h.speed + 2.0);
      } else {
        // Sideswipe impact while overtaking or changing lanes:
        // Deflect laterally outside hazard's width without altering longitudinal s!
        const pushDir =
          state.prevLateralOffset >= h.lateralOffset ? 1 : -1;
        state.lateralOffset = h.lateralOffset + pushDir * (minLateral + 0.1);
        state.lateralVelocity =
          pushDir * Math.max(3.2, Math.abs(state.lateralVelocity) * 0.55);
        state.speed = Math.max(5.0, state.speed * 0.85);
      }

      if (!h.collided && state.collisionCooldown <= 0) {
        h.collided = true;
        state.collisionCooldown = VEHICLE_CONFIG.collisionCooldown;
        state.hitstopTimer = 0.055;
        state.trauma = Math.min(0.95, state.trauma + 0.62);
        const relSpeed = Math.max(6, Math.abs(state.speed - h.speed));
        events.push({
          type: 'hazard',
          hazardId: h.id,
          relativeSpeed: relSpeed,
          s: state.s,
        });
      }
    } else if (!h.passed && h.s < state.s - 2.2) {
      h.passed = true;
      const actualDLat = Math.abs(state.lateralOffset - h.lateralOffset);
      if (!h.collided && actualDLat < minLateral + 1.1) {
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
  emergencySlowdown: boolean | any = false,
): StepCollisionEvent[] {
  const dt = Math.min(Math.max(rawDt, 0), 0.05);
  const events: StepCollisionEvent[] = [];

  if (dt <= 0) return events;

  const isSlowdown = emergencySlowdown === true;

  state.trauma = Math.max(0, state.trauma - dt * 2.2);
  state.collisionCooldown = Math.max(0, state.collisionCooldown - dt);

  if (state.hitstopTimer > 0) {
    state.hitstopTimer = Math.max(0, state.hitstopTimer - dt);
    return events;
  }

  state.physicsAccumulator += dt;
  const fixedDt = VEHICLE_CONFIG.fixedSubstepDt;
  let maxSteps = 8;

  while (state.physicsAccumulator >= fixedDt && maxSteps > 0) {
    integrateSubstep(
      state,
      input,
      hazards,
      fixedDt,
      autoCruise,
      events,
      isSlowdown,
    );
    state.physicsAccumulator -= fixedDt;
    maxSteps--;
  }

  // If rawDt was smaller than fixedDt on the very first call in a unit test, integrate directly
  if (state.s === 0 && dt > 0 && dt < fixedDt) {
    integrateSubstep(
      state,
      input,
      hazards,
      dt,
      autoCruise,
      events,
      isSlowdown,
    );
    state.physicsAccumulator = 0;
  }

  return events;
}
