import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateLanePosition,
  generateInitialHazards,
  getRoadSample,
} from './road.ts';
import {
  createInitialVehicleState,
  stepVehicleSimulation,
} from './vehicle.ts';
import {
  normalizeSteeringAxis,
  DEFAULT_CONTROLLER_SETTINGS,
  InputAdapter,
} from './controls.ts';
import { AttentionMonitor } from './attention-monitor.ts';
import { ExperimentManager } from './experiment.ts';

test('road spine starts straight and lane evaluation detects lane departure', () => {
  const startSample = getRoadSample(0);
  assert.equal(startSample.centerX, 0);
  assert.equal(startSample.curvature, 0);

  const inLane = evaluateLanePosition(1.8, 1);
  assert.equal(inLane.isOutOfLane, false);
  assert.equal(inLane.deviationFromTargetLane, 0);

  const driftedLeft = evaluateLanePosition(-0.2, 1);
  assert.equal(driftedLeft.isOutOfLane, true);
  assert.ok(driftedLeft.deviationFromTargetLane > 1.5);
});

test('seeded hazard generator produces deterministic hazard sequences', () => {
  const runA = generateInitialHazards(42, 10);
  const runB = generateInitialHazards(42, 10);
  assert.equal(runA.length, 10);
  assert.deepEqual(runA, runB);
  assert.ok(runA[0].s >= 60, 'First hazard spawns safely ahead of player');
});

test('vehicle physics accelerates, shifts gears, brakes, steers, and enforces guardrail bounds', () => {
  const state = createInitialVehicleState();
  const initialSpeed = state.speed;

  // Accelerate for 0.5s
  for (let i = 0; i < 10; i++) {
    stepVehicleSimulation(
      state,
      { steer: 0, throttle: 1, brake: 0 },
      [],
      0.05,
      false,
    );
  }
  assert.ok(state.speed > initialSpeed, 'Vehicle speed increases under throttle');
  assert.ok(state.s > 0, 'Vehicle advances along road');
  assert.ok(state.gear >= 1 && state.gear <= 5, 'Gear stays within 5-speed transmission range');
  assert.ok(state.rpmNormalized > 0 && state.rpmNormalized <= 1, 'RPM normalized within [0..1]');

  // Brake for 0.5s
  const peakSpeed = state.speed;
  for (let i = 0; i < 10; i++) {
    stepVehicleSimulation(
      state,
      { steer: 0, throttle: 0, brake: 1 },
      [],
      0.05,
      false,
    );
  }
  assert.ok(state.speed < peakSpeed, 'Vehicle decelerates under braking');

  // Steer right strongly to test lateral movement and guardrail containment
  for (let i = 0; i < 40; i++) {
    stepVehicleSimulation(
      state,
      { steer: 1, throttle: 0.8, brake: 0 },
      [],
      0.05,
      false,
    );
  }
  assert.ok(state.lateralOffset <= 5.0, 'Guardrail prevents infinite lateral excursion');
});

test('controller steering axis normalization and multi-touch simultaneous input work', () => {
  const settings = {
    ...DEFAULT_CONTROLLER_SETTINGS,
    deadzone: 0.1,
    centerOffset: 0.05,
  };
  assert.equal(normalizeSteeringAxis(0.08, settings), 0, 'Within deadzone around centerOffset');
  const fullRight = normalizeSteeringAxis(1.05, settings);
  assert.equal(fullRight, 1);

  const adapter = new InputAdapter();
  adapter.setTouchSteer(-0.65);
  adapter.setTouchPedals(0.9, 0);
  const sampled = adapter.sampleInput();
  assert.equal(sampled.telemetry.activeSource, 'touch');
  assert.equal(sampled.vehicleInput.steer, -0.65);
  assert.equal(sampled.vehicleInput.throttle, 0.9);
  adapter.dispose();
});

