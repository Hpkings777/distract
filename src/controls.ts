import type { VehicleInput } from './vehicle.ts';

export interface ControllerCalibrationSettings {
  steerAxisIndex: number;
  throttleAxisIndex: number;
  brakeAxisIndex: number;
  invertSteer: boolean;
  invertPedals: boolean;
  deadzone: number; // 0.0 to 0.35
  sensitivity: number; // 0.5 to 2.0
  centerOffset: number; // -0.5 to +0.5
}

export interface InputCapabilities {
  hasTouch: boolean;
  hasCoarsePointer: boolean;
  hasKeyboard: boolean;
  hasGamepad: boolean;
  recommendedTouchControls: boolean;
}

export interface LiveInputTelemetry {
  activeSource: 'keyboard' | 'gamepad' | 'touch';
  gamepadConnected: boolean;
  gamepadName: string;
  rawAxes: number[];
  normalizedSteer: number;
  normalizedThrottle: number;
  normalizedBrake: number;
  simulatingLookAwayLeft: boolean;
  simulatingLookAwayRight: boolean;
  steeringChangeDetected: boolean;
  capabilities: InputCapabilities;
}

export const DEFAULT_CONTROLLER_SETTINGS: ControllerCalibrationSettings = {
  steerAxisIndex: 0,
  throttleAxisIndex: 2,
  brakeAxisIndex: 1,
  invertSteer: false,
  invertPedals: false,
  deadzone: 0.06,
  sensitivity: 1.0,
  centerOffset: 0.0,
};

/**
 * Normalizes a raw gamepad axis value [-1..1] using center offset, deadzone, and sensitivity curve.
 */
export function normalizeSteeringAxis(
  rawValue: number,
  settings: ControllerCalibrationSettings,
): number {
  let shifted = rawValue - settings.centerOffset;
  if (settings.invertSteer) shifted = -shifted;

  const absVal = Math.abs(shifted);
  if (absVal <= settings.deadzone) return 0;

  const sign = Math.sign(shifted);
  const rescaled =
    (absVal - settings.deadzone) / Math.max(0.05, 1 - settings.deadzone);
  const clamped = Math.min(1, Math.max(0, rescaled));
  const curved = Math.pow(clamped, 1 / Math.max(0.25, settings.sensitivity));
  return Math.max(-1, Math.min(1, sign * curved));
}

/**
 * Hardware-abstracted input adapter separating Keyboard, Multi-Touch On-Screen Controls,
 * and USB Steering Wheel (Gamepad API) from vehicle simulation physics.
 */
export class InputAdapter {
  private keysHeld = new Set<string>();
  private keysJustPressed = new Set<string>();
  private settings: ControllerCalibrationSettings = {
    ...DEFAULT_CONTROLLER_SETTINGS,
  };
  private steeringChangeDetected = false;
  private initialAxisSample: number | null = null;
  private manualLookAwayOverride: 'none' | 'left' | 'right' = 'none';

  // Simultaneous multi-touch input state
  private touchSteer = 0;
  private touchThrottle = 0;
  private touchBrake = 0;
  private touchActive = false;

  private detectedKeyboard = false;
  private detectedTouch = false;
  private coarsePointer = false;

  constructor() {
    if (typeof window !== 'undefined') {
      this.coarsePointer =
        window.matchMedia?.('(pointer: coarse)').matches ?? false;
      this.detectedTouch =
        this.coarsePointer || (navigator.maxTouchPoints ?? 0) > 0;

      window.addEventListener('keydown', this.handleKeyDown);
      window.addEventListener('keyup', this.handleKeyUp);
      window.addEventListener('touchstart', this.handleTouchDetect, {
        passive: true,
      });
      window.addEventListener('blur', this.clearHeldKeys);
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }
  }

