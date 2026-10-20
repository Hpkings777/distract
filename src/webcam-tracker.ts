import type { AttentionObservation } from './attention-monitor.ts';

/**
 * Local, offline-capable webcam head-pose estimator.
 * Processes 64x48 frames strictly in local browser memory (never uploads or stores images).
 * Estimates horizontal (yaw) and vertical (pitch) head centroid displacement relative
 * to the camera frame center.
 */
export class WebcamHeadTracker {
  private stream: MediaStream | null = null;
  private videoEl: HTMLVideoElement | null = null;
  private canvasEl: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private isActive = false;
  private errorReason: string | null = null;

  public async start(): Promise<boolean> {
    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      !navigator.mediaDevices.getUserMedia
    ) {
      this.errorReason = 'Browser does not support local webcam access (requires localhost or HTTPS)';
      this.isActive = false;
      return false;
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 320 },
          height: { ideal: 240 },
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
      this.canvasEl.width = 64;
      this.canvasEl.height = 48;
      this.ctx = this.canvasEl.getContext('2d', { willReadFrequently: true });

      this.isActive = true;
      this.errorReason = null;
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Camera permission denied';
      this.errorReason = `Webcam unavailable: ${msg}`;
      this.isActive = false;
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
      this.videoEl.srcObject = null;
      this.videoEl = null;
    }
    this.isActive = false;
  }

  public getVideoElement(): HTMLVideoElement | null {
    return this.videoEl;
  }

  public sampleObservation(): AttentionObservation {
    if (!this.isActive || !this.videoEl || !this.ctx || !this.canvasEl) {
      return {
        yawDeg: 0,
        pitchDeg: 0,
        confidence: 0,
        source: 'webcam',
        cameraFailed: true,
        failureReason: this.errorReason || 'Camera not initialized',
      };
    }

    if (this.videoEl.readyState < 2) {
      return {
        yawDeg: 0,
        pitchDeg: 0,
        confidence: 0.5,
        source: 'webcam',
      };
    }

    const w = this.canvasEl.width;
    const h = this.canvasEl.height;
    this.ctx.drawImage(this.videoEl, 0, 0, w, h);
    const img = this.ctx.getImageData(0, 0, w, h).data;

    let weightedX = 0;
    let weightedY = 0;
    let totalWeight = 0;

    // Evaluate warm skin-tone / central facial luminance distribution
    for (let y = 4; y < h - 4; y++) {
      for (let x = 4; x < w - 4; x++) {
        const idx = (y * w + x) * 4;
        const r = img[idx];
        const g = img[idx + 1];
        const b = img[idx + 2];

        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        // Favor warm skin chromaticity & central head mass
        const warmth = Math.max(0, r - b * 0.85) + Math.max(0, r - g * 0.7);
        if (lum > 35 && lum < 245) {
          const weight = warmth * 1.6 + lum * 0.35;
          weightedX += x * weight;
          weightedY += y * weight;
          totalWeight += weight;
        }
      }
    }

    if (totalWeight < 1200) {
      return {
        yawDeg: 0,
        pitchDeg: 0,
        confidence: 0.2,
        source: 'webcam',
      };
    }

    const normX = weightedX / totalWeight / w - 0.5; // -0.5 to +0.5
    const normY = weightedY / totalWeight / h - 0.5; // -0.5 to +0.5

    // Convert normalized centroid shift into estimated head orientation degrees
    // (Mirrored X so turning head right produces positive yaw)
    const yawDeg = -normX * 115;
    const pitchDeg = normY * 95;
    const confidence = Math.min(0.96, Math.max(0.55, totalWeight / 85000));

    return {
      yawDeg: Number(yawDeg.toFixed(1)),
      pitchDeg: Number(pitchDeg.toFixed(1)),
      confidence: Number(confidence.toFixed(2)),
      source: 'webcam',
    };
  }
}
