export type SleepAfterMinutes = 0 | 15 | 30 | 60;

export interface AutonomySettings {
  enabled: boolean;
  allowRoaming: boolean;
  sleepAfterMinutes: SleepAfterMinutes;
  wakeOnWindowChange: boolean;
}

export const DEFAULT_AUTONOMY_SETTINGS: AutonomySettings = {
  enabled: true,
  allowRoaming: true,
  sleepAfterMinutes: 30,
  wakeOnWindowChange: true,
};

export interface SchedulerTiming {
  idleAfterMs: number;
  roamMinDelayMs: number;
  roamMaxDelayMs: number;
}

export const DEFAULT_SCHEDULER_TIMING: SchedulerTiming = {
  idleAfterMs: 45_000,
  roamMinDelayMs: 90_000,
  roamMaxDelayMs: 180_000,
};

interface SchedulerCallbacks {
  onIdleVariation: () => void;
  onRoamRequested: () => void;
  onSleepRequested: () => void;
  onWakeRequested: () => void;
}

type TimerHandle = ReturnType<typeof globalThis.setTimeout>;

interface SchedulerClock {
  setTimeout: (callback: () => void, delayMs: number) => TimerHandle;
  clearTimeout: (handle: TimerHandle) => void;
}

const SYSTEM_CLOCK: SchedulerClock = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle),
};

export class AutonomousBehaviorScheduler {
  private settings: AutonomySettings;
  private readonly timing: SchedulerTiming;
  private readonly callbacks: SchedulerCallbacks;
  private readonly clock: SchedulerClock;
  private readonly random: () => number;
  private idleTimer: TimerHandle | null = null;
  private roamTimer: TimerHandle | null = null;
  private sleepTimer: TimerHandle | null = null;
  private running = false;
  private sleeping = false;

  constructor(
    settings: AutonomySettings,
    callbacks: SchedulerCallbacks,
    options: {
      timing?: SchedulerTiming;
      clock?: SchedulerClock;
      random?: () => number;
    } = {},
  ) {
    this.settings = { ...settings };
    this.callbacks = callbacks;
    this.timing = options.timing ?? DEFAULT_SCHEDULER_TIMING;
    this.clock = options.clock ?? SYSTEM_CLOCK;
    this.random = options.random ?? Math.random;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.restartTimers();
  }

  stop(): void {
    this.running = false;
    this.clearTimers();
  }

  configure(settings: AutonomySettings): void {
    this.settings = { ...settings };
    if (!settings.enabled && this.sleeping) {
      this.sleeping = false;
      this.callbacks.onWakeRequested();
    }
    if (this.running) this.restartTimers();
  }

  notifyActivity(): void {
    if (this.sleeping) {
      this.sleeping = false;
      this.callbacks.onWakeRequested();
    }
    if (this.running) this.restartTimers();
  }

  notifyWindowTargetChanged(): void {
    if (this.settings.wakeOnWindowChange) this.notifyActivity();
  }

  requestSleep(): void {
    if (this.sleeping) return;
    this.sleeping = true;
    if (this.idleTimer !== null) this.clock.clearTimeout(this.idleTimer);
    if (this.roamTimer !== null) this.clock.clearTimeout(this.roamTimer);
    if (this.sleepTimer !== null) this.clock.clearTimeout(this.sleepTimer);
    this.idleTimer = null;
    this.roamTimer = null;
    this.sleepTimer = null;
    this.callbacks.onSleepRequested();
  }

  private restartTimers(): void {
    this.clearTimers();
    if (!this.settings.enabled) return;

    this.idleTimer = this.clock.setTimeout(() => {
      this.idleTimer = null;
      if (!this.sleeping) this.callbacks.onIdleVariation();
    }, this.timing.idleAfterMs);

    if (this.settings.allowRoaming) this.scheduleRoam();

    if (this.settings.sleepAfterMinutes > 0) {
      this.sleepTimer = this.clock.setTimeout(() => {
        this.sleepTimer = null;
        this.requestSleep();
      }, this.settings.sleepAfterMinutes * 60_000);
    }
  }

  private scheduleRoam(): void {
    const spread = Math.max(0, this.timing.roamMaxDelayMs - this.timing.roamMinDelayMs);
    const delay = this.timing.roamMinDelayMs + spread * this.random();
    this.roamTimer = this.clock.setTimeout(() => {
      this.roamTimer = null;
      if (!this.sleeping) this.callbacks.onRoamRequested();
      if (this.running && this.settings.enabled && this.settings.allowRoaming) {
        this.scheduleRoam();
      }
    }, delay);
  }

  private clearTimers(): void {
    for (const timer of [this.idleTimer, this.roamTimer, this.sleepTimer]) {
      if (timer !== null) this.clock.clearTimeout(timer);
    }
    this.idleTimer = null;
    this.roamTimer = null;
    this.sleepTimer = null;
  }
}
