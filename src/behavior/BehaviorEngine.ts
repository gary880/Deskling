export type BehaviorState =
  | "dragging"
  | "reacting"
  | "windowFollowing"
  | "roaming"
  | "sleeping"
  | "idle";

export type BehaviorSignals = Record<Exclude<BehaviorState, "idle">, boolean>;

export const BEHAVIOR_PRIORITY: readonly BehaviorState[] = [
  "dragging",
  "reacting",
  "windowFollowing",
  "roaming",
  "sleeping",
  "idle",
];

const DEFAULT_SIGNALS: BehaviorSignals = {
  dragging: false,
  reacting: false,
  windowFollowing: false,
  roaming: false,
  sleeping: false,
};

export function resolveBehaviorState(signals: BehaviorSignals): BehaviorState {
  return BEHAVIOR_PRIORITY.find((state) => state === "idle" || signals[state]) ?? "idle";
}

export class BehaviorEngine {
  private signals: BehaviorSignals = { ...DEFAULT_SIGNALS };

  setSignal(signal: keyof BehaviorSignals, active: boolean): BehaviorState {
    this.signals[signal] = active;
    return this.state;
  }

  clear(): BehaviorState {
    this.signals = { ...DEFAULT_SIGNALS };
    return this.state;
  }

  get state(): BehaviorState {
    return resolveBehaviorState(this.signals);
  }

  get snapshot(): Readonly<BehaviorSignals> {
    return { ...this.signals };
  }
}
