import { ATTENTION_CONFIG } from './config.ts';
import type { AttentionState } from './config.ts';

export interface AttentionObservation {
  eyesClosed?: boolean;
  eyeOpenness?: number; // 0.0 (closed) to 1.0 (fully open)
  confidence: number;
  source: 'simulated' | 'webcam';
  cameraFailed?: boolean;
  failureReason?: string;
  // Backward-compatible fields
  yawDeg?: number;
  pitchDeg?: number;
}

export interface AttentionSnapshot {
  state: AttentionState;
  mode: 'simulated' | 'webcam';
  eyesClosed: boolean;
  eyeOpenness: number;
  closureDurationMs: number;
  closureDurationSec: number;
  thresholdSec: number; // 5.0 seconds
  emergencySlowdownActive: boolean;
  confidence: number;
  statusMessage: string;
  // Backward compatibility fields
  yawDeg: number;
  pitchDeg: number;
  calibratedYawOffset: number;
  calibratedPitchOffset: number;
  sustainedDeviationMs: number;
  calibrationProgress: number;
  isOffRoadWarning?: boolean;
}

/**
 * Driver Monitoring System (DMS) for Eye-Closure and Fatigue/Drowsiness.
 * Tracks continuous eye closure against a strict 5.0-second threshold.
 * When eyes remain shut >= 5.0s, triggers critical alarm and automatic vehicle slowdown.
 */
export class AttentionMonitor {
  private state: AttentionState = 'ATTENTIVE';
  private mode: 'simulated' | 'webcam' = 'simulated';

  private lastTimestampMs: number | null = null;
  private closureDurationMs = 0;
  private recoveryDurationMs = 0;

  private currentEyesClosed = false;
  private currentEyeOpenness = 1.0;
  private currentConfidence = 1.0;
  private statusMessage = 'Driver Monitoring System active — Eyes open';

  // Calibration state for neutral pose
  private isCalibrating = false;
  private calibrationSamples: number[] = [];

  constructor(initialMode: 'simulated' | 'webcam' = 'simulated') {
    this.mode = initialMode;
    this.state = initialMode === 'simulated' ? 'ATTENTIVE' : 'INITIALIZING';
  }

  public setMode(mode: 'simulated' | 'webcam'): void {
    this.mode = mode;
    this.closureDurationMs = 0;
    this.recoveryDurationMs = 0;
    this.lastTimestampMs = null;
    if (mode === 'simulated') {
      this.state = 'ATTENTIVE';
      this.currentConfidence = 1.0;
      this.statusMessage = 'Simulated DMS active (Eyes Open)';
    } else {
      this.state = 'INITIALIZING';
      this.statusMessage = 'Connecting webcam Driver Monitoring System...';
    }
  }

  public resetCalibration(): void {
    this.calibrationSamples = [];
    this.isCalibrating = true;
    this.state = 'CALIBRATING';
    this.closureDurationMs = 0;
    this.statusMessage = 'Calibrating baseline ocular exposure...';
  }

  public reportCameraUnavailable(
    reason = 'Camera permission denied or device unavailable',
  ): void {
    this.state = 'CAMERA_UNAVAILABLE';
    this.currentConfidence = 0;
    this.statusMessage = reason;
  }

