import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { SpriteAvatar } from "./components/SpriteAvatar";
import type { Facing, HitRegion, Point } from "./domain/avatar";
import { resolveAnimation } from "./domain/fallback";
import {
  DESKTOP_EVENTS,
  DESKTOP_STORAGE,
  emitToPet,
  isDesktopRuntime,
  listenDesktop,
  readBooleanSetting,
  showPetWindow,
  writeBooleanSetting,
} from "./desktop/bridge";
import {
  getAccessibilityPermissionStatus,
  openAccessibilitySettings,
  requestAccessibilityPermission,
  type AccessibilityPermissionStatus,
} from "./desktop/desktopWorld";
import { usePetCatalog } from "./hooks/usePetCatalog";
import { MotionEngine } from "./motion/MotionEngine";
import { SpriteRenderer } from "./renderers/SpriteRenderer";

const BEHAVIORS = ["idle", "walk", "sleep", "thinking", "talking", "happy"] as const;
const BEHAVIOR_LABELS: Record<(typeof BEHAVIORS)[number], string> = {
  idle: "待機",
  walk: "散步",
  sleep: "睡覺",
  thinking: "思考",
  talking: "說話",
  happy: "開心",
};
const SPEECH: Record<string, string> = {
  idle: "我在這裡。",
  sleep: "Zzz…",
  thinking: "讓我想想…",
  talking: "今天也一起工作吧！",
  happy: "太好啦！",
  head: "嘿嘿，好癢。",
};

