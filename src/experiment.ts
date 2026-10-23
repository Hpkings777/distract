import {
  DEFAULT_SIDE_DISPLAY_CONFIG,
  EXPERIMENT_CONFIG,
} from './config.ts';
import type {
  AttentionState,
  SideDisplayConfig,
  SidePatternType,
  StimulusIntensityLevel,
} from './config.ts';
import type { SynchronizedStimulusPayload } from './network.ts';
import type { StepCollisionEvent, VehicleState } from './vehicle.ts';

export interface DistractionEventRecord {
  id: number;
  startTimeSec: number;
  endTimeSec: number | null;
  durationSec: number;
  peakLaneDeviationMeters: number;
  recoveryTimeMs: number | null;
  waitingForLaneRecovery: boolean;
  gazeReturnedTimeSec: number | null;
}

export interface TrialSummary {
  trialType: 'baseline' | 'distracted';
  durationSec: number;
  distanceMeters: number;
  avgSpeedKmh: number;
  meanLaneDeviationMeters: number;
  maxLaneDeviationMeters: number;
  outOfLanePercent: number;
  collisionsCount: number;
  guardrailHitsCount: number;
  nearMissesCount: number;
  distractionEventsCount: number;
  totalDistractedTimeSec: number;
  avgLaneRecoveryTimeMs: number | null;
  sideStimulusEventsCount: number;
  events: DistractionEventRecord[];
}

export interface SideStimulusState {
  activeSide: 'none' | 'left' | 'right';
  patternIndex: number;
  leftPattern: SidePatternType;
  rightPattern: SidePatternType;
  leftIntensity: StimulusIntensityLevel;
  rightIntensity: StimulusIntensityLevel;
  colorHex: string;
  symbolLabel: string;
  intensity: number;
  eventId: number;
}

const STIMULUS_PALETTE: Record<
  SidePatternType,
  { colorHex: string; symbolLabel: string }
> = {
  chevron: { colorHex: '#f59e0b', symbolLabel: 'CHEVRON PULSE' },
  rings: { colorHex: '#06b6d4', symbolLabel: 'RADIAL RINGS' },
  matrix: { colorHex: '#ec4899', symbolLabel: 'OPTIC MATRIX' },
  wave: { colorHex: '#10b981', symbolLabel: 'SINE WAVE' },
};

/**
 * Records objective driving telemetry and distraction events during a simulation run,
 * and coordinates independent left and right side-display visual stimuli.
 */
export class ExperimentManager {
  private trialType: 'baseline' | 'distracted' = 'distracted';
  private elapsedSec = 0;
  private speedAccum = 0;
  private deviationAccum = 0;
  private sampleCount = 0;
  private outOfLaneTimeSec = 0;
  private maxLaneDeviationMeters = 0;
  private collisionsCount = 0;
  private guardrailHitsCount = 0;
  private nearMissesCount = 0;
  private sideStimulusEventsCount = 0;

  private distractionEvents: DistractionEventRecord[] = [];
  private activeEvent: DistractionEventRecord | null = null;
  private totalDistractedTimeSec = 0;

  private sideConfig: SideDisplayConfig = { ...DEFAULT_SIDE_DISPLAY_CONFIG };
  private lastStimulusTriggerSec = 2.0;
  private stimulusEventId = 0;
  private currentStimulus: SideStimulusState = {
    activeSide: 'none',
    patternIndex: 0,
    leftPattern: 'chevron',
    rightPattern: 'rings',
    leftIntensity: 'medium',
    rightIntensity: 'medium',
    colorHex: '#f59e0b',
    symbolLabel: 'STANDBY',
    intensity: 0,
    eventId: 0,
  };

  private baselineSummary: TrialSummary | null = null;
  private distractedSummary: TrialSummary | null = null;
  private onStimulusBroadcast?: (payload: SynchronizedStimulusPayload) => void;

  constructor(
    onStimulusBroadcast?: (payload: SynchronizedStimulusPayload) => void,
  ) {
    this.onStimulusBroadcast = onStimulusBroadcast;
  }

  public setOnStimulusBroadcast(
    cb: (payload: SynchronizedStimulusPayload) => void,
  ): void {
    this.onStimulusBroadcast = cb;
  }

  public updateSideConfig(partial: Partial<SideDisplayConfig>): void {
    this.sideConfig = { ...this.sideConfig, ...partial };
    this.currentStimulus.leftPattern = this.sideConfig.leftPattern;
    this.currentStimulus.rightPattern = this.sideConfig.rightPattern;
    this.currentStimulus.leftIntensity = this.sideConfig.leftIntensity;
    this.currentStimulus.rightIntensity = this.sideConfig.rightIntensity;
    this.emitNetworkStimulus();
  }

  public getSideConfig(): SideDisplayConfig {
    return { ...this.sideConfig };
  }

