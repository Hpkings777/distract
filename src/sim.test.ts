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