export function App() {
  const { packages, error: catalogError } = usePetCatalog();
  const [selectedId, setSelectedId] = useState(
    () => localStorage.getItem(DESKTOP_STORAGE.petId) ?? "mochi",
  );
  const [animation, setAnimation] = useState("idle");
  const [facing, setFacing] = useState<Facing>("right");
  const [debug, setDebug] = useState(false);
  const [speech, setSpeech] = useState<string | null>("點一下舞台，我會走過去。");
  const [positionX, setPositionX] = useState(420);
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
    isDesktopRuntime() ? "denied" : "unsupported",
  );
  const stageRef = useRef<HTMLDivElement>(null);
  const dragPointerRef = useRef<number | null>(null);
  const motionRef = useRef(new MotionEngine({ x: 420, y: 0 }));
  const rendererRef = useRef(new SpriteRenderer());
  const speechTimerRef = useRef<number | null>(null);

  const selectedPackage = useMemo(
    () => packages.find((pkg) => pkg.manifest.id === selectedId) ?? packages[0],
    [packages, selectedId],
  );

  const scale = selectedPackage?.manifest.id === "bella" ? 0.82 : 0.9;

  const showSpeech = useCallback((message: string, duration = 2400) => {
    if (speechTimerRef.current) window.clearTimeout(speechTimerRef.current);
    setSpeech(message);
    speechTimerRef.current = window.setTimeout(() => setSpeech(null), duration);
  }, []);

  const handleAnimationComplete = useCallback(() => setAnimation("idle"), []);

  useEffect(() => {
    const unlisteners: (() => void)[] = [];
    void Promise.all([
      listenDesktop<string>(DESKTOP_EVENTS.selectPet, (petId) => setSelectedId(petId)),
      listenDesktop<boolean>(DESKTOP_EVENTS.clickThrough, (enabled) => setClickThrough(enabled)),
      listenDesktop<null>(DESKTOP_EVENTS.toggleClickThrough, () =>
        setClickThrough((enabled) => {
          const next = !enabled;
          writeBooleanSetting(DESKTOP_STORAGE.clickThrough, next);
          return next;
        }),
      ),
      listenDesktop<boolean>(DESKTOP_EVENTS.alwaysOnTop, (enabled) => setAlwaysOnTop(enabled)),
      listenDesktop<null>(DESKTOP_EVENTS.toggleAlwaysOnTop, () =>
        setAlwaysOnTop((enabled) => {
          const next = !enabled;
          writeBooleanSetting(DESKTOP_STORAGE.alwaysOnTop, next);
          return next;
        }),
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
  }, []);

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

  useEffect(() => {
    if (!selectedPackage) return;
    localStorage.setItem(DESKTOP_STORAGE.petId, selectedPackage.manifest.id);
    void emitToPet(DESKTOP_EVENTS.selectPet, selectedPackage.manifest.id);
    const renderer = new SpriteRenderer();
    rendererRef.current = renderer;
    void renderer.load(selectedPackage).then(() => {
      renderer.play(animation);
      renderer.setFacing(facing);
    });
    setAnimation("idle");
    showSpeech(`嗨，我是 ${selectedPackage.manifest.name}。`);
  }, [selectedPackage?.manifest.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    rendererRef.current.play(animation);
  }, [animation]);

  useEffect(() => {
    rendererRef.current.setFacing(facing);
  }, [facing]);

  useEffect(() => {
    let frameId = 0;
    let previous = performance.now();
    const tick = (now: number) => {
      const delta = Math.min((now - previous) / 1000, 0.05);
      previous = now;
      const wasMoving = motionRef.current.getSnapshot().moving;
      const snapshot = motionRef.current.step(delta);
      setPositionX(snapshot.position.x);
      if (snapshot.velocity.x !== 0) setFacing(snapshot.velocity.x < 0 ? "left" : "right");
      if (wasMoving && !snapshot.moving) {
        setAnimation("idle");
        showSpeech("到了！", 1300);
      }
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [showSpeech]);

  useEffect(
    () => () => {
      if (speechTimerRef.current) window.clearTimeout(speechTimerRef.current);
    },
    [],
  );

  const selectBehavior = (behavior: (typeof BEHAVIORS)[number]) => {
    setAnimation(behavior);
    showSpeech(SPEECH[behavior] ?? BEHAVIOR_LABELS[behavior]);
    void emitToPet(DESKTOP_EVENTS.playBehavior, behavior);
    if (behavior === "walk") {
      const stageWidth = stageRef.current?.clientWidth ?? 840;
      const destination = positionX > stageWidth / 2 ? 110 : stageWidth - 110;
      motionRef.current.moveTo({ x: destination, y: 0 });
    }
  };

  const updateDebug = (enabled: boolean) => {
    setDebug(enabled);
    void emitToPet(DESKTOP_EVENTS.debug, enabled);
  };

  const updateClickThrough = (enabled: boolean) => {
    setClickThrough(enabled);
    writeBooleanSetting(DESKTOP_STORAGE.clickThrough, enabled);
    void emitToPet(DESKTOP_EVENTS.clickThrough, enabled);
  };

  const updateAlwaysOnTop = (enabled: boolean) => {
    setAlwaysOnTop(enabled);
    writeBooleanSetting(DESKTOP_STORAGE.alwaysOnTop, enabled);
    void emitToPet(DESKTOP_EVENTS.alwaysOnTop, enabled);
  };

  const updateWindowAware = (enabled: boolean) => {
    setWindowAware(enabled);
    writeBooleanSetting(DESKTOP_STORAGE.windowAware, enabled);
    void emitToPet(DESKTOP_EVENTS.windowAware, enabled);
    if (enabled && permissionStatus === "denied") {
      void requestAccessibilityPermission().then(setPermissionStatus);
    }
  };

  const updateFollowActiveWindow = (enabled: boolean) => {
    setFollowActiveWindow(enabled);
    writeBooleanSetting(DESKTOP_STORAGE.followActiveWindow, enabled);
    void emitToPet(DESKTOP_EVENTS.followActiveWindow, enabled);
  };

  const updateDesktopFloorFallback = (enabled: boolean) => {
    setDesktopFloorFallback(enabled);
    writeBooleanSetting(DESKTOP_STORAGE.desktopFloorFallback, enabled);
    void emitToPet(DESKTOP_EVENTS.desktopFloorFallback, enabled);
  };

  const handleAccessibilityAction = async () => {
    const status = await requestAccessibilityPermission();
    setPermissionStatus(status);
    if (status === "denied") await openAccessibilitySettings();
  };

  const stagePoint = (clientX: number): number => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return positionX;
    return Math.max(70, Math.min(clientX - rect.left, rect.width - 70));
  };

  const moveFromStage = (event: ReactPointerEvent<HTMLDivElement>) => {
    const target = stagePoint(event.clientX);
    motionRef.current.moveTo({ x: target, y: 0 });
    setAnimation("walk");
    setSpeech(null);
  };

  const handlePetPointerDown = (
    event: ReactPointerEvent<HTMLDivElement>,
    _point: Point,
    region: HitRegion | null,
  ) => {
    if (region === "head") {
      setAnimation("happy");
      showSpeech(SPEECH.head);
      return;
    }
    if (region === "body") {
      dragPointerRef.current = event.pointerId;
      event.currentTarget.setPointerCapture(event.pointerId);
      motionRef.current.teleport({ x: stagePoint(event.clientX), y: 0 });
      setAnimation("idle");
      setSpeech(null);
    }
  };

  const handlePetPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragPointerRef.current !== event.pointerId) return;
    const nextX = stagePoint(event.clientX);
    setFacing(nextX < positionX ? "left" : "right");
    motionRef.current.teleport({ x: nextX, y: 0 });
    setPositionX(nextX);
  };

  const handlePetPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragPointerRef.current !== event.pointerId) return;
    dragPointerRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    showSpeech("放好囉。", 1300);
  };

  if (catalogError) {
    return (
      <main className="loading-state loading-state--error">
        <span>Pet Package 載入失敗</span>
        <strong>{catalogError}</strong>
      </main>
    );
  }

  if (!selectedPackage) {
    return <main className="loading-state">正在驗證 Pet Packages…</main>;
  }

  const { manifest } = selectedPackage;
  const feet = manifest.anchors.feet;
  const petLeft = positionX - feet[0] * scale;
  const petBottom = 64 - (manifest.renderer.frameHeight - feet[1]) * scale;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">D</div>
        <div>
          <h1>Deskling</h1>
          <p>Pet Package Lab</p>
        </div>
        <div className="topbar-actions">
          {isDesktopRuntime() && (
            <button className="show-pet-button" onClick={() => void showPetWindow()}>顯示寵物</button>
          )}
          <span className="mvp-badge">{isDesktopRuntime() ? "DESKTOP · CONNECTED" : "MVP · WEB"}</span>
        </div>
      </header>

      <section className="workspace">
        <aside className="control-panel">
          <div className="panel-section">
            <p className="eyebrow">YOUR DESKLINGS</p>
            <div className="pet-list">
              {packages.map((pkg) => (
                <button
                  className={`pet-option ${pkg.manifest.id === manifest.id ? "pet-option--active" : ""}`}
                  key={pkg.manifest.id}
                  onClick={() => setSelectedId(pkg.manifest.id)}
                >
                  <span
                    className="pet-option__portrait"
                    style={{
                      backgroundImage: `url(${pkg.assetUrl})`,
                      backgroundSize: `${pkg.imageWidth * (44 / pkg.manifest.renderer.frameWidth)}px auto`,
                    }}
                  />
                  <span>
                    <strong>{pkg.manifest.name}</strong>
                    <small>{pkg.manifest.author}</small>
                  </span>
                  <i aria-hidden="true">›</i>
                </button>
              ))}
            </div>
          </div>

          <div className="panel-section">
            <p className="eyebrow">BEHAVIOR</p>
            <div className="behavior-grid">
              {BEHAVIORS.map((behavior) => (
                <button
                  className={animation === behavior ? "active" : ""}
                  key={behavior}
                  onClick={() => selectBehavior(behavior)}
                >
                  <span>{BEHAVIOR_LABELS[behavior]}</span>
                  <small>{behavior}</small>
                </button>
              ))}
            </div>
          </div>

          <div className="panel-section panel-section--bottom">
            <div className="window-awareness-settings">
              <p className="eyebrow">DESKTOP WORLD</p>
              <label className="debug-toggle">
                <span>
                  <strong>視窗感知模式</strong>
                  <small>Window-aware mode</small>
                </span>
                <input
                  type="checkbox"
                  checked={windowAware}
                  disabled={!isDesktopRuntime()}
                  onChange={(event) => updateWindowAware(event.target.checked)}
                />
                <i aria-hidden="true" />
              </label>
              <label className="debug-toggle">
                <span>
                  <strong>跟隨使用中視窗</strong>
                  <small>Follow active window</small>
                </span>
                <input
                  type="checkbox"
                  checked={followActiveWindow}
                  disabled={!windowAware || !isDesktopRuntime()}
                  onChange={(event) => updateFollowActiveWindow(event.target.checked)}
                />
                <i aria-hidden="true" />
              </label>
              <label className="debug-toggle">
                <span>
                  <strong>桌面底部備援</strong>
                  <small>Desktop floor fallback</small>
                </span>
                <input
                  type="checkbox"
                  checked={desktopFloorFallback}
                  disabled={!isDesktopRuntime()}
                  onChange={(event) => updateDesktopFloorFallback(event.target.checked)}
                />
                <i aria-hidden="true" />
              </label>
              <div className="permission-status">
                <span>
                  <strong>輔助使用權限</strong>
                  <small>僅讀取視窗位置與尺寸</small>
                </span>
                <button
                  type="button"
                  className={`permission-status__badge permission-status__badge--${permissionStatus}`}
                  disabled={!isDesktopRuntime() || permissionStatus === "authorized"}
                  onClick={() => void handleAccessibilityAction()}
                >
                  {permissionStatus === "authorized"
                    ? "已授權"
                    : permissionStatus === "denied"
                      ? "前往授權"
                      : "不支援"}
                </button>
              </div>
            </div>
            <label className="debug-toggle">
              <span>
                <strong>顯示結構</strong>
                <small>Anchors & hitboxes</small>
              </span>
              <input type="checkbox" checked={debug} onChange={(event) => updateDebug(event.target.checked)} />
              <i aria-hidden="true" />
            </label>
            <label className="debug-toggle">
              <span>
                <strong>穿透點擊</strong>
                <small>Click through overlay</small>
              </span>
              <input
                type="checkbox"
                checked={clickThrough}
                disabled={!isDesktopRuntime()}
                onChange={(event) => updateClickThrough(event.target.checked)}
              />
              <i aria-hidden="true" />
            </label>
            <label className="debug-toggle">
              <span>
                <strong>保持置頂</strong>
                <small>Always on top</small>
              </span>
              <input
                type="checkbox"
                checked={alwaysOnTop}
                disabled={!isDesktopRuntime()}
                onChange={(event) => updateAlwaysOnTop(event.target.checked)}
              />
              <i aria-hidden="true" />
            </label>
          </div>
        </aside>

        <section className="preview-panel">
          <div className="preview-heading">
            <div>
              <span className="status-dot" />
              <span>LIVE PREVIEW</span>
            </div>
            <p>點擊地面移動 · 拖曳身體 · 摸摸頭</p>
          </div>

          <div className="desktop-stage" ref={stageRef} onPointerDown={moveFromStage}>
            <div className="ambient-orb ambient-orb--one" />
            <div className="ambient-orb ambient-orb--two" />

            <div className="mock-window" aria-hidden="true">
              <div className="mock-window__bar"><i /><i /><i /></div>
              <div className="mock-window__content">
                <span />
                <strong />
                <p />
                <p />
                <div><b /><b /><b /></div>
              </div>
            </div>

            <div className="pet-position" style={{ left: petLeft, bottom: petBottom }}>
              <SpriteAvatar
                pkg={selectedPackage}
                renderer={rendererRef.current}
                animation={animation}
                facing={facing}
                scale={scale}
                debug={debug}
                speech={speech}
                onAnimationComplete={handleAnimationComplete}
                onPointerDown={handlePetPointerDown}
                onPointerMove={handlePetPointerMove}
                onPointerUp={handlePetPointerUp}
              />
            </div>

            <div className="desktop-floor" aria-hidden="true">
              <span>DESKTOP SURFACE</span>
            </div>
          </div>

          <footer className="package-readout">
            <div>
              <span>PACKAGE</span>
              <strong>{manifest.id}</strong>
            </div>
            <div>
              <span>FRAME</span>
              <strong>{manifest.renderer.frameWidth} × {manifest.renderer.frameHeight}</strong>
            </div>
            <div>
              <span>ANIMATION</span>
              <strong>{resolveAnimation(animation, manifest.animations)}</strong>
            </div>
            <div>
              <span>FACING</span>
              <strong>{facing}</strong>
            </div>
            <div className="validation-chip">✓ Manifest valid</div>
          </footer>
        </section>
      </section>
    </main>
  );
}