  public startRun(trialType: 'baseline' | 'distracted'): void {
    this.trialType = trialType;
    this.elapsedSec = 0;
    this.speedAccum = 0;
    this.deviationAccum = 0;
    this.sampleCount = 0;
    this.outOfLaneTimeSec = 0;
    this.maxLaneDeviationMeters = 0;
    this.collisionsCount = 0;
    this.guardrailHitsCount = 0;
    this.nearMissesCount = 0;
    this.sideStimulusEventsCount = 0;
    this.distractionEvents = [];
    this.activeEvent = null;
    this.totalDistractedTimeSec = 0;
    this.lastStimulusTriggerSec = 2.5;
    this.setStimulus('none', 0);
  }

  public triggerManualStimulus(side: 'left' | 'right', patternIdx = 0): void {
    this.lastStimulusTriggerSec = this.elapsedSec;
    this.sideStimulusEventsCount += 1;
    this.setStimulus(side, patternIdx);
  }

  private setStimulus(side: 'none' | 'left' | 'right', patternIdx: number): void {
    if (side === 'left' && !this.sideConfig.leftEnabled) side = 'none';
    if (side === 'right' && !this.sideConfig.rightEnabled) side = 'none';

    const activePattern =
      side === 'right'
        ? this.sideConfig.rightPattern
        : this.sideConfig.leftPattern;
    const meta = STIMULUS_PALETTE[activePattern];
    this.stimulusEventId += 1;

    this.currentStimulus = {
      activeSide: side,
      patternIndex: patternIdx % 4,
      leftPattern: this.sideConfig.leftPattern,
      rightPattern: this.sideConfig.rightPattern,
      leftIntensity: this.sideConfig.leftIntensity,
      rightIntensity: this.sideConfig.rightIntensity,
      colorHex: meta.colorHex,
      symbolLabel: side === 'none' ? 'STANDBY' : meta.symbolLabel,
      intensity: side === 'none' ? 0 : 1,
      eventId: this.stimulusEventId,
    };

    this.emitNetworkStimulus();
  }

  private emitNetworkStimulus(): void {
    if (!this.onStimulusBroadcast) return;
    this.onStimulusBroadcast({
      leftActive: this.currentStimulus.activeSide === 'left',
      rightActive: this.currentStimulus.activeSide === 'right',
      leftPattern: this.sideConfig.leftPattern,
      rightPattern: this.sideConfig.rightPattern,
      leftIntensity: this.sideConfig.leftIntensity,
      rightIntensity: this.sideConfig.rightIntensity,
      leftColor: STIMULUS_PALETTE[this.sideConfig.leftPattern].colorHex,
      rightColor: STIMULUS_PALETTE[this.sideConfig.rightPattern].colorHex,
      symbolLabel: this.currentStimulus.symbolLabel,
      eventId: this.currentStimulus.eventId,
      authoritativeTimeMs: Date.now(),
    });
  }