  public update(
    observation: AttentionObservation,
    timestampMs: number,
  ): AttentionSnapshot {
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

    // Determine eye closure state:
    // Either directly from observation.eyesClosed / observation.eyeOpenness,
    // or from legacy gaze deflection if eyesClosed is not provided.
    let isClosed = false;
    if (typeof observation.eyesClosed === 'boolean') {
      isClosed = observation.eyesClosed;
      this.currentEyeOpenness =
        observation.eyeOpenness ?? (isClosed ? 0.05 : 0.95);
    } else if (typeof observation.eyeOpenness === 'number') {
      this.currentEyeOpenness = observation.eyeOpenness;
      isClosed = observation.eyeOpenness < 0.38;
    } else {
      // Legacy fallback: head pose deviation
      const yaw = Math.abs(observation.yawDeg ?? 0);
      const pitch = Math.abs(observation.pitchDeg ?? 0);
      isClosed =
        yaw >= ATTENTION_CONFIG.yawThresholdDeg ||
        pitch >= ATTENTION_CONFIG.pitchThresholdDeg;
      this.currentEyeOpenness = isClosed ? 0.1 : 0.95;
    }

    this.currentEyesClosed = isClosed;

    if (this.isCalibrating) {
      this.calibrationSamples.push(this.currentEyeOpenness);
      if (this.calibrationSamples.length >= 10) {
        this.isCalibrating = false;
        this.state = 'ATTENTIVE';
        this.statusMessage = 'DMS Baseline calibrated';
      } else {
        this.state = 'CALIBRATING';
        return this.getState();
      }
    }

    const thresholdMs = ATTENTION_CONFIG.eyesClosedThresholdSec * 1000; // 5000ms (5s)

    if (isClosed) {
      this.closureDurationMs += dtMs;
      this.recoveryDurationMs = 0;

      if (this.closureDurationMs >= thresholdMs) {
        // Critical threshold crossed (>= 5.0 seconds closed)
        this.state = 'DROWSY_CRITICAL';
        this.statusMessage = `DROWSINESS DETECTED: EYES CLOSED ${(
          this.closureDurationMs / 1000
        ).toFixed(1)}s (>${
          ATTENTION_CONFIG.eyesClosedThresholdSec
        }s) — EMERGENCY VEHICLE SLOWDOWN ENGAGED!`;
      } else if (
        this.closureDurationMs >= ATTENTION_CONFIG.eyesClosedWarningDelayMs
      ) {
        // Warning countdown zone (0.4s to 4.9s)
        this.state = 'DROWSY_WARNING';
        const remainingSec = Math.max(
          0,
          (thresholdMs - this.closureDurationMs) / 1000,
        );
        this.statusMessage = `EYES CLOSED ${(
          this.closureDurationMs / 1000
        ).toFixed(1)}s — 5s THRESHOLD IN ${remainingSec.toFixed(1)}s`;
      } else {
        // Brief natural blink grace period (<400ms)
        if (this.state !== 'DROWSY_CRITICAL') {
          this.state = 'ATTENTIVE';
        }
      }
    } else {
      // Eyes are open: clear closure timer & restore attentive state
      if (this.state === 'DROWSY_CRITICAL') {
        this.recoveryDurationMs += dtMs;
        // Fast 150ms confirmation to disengage emergency alert
        if (this.recoveryDurationMs >= 150) {
          this.state = 'ATTENTIVE';
          this.closureDurationMs = 0;
          this.recoveryDurationMs = 0;
          this.statusMessage =
            'Driver alert — Eyes reopened, vehicle control restored';
        }
      } else {
        this.state = 'ATTENTIVE';
        this.closureDurationMs = 0;
        this.recoveryDurationMs = 0;
        this.statusMessage = 'Driver attentive — Forward roadway monitored';
      }
    }

    return this.getState();
  }

  public getState(): AttentionSnapshot {
    const isCritical = this.state === 'DROWSY_CRITICAL';
    const isWarning = this.state === 'DROWSY_WARNING' || isCritical;

    return {
      state: this.state,
      mode: this.mode,
      eyesClosed: this.currentEyesClosed,
      eyeOpenness: this.currentEyeOpenness,
      closureDurationMs: this.closureDurationMs,
      closureDurationSec: Number((this.closureDurationMs / 1000).toFixed(2)),
      thresholdSec: ATTENTION_CONFIG.eyesClosedThresholdSec, // 5.0
      emergencySlowdownActive:
        this.closureDurationMs >=
        ATTENTION_CONFIG.eyesClosedThresholdSec * 1000,
      confidence: this.currentConfidence,
      statusMessage: this.statusMessage,
      // Backward-compatibility properties
      yawDeg: this.currentEyesClosed ? 22 : 0,
      pitchDeg: this.currentEyesClosed ? 18 : 0,
      calibratedYawOffset: 0,
      calibratedPitchOffset: 0,
      sustainedDeviationMs: this.closureDurationMs,
      calibrationProgress: this.isCalibrating ? 0.5 : 1.0,
      isOffRoadWarning: isWarning,
    };
  }
}

// Backward-compatible alias
export const DriverDrowsinessMonitor = AttentionMonitor;
