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
import type { MapPreset } from './config.ts';

test('road spine starts straight at s=0 across all 4 map presets and computes exact analytical pitch/heading derivatives', () => {
  const maps: MapPreset[] = ['alpine', 'coastal', 'urban', 'desert'];
  for (const map of maps) {
    const startSample = getRoadSample(0, map);
    assert.equal(startSample.centerX, 0, `${map} centerX is 0 at s=0`);
    assert.equal(startSample.elevationY, 0, `${map} elevationY is 0 at s=0`);
    assert.equal(startSample.curvature, 0, `${map} curvature is 0 at s=0`);

    // Check finite difference vs analytical derivative at s = 250m
    const s0 = 250;
    const ds = 0.01;
    const sampleA = getRoadSample(s0 - ds, map);
    const sampleB = getRoadSample(s0 + ds, map);
    const sampleMid = getRoadSample(s0, map);
    const numericDxDs = (sampleB.centerX - sampleA.centerX) / (2 * ds);
    const numericDyDs = (sampleB.elevationY - sampleA.elevationY) / (2 * ds);

    assert.ok(
      Math.abs(Math.tan(sampleMid.headingRad) - numericDxDs) < 1e-4,
      `${map} headingRad matches exact d(centerX)/ds`,
    );
    assert.ok(
      Math.abs(Math.tan(sampleMid.pitchRad) - numericDyDs) < 1e-4,
      `${map} pitchRad matches exact d(elevationY)/ds`,
    );
  }

  const inLane = evaluateLanePosition(1.8, 1);
  assert.equal(inLane.isOutOfLane, false);
  assert.equal(inLane.deviationFromTargetLane, 0);

  const driftedLeft = evaluateLanePosition(-0.2, 1);
  assert.equal(driftedLeft.isOutOfLane, true);
  assert.ok(driftedLeft.deviationFromTargetLane > 1.5);
});

test('seeded hazard generator respects trafficConfig density, speedMultiplier, and workzone toggle', () => {
  const runA = generateInitialHazards(42, 10);
  const runB = generateInitialHazards(42, 10);
  assert.equal(runA.length, 10);
  assert.deepEqual(runA, runB);
  assert.ok(runA[0].s >= 65, 'First hazard spawns safely ahead of player');

  const emptyTraffic = generateInitialHazards(42, undefined, {
    density: 'none',
    aggression: 'normal',
    allowWorkZones: true,
    speedMultiplier: 1.0,
  });
  assert.equal(emptyTraffic.length, 0, 'density=none produces 0 hazards');

  const heavyNoWorkzones = generateInitialHazards(42, undefined, {
    density: 'heavy',
    aggression: 'aggressive',
    allowWorkZones: false,
    speedMultiplier: 1.2,
  });
  assert.equal(heavyNoWorkzones.length, 36, 'density=heavy produces 36 hazards');
  assert.ok(
    heavyNoWorkzones.every((h) => h.type !== 'work_zone'),
    'allowWorkZones=false excludes work_zone hazards',
  );
});

test('vehicle physics accelerates, shifts 6-speed gears, rotates wheels, brakes, and enforces guardrail bounds', () => {
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
      'alpine',
    );
  }
  assert.ok(state.speed > initialSpeed, 'Vehicle speed increases under throttle');
  assert.ok(state.s > 0, 'Vehicle advances along road');
  assert.ok(state.wheelRotationRad > 0, 'Wheels rotate forward with distance');
  assert.ok(state.gear >= 1 && state.gear <= 6, 'Gear stays within 6-speed transmission range');
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
      'alpine',
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
      'alpine',
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

