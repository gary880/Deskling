import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { PhysicalPosition } from "@tauri-apps/api/dpi";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
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
  const rendererRef = useRef(new SpriteRenderer());
  const speechTimerRef = useRef<number | null>(null);
  const activeGestureRef = useRef<ActivePetGesture | null>(null);
  const desktopMotionTokenRef = useRef(0);

  const selectedPackage = useMemo(
    () => packages.find((pkg) => pkg.manifest.id === selectedId) ?? packages[0],
    [packages, selectedId],
  );
  const scale = selectedPackage?.manifest.id === "bella" ? 0.92 : 1;

  const showSpeech = useCallback((message: string, duration = 2200) => {
    if (speechTimerRef.current) window.clearTimeout(speechTimerRef.current);
    setSpeech(message);
    speechTimerRef.current = window.setTimeout(() => setSpeech(null), duration);
  }, []);
  const handleAnimationComplete = useCallback(() => setAnimation("idle"), []);

  const stopDesktopMotion = useCallback(() => {
    desktopMotionTokenRef.current += 1;
  }, []);

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
    setAnimation("walk");
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
        setAnimation("idle");
        showSpeech("到了！", 1300);
        await constrainPetWindow(appWindow);
        return;
      }
      requestAnimationFrame((next) => void step(next));
    };

    requestAnimationFrame((now) => void step(now));
  }, [showSpeech]);

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
        setAnimation(behavior);
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
    ]).then((subscriptions) => unlisteners.push(...subscriptions));
    return () => unlisteners.forEach((unlisten) => unlisten());
  }, [showSpeech, startDesktopWalk, stopDesktopMotion]);

  useEffect(() => {
    if (!selectedPackage) return;
    stopDesktopMotion();
    localStorage.setItem(DESKTOP_STORAGE.petId, selectedPackage.manifest.id);
    const renderer = new SpriteRenderer();
    rendererRef.current = renderer;
    void renderer.load(selectedPackage).then(() => renderer.play("idle"));
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
    const appWindow = getCurrentWindow();
    const unlisteners: (() => void)[] = [];
    let constrainTimer: number | null = null;

    void (async () => {
      await restorePetWindowPosition(appWindow);
      unlisteners.push(
        await appWindow.onMoved(({ payload }) => {
          if (activeGestureRef.current) activeGestureRef.current.moved = true;
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

    if (!isDesktopRuntime()) {
      if (region === "head") {
        setAnimation("happy");
        showSpeech(SPEECH.head);
      }
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
          setAnimation("happy");
          showSpeech(SPEECH.head);
        }
        activeGestureRef.current = null;
      }
    }
  };

  if (error) return <div className="overlay-error">{error}</div>;
  if (!selectedPackage) return null;

  return (
    <main className={`pet-overlay ${clickThrough ? "pet-overlay--click-through" : ""}`}>
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
