import { ATTENTION_CONFIG } from './config.ts';
import type { AttentionState } from './config.ts';

export interface AttentionObservation {
  yawDeg: number; // horizontal head turn (+ right, - left)
  pitchDeg: number; // vertical head pitch (+ down, - up)
  confidence: number; // 0.0 to 1.0
  source: 'simulated' | 'webcam';
  cameraFailed?: boolean;
  failureReason?: string;
}

export interface AttentionSnapshot {
  state: AttentionState;
  mode: 'simulated' | 'webcam';
  yawDeg: number;
  pitchDeg: number;
  calibratedYawOffset: number;
  calibratedPitchOffset: number;
  confidence: number;
  sustainedDeviationMs: number;
  calibrationProgress: number; // 0..1
  statusMessage: string;
}

/**
 * Modular, replaceable driver attention monitor.
 * Accepts head orientation / gaze observations with timestamps and computes
 * calibrated state transitions with configurable grace periods.
 */
export class AttentionMonitor {
  private state: AttentionState = 'ATTENTIVE';
  private mode: 'simulated' | 'webcam' = 'simulated';
  private calibratedYaw = 0;
  private calibratedPitch = 0;
  private calibrationSamples: Array<{ yaw: number; pitch: number }> = [];
  private isCalibrating = false;

  private lastTimestampMs: number | null = null;
  private deviationDurationMs = 0;
  private recoveryDurationMs = 0;

  private currentYawDeg = 0;
  private currentPitchDeg = 0;
  private currentConfidence = 1.0;
  private statusMessage = 'Simulated attention monitor ready (Hold L or look at side stimulus)';

  constructor(initialMode: 'simulated' | 'webcam' = 'simulated') {
    this.mode = initialMode;
    this.state = initialMode === 'simulated' ? 'ATTENTIVE' : 'INITIALIZING';
  }

  public setMode(mode: 'simulated' | 'webcam'): void {
    this.mode = mode;
    this.deviationDurationMs = 0;
    this.recoveryDurationMs = 0;
    this.lastTimestampMs = null;
    if (mode === 'simulated') {
      this.state = 'ATTENTIVE';
      this.currentConfidence = 1.0;
      this.statusMessage = 'Simulated monitoring active';
    } else {
      this.state = 'INITIALIZING';
      this.statusMessage = 'Initializing webcam head-pose tracker...';
    }
  }

  public resetCalibration(): void {
    this.calibrationSamples = [];
    this.isCalibrating = true;
    this.state = 'CALIBRATING';
    this.deviationDurationMs = 0;
    this.statusMessage = 'Look straight ahead at the road center to calibrate neutral pose...';
  }

  public reportCameraUnavailable(reason = 'Camera permission denied or device unavailable'): void {
    this.state = 'CAMERA_UNAVAILABLE';
    this.currentConfidence = 0;
    this.statusMessage = reason;
  }

  public update(observation: AttentionObservation, timestampMs: number): AttentionSnapshot {
    const dtMs =
      this.lastTimestampMs !== null
        ? Math.max(0, Math.min(250, timestampMs - this.lastTimestampMs))
        : 16;
    this.lastTimestampMs = timestampMs;

    this.mode = observation.source;

    if (observation.cameraFailed) {
      this.reportCameraUnavailable(
        observation.failureReason || 'Webcam feed interrupted or unavailable',
      );
      return this.getState();
    }

    this.currentConfidence = observation.confidence;

    // Low confidence check (e.g. face occluded or poor lighting)
    if (observation.confidence < ATTENTION_CONFIG.minConfidence) {
      this.statusMessage = 'Low face-tracking confidence — ensure face is evenly lit';
      return this.getState();
    }

    // Handle active neutral-pose calibration
    if (this.isCalibrating) {
      this.calibrationSamples.push({
        yaw: observation.yawDeg,
        pitch: observation.pitchDeg,
      });
      if (this.calibrationSamples.length >= ATTENTION_CONFIG.calibrationSamplesRequired) {
        const sum = this.calibrationSamples.reduce(
          (acc, s) => ({ yaw: acc.yaw + s.yaw, pitch: acc.pitch + s.pitch }),
          { yaw: 0, pitch: 0 },
        );
        this.calibratedYaw = sum.yaw / this.calibrationSamples.length;
        this.calibratedPitch = sum.pitch / this.calibrationSamples.length;
        this.isCalibrating = false;
        this.state = 'ATTENTIVE';
        this.statusMessage = 'Neutral forward pose calibrated';
      } else {
        this.state = 'CALIBRATING';
        return this.getState();
      }
    }

    // Compute relative head pose from calibrated neutral center
    const relYaw = observation.yawDeg - this.calibratedYaw;
    const relPitch = observation.pitchDeg - this.calibratedPitch;
    this.currentYawDeg = relYaw;
    this.currentPitchDeg = relPitch;

    const isLookingAway =
      Math.abs(relYaw) >= ATTENTION_CONFIG.yawThresholdDeg ||
      Math.abs(relPitch) >= ATTENTION_CONFIG.pitchThresholdDeg;

    if (isLookingAway) {
      this.deviationDurationMs += dtMs;
      this.recoveryDurationMs = 0;

      if (this.deviationDurationMs >= ATTENTION_CONFIG.distractedDelayMs) {
        this.state = 'DISTRACTED';
        this.statusMessage = 'Sustained visual distraction detected — Eyes on road!';
      } else if (this.deviationDurationMs >= ATTENTION_CONFIG.possiblyDistractedDelayMs) {
        this.state = 'POSSIBLY_DISTRACTED';
        this.statusMessage = 'Head pose deviating from road center...';
      } else {
        // Within short grace period to prevent false alarms from brief glances
        if (this.state !== 'DISTRACTED' && this.state !== 'POSSIBLY_DISTRACTED') {
          this.state = 'ATTENTIVE';
        }
      }
    } else {
      // Looking forward
      if (this.state === 'DISTRACTED' || this.state === 'POSSIBLY_DISTRACTED') {
        this.recoveryDurationMs += dtMs;
        if (this.recoveryDurationMs >= ATTENTION_CONFIG.recoveryGraceMs) {
          this.state = 'ATTENTIVE';
          this.deviationDurationMs = 0;
          this.recoveryDurationMs = 0;
          this.statusMessage = 'Driver attentive — Forward roadway aligned';
        }
      } else {
        this.state = 'ATTENTIVE';
        this.deviationDurationMs = Math.max(0, this.deviationDurationMs - dtMs * 2);
        this.statusMessage = 'Driver attentive — Forward roadway aligned';
      }
    }

    return this.getState();
  }

  public getState(): AttentionSnapshot {
    const progress = this.isCalibrating
      ? Math.min(
          1,
          this.calibrationSamples.length / ATTENTION_CONFIG.calibrationSamplesRequired,
        )
      : 1;

    return {
      state: this.state,
      mode: this.mode,
      yawDeg: this.currentYawDeg,
      pitchDeg: this.currentPitchDeg,
      calibratedYawOffset: this.calibratedYaw,
      calibratedPitchOffset: this.calibratedPitch,
      confidence: this.currentConfidence,
      sustainedDeviationMs: this.deviationDurationMs,
      calibrationProgress: progress,
      statusMessage: this.statusMessage,
    };
  }
}