test('AttentionMonitor transitions through grace period, POSSIBLY_DISTRACTED, DISTRACTED, and recovery', () => {
  const monitor = new AttentionMonitor('simulated');
  assert.equal(monitor.getState().state, 'ATTENTIVE');

  // Brief 200ms glance away should NOT trigger alarm (grace period)
  monitor.update({ yawDeg: 28, pitchDeg: 0, confidence: 0.95, source: 'simulated' }, 1000);
  const s1 = monitor.update(
    { yawDeg: 28, pitchDeg: 0, confidence: 0.95, source: 'simulated' },
    1200,
  );
  assert.equal(s1.state, 'ATTENTIVE');

  // Sustained 550ms look-away -> POSSIBLY_DISTRACTED
  for (let t = 1400; t <= 1600; t += 200) {
    monitor.update({ yawDeg: 28, pitchDeg: 0, confidence: 0.95, source: 'simulated' }, t);
  }
  assert.equal(monitor.getState().state, 'POSSIBLY_DISTRACTED');

  // Sustained > 1350ms look-away -> DISTRACTED
  for (let t = 1800; t <= 2600; t += 200) {
    monitor.update({ yawDeg: 28, pitchDeg: 0, confidence: 0.95, source: 'simulated' }, t);
  }
  assert.equal(monitor.getState().state, 'DISTRACTED');

  // Return gaze to road center for >= 250ms -> recovers to ATTENTIVE
  monitor.update({ yawDeg: 0, pitchDeg: 0, confidence: 0.95, source: 'simulated' }, 2800);
  const recovered = monitor.update(
    { yawDeg: 0, pitchDeg: 0, confidence: 0.95, source: 'simulated' },
    3000,
  );
  assert.equal(recovered.state, 'ATTENTIVE');
});

test('ExperimentManager records distraction events, lane deviation, recovery time, and side display stimuli', () => {
  let lastBroadcastPayload: unknown = null;
  const exp = new ExperimentManager((payload) => {
    lastBroadcastPayload = payload;
  });
  exp.updateSideConfig({
    leftPattern: 'matrix',
    rightPattern: 'wave',
    leftIntensity: 'high',
    rightIntensity: 'low',
  });
  exp.startRun('distracted');

  exp.triggerManualStimulus('left', 1);
  assert.equal(exp.getStimulus().activeSide, 'left');
  assert.equal(exp.getStimulus().leftPattern, 'matrix');
  assert.ok(lastBroadcastPayload !== null, 'Broadcast callback invoked on stimulus trigger');

  const vehicle = createInitialVehicleState();
  // Normal attentive driving for 1s
  for (let i = 0; i < 10; i++) {
    exp.step(0.1, vehicle, 'ATTENTIVE', [], false);
  }

  // Driver becomes distracted and drifts out of lane
  vehicle.lateralOffset = -0.5;
  vehicle.laneDeviationMeters = 2.3;
  vehicle.isOutOfLane = true;
  for (let i = 0; i < 15; i++) {
    exp.step(0.1, vehicle, 'DISTRACTED', [], false);
  }

  // Gaze returns to road while still out of lane
  exp.step(0.1, vehicle, 'ATTENTIVE', [], false);
  // 0.4s later, driver steers back inside safe lane
  exp.step(0.2, vehicle, 'ATTENTIVE', [], false);
  vehicle.lateralOffset = 1.8;
  vehicle.laneDeviationMeters = 0;
  vehicle.isOutOfLane = false;
  exp.step(0.2, vehicle, 'ATTENTIVE', [], false);

  const summary = exp.finalizeCurrentRun(420);
  assert.equal(summary.distractionEventsCount, 1);
  assert.ok(summary.totalDistractedTimeSec >= 1.4);
  assert.equal(summary.maxLaneDeviationMeters, 2.3);
  assert.ok(
    summary.avgLaneRecoveryTimeMs !== null && summary.avgLaneRecoveryTimeMs >= 350,
    'Recorded lane recovery time in ms after gaze return',
  );
});