  public dispose(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this.handleKeyDown);
      window.removeEventListener('keyup', this.handleKeyUp);
      window.removeEventListener('touchstart', this.handleTouchDetect);
      window.removeEventListener('blur', this.clearHeldKeys);
      document.removeEventListener(
        'visibilitychange',
        this.handleVisibilityChange,
      );
    }
  }

  private handleTouchDetect = () => {
    this.detectedTouch = true;
  };

  private handleKeyDown = (e: KeyboardEvent) => {
    this.detectedKeyboard = true;
    const code = e.code;
    if (!this.keysHeld.has(code)) {
      this.keysJustPressed.add(code);
    }
    this.keysHeld.add(code);
  };

  private handleKeyUp = (e: KeyboardEvent) => {
    this.keysHeld.delete(e.code);
  };

  private handleVisibilityChange = () => {
    if (document.hidden) {
      this.clearHeldKeys();
    }
  };

  public clearHeldKeys = () => {
    this.keysHeld.clear();
    this.keysJustPressed.clear();
    this.manualLookAwayOverride = 'none';
    this.touchSteer = 0;
    this.touchThrottle = 0;
    this.touchBrake = 0;
    this.touchActive = false;
  };

  public setTouchSteer(value: number, active = true): void {
    this.touchSteer = Math.max(-1, Math.min(1, value));
    this.touchActive =
      active || this.touchThrottle > 0.01 || this.touchBrake > 0.01;
    if (Math.abs(this.touchSteer) > 0.05) {
      this.steeringChangeDetected = true;
    }
  }

  public setTouchPedals(throttle: number, brake: number): void {
    this.touchThrottle = Math.max(0, Math.min(1, throttle));
    this.touchBrake = Math.max(0, Math.min(1, brake));
    this.touchActive =
      this.touchThrottle > 0.01 ||
      this.touchBrake > 0.01 ||
      Math.abs(this.touchSteer) > 0.01;
  }

  public setManualLookAway(dir: 'none' | 'left' | 'right'): void {
    this.manualLookAwayOverride = dir;
  }

  public consumeJustPressed(code: string): boolean {
    if (this.keysJustPressed.has(code)) {
      this.keysJustPressed.delete(code);
      return true;
    }
    return false;
  }

  public flushJustPressed(): void {
    this.keysJustPressed.clear();
  }

  public getSettings(): ControllerCalibrationSettings {
    return { ...this.settings };
  }

  public updateSettings(partial: Partial<ControllerCalibrationSettings>): void {
    this.settings = { ...this.settings, ...partial };
  }

  public calibrateCenterFromCurrentGamepad(): void {
    const gp = this.getActiveGamepad();
    if (gp && gp.axes.length > this.settings.steerAxisIndex) {
      this.settings.centerOffset = Number(
        gp.axes[this.settings.steerAxisIndex].toFixed(3),
      );
    }
  }

  private getActiveGamepad(): Gamepad | null {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return null;
    try {
      const pads = navigator.getGamepads();
      for (const pad of pads) {
        if (pad && pad.connected) return pad;
      }
    } catch {
      return null;
    }
    return null;
  }

  public sampleInput(): {
    vehicleInput: VehicleInput;
    telemetry: LiveInputTelemetry;
  } {
    let kbSteer = 0;
    if (this.keysHeld.has('KeyA') || this.keysHeld.has('ArrowLeft'))
      kbSteer -= 1;
    if (this.keysHeld.has('KeyD') || this.keysHeld.has('ArrowRight'))
      kbSteer += 1;

    let kbThrottle = 0;
    if (this.keysHeld.has('KeyW') || this.keysHeld.has('ArrowUp'))
      kbThrottle = 1;

    let kbBrake = 0;
    if (
      this.keysHeld.has('KeyS') ||
      this.keysHeld.has('ArrowDown') ||
      this.keysHeld.has('Space')
    ) {
      kbBrake = 1;
    }

    const lookLeft =
      this.manualLookAwayOverride === 'left' ||
      this.keysHeld.has('KeyQ') ||
      this.keysHeld.has('KeyL');
    const lookRight =
      this.manualLookAwayOverride === 'right' || this.keysHeld.has('KeyE');

    const pad = this.getActiveGamepad();
    let padSteer = 0;
    let padThrottle = 0;
    let padBrake = 0;
    const rawAxes: number[] = [];

    if (pad) {
      for (let i = 0; i < pad.axes.length; i++) {
        rawAxes.push(Number(pad.axes[i].toFixed(3)));
      }
      const rawSteer = pad.axes[this.settings.steerAxisIndex] ?? 0;
      if (this.initialAxisSample === null) {
        this.initialAxisSample = rawSteer;
      } else if (Math.abs(rawSteer - this.initialAxisSample) > 0.12) {
        this.steeringChangeDetected = true;
      }

      padSteer = normalizeSteeringAxis(rawSteer, this.settings);

      if (pad.axes.length > this.settings.throttleAxisIndex) {
        const rawT = pad.axes[this.settings.throttleAxisIndex];
        padThrottle = this.settings.invertPedals
          ? (1 - rawT) * 0.5
          : Math.max(0, rawT);
      }
      if (pad.buttons[7]?.value) {
        padThrottle = Math.max(padThrottle, pad.buttons[7].value);
      }

      if (pad.axes.length > this.settings.brakeAxisIndex) {
        const rawB = pad.axes[this.settings.brakeAxisIndex];
        padBrake = this.settings.invertPedals
          ? (1 - rawB) * 0.5
          : Math.max(0, -rawB);
      }
      if (pad.buttons[6]?.value) {
        padBrake = Math.max(padBrake, pad.buttons[6].value);
      }
    }

    if (kbSteer !== 0) {
      this.steeringChangeDetected = true;
    }

    let activeSource: 'keyboard' | 'gamepad' | 'touch' = 'keyboard';
    if (this.touchActive) {
      activeSource = 'touch';
    } else if (
      pad !== null &&
      (Math.abs(padSteer) > 0.01 || padThrottle > 0.05 || padBrake > 0.05) &&
      kbSteer === 0 &&
      kbThrottle === 0 &&
      kbBrake === 0
    ) {
      activeSource = 'gamepad';
    }

    const finalSteer =
      kbSteer !== 0
        ? kbSteer
        : Math.abs(this.touchSteer) > 0.01
        ? this.touchSteer
        : padSteer;
    const finalThrottle = Math.max(kbThrottle, this.touchThrottle, padThrottle);
    const finalBrake = Math.max(kbBrake, this.touchBrake, padBrake);

    const isNarrowScreen =
      typeof window !== 'undefined' && window.innerWidth < 900;
    const recommendedTouch =
      (this.coarsePointer || (this.detectedTouch && isNarrowScreen)) &&
      !pad;

    return {
      vehicleInput: {
        steer: finalSteer,
        throttle: finalThrottle,
        brake: finalBrake,
      },
      telemetry: {
        activeSource,
        gamepadConnected: pad !== null,
        gamepadName: pad
          ? pad.id
          : 'No USB Wheel / Gamepad Detected (Keyboard / Touch Active)',
        rawAxes,
        normalizedSteer: Number(finalSteer.toFixed(2)),
        normalizedThrottle: Number(finalThrottle.toFixed(2)),
        normalizedBrake: Number(finalBrake.toFixed(2)),
        simulatingLookAwayLeft: lookLeft,
        simulatingLookAwayRight: lookRight,
        steeringChangeDetected: this.steeringChangeDetected,
        capabilities: {
          hasTouch: this.detectedTouch,
          hasCoarsePointer: this.coarsePointer,
          hasKeyboard: this.detectedKeyboard,
          hasGamepad: pad !== null,
          recommendedTouchControls: recommendedTouch,
        },
      },
    };
  }
}
