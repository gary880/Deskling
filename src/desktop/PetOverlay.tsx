import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { PhysicalPosition } from "@tauri-apps/api/dpi";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { BehaviorEngine, type BehaviorSignals, type BehaviorState } from "../behavior/BehaviorEngine";
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
  writeBooleanSetting,
} from "./bridge";
import {
  desktopFloorFeetPosition,
  getAccessibilityPermissionStatus,
  getActiveDesktopWindow,
  feetAnchorOffset,
  positionPetWindow,
  windowSnapshotChanged,
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
  const rendererRef = useRef(new SpriteRenderer());
  const speechTimerRef = useRef<number | null>(null);
  const activeGestureRef = useRef<ActivePetGesture | null>(null);
  const desktopMotionTokenRef = useRef(0);
  const behaviorEngineRef = useRef(new BehaviorEngine());
  const surfaceModeRef = useRef<"manual" | "window" | "floor">("manual");
  const lastWindowSnapshotRef = useRef<DesktopWindowSnapshot | null>(null);
  const lastWindowFeetXRef = useRef<number | null>(null);

  const selectedPackage = useMemo(
    () => packages.find((pkg) => pkg.manifest.id === selectedId) ?? packages[0],
    [packages, selectedId],
  );
  const scale = selectedPackage?.manifest.id === "bella" ? 0.92 : 1;

  const updateBehaviorSignal = useCallback(
    (signal: keyof BehaviorSignals, active: boolean): BehaviorState => {
      const state = behaviorEngineRef.current.setSignal(signal, active);
      setBehaviorState(state);
      if (state === "dragging" || state === "windowFollowing" || state === "idle") {
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

  const showSpeech = useCallback((message: string, duration = 2200) => {
    if (speechTimerRef.current) window.clearTimeout(speechTimerRef.current);
    setSpeech(message);
    speechTimerRef.current = window.setTimeout(() => setSpeech(null), duration);
  }, []);
  const handleAnimationComplete = useCallback(() => {
    updateBehaviorSignal("reacting", false);
  }, [updateBehaviorSignal]);

  const stopDesktopMotion = useCallback(() => {
    desktopMotionTokenRef.current += 1;
    updateBehaviorSignal("roaming", false);
  }, [updateBehaviorSignal]);

  const startDesktopWalk = useCallback(async () => {
    if (!isDesktopRuntime()) return;

    const token = ++desktopMotionTokenRef.current;
    const appWindow = getCurrentWindow();
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
    if (updateBehaviorSignal("roaming", true) !== "roaming") {
      updateBehaviorSignal("roaming", false);
      return;
    }
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
        updateBehaviorSignal("roaming", false);
        showSpeech("到了！", 1300);
        await constrainPetWindow(appWindow);
        return;
      }
      requestAnimationFrame((next) => void step(next));
    };

    requestAnimationFrame((now) => void step(now));
  }, [showSpeech, updateBehaviorSignal]);

  useEffect(() => {
    const unlisteners: (() => void)[] = [];
    void Promise.all([
      listenDesktop<string>(DESKTOP_EVENTS.selectPet, (petId) => setSelectedId(petId)),
      listenDesktop<string>(DESKTOP_EVENTS.playBehavior, (behavior) => {
        if (behavior === "walk") {
          void startDesktopWalk();
          return;
        }
        stopDesktopMotion();
        updateBehaviorSignal("sleeping", behavior === "sleep");
        updateBehaviorSignal("reacting", behavior !== "sleep" && behavior !== "idle");
        if (behavior !== "idle" && behavior !== "sleep") setAnimation(behavior);
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
    ]).then((subscriptions) => unlisteners.push(...subscriptions));
    return () => unlisteners.forEach((unlisten) => unlisten());
  }, [showSpeech, startDesktopWalk, stopDesktopMotion, updateBehaviorSignal]);

  useEffect(() => {
    if (!selectedPackage) return;
    stopDesktopMotion();
    localStorage.setItem(DESKTOP_STORAGE.petId, selectedPackage.manifest.id);
    const renderer = new SpriteRenderer();
    rendererRef.current = renderer;
    void renderer.load(selectedPackage).then(() => renderer.play("idle"));
    behaviorEngineRef.current.clear();
    setBehaviorState("idle");
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
    surfaceModeRef.current = "floor";
    await appWindow.setPosition(new PhysicalPosition(target.x, target.y));
  }, [facing, scale, selectedPackage]);

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
    surfaceModeRef.current = "window";
    await positionPetWindow(target);
    lastWindowFeetXRef.current = target.x + anchor.x;
  }, [facing, scale, selectedPackage]);

  useEffect(() => {
    if (!isDesktopRuntime() || !selectedPackage) return;

    let active = true;
    let polling = false;
    let missedSnapshots = 0;
    let fallbackPlaced = false;

    const fallback = () => {
      lastWindowSnapshotRef.current = null;
      lastWindowFeetXRef.current = null;
      updateBehaviorSignal("windowFollowing", false);
      if (desktopFloorFallback && !fallbackPlaced) {
        fallbackPlaced = true;
        void positionOnDesktopFloor();
      } else if (!desktopFloorFallback) {
        surfaceModeRef.current = "manual";
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
        updateBehaviorSignal("windowFollowing", true);
        if (windowSnapshotChanged(lastWindowSnapshotRef.current, snapshot)) {
          stopDesktopMotion();
          const previous = lastWindowSnapshotRef.current;
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
    updateBehaviorSignal,
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
    updateBehaviorSignal("dragging", true);
    surfaceModeRef.current = "manual";
    lastWindowSnapshotRef.current = null;
    lastWindowFeetXRef.current = null;

    if (!isDesktopRuntime()) {
      if (region === "head") {
        updateBehaviorSignal("reacting", true);
        setAnimation("happy");
        showSpeech(SPEECH.head);
      }
      updateBehaviorSignal("dragging", false);
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
          updateBehaviorSignal("reacting", true);
          setAnimation("happy");
          showSpeech(SPEECH.head);
        }
        activeGestureRef.current = null;
        updateBehaviorSignal("dragging", false);
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
