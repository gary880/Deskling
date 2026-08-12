export type BehaviorState = "dragging" | "reacting" | "roaming" | "sleeping" | "idle";
export type SurfaceState = "manual" | "window" | "desktopFloor";

export interface BehaviorContext {
  dragging: boolean;
  reacting: boolean;
  roaming: boolean;
  sleeping: boolean;
}

export type BehaviorEvent =
  | "dragStarted"
  | "dragEnded"
  | "reactionStarted"
  | "reactionCompleted"
  | "roamRequested"
  | "roamCompleted"
  | "sleepRequested"
  | "wakeRequested"
  | "reset";

export type SurfaceEvent =
  | "windowTargetChanged"
  | "windowTargetLost"
  | "desktopFloorSelected"
  | "manualPositioned";

export const BEHAVIOR_PRIORITY: readonly BehaviorState[] = [
  "dragging",
  "reacting",
  "roaming",
  "sleeping",
  "idle",
];

const DEFAULT_CONTEXT: BehaviorContext = {
  dragging: false,
  reacting: false,
  roaming: false,
  sleeping: false,
};

export function resolveBehaviorState(context: BehaviorContext): BehaviorState {
  return BEHAVIOR_PRIORITY.find((state) => state === "idle" || context[state]) ?? "idle";
}

export function transitionBehavior(
  context: BehaviorContext,
  event: BehaviorEvent,
): BehaviorContext {
  switch (event) {
    case "dragStarted":
      return { ...context, dragging: true, roaming: false, sleeping: false };
    case "dragEnded":
      return { ...context, dragging: false };
    case "reactionStarted":
      return { ...context, reacting: true, roaming: false, sleeping: false };
    case "reactionCompleted":
      return { ...context, reacting: false };
    case "roamRequested":
      return context.dragging || context.reacting || context.sleeping
        ? context
        : { ...context, roaming: true };
    case "roamCompleted":
      return { ...context, roaming: false };
    case "sleepRequested":
      return { ...context, roaming: false, sleeping: true };
    case "wakeRequested":
      return { ...context, sleeping: false };
    case "reset":
      return { ...DEFAULT_CONTEXT };
  }
}

export function transitionSurface(
  surface: SurfaceState,
  event: SurfaceEvent,
  desktopFloorFallback = true,
): SurfaceState {
  switch (event) {
    case "windowTargetChanged":
      return "window";
    case "windowTargetLost":
      return desktopFloorFallback ? "desktopFloor" : "manual";
    case "desktopFloorSelected":
      return "desktopFloor";
    case "manualPositioned":
      return "manual";
    default:
      return surface;
  }
}

export class BehaviorEngine {
  private context: BehaviorContext = { ...DEFAULT_CONTEXT };
  private currentSurface: SurfaceState = "manual";

  dispatch(event: BehaviorEvent): BehaviorState {
    this.context = transitionBehavior(this.context, event);
    return this.state;
  }

  dispatchSurface(event: SurfaceEvent, desktopFloorFallback = true): SurfaceState {
    this.currentSurface = transitionSurface(this.currentSurface, event, desktopFloorFallback);
    return this.surface;
  }

  clear(): BehaviorState {
    this.context = { ...DEFAULT_CONTEXT };
    return this.state;
  }

  get state(): BehaviorState {
    return resolveBehaviorState(this.context);
  }

  get surface(): SurfaceState {
    return this.currentSurface;
  }

  get snapshot(): Readonly<BehaviorContext> {
    return { ...this.context };
  }
}
