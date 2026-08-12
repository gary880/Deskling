import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { SpriteAvatar } from "./components/SpriteAvatar";
import { PersonalitySettings } from "./components/PersonalitySettings";
import { ConversationHistorySettings } from "./components/ConversationHistorySettings";
import { PetMemorySettings } from "./components/PetMemorySettings";
import { PetCreator } from "./components/PetCreator";
import type { ConversationEvent } from "./agent/conversation";
import {
  DEFAULT_AUTONOMY_SETTINGS,
  type AutonomySettings,
  type SleepAfterMinutes,
} from "./behavior/AutonomousBehaviorScheduler";
import {
  AGENT_ACTIVITY_ANIMATION,
  AGENT_REACTION_DURATION_MS,
  AGENT_ACTIVITY_SPEECH,
  type AgentActivityEvent,
  type AgentActivity,
} from "./behavior/AgentActivity";
import type { Facing, HitRegion, Point } from "./domain/avatar";
import { resolveAnimation } from "./domain/fallback";
import {
  DESKTOP_EVENTS,
  DESKTOP_STORAGE,
  choosePetZip,
  clearAgentActivity,
  emitToPet,
  importPetZip,
  isDesktopRuntime,
  listenDesktop,
  readBooleanSetting,
  readNumberSetting,
  removeInstalledPet,
  reportAgentActivity,
  resetPetConversation,
  showPetWindow,
  startPetConversation,
  writeBooleanSetting,
  writeNumberSetting,
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
import { DEFAULT_PROACTIVE_SETTINGS, type ProactiveInteractionSettings } from "./behavior/ProactiveInteractionScheduler";

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
const SLEEP_AFTER_OPTIONS: readonly SleepAfterMinutes[] = [0, 15, 30, 60];
const AGENT_ACTIVITIES: readonly AgentActivity[] = ["thinking", "talking", "success", "error"];

export function App() {
  const { packages, error: catalogError, reload: reloadCatalog } = usePetCatalog();
  const [packageStatus, setPackageStatus] = useState<{ kind: "busy" | "success" | "error"; message: string } | null>(null);
  const [workspaceMode, setWorkspaceMode] = useState<"runtime" | "creator">("runtime");
  const [selectedId, setSelectedId] = useState(
    () => localStorage.getItem(DESKTOP_STORAGE.petId) ?? "mochi",
  );
  const [animation, setAnimation] = useState("idle");
  const [agentActivity, setAgentActivity] = useState<AgentActivity>("idle");
  const [facing, setFacing] = useState<Facing>("right");
  const [debug, setDebug] = useState(false);
  const [speech, setSpeech] = useState<string | null>("點一下舞台，我會走過去。");
  const [personalityPreview, setPersonalityPreview] = useState("");
  const [personalityPreviewBusy, setPersonalityPreviewBusy] = useState(false);
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
  const [autonomousBehavior, setAutonomousBehavior] = useState(() =>
    readBooleanSetting(DESKTOP_STORAGE.autonomousBehavior, DEFAULT_AUTONOMY_SETTINGS.enabled),
  );
  const [allowRoaming, setAllowRoaming] = useState(() =>
    readBooleanSetting(DESKTOP_STORAGE.allowRoaming, DEFAULT_AUTONOMY_SETTINGS.allowRoaming),
  );
  const [sleepAfterMinutes, setSleepAfterMinutes] = useState<SleepAfterMinutes>(() =>
    readNumberSetting(
      DESKTOP_STORAGE.sleepAfterMinutes,
      SLEEP_AFTER_OPTIONS,
      DEFAULT_AUTONOMY_SETTINGS.sleepAfterMinutes,
    ),
  );
  const [wakeOnWindowChange, setWakeOnWindowChange] = useState(() =>
    readBooleanSetting(
      DESKTOP_STORAGE.wakeOnWindowChange,
      DEFAULT_AUTONOMY_SETTINGS.wakeOnWindowChange,
    ),
  );
  const [proactiveSettings, setProactiveSettings] = useState<ProactiveInteractionSettings>(() => {
    try { return { ...DEFAULT_PROACTIVE_SETTINGS, ...JSON.parse(localStorage.getItem(DESKTOP_STORAGE.proactiveSettings) ?? "{}") }; }
    catch { return DEFAULT_PROACTIVE_SETTINGS; }
  });
  const stageRef = useRef<HTMLDivElement>(null);
  const dragPointerRef = useRef<number | null>(null);
  const motionRef = useRef(new MotionEngine({ x: 420, y: 0 }));
  const rendererRef = useRef(new SpriteRenderer());
  const speechTimerRef = useRef<number | null>(null);
  const agentActivityTimerRef = useRef<number | null>(null);

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
      listenDesktop<AgentActivityEvent>(DESKTOP_EVENTS.agentActivity, (event) => {
        if (agentActivityTimerRef.current) window.clearTimeout(agentActivityTimerRef.current);
        setAgentActivity(event.activity);
        setAnimation(AGENT_ACTIVITY_ANIMATION[event.activity]);
        const message = event.message ?? AGENT_ACTIVITY_SPEECH[event.activity];
        if (message) showSpeech(message);
        if (event.activity === "idle") setSpeech(null);
        if (event.activity === "success" || event.activity === "error") {
          agentActivityTimerRef.current = window.setTimeout(() => {
            setAgentActivity("idle");
            setAnimation("idle");
            agentActivityTimerRef.current = null;
          }, AGENT_REACTION_DURATION_MS);
        }
      }),
      listenDesktop<ConversationEvent>(DESKTOP_EVENTS.conversation, (event) => {
        if (!personalityPreviewBusy) return;
        if (event.type === "text" && event.text) setPersonalityPreview(event.text);
        if (event.type === "completed" || event.type === "error") {
          if (event.type === "error" && event.text) setPersonalityPreview(event.text);
          setPersonalityPreviewBusy(false);
          void resetPetConversation();
        }
      }),
    ]).then((subscriptions) => unlisteners.push(...subscriptions));
    return () => unlisteners.forEach((unlisten) => unlisten());
  }, [showSpeech, personalityPreviewBusy]);

  const previewPersonality = async (name: string, instructions: string) => {
    setPersonalityPreview("");
    setPersonalityPreviewBusy(true);
    try { await startPetConversation("今天工作有點累。", name, instructions); }
    catch (error) { setPersonalityPreview(String(error)); setPersonalityPreviewBusy(false); }
  };

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
      if (agentActivityTimerRef.current) window.clearTimeout(agentActivityTimerRef.current);
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

  const simulateAgentActivity = async (activity: AgentActivity) => {
    setAgentActivity(activity);
    setAnimation(AGENT_ACTIVITY_ANIMATION[activity]);
    const message = AGENT_ACTIVITY_SPEECH[activity];
    if (message) showSpeech(message);
    await reportAgentActivity(activity, "manual", message ?? undefined);
  };

  const resetAgentActivity = async () => {
    setAgentActivity("idle");
    setAnimation("idle");
    setSpeech(null);
    await clearAgentActivity();
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

  const emitAutonomySettings = (overrides: Partial<AutonomySettings> = {}) => {
    const settings = {
      enabled: autonomousBehavior,
      allowRoaming,
      sleepAfterMinutes,
      wakeOnWindowChange,
      ...overrides,
    };
    void emitToPet(DESKTOP_EVENTS.autonomySettings, settings);
  };

  const updateAutonomousBehavior = (enabled: boolean) => {
    setAutonomousBehavior(enabled);
    writeBooleanSetting(DESKTOP_STORAGE.autonomousBehavior, enabled);
    emitAutonomySettings({ enabled });
  };

  const updateAllowRoaming = (enabled: boolean) => {
    setAllowRoaming(enabled);
    writeBooleanSetting(DESKTOP_STORAGE.allowRoaming, enabled);
    emitAutonomySettings({ allowRoaming: enabled });
  };

  const updateSleepAfterMinutes = (minutes: SleepAfterMinutes) => {
    setSleepAfterMinutes(minutes);
    writeNumberSetting(DESKTOP_STORAGE.sleepAfterMinutes, minutes);
    emitAutonomySettings({ sleepAfterMinutes: minutes });
  };

  const updateWakeOnWindowChange = (enabled: boolean) => {
    setWakeOnWindowChange(enabled);
    writeBooleanSetting(DESKTOP_STORAGE.wakeOnWindowChange, enabled);
    emitAutonomySettings({ wakeOnWindowChange: enabled });
  };

  const updateProactiveSettings = (updates: Partial<ProactiveInteractionSettings>) => {
    const next = { ...proactiveSettings, ...updates };
    setProactiveSettings(next);
    localStorage.setItem(DESKTOP_STORAGE.proactiveSettings, JSON.stringify(next));
    void emitToPet(DESKTOP_EVENTS.proactiveSettings, next);
  };

  const handleAccessibilityAction = async () => {
    const status = await requestAccessibilityPermission();
    setPermissionStatus(status);
    if (status === "denied") await openAccessibilitySettings();
  };

  const handleImport = async () => {
    const zipPath = await choosePetZip();
    if (!zipPath) return;
    setPackageStatus({ kind: "busy", message: "正在安全檢查與安裝 ZIP…" });
    try {
      const installed = await importPetZip(zipPath);
      setPackageStatus({ kind: "success", message: `${installed.id} 安裝完成` });
      setSelectedId(installed.id);
      setWorkspaceMode("creator");
      reloadCatalog();
    } catch (error) {
      const message = String(error);
      const conflict = message.match(/PET_ID_CONFLICT:([a-z0-9-]+)/);
      if (conflict && window.confirm(`${conflict[1]} 已安裝。要明確替換現有版本嗎？`)) {
        try {
          const installed = await importPetZip(zipPath, true);
          setPackageStatus({ kind: "success", message: `${installed.id} 已替換` });
          setSelectedId(installed.id);
          setWorkspaceMode("creator");
          reloadCatalog();
          return;
        } catch (replaceError) {
          setPackageStatus({ kind: "error", message: String(replaceError) });
          return;
        }
      }
      setPackageStatus({ kind: "error", message: conflict ? "已取消替換；原有 package 未變更。" : message });
    }
  };

  const handleRemove = async (id: string) => {
    if (!window.confirm(`移除已安裝的 ${id}？`)) return;
    try {
      if (selectedId === id) {
        setSelectedId("mochi");
        localStorage.setItem(DESKTOP_STORAGE.petId, "mochi");
        await emitToPet(DESKTOP_EVENTS.selectPet, "mochi");
      }
      await removeInstalledPet(id);
      setPackageStatus({ kind: "success", message: `${id} 已移除` });
      reloadCatalog();
    } catch (error) {
      setPackageStatus({ kind: "error", message: String(error) });
    }
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
          <div className="workspace-switch" role="group" aria-label="Workspace mode">
            <button className={workspaceMode === "runtime" ? "active" : ""} onClick={() => setWorkspaceMode("runtime")}>Runtime</button>
            <button className={workspaceMode === "creator" ? "active" : ""} onClick={() => setWorkspaceMode("creator")}>Creator</button>
          </div>
          {isDesktopRuntime() && (
            <button className="show-pet-button" onClick={() => void showPetWindow()}>顯示寵物</button>
          )}
          <span className="mvp-badge">{isDesktopRuntime() ? "DESKTOP · CONNECTED" : "MVP · WEB"}</span>
        </div>
      </header>

      {workspaceMode === "creator" ? (
        <PetCreator pkg={selectedPackage} onImport={handleImport} importing={packageStatus?.kind === "busy"} />
      ) : <section className="workspace">
        <aside className="control-panel">
          <div className="panel-section">
            <p className="eyebrow">YOUR DESKLINGS</p>
            <button className="import-pet-button" disabled={!isDesktopRuntime() || packageStatus?.kind === "busy"} onClick={() => void handleImport()}>
              Import Pet ZIP
            </button>
            <details className="import-guide">
              <summary>ZIP 格式說明</summary>
              <div className="import-guide__content">
                <p><code>pet.json</code> 與 <code>spritesheet.webp</code> 必須直接位於 ZIP 最外層；<code>deskling.json</code> 是選用增強 sidecar。</p>
                <pre>{`my-pet.zip
├── pet.json
├── spritesheet.webp
├── deskling.json (選用)
└── sounds/ (選用)`}</pre>
                <p>ZIP 上限 25 MB，解壓後 100 MB／100 個項目。音效支援 WAV、MP3、OGG。</p>
                <p>相同 ID 會先詢問是否替換；內建角色不能覆寫或移除。</p>
              </div>
            </details>
            {packageStatus && <div className={`package-status package-status--${packageStatus.kind}`} role="status">{packageStatus.message}</div>}
            <div className="pet-list">
              {packages.map((pkg) => (
                <div
                  className={`pet-option ${pkg.manifest.id === manifest.id ? "pet-option--active" : ""}`}
                  key={pkg.manifest.id}
                >
                  <button className="pet-option__select" onClick={() => setSelectedId(pkg.manifest.id)}>
                    <span className="pet-option__portrait" style={{ backgroundImage: `url(${pkg.assetUrl})`, backgroundSize: `${pkg.imageWidth * (44 / pkg.manifest.renderer.frameWidth)}px auto` }} />
                    <span><strong>{pkg.manifest.name}</strong><small>{pkg.manifest.author}</small><em>{pkg.source}</em></span>
                  </button>
                  {pkg.source === "installed" && <button className="pet-option__remove" aria-label={`移除 ${pkg.manifest.name}`} onClick={() => void handleRemove(pkg.manifest.id)}>×</button>}
                </div>
              ))}
            </div>
          </div>

          <div className="panel-section">
            <PersonalitySettings manifest={manifest} preview={personalityPreview} previewBusy={personalityPreviewBusy} onPreview={previewPersonality} />
          </div>

          <div className="panel-section">
            <ConversationHistorySettings petId={manifest.id} petName={manifest.name} />
          </div>

          <div className="panel-section">
            <PetMemorySettings petId={manifest.id} petName={manifest.name} />
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

          <div className="panel-section">
            <p className="eyebrow">AGENT ACTIVITY</p>
            <p className="activity-hint">測試 Codex／Agent 語意動畫與 fallback。</p>
            <div className="behavior-grid activity-grid">
              {AGENT_ACTIVITIES.map((activity) => (
                <button
                  className={agentActivity === activity ? "active" : ""}
                  key={activity}
                  onClick={() => void simulateAgentActivity(activity)}
                >
                  <span>{activity === "thinking" ? "思考" : activity === "talking" ? "說話" : activity === "success" ? "完成" : "錯誤"}</span>
                  <small>{activity}</small>
                </button>
              ))}
              <button className={agentActivity === "idle" ? "active" : ""} onClick={() => void resetAgentActivity()}>
                <span>清除</span><small>idle</small>
              </button>
            </div>
          </div>

          <div className="panel-section panel-section--bottom">
            <div className="behavior-settings">
              <p className="eyebrow">AUTONOMY</p>
              <label className="debug-toggle">
                <span>
                  <strong>自主行為</strong>
                  <small>Autonomous behavior</small>
                </span>
                <input
                  type="checkbox"
                  checked={autonomousBehavior}
                  disabled={!isDesktopRuntime()}
                  onChange={(event) => updateAutonomousBehavior(event.target.checked)}
                />
                <i aria-hidden="true" />
              </label>
              <div className="proactive-settings">
                <p className="eyebrow">PROACTIVE CONVERSATIONS</p>
                <label className="debug-toggle"><span><strong>主動打招呼</strong><small>明確選擇加入，無額外 context</small></span><input type="checkbox" checked={proactiveSettings.enabled} disabled={!isDesktopRuntime()} onChange={(e) => updateProactiveSettings({ enabled: e.target.checked })} /><i aria-hidden="true" /></label>
                <label className="debug-toggle"><span><strong>使用 AI 產生短句</strong><small>不會主動執行工具</small></span><input type="checkbox" checked={proactiveSettings.useAi} disabled={!proactiveSettings.enabled} onChange={(e) => updateProactiveSettings({ useAi: e.target.checked })} /><i aria-hidden="true" /></label>
                <label className="select-setting"><span><strong>頻率</strong><small>至少間隔 30 分鐘</small></span><select value={proactiveSettings.frequency} disabled={!proactiveSettings.enabled} onChange={(e) => updateProactiveSettings({ frequency: e.target.value as ProactiveInteractionSettings["frequency"] })}><option value="rare">少</option><option value="sometimes">有時</option><option value="often">常</option></select></label>
                <div className="quiet-hours"><label>勿擾開始<input type="time" value={proactiveSettings.quietHoursStart} disabled={!proactiveSettings.enabled} onChange={(e) => updateProactiveSettings({ quietHoursStart: e.target.value })} /></label><label>勿擾結束<input type="time" value={proactiveSettings.quietHoursEnd} disabled={!proactiveSettings.enabled} onChange={(e) => updateProactiveSettings({ quietHoursEnd: e.target.value })} /></label></div>
                <label className="personality-field"><span>每日上限</span><input type="number" min="1" max="10" value={proactiveSettings.dailyLimit} disabled={!proactiveSettings.enabled} onChange={(e) => updateProactiveSettings({ dailyLimit: Math.max(1, Math.min(10, Number(e.target.value))) })} /></label>
                <small className="privacy-note">AI context：Pet 名稱、人格、約略時段、閒置時間、目前 behavior，以及最近 Pet 對話是否完成。永不讀取視窗標題、剪貼簿、文件或 workspace。</small>
                <button className="proactive-test-button" type="button" disabled={!isDesktopRuntime() || !proactiveSettings.enabled || !proactiveSettings.useAi} onClick={() => void emitToPet(DESKTOP_EVENTS.testProactive, null)}>Test now</button>
              </div>
              <label className="debug-toggle">
                <span>
                  <strong>允許散步</strong>
                  <small>Allow roaming</small>
                </span>
                <input
                  type="checkbox"
                  checked={allowRoaming}
                  disabled={!isDesktopRuntime() || !autonomousBehavior}
                  onChange={(event) => updateAllowRoaming(event.target.checked)}
                />
                <i aria-hidden="true" />
              </label>
              <label className="select-setting">
                <span>
                  <strong>自動睡眠</strong>
                  <small>Sleep after</small>
                </span>
                <select
                  value={sleepAfterMinutes}
                  disabled={!isDesktopRuntime() || !autonomousBehavior}
                  onChange={(event) =>
                    updateSleepAfterMinutes(Number(event.target.value) as SleepAfterMinutes)}
                >
                  <option value={0}>永不</option>
                  <option value={15}>15 分鐘</option>
                  <option value={30}>30 分鐘</option>
                  <option value={60}>60 分鐘</option>
                </select>
              </label>
              <label className="debug-toggle">
                <span>
                  <strong>切換視窗時喚醒</strong>
                  <small>Wake on window change</small>
                </span>
                <input
                  type="checkbox"
                  checked={wakeOnWindowChange}
                  disabled={!isDesktopRuntime() || !autonomousBehavior}
                  onChange={(event) => updateWakeOnWindowChange(event.target.checked)}
                />
                <i aria-hidden="true" />
              </label>
            </div>
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
      </section>}
    </main>
  );
}
