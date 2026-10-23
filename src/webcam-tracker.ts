import type { AttentionObservation } from './attention-monitor.ts';

export interface EyeRegionBounds {
  x: number;
  y: number;
  w: number;
  h: number;
  openness: number; // 0..1
}

export interface EyeAnalysisResult {
  eyesClosed: boolean;
  overallOpenness: number; // 0..1
  leftEye: EyeRegionBounds;
  rightEye: EyeRegionBounds;
  confidence: number;
  faceDetected: boolean;
}

/**
 * Local, privacy-preserving webcam driver eye-tracker and DMS (Driver Monitoring System).
 * Analyzes ocular openness directly in local browser memory (zero cloud uploads).
 * Crops the upper facial eye band and evaluates ocular contrast, pupil presence,
 * and eyelid closure gradients.
 */
export class WebcamHeadTracker {
  private stream: MediaStream | null = null;
  private videoEl: HTMLVideoElement | null = null;
  private canvasEl: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private active = false;
  private errorReason: string | null = null;

  // Manual / simulated eye closure override (for testing without a webcam)
  private simulatedClosed = false;

  public async start(): Promise<boolean> {
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      !navigator.mediaDevices.getUserMedia
    ) {
      this.errorReason =
        'Browser does not support local webcam access (requires localhost or HTTPS)';
      this.active = false;
      return false;
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user',
        },
        audio: false,
      });

      this.videoEl = document.createElement('video');
      this.videoEl.playsInline = true;
      this.videoEl.muted = true;
      this.videoEl.srcObject = this.stream;
      await this.videoEl.play();

      this.canvasEl = document.createElement('canvas');
      this.canvasEl.width = 160;
      this.canvasEl.height = 120;
      this.ctx = this.canvasEl.getContext('2d', { willReadFrequently: true });

      this.active = true;
      this.errorReason = null;
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Camera permission denied';
      this.errorReason = `Webcam unavailable: ${msg}`;
      this.active = false;
      return false;
    }
  }

  public stop(): void {
    if (this.stream) {
      for (const track of this.stream.getTracks()) {
        track.stop();
      }
      this.stream = null;
    }
    if (this.videoEl) {
      this.videoEl.pause();
      this.videoEl.srcObject = null;
      this.videoEl = null;
    }
    this.active = false;
  }

  public isRunning(): boolean {
    return this.active && this.videoEl !== null && this.videoEl.readyState >= 2;
  }

  public getMediaStream(): MediaStream | null {
    return this.stream;
  }

  public getVideoElement(): HTMLVideoElement | null {
    return this.videoEl;
  }

  public getErrorReason(): string | null {
    return this.errorReason;
  }

  public setSimulatedEyesClosed(closed: boolean): void {
    this.simulatedClosed = closed;
  }

  public toggleSimulatedEyesClosed(): boolean {
    this.simulatedClosed = !this.simulatedClosed;
    return this.simulatedClosed;
  }

  public isSimulatedEyesClosed(): boolean {
    return this.simulatedClosed;
  }

  /**
   * Evaluates eye openness from webcam frames or simulation.
   */
  public analyzeEyes(): EyeAnalysisResult {
    // If user has toggled simulated eye closure or simulation is forced:
    if (this.simulatedClosed) {
      return {
        eyesClosed: true,
        overallOpenness: 0.04,
        leftEye: { x: 38, y: 35, w: 32, h: 22, openness: 0.04 },
        rightEye: { x: 90, y: 35, w: 32, h: 22, openness: 0.04 },
        confidence: 0.98,
        faceDetected: true,
      };
    }

    // If webcam is not running, return attentive simulation
    if (!this.active || !this.videoEl || !this.ctx || !this.canvasEl) {
      return {
        eyesClosed: false,
        overallOpenness: 0.96,
        leftEye: { x: 38, y: 35, w: 32, h: 22, openness: 0.96 },
        rightEye: { x: 90, y: 35, w: 32, h: 22, openness: 0.96 },
        confidence: 0.95,
        faceDetected: false,
      };
    }

    if (this.videoEl.readyState < 2) {
      return {
        eyesClosed: false,
        overallOpenness: 0.85,
        leftEye: { x: 38, y: 35, w: 32, h: 22, openness: 0.85 },
        rightEye: { x: 90, y: 35, w: 32, h: 22, openness: 0.85 },
        confidence: 0.6,
        faceDetected: true,
      };
    }

    const w = this.canvasEl.width;
    const h = this.canvasEl.height;
    this.ctx.drawImage(this.videoEl, 0, 0, w, h);
    const imgData = this.ctx.getImageData(0, 0, w, h).data;

    // 1. Locate facial bounding region by skin chromaticity and luminance
    let weightedX = 0;
    let weightedY = 0;
    let totalWeight = 0;

    for (let y = 6; y < h - 6; y += 2) {
      for (let x = 6; x < w - 6; x += 2) {
        const idx = (y * w + x) * 4;
        const r = imgData[idx];
        const g = imgData[idx + 1];
        const b = imgData[idx + 2];
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        const warmth = Math.max(0, r - b * 0.85) + Math.max(0, r - g * 0.7);

        if (lum > 32 && lum < 248) {
          const weight = warmth * 1.5 + lum * 0.3;
          weightedX += x * weight;
          weightedY += y * weight;
          totalWeight += weight;
        }
      }
    }

    if (totalWeight < 4000) {
      // Poor lighting or face out of view
      return {
        eyesClosed: false,
        overallOpenness: 0.75,
        leftEye: { x: 38, y: 35, w: 32, h: 22, openness: 0.75 },
        rightEye: { x: 90, y: 35, w: 32, h: 22, openness: 0.75 },
        confidence: 0.35,
        faceDetected: false,
      };
    }

    const faceCenterX = Math.round(weightedX / totalWeight);
    const faceCenterY = Math.round(weightedY / totalWeight);

    // Estimate eye band location: eyes are typically ~12% above face center
    const eyeBandY = Math.max(16, Math.min(h - 30, faceCenterY - Math.round(h * 0.1)));
    const eyeSpan = Math.round(w * 0.18);
    const eyeBoxW = Math.round(w * 0.17);
    const eyeBoxH = Math.round(h * 0.18);

    // Left and right eye box coordinates
    const leftEyeX = Math.max(4, faceCenterX - eyeSpan - Math.round(eyeBoxW * 0.5));
    const rightEyeX = Math.min(w - eyeBoxW - 4, faceCenterX + eyeSpan - Math.round(eyeBoxW * 0.5));

    // Analyze ocular contrast and vertical edge energy inside each eye box
    const analyzeEyeBox = (startX: number, startY: number): number => {
      let minLum = 255;
      let maxLum = 0;
      let verticalEdgeSum = 0;
      let pixelCount = 0;

      for (let y = startY; y < startY + eyeBoxH - 1; y++) {
        for (let x = startX; x < startX + eyeBoxW; x++) {
          const idx = (y * w + x) * 4;
          const idxBelow = ((y + 1) * w + x) * 4;

          const r = imgData[idx];
          const g = imgData[idx + 1];
          const b = imgData[idx + 2];
          const lum = 0.299 * r + 0.587 * g + 0.114 * b;

          const lumBelow =
            0.299 * imgData[idxBelow] +
            0.587 * imgData[idxBelow + 1] +
            0.114 * imgData[idxBelow + 2];

          if (lum < minLum) minLum = lum;
          if (lum > maxLum) maxLum = lum;
          verticalEdgeSum += Math.abs(lum - lumBelow);
          pixelCount++;
        }
      }

      if (pixelCount === 0) return 0.8;
      const contrast = maxLum - minLum;
      const avgEdge = verticalEdgeSum / pixelCount;

      // When open: dark iris against white sclera produces contrast > 55 and vertical edge energy > 10
      // When closed: smooth eyelid skin tone drops contrast and edge gradients dramatically
      const opennessScore = (contrast / 85) * 0.6 + (avgEdge / 16) * 0.4;
      return Math.max(0.02, Math.min(1.0, opennessScore));
    };

    const leftOpenness = analyzeEyeBox(leftEyeX, eyeBandY);
    const rightOpenness = analyzeEyeBox(rightEyeX, eyeBandY);
    const avgOpenness = (leftOpenness + rightOpenness) * 0.5;

    // Threshold for eye closure: openness below 0.38 indicates eyelids shut
    const isClosed = avgOpenness < 0.38;

    return {
      eyesClosed: isClosed,
      overallOpenness: Number(avgOpenness.toFixed(2)),
      leftEye: {
        x: leftEyeX,
        y: eyeBandY,
        w: eyeBoxW,
        h: eyeBoxH,
        openness: Number(leftOpenness.toFixed(2)),
      },
      rightEye: {
        x: rightEyeX,
        y: eyeBandY,
        w: eyeBoxW,
        h: eyeBoxH,
        openness: Number(rightOpenness.toFixed(2)),
      },
      confidence: 0.92,
      faceDetected: true,
    };
  }

  public sampleObservation(): AttentionObservation {
    const analysis = this.analyzeEyes();

    return {
      eyesClosed: analysis.eyesClosed,
      eyeOpenness: analysis.overallOpenness,
      confidence: analysis.confidence,
      source: this.active ? 'webcam' : 'simulated',
      cameraFailed: this.errorReason !== null,
      failureReason: this.errorReason || undefined,
      // Backward-compatible pose indicators
      yawDeg: analysis.eyesClosed ? 18 : 0,
      pitchDeg: analysis.eyesClosed ? 14 : 0,
    };
  }
}

// Backward-compatible alias
export const WebcamEyeTracker = WebcamHeadTracker;