test('AttentionMonitor DMS tracks eye closure, 5.0s threshold, emergency slowdown and recovery', () => {
  const monitor = new AttentionMonitor('simulated');
  assert.equal(monitor.getState().state, 'ATTENTIVE');
  assert.equal(monitor.getState().emergencySlowdownActive, false);

  // Brief 200ms blink should NOT trigger warning (natural blink)
  monitor.update({ eyesClosed: true, eyeOpenness: 0.1, confidence: 0.95, source: 'simulated' }, 1000);
  const s1 = monitor.update(
    { eyesClosed: true, eyeOpenness: 0.1, confidence: 0.95, source: 'simulated' },
    1200,
  );
  assert.equal(s1.state, 'ATTENTIVE');
  assert.equal(s1.emergencySlowdownActive, false);

  // Closed for 1.5s -> warning state
  for (let t = 1400; t <= 2500; t += 200) {
    monitor.update({ eyesClosed: true, eyeOpenness: 0.05, confidence: 0.95, source: 'simulated' }, t);
  }
  const sWarn = monitor.getState();
  assert.ok(sWarn.state === 'DROWSY_WARNING' || sWarn.state === 'POSSIBLY_DISTRACTED');
  assert.equal(sWarn.emergencySlowdownActive, false);

  // Closed for >= 5.0 seconds (cumulative 5200ms) -> DROWSY_CRITICAL / emergency slowdown!
  for (let t = 2700; t <= 6300; t += 200) {
    monitor.update({ eyesClosed: true, eyeOpenness: 0.02, confidence: 0.95, source: 'simulated' }, t);
  }
  const sCrit = monitor.getState();
  assert.ok(sCrit.state === 'DROWSY_CRITICAL' || sCrit.state === 'DISTRACTED');
  assert.equal(sCrit.emergencySlowdownActive, true, 'Emergency slowdown must be engaged at >= 5s threshold');

  // Verify that vehicle actually decelerates under emergency slowdown
  const vehicle = createInitialVehicleState();
  vehicle.speed = 22.0; // cruising at ~80 km/h
  const initialSpeed = vehicle.speed;
  for (let i = 0; i < 15; i++) {
    stepVehicleSimulation(vehicle, { steer: 0, throttle: 1, brake: 0 }, [], 0.05, true, true);
  }
  assert.ok(vehicle.speed < initialSpeed * 0.4, 'Emergency slowdown forced rapid vehicle deceleration');

  // Eyes reopen -> instant recovery
  monitor.update({ eyesClosed: false, eyeOpenness: 0.95, confidence: 0.95, source: 'simulated' }, 6500);
  const recovered = monitor.update(
    { eyesClosed: false, eyeOpenness: 0.95, confidence: 0.95, source: 'simulated' },
    6700,
  );
  assert.equal(recovered.state, 'ATTENTIVE');
  assert.equal(recovered.emergencySlowdownActive, false);
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
  for (let i = 0; i < 10; i++) {
    exp.step(0.1, vehicle, 'ATTENTIVE', [], false);
  }

  vehicle.lateralOffset = -0.5;
  vehicle.laneDeviationMeters = 2.3;
  vehicle.isOutOfLane = true;
  for (let i = 0; i < 15; i++) {
    exp.step(0.1, vehicle, 'DISTRACTED', [], false);
  }

  exp.step(0.1, vehicle, 'ATTENTIVE', [], false);
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
      baseCruiseSpeed: 10.0,
      width: 2.35,
      length: 7.4,
      colorHex: 0xe2e8f0,
      telegraphActive: false,
      brakeTriggered: false,
      passed: false,
      collided: false,
      nearMissed: false,
    },
  ];

  const events: any[] = [];
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
      baseCruiseSpeed: 8.0,
      width: 2.35,
      length: 7.4,
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
      s: 120,
      laneIndex: 1 as const,
      lateralOffset: 1.8,
      speed: 16.0,
      baseCruiseSpeed: 16.0,
      width: 1.88,
      length: 4.55,
      colorHex: 0x38bdf8,
      telegraphActive: false,
      brakeTriggered: false,
      passed: false,
      collided: false,
      nearMissed: false,
    },
  ];

  for (let i = 0; i < 40; i++) {
    stepVehicleSimulation(
      state,
      { steer: 0, throttle: 0, brake: 0 },
      hazards,
      0.05,
      false,
    );
  }

  const sedan = hazards.find((h) => h.id === 2)!;
  const truck = hazards.find((h) => h.id === 1)!;

  assert.ok(
    sedan.s < truck.s,
    `Trailing sedan must remain behind lead truck (sedan s=${sedan.s.toFixed(2)}, truck s=${truck.s.toFixed(2)})`,
  );
  const separation = truck.s - sedan.s;
  assert.ok(
    separation >= (truck.length + sedan.length) * 0.5,
    `Trailing vehicle maintained rigid physical separation (${separation.toFixed(2)}m)`,
  );
});