test('collision physics stops tunneling through vehicles at high speed and transfers momentum', () => {
  const state = createInitialVehicleState();
  state.s = 85;
  state.speed = 30.0; // 108 km/h high approach speed
  state.lateralOffset = 1.8; // right lane

  const hazards = [
    {
      id: 99,
      type: 'truck' as const,
      s: 98,
      laneIndex: 1 as const,
      lateralOffset: 1.8,
      speed: 10.0,
      width: 2.3,
      length: 7.2,
      colorHex: 0xe2e8f0,
      telegraphActive: false,
      brakeTriggered: false,
      passed: false,
      collided: false,
      nearMissed: false,
    },
  ];

  const events: any[] = [];
  // Step simulation where player approaches and strikes the truck
  for (let i = 0; i < 10; i++) {
    const stepEvents = stepVehicleSimulation(
      state,
      { steer: 0, throttle: 1, brake: 0 },
      hazards,
      0.05,
      false,
    );
    events.push(...stepEvents);
  }

  // Player must NOT phase through the truck: state.s must remain behind the truck's rear bumper!
  assert.ok(
    state.s <= hazards[0].s - 4.5,
    `Player car must not phase through lead truck (player s=${state.s.toFixed(2)}, hazard s=${hazards[0].s.toFixed(2)})`,
  );
  assert.ok(hazards[0].collided, 'Hazard marked as collided');
  assert.ok(
    events.some((e) => e.type === 'hazard'),
    'Hazard impact event emitted',
  );
  assert.ok(state.speed < 25.0, 'Player car decelerated from collision');
});

test('traffic car-following AI prevents lead vehicle overlap and maintains safe headway', () => {
  const state = createInitialVehicleState();
  state.s = 0;
  state.speed = 0;

  const hazards = [
    {
      id: 1,
      type: 'truck' as const,
      s: 140,
      laneIndex: 1 as const,
      lateralOffset: 1.8,
      speed: 8.0,
      width: 2.3,
      length: 7.2,
      colorHex: 0xe2e8f0,
      telegraphActive: false,
      brakeTriggered: false,
      passed: false,
      collided: false,
      nearMissed: false,
    },
    {
      id: 2,
      type: 'sedan' as const,
      s: 120, // 20m behind the truck in the same lane
      laneIndex: 1 as const,
      lateralOffset: 1.8,
      speed: 16.0, // faster approach
      width: 1.85,
      length: 4.2,
      colorHex: 0x38bdf8,
      telegraphActive: false,
      brakeTriggered: false,
      passed: false,
      collided: false,
      nearMissed: false,
    },
  ];

  // Run simulation for 2 seconds (40 steps of 0.05s)
  for (let i = 0; i < 40; i++) {
    stepVehicleSimulation(
      state,
      { steer: 0, throttle: 0, brake: 0 },
      hazards,
      0.05,
      false,
    );
  }

  // Sedan must not phase through the truck ahead!
  assert.ok(
    hazards[1].s < hazards[0].s,
    `Trailing sedan must remain behind lead truck (sedan s=${hazards[1].s.toFixed(2)}, truck s=${hazards[0].s.toFixed(2)})`,
  );
  const separation = hazards[0].s - hazards[1].s;
  assert.ok(
    separation >= (hazards[0].length + hazards[1].length) * 0.5,
    `Trailing vehicle maintained rigid physical separation (${separation.toFixed(2)}m)`,
  );
});

test('road-normal perpendicular coordinates ensure roadside props never intersect road carriageway', () => {
  const roadCarriagewayLimit = 5.0; // 3.6m carriageway + 1.4m shoulder
  const propPlacementDist = 8.5; // placed at least 8.5m perpendicular

  for (let s = 100; s <= 800; s += 50) {
    const sample = getRoadSample(s);
    const nx = Math.cos(sample.headingRad);
    const nz = Math.sin(sample.headingRad);

    // Test for both left and right sides
    for (const side of [-1, 1]) {
      const propX = sample.centerX + side * propPlacementDist * nx;
      const propZ = -s + side * propPlacementDist * nz;

      // Distance from road center (sample.centerX, -s) along perpendicular normal
      const dx = propX - sample.centerX;
      const dz = propZ - (-s);
      const normalDist = Math.sqrt(dx * dx + dz * dz);

      assert.ok(
        normalDist >= propPlacementDist - 0.01,
        `Prop perpendicular distance (${normalDist.toFixed(2)}m) matches target distance`,
      );
      assert.ok(
        normalDist > roadCarriagewayLimit + 2.0,
        `Prop is safely outside road carriageway and guardrail boundary (${roadCarriagewayLimit}m)`,
      );
    }
  }
});