  public step(
    dt: number,
    vehicle: VehicleState,
    attentionState: AttentionState,
    collisionEvents: StepCollisionEvent[],
    enableAutoStimuli: boolean,
  ): void {
    if (dt <= 0) return;

    this.elapsedSec += dt;
    this.sampleCount += 1;
    this.speedAccum += vehicle.speed * 3.6;
    this.deviationAccum += vehicle.laneDeviationMeters;

    if (vehicle.laneDeviationMeters > this.maxLaneDeviationMeters) {
      this.maxLaneDeviationMeters = vehicle.laneDeviationMeters;
    }

    if (vehicle.isOutOfLane) {
      this.outOfLaneTimeSec += dt;
    }

    for (const ev of collisionEvents) {
      if (ev.type === 'hazard') this.collisionsCount += 1;
      else if (ev.type === 'guardrail') this.guardrailHitsCount += 1;
      else if (ev.type === 'near_miss') this.nearMissesCount += 1;
    }

    const isCurrentlyDistracted =
      attentionState === 'POSSIBLY_DISTRACTED' ||
      attentionState === 'DISTRACTED' ||
      attentionState === 'DROWSY_WARNING' ||
      attentionState === 'DROWSY_CRITICAL';

    if (isCurrentlyDistracted) {
      this.totalDistractedTimeSec += dt;
      if (!this.activeEvent) {
        const newEvent: DistractionEventRecord = {
          id: this.distractionEvents.length + 1,
          startTimeSec: this.elapsedSec,
          endTimeSec: null,
          durationSec: dt,
          peakLaneDeviationMeters: vehicle.laneDeviationMeters,
          recoveryTimeMs: null,
          waitingForLaneRecovery: false,
          gazeReturnedTimeSec: null,
        };
        this.activeEvent = newEvent;
        this.distractionEvents.push(newEvent);
      } else {
        this.activeEvent.durationSec =
          this.elapsedSec - this.activeEvent.startTimeSec;
        if (
          vehicle.laneDeviationMeters >
          this.activeEvent.peakLaneDeviationMeters
        ) {
          this.activeEvent.peakLaneDeviationMeters =
            vehicle.laneDeviationMeters;
        }
      }
    } else if (this.activeEvent) {
      this.activeEvent.endTimeSec = this.elapsedSec;
      this.activeEvent.durationSec =
        this.activeEvent.endTimeSec - this.activeEvent.startTimeSec;
      this.activeEvent.gazeReturnedTimeSec = this.elapsedSec;
      if (vehicle.isOutOfLane) {
        this.activeEvent.waitingForLaneRecovery = true;
      } else {
        this.activeEvent.recoveryTimeMs = 120;
      }
      this.activeEvent = null;
    }

    for (const ev of this.distractionEvents) {
      if (ev.waitingForLaneRecovery && ev.gazeReturnedTimeSec !== null) {
        if (!vehicle.isOutOfLane) {
          ev.recoveryTimeMs = Math.round(
            (this.elapsedSec - ev.gazeReturnedTimeSec) * 1000,
          );
          ev.waitingForLaneRecovery = false;
        }
      }
    }

    if (enableAutoStimuli && this.trialType === 'distracted') {
      const sinceLast = this.elapsedSec - this.lastStimulusTriggerSec;
      if (
        this.currentStimulus.activeSide === 'none' &&
        sinceLast >= EXPERIMENT_CONFIG.stimulusIntervalSec
      ) {
        this.lastStimulusTriggerSec = this.elapsedSec;
        let side: 'left' | 'right' =
          Math.floor(this.elapsedSec / EXPERIMENT_CONFIG.stimulusIntervalSec) %
            2 ===
          0
            ? 'left'
            : 'right';
        if (side === 'left' && !this.sideConfig.leftEnabled) side = 'right';
        if (side === 'right' && !this.sideConfig.rightEnabled) side = 'left';

        const patIdx = Math.floor(this.elapsedSec) % 4;
        this.sideStimulusEventsCount += 1;
        this.setStimulus(side, patIdx);
      } else if (
        this.currentStimulus.activeSide !== 'none' &&
        sinceLast >= EXPERIMENT_CONFIG.stimulusDurationSec
      ) {
        this.setStimulus('none', 0);
      }
    } else if (
      !enableAutoStimuli &&
      this.currentStimulus.activeSide !== 'none'
    ) {
      const sinceLast = this.elapsedSec - this.lastStimulusTriggerSec;
      if (sinceLast >= EXPERIMENT_CONFIG.stimulusDurationSec) {
        this.setStimulus('none', 0);
      }
    }
  }

  public getStimulus(): SideStimulusState {
    return this.currentStimulus;
  }

  public getElapsedSec(): number {
    return this.elapsedSec;
  }

  public getLiveSummary(distanceMeters: number): TrialSummary {
    const duration = Math.max(0.1, this.elapsedSec);
    const count = Math.max(1, this.sampleCount);

    const completedRecoveries = this.distractionEvents
      .map((e) => e.recoveryTimeMs)
      .filter((v): v is number => v !== null);

    const avgRecovery =
      completedRecoveries.length > 0
        ? Math.round(
            completedRecoveries.reduce((a, b) => a + b, 0) /
              completedRecoveries.length,
          )
        : null;

    return {
      trialType: this.trialType,
      durationSec: Number(duration.toFixed(1)),
      distanceMeters: Math.round(distanceMeters),
      avgSpeedKmh: Math.round(this.speedAccum / count),
      meanLaneDeviationMeters: Number((this.deviationAccum / count).toFixed(2)),
      maxLaneDeviationMeters: Number(this.maxLaneDeviationMeters.toFixed(2)),
      outOfLanePercent: Math.min(
        100,
        Math.round((this.outOfLaneTimeSec / duration) * 100),
      ),
      collisionsCount: this.collisionsCount,
      guardrailHitsCount: this.guardrailHitsCount,
      nearMissesCount: this.nearMissesCount,
      distractionEventsCount: this.distractionEvents.length,
      totalDistractedTimeSec: Number(this.totalDistractedTimeSec.toFixed(1)),
      avgLaneRecoveryTimeMs: avgRecovery,
      sideStimulusEventsCount: this.sideStimulusEventsCount,
      events: [...this.distractionEvents],
    };
  }

  public finalizeCurrentRun(distanceMeters: number): TrialSummary {
    const summary = this.getLiveSummary(distanceMeters);
    if (this.trialType === 'baseline') {
      this.baselineSummary = summary;
    } else {
      this.distractedSummary = summary;
    }
    this.setStimulus('none', 0);
    return summary;
  }

  public getSavedComparison(): {
    baseline: TrialSummary | null;
    distracted: TrialSummary | null;
  } {
    return {
      baseline: this.baselineSummary,
      distracted: this.distractedSummary,
    };
  }
}
