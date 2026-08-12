import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { PhysicalPosition } from "@tauri-apps/api/dpi";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import {
  AutonomousBehaviorScheduler,
  DEFAULT_AUTONOMY_SETTINGS,
  type AutonomySettings,
  type SleepAfterMinutes,
} from "../behavior/AutonomousBehaviorScheduler";
import {
  BehaviorEngine,
  type BehaviorEvent,
  type BehaviorState,
  type SurfaceEvent,
  type SurfaceState,
} from "../behavior/BehaviorEngine";
import { SpriteAvatar } from "../components/SpriteAvatar";
import type { Facing, HitRegion, Point } from "../domain/avatar";
import { usePetCatalog } from "../hooks/usePetCatalog";
import { SpriteRenderer } from "../renderers/SpriteRenderer";
import {
  DESKTOP_EVENTS,
  DESKTOP_STORAGE,
  isDesktopRuntime,
  listenDesktop,
  readBooleanSetting,
  readNumberSetting,
  writeBooleanSetting,
  writeNumberSetting,
} from "./bridge";
import {
  desktopFloorFeetPosition,
  getAccessibilityPermissionStatus,
  getActiveDesktopWindow,
  feetAnchorOffset,
  positionPetWindow,
  windowSnapshotChanged,
  windowRoamFeetTarget,
  windowTopFeetPosition,
  WINDOW_TRACKING_INTERVAL_MS,
  type AccessibilityPermissionStatus,
  type DesktopWindowSnapshot,
  type FeetAnchorMetrics,
} from "./desktopWorld";
import {
  constrainPetWindow,
  horizontalWalkTarget,
  persistPetWindowPosition,
  restorePetWindowPosition,
} from "./windowPosition";

const SPEECH: Record<string, string> = {
  idle: "我在這裡。",
  sleep: "Zzz…",
  thinking: "讓我想想…",
  talking: "今天也一起工作吧！",
  happy: "太好啦！",
  head: "嘿嘿，好癢。",
};

interface ActivePetGesture {
  region: HitRegion;
  moved: boolean;
}

const SLEEP_AFTER_OPTIONS: readonly SleepAfterMinutes[] = [0, 15, 30, 60];

