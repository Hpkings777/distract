import { DEFAULT_AUDIO_SETTINGS } from './config.ts';
import type { AudioSettings } from './config.ts';

/**
 * Procedural Web Audio API synthesizer for continuous engine RPM hum,
 * road rumble-strip vibration, collision impacts, and distraction alerts
 * with independent volume controls.
 */
export class SoundEngine {
  private ctx: AudioContext | null = null;
  private settings: AudioSettings = { ...DEFAULT_AUDIO_SETTINGS };
  private lastAlarmTime = 0;
  private lastRumbleTime = 0;

  private engineOsc: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;

  public getSettings(): AudioSettings {
    return { ...this.settings };
  }

  public updateSettings(partial: Partial<AudioSettings>): void {
    this.settings = { ...this.settings, ...partial };
    if (this.engineGain && this.ctx) {
      const targetGain = this.settings.muted
        ? 0
        : this.settings.engineVolume * 0.045;
      this.engineGain.gain.setTargetAtTime(
        targetGain,
        this.ctx.currentTime,
        0.05,
      );
    }
  }

  public isMuted(): boolean {
    return this.settings.muted;
  }

  public toggleMute(): boolean {
    this.updateSettings({ muted: !this.settings.muted });
    return this.settings.muted;
  }

  public setMuted(val: boolean): void {
    this.updateSettings({ muted: val });
  }

  private ensureContext(): AudioContext | null {
    if (this.settings.muted || typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public updateEngineHum(rpmNormalized: number, isPlaying: boolean): void {
    if (this.settings.muted || !isPlaying || this.settings.engineVolume <= 0.01) {
      if (this.engineGain && this.ctx) {
        this.engineGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
      }
      return;
    }

    const ctx = this.ensureContext();
    if (!ctx) return;

    if (!this.engineOsc || !this.engineGain) {
      try {
        this.engineOsc = ctx.createOscillator();
        this.engineGain = ctx.createGain();
        this.engineOsc.type = 'triangle';
        this.engineOsc.frequency.setValueAtTime(62, ctx.currentTime);
        this.engineGain.gain.setValueAtTime(0.001, ctx.currentTime);
        this.engineOsc.connect(this.engineGain);
        this.engineGain.connect(ctx.destination);
        this.engineOsc.start();
      } catch {
        return;
      }
    }

    const freq = 52 + rpmNormalized * 115;
    const vol = this.settings.engineVolume * 0.04;
    this.engineOsc.frequency.setTargetAtTime(freq, ctx.currentTime, 0.06);
    this.engineGain.gain.setTargetAtTime(vol, ctx.currentTime, 0.08);
  }

  public playCollision(intensity = 0.8): void {
    const ctx = this.ensureContext();
    if (!ctx || this.settings.roadVolume <= 0.01) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(135, now);
    osc.frequency.exponentialRampToValueAtTime(32, now + 0.24);

    const peak = Math.min(
      0.4,
      intensity * 0.35 * this.settings.roadVolume,
    );
    gain.gain.setValueAtTime(Math.max(0.002, peak), now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.26);
  }

  public playDistractionBeep(urgent = false): void {
    const ctx = this.ensureContext();
    if (!ctx || this.settings.alertVolume <= 0.01) return;
    const now = ctx.currentTime;
    if (now - this.lastAlarmTime < (urgent ? 0.34 : 0.68)) return;
    this.lastAlarmTime = now;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = urgent ? 'square' : 'triangle';
    osc.frequency.setValueAtTime(urgent ? 880 : 587.33, now);
    if (urgent) {
      osc.frequency.setValueAtTime(1174.66, now + 0.08);
    }

    const peak = (urgent ? 0.16 : 0.09) * this.settings.alertVolume;
    gain.gain.setValueAtTime(Math.max(0.002, peak), now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.19);
  }

  public playDrowsinessCriticalAlarm(): void {
    const ctx = this.ensureContext();
    if (!ctx || this.settings.alertVolume <= 0.01) return;
    const now = ctx.currentTime;
    if (now - this.lastAlarmTime < 0.22) return;
    this.lastAlarmTime = now;

    // Dual-tone urgent ADAS horn/chime (1200Hz + 800Hz)
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();

    osc1.type = 'sawtooth';
    osc2.type = 'square';
    osc1.frequency.setValueAtTime(987.77, now);
    osc1.frequency.setValueAtTime(1318.51, now + 0.07);
    osc2.frequency.setValueAtTime(659.25, now);
    osc2.frequency.setValueAtTime(880.0, now + 0.07);

    const peak = 0.22 * this.settings.alertVolume;
    gain.gain.setValueAtTime(Math.max(0.002, peak), now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(ctx.destination);

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.19);
    osc2.stop(now + 0.19);
  }

  public playRumbleTick(): void {
    const ctx = this.ensureContext();
    if (!ctx || this.settings.roadVolume <= 0.01) return;
    const now = ctx.currentTime;
    if (now - this.lastRumbleTime < 0.09) return;
    this.lastRumbleTime = now;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(74, now);
    const peak = 0.08 * this.settings.roadVolume;
    gain.gain.setValueAtTime(Math.max(0.002, peak), now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.065);
  }
}