export function PetOverlay() {
  const { packages, error } = usePetCatalog();
  const [selectedId, setSelectedId] = useState(
    () => localStorage.getItem(DESKTOP_STORAGE.petId) ?? "mochi",
  );
  const [animation, setAnimation] = useState("idle");
  const [facing, setFacing] = useState<Facing>("right");
  const [debug, setDebug] = useState(false);
  const [speech, setSpeech] = useState<string | null>(null);
  const [clickThrough, setClickThrough] = useState(() =>
    readBooleanSetting(DESKTOP_STORAGE.clickThrough, false),
  );
  const [alwaysOnTop, setAlwaysOnTop] = useState(() =>
    readBooleanSetting(DESKTOP_STORAGE.alwaysOnTop, true),
  );
  const [windowAware, setWindowAware] = useState(() =>
    readBooleanSetting(DESKTOP_STORAGE.windowAware, true),
  );
  const [followActiveWindow, setFollowActiveWindow] = useState(() =>
    readBooleanSetting(DESKTOP_STORAGE.followActiveWindow, true),
  );
  const [desktopFloorFallback, setDesktopFloorFallback] = useState(() =>
    readBooleanSetting(DESKTOP_STORAGE.desktopFloorFallback, true),
  );
  const [permissionStatus, setPermissionStatus] = useState<AccessibilityPermissionStatus>(
    "denied",
  );
  const [behaviorState, setBehaviorState] = useState<BehaviorState>("idle");
  const [surfaceState, setSurfaceState] = useState<SurfaceState>("manual");
  const [autonomySettings, setAutonomySettings] = useState<AutonomySettings>(() => ({
    enabled: readBooleanSetting(
      DESKTOP_STORAGE.autonomousBehavior,
      DEFAULT_AUTONOMY_SETTINGS.enabled,
    ),
    allowRoaming: readBooleanSetting(
      DESKTOP_STORAGE.allowRoaming,
      DEFAULT_AUTONOMY_SETTINGS.allowRoaming,
    ),
    sleepAfterMinutes: readNumberSetting(
      DESKTOP_STORAGE.sleepAfterMinutes,
      SLEEP_AFTER_OPTIONS,
      DEFAULT_AUTONOMY_SETTINGS.sleepAfterMinutes,
    ),
    wakeOnWindowChange: readBooleanSetting(
      DESKTOP_STORAGE.wakeOnWindowChange,
      DEFAULT_AUTONOMY_SETTINGS.wakeOnWindowChange,
    ),
  }));
  const rendererRef = useRef(new SpriteRenderer());
  const speechTimerRef = useRef<number | null>(null);
  const idleVariationTimerRef = useRef<number | null>(null);
  const reactionTimerRef = useRef<number | null>(null);
  const activeGestureRef = useRef<ActivePetGesture | null>(null);
  const desktopMotionTokenRef = useRef(0);
  const behaviorEngineRef = useRef(new BehaviorEngine());
  const schedulerRef = useRef<AutonomousBehaviorScheduler | null>(null);
  const surfaceModeRef = useRef<SurfaceState>("manual");
  const lastWindowSnapshotRef = useRef<DesktopWindowSnapshot | null>(null);
  const lastWindowFeetXRef = useRef<number | null>(null);
  const startDesktopWalkRef = useRef<() => Promise<void>>(async () => undefined);

  const selectedPackage = useMemo(
    () => packages.find((pkg) => pkg.manifest.id === selectedId) ?? packages[0],
    [packages, selectedId],
  );
  const scale = selectedPackage?.manifest.id === "bella" ? 0.92 : 1;

  const dispatchBehavior = useCallback(
    (event: BehaviorEvent): BehaviorState => {
      const state = behaviorEngineRef.current.dispatch(event);
      setBehaviorState(state);
      if (state === "dragging" || state === "idle") {
        setAnimation("idle");
      } else if (state === "roaming") {
        setAnimation("walk");
      } else if (state === "sleeping") {
        setAnimation("sleep");
      }
      return state;
    },
    [],
  );

  const dispatchSurface = useCallback(
    (event: SurfaceEvent, fallback = desktopFloorFallback): SurfaceState => {
      const surface = behaviorEngineRef.current.dispatchSurface(event, fallback);
      surfaceModeRef.current = surface;
      setSurfaceState(surface);
      return surface;
    },
    [desktopFloorFallback],
  );

  const showSpeech = useCallback((message: string, duration = 2200) => {
    if (speechTimerRef.current) window.clearTimeout(speechTimerRef.current);
    setSpeech(message);
    speechTimerRef.current = window.setTimeout(() => setSpeech(null), duration);
  }, []);
  const handleAnimationComplete = useCallback(() => {
    if (reactionTimerRef.current) window.clearTimeout(reactionTimerRef.current);
    reactionTimerRef.current = null;
    dispatchBehavior("reactionCompleted");
  }, [dispatchBehavior]);

  const startReaction = useCallback((nextAnimation: string, duration = 4_000) => {
    dispatchBehavior("reactionStarted");
    setAnimation(nextAnimation);
    if (reactionTimerRef.current) window.clearTimeout(reactionTimerRef.current);
    reactionTimerRef.current = window.setTimeout(() => {
      reactionTimerRef.current = null;
      dispatchBehavior("reactionCompleted");
    }, duration);
  }, [dispatchBehavior]);

  const stopDesktopMotion = useCallback(() => {
    desktopMotionTokenRef.current += 1;
    dispatchBehavior("roamCompleted");
  }, [dispatchBehavior]);

  const startDesktopWalk = useCallback(async () => {
    if (!isDesktopRuntime() || !selectedPackage) return;

    const token = ++desktopMotionTokenRef.current;
    const appWindow = getCurrentWindow();
    const windowSurface = surfaceModeRef.current === "window"
      ? lastWindowSnapshotRef.current
      : null;

    if (windowSurface) {
      const [windowSize, windowPosition, pixelScale] = await Promise.all([
        appWindow.innerSize(),
        appWindow.outerPosition(),
        appWindow.scaleFactor(),
      ]);
      if (token !== desktopMotionTokenRef.current) return;
      const metrics: FeetAnchorMetrics = {
        overlayWidth: windowSize.width / pixelScale,
        overlayHeight: windowSize.height / pixelScale,
        frameWidth: selectedPackage.manifest.renderer.frameWidth,
        frameHeight: selectedPackage.manifest.renderer.frameHeight,
        feet: selectedPackage.manifest.anchors.feet,
        scale,
        facing,
        avatarBottom: 16,
      };
      const anchor = feetAnchorOffset(metrics);
      const currentFeetX = lastWindowFeetXRef.current
        ?? windowPosition.x / pixelScale + anchor.x;
      const targetFeetX = windowRoamFeetTarget(windowSurface, currentFeetX);
      const direction = targetFeetX < currentFeetX ? -1 : 1;
      const walkFacing: Facing = direction < 0 ? "left" : "right";
      const walkMetrics = { ...metrics, facing: walkFacing };
      const walkAnchor = feetAnchorOffset(walkMetrics);
      const targetX = targetFeetX - walkAnchor.x;
      const fixedY = windowSurface.bounds.y - walkAnchor.y;
      const speed = 110;
      let x = currentFeetX - walkAnchor.x;
      let previous = performance.now();

      setFacing(walkFacing);
      if (dispatchBehavior("roamRequested") !== "roaming") return;
      setSpeech(null);

      const step = async (now: number) => {
        if (token !== desktopMotionTokenRef.current) return;
        const deltaSeconds = Math.min((now - previous) / 1000, 0.05);
        previous = now;
        x += direction * speed * deltaSeconds;
        const arrived = direction > 0 ? x >= targetX : x <= targetX;
        if (arrived) x = targetX;
        await positionPetWindow({ x, y: fixedY });
        lastWindowFeetXRef.current = x + walkAnchor.x;
        if (token !== desktopMotionTokenRef.current) return;
        if (arrived) {
          dispatchBehavior("roamCompleted");
          return;
        }
        requestAnimationFrame((next) => void step(next));
      };

      requestAnimationFrame((now) => void step(now));
      return;
    }

    const [monitor, initialPosition, windowSize] = await Promise.all([
      currentMonitor(),
      appWindow.outerPosition(),
      appWindow.outerSize(),
    ]);
    if (!monitor || token !== desktopMotionTokenRef.current) return;

    const workArea = {
      x: monitor.workArea.position.x,
      y: monitor.workArea.position.y,
      width: monitor.workArea.size.width,
      height: monitor.workArea.size.height,
    };
    const targetX = horizontalWalkTarget(initialPosition.x, windowSize.width, workArea);
    const direction = targetX < initialPosition.x ? -1 : 1;
    const speed = 170 * monitor.scaleFactor;
    let x = initialPosition.x;
    let previous = performance.now();

    setFacing(direction < 0 ? "left" : "right");
    if (dispatchBehavior("roamRequested") !== "roaming") return;
    setSpeech(null);

    const step = async (now: number) => {
      if (token !== desktopMotionTokenRef.current) return;
      const deltaSeconds = Math.min((now - previous) / 1000, 0.05);
      previous = now;
      x += direction * speed * deltaSeconds;
      const arrived = direction > 0 ? x >= targetX : x <= targetX;
      if (arrived) x = targetX;

      await appWindow.setPosition(new PhysicalPosition(Math.round(x), initialPosition.y));
      if (token !== desktopMotionTokenRef.current) return;

      if (arrived) {
        dispatchBehavior("roamCompleted");
        if (surfaceModeRef.current === "manual") await constrainPetWindow(appWindow);
        return;
      }
      requestAnimationFrame((next) => void step(next));
    };

    requestAnimationFrame((now) => void step(now));
  }, [dispatchBehavior, facing, scale, selectedPackage]);

  startDesktopWalkRef.current = startDesktopWalk;

  useEffect(() => {
    const scheduler = new AutonomousBehaviorScheduler(autonomySettings, {
      onIdleVariation: () => {
        if (behaviorEngineRef.current.state !== "idle") return;
        setAnimation("thinking");
        if (idleVariationTimerRef.current) window.clearTimeout(idleVariationTimerRef.current);
        idleVariationTimerRef.current = window.setTimeout(() => {
          idleVariationTimerRef.current = null;
          if (behaviorEngineRef.current.state === "idle") setAnimation("idle");
        }, 4_000);
      },
      onRoamRequested: () => void startDesktopWalkRef.current(),
      onSleepRequested: () => {
        stopDesktopMotion();
        dispatchBehavior("sleepRequested");
      },
      onWakeRequested: () => {
        stopDesktopMotion();
        dispatchBehavior("wakeRequested");
      },
    });
    schedulerRef.current = scheduler;
    scheduler.start();
    return () => {
      scheduler.stop();
      if (schedulerRef.current === scheduler) schedulerRef.current = null;
    };
  }, [dispatchBehavior, stopDesktopMotion]); // Settings are applied by the configure effect.

  useEffect(() => {
    const unlisteners: (() => void)[] = [];
    void Promise.all([
      listenDesktop<string>(DESKTOP_EVENTS.selectPet, (petId) => setSelectedId(petId)),
      listenDesktop<string>(DESKTOP_EVENTS.playBehavior, (behavior) => {
        schedulerRef.current?.notifyActivity();
        if (behavior === "walk") {
          dispatchBehavior("reactionCompleted");
          dispatchBehavior("wakeRequested");
          void startDesktopWalkRef.current();
          return;
        }
        stopDesktopMotion();
        if (behavior === "sleep") {
          dispatchBehavior("reactionCompleted");
          schedulerRef.current?.requestSleep();
        } else if (behavior === "idle") {
          dispatchBehavior("reactionCompleted");
          dispatchBehavior("wakeRequested");
        } else {
          startReaction(behavior);
        }
        showSpeech(SPEECH[behavior] ?? behavior);
      }),
      listenDesktop<boolean>(DESKTOP_EVENTS.debug, (enabled) => setDebug(enabled)),
      listenDesktop<boolean>(DESKTOP_EVENTS.clickThrough, (enabled) => setClickThrough(enabled)),
      listenDesktop<null>(DESKTOP_EVENTS.toggleClickThrough, () =>
        setClickThrough((enabled) => !enabled),
      ),
      listenDesktop<boolean>(DESKTOP_EVENTS.alwaysOnTop, (enabled) => setAlwaysOnTop(enabled)),
      listenDesktop<null>(DESKTOP_EVENTS.toggleAlwaysOnTop, () =>
        setAlwaysOnTop((enabled) => !enabled),
      ),
      listenDesktop<boolean>(DESKTOP_EVENTS.windowAware, setWindowAware),
      listenDesktop<null>(DESKTOP_EVENTS.toggleWindowAware, () =>
        setWindowAware((enabled) => {
          const next = !enabled;
          writeBooleanSetting(DESKTOP_STORAGE.windowAware, next);
          return next;
        }),
      ),
      listenDesktop<boolean>(DESKTOP_EVENTS.followActiveWindow, setFollowActiveWindow),
      listenDesktop<null>(DESKTOP_EVENTS.toggleFollowActiveWindow, () =>
        setFollowActiveWindow((enabled) => {
          const next = !enabled;
          writeBooleanSetting(DESKTOP_STORAGE.followActiveWindow, next);
          return next;
        }),
      ),
      listenDesktop<boolean>(DESKTOP_EVENTS.desktopFloorFallback, setDesktopFloorFallback),
      listenDesktop<null>(DESKTOP_EVENTS.toggleDesktopFloorFallback, () =>
        setDesktopFloorFallback((enabled) => {
          const next = !enabled;
          writeBooleanSetting(DESKTOP_STORAGE.desktopFloorFallback, next);
          return next;
        }),
      ),
      listenDesktop<AccessibilityPermissionStatus>(
        DESKTOP_EVENTS.accessibilityStatusChanged,
        setPermissionStatus,
      ),
      listenDesktop<AutonomySettings>(DESKTOP_EVENTS.autonomySettings, setAutonomySettings),
    ]).then((subscriptions) => unlisteners.push(...subscriptions));
    return () => unlisteners.forEach((unlisten) => unlisten());
  }, [dispatchBehavior, showSpeech, startReaction, stopDesktopMotion]);

  useEffect(() => {
    if (!selectedPackage) return;
    stopDesktopMotion();
    localStorage.setItem(DESKTOP_STORAGE.petId, selectedPackage.manifest.id);
    const renderer = new SpriteRenderer();
    rendererRef.current = renderer;
    void renderer.load(selectedPackage).then(() => renderer.play("idle"));
    behaviorEngineRef.current.clear();
    setBehaviorState("idle");
    schedulerRef.current?.notifyActivity();
    lastWindowSnapshotRef.current = null;
    lastWindowFeetXRef.current = null;
    setAnimation("idle");
    showSpeech(`嗨，我是 ${selectedPackage.manifest.name}。`);
  }, [selectedPackage, showSpeech, stopDesktopMotion]);

  useEffect(() => {
    rendererRef.current.play(animation);
  }, [animation]);

  useEffect(() => {
    rendererRef.current.setFacing(facing);
  }, [facing]);

  useEffect(() => {
    if (!isDesktopRuntime()) return;
    const appWindow = getCurrentWindow();
    writeBooleanSetting(DESKTOP_STORAGE.clickThrough, clickThrough);
    void appWindow.setIgnoreCursorEvents(clickThrough);
  }, [clickThrough]);

  useEffect(() => {
    if (!isDesktopRuntime()) return;
    const appWindow = getCurrentWindow();
    writeBooleanSetting(DESKTOP_STORAGE.alwaysOnTop, alwaysOnTop);
    void appWindow.setAlwaysOnTop(alwaysOnTop);
  }, [alwaysOnTop]);

  useEffect(() => {
    if (!isDesktopRuntime()) return;
    writeBooleanSetting(DESKTOP_STORAGE.windowAware, windowAware);
    writeBooleanSetting(DESKTOP_STORAGE.followActiveWindow, followActiveWindow);
    writeBooleanSetting(DESKTOP_STORAGE.desktopFloorFallback, desktopFloorFallback);
  }, [desktopFloorFallback, followActiveWindow, windowAware]);

  useEffect(() => {
    writeBooleanSetting(DESKTOP_STORAGE.autonomousBehavior, autonomySettings.enabled);
    writeBooleanSetting(DESKTOP_STORAGE.allowRoaming, autonomySettings.allowRoaming);
    writeNumberSetting(DESKTOP_STORAGE.sleepAfterMinutes, autonomySettings.sleepAfterMinutes);
    writeBooleanSetting(DESKTOP_STORAGE.wakeOnWindowChange, autonomySettings.wakeOnWindowChange);
    if (!autonomySettings.enabled || !autonomySettings.allowRoaming) stopDesktopMotion();
    schedulerRef.current?.configure(autonomySettings);
  }, [autonomySettings, stopDesktopMotion]);

  useEffect(() => {
    if (!isDesktopRuntime()) return;
    let active = true;
    const refresh = () => {
      void getAccessibilityPermissionStatus().then((status) => {
        if (active) setPermissionStatus(status);
      });
    };
    refresh();
    const timer = window.setInterval(refresh, 2000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  const positionOnDesktopFloor = useCallback(async () => {
    if (!isDesktopRuntime() || !selectedPackage) return;
    const appWindow = getCurrentWindow();
    const [monitor, position, windowSize] = await Promise.all([
      currentMonitor(),
      appWindow.outerPosition(),
      appWindow.outerSize(),
    ]);
    if (!monitor || activeGestureRef.current) return;
    const pixelScale = monitor.scaleFactor;
    const metrics: FeetAnchorMetrics = {
      overlayWidth: windowSize.width,
      overlayHeight: windowSize.height,
      frameWidth: selectedPackage.manifest.renderer.frameWidth,
      frameHeight: selectedPackage.manifest.renderer.frameHeight,
      feet: selectedPackage.manifest.anchors.feet,
      scale: scale * pixelScale,
      facing,
      avatarBottom: 16 * pixelScale,
    };
    const target = desktopFloorFeetPosition(
      position.x,
      {
        x: monitor.workArea.position.x,
        y: monitor.workArea.position.y,
        width: monitor.workArea.size.width,
        height: monitor.workArea.size.height,
      },
      metrics,
    );
    dispatchSurface("desktopFloorSelected");
    await appWindow.setPosition(new PhysicalPosition(target.x, target.y));
  }, [dispatchSurface, facing, scale, selectedPackage]);

  const positionOnWindow = useCallback(async (
    snapshot: DesktopWindowSnapshot,
    preferredFeetX: number | null,
  ) => {
    if (!isDesktopRuntime() || !selectedPackage || activeGestureRef.current) return;
    const appWindow = getCurrentWindow();
    const [windowSize, windowPosition, pixelScale] = await Promise.all([
      appWindow.innerSize(),
      appWindow.outerPosition(),
      appWindow.scaleFactor(),
    ]);
    const metrics: FeetAnchorMetrics = {
      overlayWidth: windowSize.width / pixelScale,
      overlayHeight: windowSize.height / pixelScale,
      frameWidth: selectedPackage.manifest.renderer.frameWidth,
      frameHeight: selectedPackage.manifest.renderer.frameHeight,
      feet: selectedPackage.manifest.anchors.feet,
      scale,
      facing,
      avatarBottom: 16,
    };
    const anchor = feetAnchorOffset(metrics);
    const currentFeetX = windowPosition.x / pixelScale + anchor.x;
    const target = windowTopFeetPosition(snapshot, metrics, preferredFeetX ?? currentFeetX);
    dispatchSurface("windowTargetChanged");
    await positionPetWindow(target);
    lastWindowFeetXRef.current = target.x + anchor.x;
  }, [dispatchSurface, facing, scale, selectedPackage]);

  useEffect(() => {
    if (!isDesktopRuntime() || !selectedPackage) return;

    let active = true;
    let polling = false;
    let missedSnapshots = 0;
    let fallbackPlaced = false;

    const fallback = () => {
      lastWindowSnapshotRef.current = null;
      lastWindowFeetXRef.current = null;
      dispatchSurface("windowTargetLost", desktopFloorFallback);
      if (desktopFloorFallback && !fallbackPlaced) {
        fallbackPlaced = true;
        void positionOnDesktopFloor();
      }
    };

    if (!windowAware || !followActiveWindow || permissionStatus !== "authorized") {
      fallback();
      return;
    }

    const poll = async () => {
      if (!active || polling) return;
      polling = true;
      try {
        const snapshot = await getActiveDesktopWindow();
        if (!active) return;
        if (!snapshot || snapshot.minimized) {
          missedSnapshots += 1;
          if (missedSnapshots >= 3) fallback();
          return;
        }

        missedSnapshots = 0;
        fallbackPlaced = false;
        if (windowSnapshotChanged(lastWindowSnapshotRef.current, snapshot)) {
          stopDesktopMotion();
          const previous = lastWindowSnapshotRef.current;
          if (
            !previous ||
            previous.appId !== snapshot.appId ||
            previous.monitorId !== snapshot.monitorId
          ) {
            schedulerRef.current?.notifyWindowTargetChanged();
          }
          let preferredFeetX = lastWindowFeetXRef.current;
          if (
            previous &&
            preferredFeetX !== null &&
            previous.appId === snapshot.appId &&
            previous.monitorId === snapshot.monitorId
          ) {
            preferredFeetX += snapshot.bounds.x - previous.bounds.x;
          }
          lastWindowSnapshotRef.current = snapshot;
          await positionOnWindow(snapshot, preferredFeetX);
        }
      } catch {
        missedSnapshots += 1;
        if (missedSnapshots >= 3) fallback();
      } finally {
        polling = false;
      }
    };

    void poll();
    const timer = window.setInterval(() => void poll(), WINDOW_TRACKING_INTERVAL_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [
    desktopFloorFallback,
    followActiveWindow,
    permissionStatus,
    positionOnDesktopFloor,
    positionOnWindow,
    selectedPackage,
    stopDesktopMotion,
    dispatchSurface,
    windowAware,
  ]);

  useEffect(() => {
    if (!isDesktopRuntime()) return;
    const appWindow = getCurrentWindow();
    const unlisteners: (() => void)[] = [];
    let constrainTimer: number | null = null;

    void (async () => {
      await restorePetWindowPosition(appWindow);
      unlisteners.push(
        await appWindow.onMoved(({ payload }) => {
          if (activeGestureRef.current) activeGestureRef.current.moved = true;
          if (surfaceModeRef.current !== "manual") return;
          persistPetWindowPosition(payload);
          if (constrainTimer) globalThis.clearTimeout(constrainTimer);
          constrainTimer = globalThis.setTimeout(() => void constrainPetWindow(appWindow), 350);
        }),
        await appWindow.onScaleChanged(() => void constrainPetWindow(appWindow)),
      );
      await appWindow.show();
    })();

    return () => {
      if (constrainTimer) globalThis.clearTimeout(constrainTimer);
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, []);

  useEffect(
    () => () => {
      desktopMotionTokenRef.current += 1;
      if (speechTimerRef.current) window.clearTimeout(speechTimerRef.current);
      if (idleVariationTimerRef.current) window.clearTimeout(idleVariationTimerRef.current);
      if (reactionTimerRef.current) window.clearTimeout(reactionTimerRef.current);
    },
    [],
  );

  const handlePointerDown = async (
    event: ReactPointerEvent<HTMLDivElement>,
    _point: Point,
    region: HitRegion | null,
  ) => {
    if (!region) return;

    stopDesktopMotion();
    schedulerRef.current?.notifyActivity();
    dispatchBehavior("dragStarted");
    dispatchSurface("manualPositioned");
    lastWindowSnapshotRef.current = null;
    lastWindowFeetXRef.current = null;

    if (!isDesktopRuntime()) {
      if (region === "head") {
        startReaction("happy");
        showSpeech(SPEECH.head);
      }
      dispatchBehavior("dragEnded");
      return;
    }

    // Every visible hit region can move the native window. The operating system
    // applies its own movement threshold, so a stationary head click remains a tap.
    const gesture: ActivePetGesture = { region, moved: false };
    activeGestureRef.current = gesture;
    setSpeech(null);

    try {
      event.currentTarget.setPointerCapture(event.pointerId);
      await getCurrentWindow().startDragging();
    } finally {
      if (activeGestureRef.current === gesture) {
        if (gesture.region === "head" && !gesture.moved) {
          startReaction("happy");
          showSpeech(SPEECH.head);
        }
        activeGestureRef.current = null;
        dispatchBehavior("dragEnded");
        lastWindowSnapshotRef.current = null;
        lastWindowFeetXRef.current = null;
      }
    }
  };

  if (error) return <div className="overlay-error">{error}</div>;
  if (!selectedPackage) return null;

  return (
    <main
      className={`pet-overlay ${clickThrough ? "pet-overlay--click-through" : ""}`}
      data-behavior-state={behaviorState}
      data-surface-state={surfaceState}
    >
      <div className="pet-overlay__avatar">
        <SpriteAvatar
          pkg={selectedPackage}
          renderer={rendererRef.current}
          animation={animation}
          facing={facing}
          scale={scale}
          debug={debug}
          speech={speech}
          onAnimationComplete={handleAnimationComplete}
          onPointerDown={(event, point, region) => void handlePointerDown(event, point, region)}
          onPointerMove={() => undefined}
          onPointerUp={() => undefined}
        />
      </div>
      {debug && (
        <button className="overlay-facing" onClick={() => setFacing(facing === "left" ? "right" : "left")}>
          facing: {facing}
        </button>
      )}
      {!isDesktopRuntime() && <span className="overlay-browser-note">Desktop overlay preview</span>}
    </main>
  );
}
