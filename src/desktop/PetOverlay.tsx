import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { PhysicalPosition } from "@tauri-apps/api/dpi";
import { cursorPosition, currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
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
import {
  cursorNearHead,
  facingForCursor,
  PettingGestureTracker,
  reactionForInteraction,
} from "../behavior/RichInteraction";
import {
  AGENT_ACTIVITY_ANIMATION,
  AGENT_ACTIVITY_SPEECH,
  AGENT_ACTIVITY_TIMEOUT_MS,
  AGENT_REACTION_DURATION_MS,
  AgentActivityEngine,
  type AgentActivityEvent,
} from "../behavior/AgentActivity";
import { SpriteAvatar } from "../components/SpriteAvatar";
import { AGENT_PROVIDER_LABELS, DEFAULT_HISTORY_SETTINGS, statusFromEvent, type AgentProvider, type ConversationEvent, type ConversationHistoryEntry, type ConversationHistorySettings, type ConversationStatus } from "../agent/conversation";
import type { Facing, HitRegion, PetPersonalityOverride, Point } from "../domain/avatar";
import { composePetInstructions, effectivePersonality } from "../domain/personality";
import { DEFAULT_MEMORY_SETTINGS, selectRelevantMemories, sensitiveMemoryReason, type PetMemory, type PetMemorySettings } from "../domain/petMemory";
import type { ConversationUiAction, ConversationUiState } from "./ConversationWindow";
import {
  DEFAULT_PROACTIVE_SETTINGS,
  canStartProactiveInteraction,
  emptyProactiveHistory,
  formatProactiveUtterance,
  localProactiveUtterance,
  proactiveOperationalBlockReason,
  recordPresenceBeat,
  recordProactiveAttempt,
  recordProactiveIgnored,
  recordProactiveOpened,
  type ProactiveHistory,
  type ProactiveInteractionSettings,
  type ProactiveTestStatus,
} from "../behavior/ProactiveInteractionScheduler";
import {
  composeNonsensePresencePrompt,
  selectNonsensePresenceBeat,
  type NonsensePresenceContext,
  type PresenceBeatAnimation,
} from "../behavior/NonsensePresenceBeats";
import { usePetCatalog } from "../hooks/usePetCatalog";
import { SpriteRenderer } from "../renderers/SpriteRenderer";
import {
  DESKTOP_EVENTS,
  DESKTOP_STORAGE,
  agentRuntimeAvailable,
  appendConversationHistory,
  emitToConversation,
  emitToControl,
  isDesktopRuntime,
  listenDesktop,
  loadPetPersonality,
  loadConversationHistory,
  loadPetMemory,
  savePetMemory,
  readBooleanSetting,
  readAgentProvider,
  readNumberSetting,
  resetPetConversation,
  startPetConversation,
  stopPetConversation,
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
  conversationWindowPosition,
  constrainPetWindow,
  horizontalWalkTarget,
  persistPetWindowPosition,
  relativeWindowOffset,
  restorePetWindowPosition,
  type SavedPosition,
} from "./windowPosition";
import {
  clientPointFromPhysicalCursor,
  framePointFromClient,
  pointInsideBounds,
} from "./regionalClickThrough";

const SPEECH: Record<string, string> = {
  idle: "我在這裡。",
  sleep: "Zzz…",
  thinking: "讓我想想…",
  talking: "今天也一起工作吧！",
  happy: "太好啦！",
};

function readConversationOffset(): SavedPosition | null {
  try {
    const value = JSON.parse(localStorage.getItem(DESKTOP_STORAGE.conversationPositionOffset) ?? "null") as unknown;
    if (value && typeof value === "object" && "x" in value && "y" in value &&
      typeof value.x === "number" && Number.isFinite(value.x) &&
      typeof value.y === "number" && Number.isFinite(value.y)) {
      return { x: value.x, y: value.y };
    }
  } catch {
    // Invalid layout state falls back to the selected left/right dock.
  }
  return null;
}

interface ActivePetGesture {
  region: HitRegion;
  moved: boolean;
}

const SLEEP_AFTER_OPTIONS: readonly SleepAfterMinutes[] = [0, 15, 30, 60];
const PET_DOUBLE_CLICK_MS = 400;
const CURSOR_ATTENTION_TIMEOUT_MS = 900;
const REGIONAL_CLICK_THROUGH_INTERVAL_MS = 50;

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
  const [agentEvent, setAgentEvent] = useState<AgentActivityEvent | null>(null);
  const [conversationOpen, setConversationOpen] = useState(false);
  const [conversationSide, setConversationSide] = useState<"left" | "right">(() => localStorage.getItem("deskling.conversationSide") === "right" ? "right" : "left");
  const [conversationOffset, setConversationOffset] = useState<SavedPosition | null>(readConversationOffset);
  const [conversationResponse, setConversationResponse] = useState("");
  const [lastDirectMessage, setLastDirectMessage] = useState("");
  const [conversationStatus, setConversationStatus] = useState<ConversationStatus>("idle");
  const [memorySaveStatus, setMemorySaveStatus] = useState("");
  const [runtimeAvailable, setRuntimeAvailable] = useState(false);
  const [cursorAware, setCursorAware] = useState(false);
  const [agentProvider, setAgentProvider] = useState<AgentProvider>(() => readAgentProvider());
  const [personalityOverrides, setPersonalityOverrides] = useState<PetPersonalityOverride>({});
  const [proactiveSettings, setProactiveSettings] = useState<ProactiveInteractionSettings>(() => {
    try { return { ...DEFAULT_PROACTIVE_SETTINGS, ...JSON.parse(localStorage.getItem(DESKTOP_STORAGE.proactiveSettings) ?? "{}") }; }
    catch { return DEFAULT_PROACTIVE_SETTINGS; }
  });
  const [userTyping, setUserTyping] = useState(false);
  const [proactiveMessage, setProactiveMessage] = useState<string | null>(null);
  const [historySettings, setHistorySettings] = useState<ConversationHistorySettings>(() => {
    const petId = localStorage.getItem(DESKTOP_STORAGE.petId) ?? "mochi";
    try { return { ...DEFAULT_HISTORY_SETTINGS, ...JSON.parse(localStorage.getItem(`${DESKTOP_STORAGE.conversationHistorySettings}.${petId}`) ?? "{}") }; }
    catch { return DEFAULT_HISTORY_SETTINGS; }
  });
  const [memorySettings, setMemorySettings] = useState<PetMemorySettings>(() => {
    const petId = localStorage.getItem(DESKTOP_STORAGE.petId) ?? "mochi";
    try { return { ...DEFAULT_MEMORY_SETTINGS, ...JSON.parse(localStorage.getItem(`${DESKTOP_STORAGE.petMemorySettings}.${petId}`) ?? "{}") }; }
    catch { return DEFAULT_MEMORY_SETTINGS; }
  });
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
  const overlayRef = useRef<HTMLElement | null>(null);
  const cursorEventsIgnoredRef = useRef<boolean | null>(null);
  const cursorEventsUpdateRef = useRef<Promise<void>>(Promise.resolve());
  const speechTimerRef = useRef<number | null>(null);
  const idleVariationTimerRef = useRef<number | null>(null);
  const reactionTimerRef = useRef<number | null>(null);
  const agentActivityTimerRef = useRef<number | null>(null);
  const activeGestureRef = useRef<ActivePetGesture | null>(null);
  const pettingGestureRef = useRef(new PettingGestureTracker());
  const cursorAttentionTimerRef = useRef<number | null>(null);
  const desktopMotionTokenRef = useRef(0);
  const behaviorEngineRef = useRef(new BehaviorEngine());
  const agentActivityEngineRef = useRef(new AgentActivityEngine());
  const schedulerRef = useRef<AutonomousBehaviorScheduler | null>(null);
  const surfaceModeRef = useRef<SurfaceState>("manual");
  const lastWindowSnapshotRef = useRef<DesktopWindowSnapshot | null>(null);
  const lastWindowFeetXRef = useRef<number | null>(null);
  const startDesktopWalkRef = useRef<() => Promise<void>>(async () => undefined);
  const lastInteractionAtRef = useRef(Date.now());
  const lastConversationResultRef = useRef<"completed" | "none">("none");
  const proactiveHistoryRef = useRef<ProactiveHistory>(emptyProactiveHistory());
  const proactiveIgnoreTimerRef = useRef<number | null>(null);
  const proactiveActiveRef = useRef(false);
  const proactivePresentationRef = useRef<"ambient" | "invitation">("invitation");
  const proactiveAmbientAnimationRef = useRef<PresenceBeatAnimation>("talking");
  const testProactiveRef = useRef<() => void>(() => undefined);
  const proactiveTestRequestRef = useRef<string | null>(null);
  const lastPetTapAtRef = useRef(0);
  const conversationResponseRef = useRef("");
  const historySettingsRef = useRef(historySettings);
  const memorySettingsRef = useRef(memorySettings);
  const conversationRequestIdRef = useRef<string | null>(null);
  const conversationSendPendingRef = useRef(false);
  const positionConversationRef = useRef<() => Promise<void>>(async () => undefined);
  const conversationDraggingRef = useRef(false);
  const conversationOpenRef = useRef(conversationOpen);
  const conversationFocusGraceUntilRef = useRef(0);
  useEffect(() => { conversationOpenRef.current = conversationOpen; }, [conversationOpen]);

  const selectedPackage = useMemo(
    () => packages.find((pkg) => pkg.manifest.id === selectedId) ?? packages[0],
    [packages, selectedId],
  );

  const addHistoryEntry = useCallback(async (entry: ConversationHistoryEntry) => {
    if (!selectedPackage) return;
    if (historySettingsRef.current.saveHistory) {
      await appendConversationHistory(selectedPackage.manifest.id, entry, historySettingsRef.current);
    }
  }, [selectedPackage]);

  const notifyUserActivity = useCallback(() => {
    lastInteractionAtRef.current = Date.now();
    schedulerRef.current?.notifyActivity();
  }, []);

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

  const presentProactiveUtterance = useCallback((value: string, trackIgnored = true) => {
    if (!selectedPackage) return;
    const sentence = formatProactiveUtterance(value);
    setProactiveMessage(sentence);
    showSpeech(sentence, 15_000);
    setAnimation("talking");
    if (proactiveIgnoreTimerRef.current) window.clearTimeout(proactiveIgnoreTimerRef.current);
    proactiveIgnoreTimerRef.current = window.setTimeout(() => {
      if (trackIgnored) {
        proactiveHistoryRef.current = recordProactiveIgnored(proactiveHistoryRef.current);
        localStorage.setItem(`deskling.proactiveHistory.${selectedPackage.manifest.id}`, JSON.stringify(proactiveHistoryRef.current));
      }
      setProactiveMessage(null);
      proactiveActiveRef.current = false;
      setAnimation("idle");
    }, 15_000);
  }, [selectedPackage, showSpeech]);

  const presentAmbientUtterance = useCallback((value: string) => {
    const utterance = formatProactiveUtterance(value, 40);
    if (!utterance) return;
    setProactiveMessage(null);
    showSpeech(utterance, 4_500);
    setAnimation(proactiveAmbientAnimationRef.current);
    if (proactiveIgnoreTimerRef.current) window.clearTimeout(proactiveIgnoreTimerRef.current);
    proactiveIgnoreTimerRef.current = window.setTimeout(() => {
      proactiveActiveRef.current = false;
      proactivePresentationRef.current = "invitation";
      setAnimation("idle");
    }, 4_500);
  }, [showSpeech]);

  const reportProactiveTestStatus = useCallback((status: ProactiveTestStatus) => {
    void emitToControl(DESKTOP_EVENTS.proactiveTestStatus, status);
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

  const clearCursorAttention = useCallback(() => {
    if (cursorAttentionTimerRef.current) window.clearTimeout(cursorAttentionTimerRef.current);
    cursorAttentionTimerRef.current = null;
    pettingGestureRef.current.resetSequence();
    setCursorAware(false);
    if (
      behaviorEngineRef.current.state === "idle"
      && !agentActivityEngineRef.current.event
      && !proactiveActiveRef.current
    ) {
      setAnimation((current) => current === "look" ? "idle" : current);
    }
  }, []);

  const stopDesktopMotion = useCallback(() => {
    desktopMotionTokenRef.current += 1;
    dispatchBehavior("roamCompleted");
  }, [dispatchBehavior]);

  const startDesktopWalk = useCallback(async () => {
    if (!isDesktopRuntime() || !selectedPackage || conversationOpen) return;

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
  }, [conversationOpen, dispatchBehavior, facing, scale, selectedPackage]);

  startDesktopWalkRef.current = startDesktopWalk;

  useEffect(() => {
    const scheduler = new AutonomousBehaviorScheduler(autonomySettings, {
      onIdleVariation: () => {
        if (behaviorEngineRef.current.state !== "idle" || agentActivityEngineRef.current.event || proactiveActiveRef.current) return;
        setAnimation("thinking");
        if (idleVariationTimerRef.current) window.clearTimeout(idleVariationTimerRef.current);
        idleVariationTimerRef.current = window.setTimeout(() => {
          idleVariationTimerRef.current = null;
          if (behaviorEngineRef.current.state === "idle") setAnimation("idle");
        }, 4_000);
      },
      onRoamRequested: () => {
        if (!agentActivityEngineRef.current.event && !proactiveActiveRef.current) void startDesktopWalkRef.current();
      },
      onSleepRequested: () => {
        if (agentActivityEngineRef.current.event || proactiveActiveRef.current) return;
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
    if (!conversationOpen) return;
    void agentRuntimeAvailable(agentProvider).then(setRuntimeAvailable);
  }, [agentProvider, conversationOpen]);

  useEffect(() => {
    const unlisteners: (() => void)[] = [];
    void Promise.all([
      listenDesktop<string>(DESKTOP_EVENTS.selectPet, (petId) => setSelectedId(petId)),
      listenDesktop<AgentProvider>(DESKTOP_EVENTS.agentProviderChanged, (provider) => {
        notifyUserActivity();
        localStorage.setItem(DESKTOP_STORAGE.agentProvider, provider);
        void stopPetConversation();
        setAgentProvider(provider);
        setConversationOpen(false);
        setConversationResponse("");
        conversationResponseRef.current = "";
        setConversationStatus("idle");
        setMemorySaveStatus("");
        void agentRuntimeAvailable(provider).then(setRuntimeAvailable);
      }),
      listenDesktop<string>(DESKTOP_EVENTS.playBehavior, (behavior) => {
        notifyUserActivity();
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
      listenDesktop<ProactiveInteractionSettings>(DESKTOP_EVENTS.proactiveSettings, (settings) => {
        notifyUserActivity();
        localStorage.setItem(DESKTOP_STORAGE.proactiveSettings, JSON.stringify(settings));
        setProactiveSettings(settings);
      }),
      listenDesktop<null>(DESKTOP_EVENTS.testProactive, () => testProactiveRef.current()),
      listenDesktop<string>(DESKTOP_EVENTS.newConversation, (petId) => {
        if (petId !== selectedPackage?.manifest.id) return;
        notifyUserActivity();
        conversationResponseRef.current = "";
        setConversationResponse("");
        setLastDirectMessage("");
        setConversationStatus("idle");
        setMemorySaveStatus("");
        setConversationOpen(false);
      }),
      listenDesktop<{ petId: string; settings: ConversationHistorySettings }>(DESKTOP_EVENTS.historySettingsChanged, (event) => {
        if (event.petId !== selectedPackage?.manifest.id) return;
        historySettingsRef.current = event.settings;
        setHistorySettings(event.settings);
      }),
      listenDesktop<string>(DESKTOP_EVENTS.memoryChanged, (petId) => {
        if (petId === selectedPackage?.manifest.id) {
          try {
            const next = { ...DEFAULT_MEMORY_SETTINGS, ...JSON.parse(localStorage.getItem(`${DESKTOP_STORAGE.petMemorySettings}.${petId}`) ?? "{}") };
            memorySettingsRef.current = next; setMemorySettings(next);
          } catch { /* keep current settings */ }
        }
      }),
      listenDesktop<{ petId: string; settings: PetMemorySettings }>(DESKTOP_EVENTS.memorySettingsChanged, (event) => {
        if (event.petId !== selectedPackage?.manifest.id) return;
        memorySettingsRef.current = event.settings;
        setMemorySettings(event.settings);
      }),
      listenDesktop<AgentActivityEvent>(DESKTOP_EVENTS.agentActivity, (event) => {
        if (!agentActivityEngineRef.current.accept(event)) return;
        if (agentActivityTimerRef.current) window.clearTimeout(agentActivityTimerRef.current);
        agentActivityTimerRef.current = null;
        stopDesktopMotion();
        dispatchBehavior("wakeRequested");
        schedulerRef.current?.notifyActivity();
        setAgentEvent(agentActivityEngineRef.current.event);
        const duration = event.activity === "success" || event.activity === "error"
          ? AGENT_REACTION_DURATION_MS
          : event.activity === "idle" ? 0 : AGENT_ACTIVITY_TIMEOUT_MS;
        if (duration > 0) {
          agentActivityTimerRef.current = window.setTimeout(() => {
            if (agentActivityEngineRef.current.event?.timestamp !== event.timestamp) return;
            agentActivityEngineRef.current.clear();
            setAgentEvent(null);
            schedulerRef.current?.notifyActivity();
            agentActivityTimerRef.current = null;
          }, duration);
        }
      }),
      listenDesktop<ConversationEvent>(DESKTOP_EVENTS.conversation, (event) => {
        if (event.provider && event.provider !== agentProvider) return;
        if (event.purpose === "proactive") {
          if (event.type === "started") { proactiveActiveRef.current = true; setAnimation("thinking"); }
          if (event.type === "text" && event.text) {
            if (proactivePresentationRef.current === "ambient") {
              presentAmbientUtterance(event.text);
            } else {
              presentProactiveUtterance(event.text, event.requestId !== proactiveTestRequestRef.current);
            }
          }
          if (event.type === "error") {
            proactiveActiveRef.current = false;
            proactivePresentationRef.current = "invitation";
            setAnimation("idle");
            if (event.requestId === proactiveTestRequestRef.current) {
              proactiveTestRequestRef.current = null;
              reportProactiveTestStatus({ kind: "error", message: event.text ?? "AI provider 無法產生陪伴碎念。" });
            }
          }
          if (event.type === "completed" && event.requestId === proactiveTestRequestRef.current) {
            proactiveTestRequestRef.current = null;
          }
          return;
        }
        const status = statusFromEvent(event);
        if (event.type === "completed" || event.type === "error") conversationSendPendingRef.current = false;
        setConversationStatus(status);
        if (event.type === "started") {
          conversationRequestIdRef.current = event.requestId;
          setConversationResponse("");
          stopDesktopMotion();
          dispatchBehavior("wakeRequested");
          schedulerRef.current?.notifyActivity();
          const activity: AgentActivityEvent = { source: event.provider ?? agentProvider, activity: "thinking", timestamp: Date.now() };
          agentActivityEngineRef.current.accept(activity);
          setAgentEvent(activity);
        } else if (event.type === "text") {
          conversationResponseRef.current = event.text ?? "";
          setConversationResponse(conversationResponseRef.current);
          const activity: AgentActivityEvent = { source: event.provider ?? agentProvider, activity: "talking", timestamp: Date.now() };
          agentActivityEngineRef.current.accept(activity);
          setAgentEvent(activity);
        } else {
          if (event.type === "completed") lastConversationResultRef.current = "completed";
          if (event.type === "completed" && conversationResponseRef.current) {
            void addHistoryEntry({ id: crypto.randomUUID(), role: "pet", content: conversationResponseRef.current, source: "direct", createdAt: Date.now() });
            conversationResponseRef.current = "";
          }
          if (event.type === "error") setConversationResponse(event.text ?? "Pet 暫時無法回答。");
          const activity: AgentActivityEvent = { source: event.provider ?? agentProvider, activity: event.type === "error" ? "error" : "success", timestamp: Date.now() };
          agentActivityEngineRef.current.accept(activity);
          setAgentEvent(activity);
          if (agentActivityTimerRef.current) window.clearTimeout(agentActivityTimerRef.current);
          agentActivityTimerRef.current = window.setTimeout(() => {
            agentActivityEngineRef.current.clear();
            setAgentEvent(null);
            setConversationStatus("idle");
            schedulerRef.current?.notifyActivity();
          }, AGENT_REACTION_DURATION_MS);
        }
      }),
      listenDesktop<{ petId: string; settings: PetPersonalityOverride }>(DESKTOP_EVENTS.personalityChanged, (event) => {
        if (event.petId === selectedPackage?.manifest.id) setPersonalityOverrides(event.settings);
      }),
    ]).then((subscriptions) => unlisteners.push(...subscriptions));
    return () => unlisteners.forEach((unlisten) => unlisten());
  }, [addHistoryEntry, agentProvider, dispatchBehavior, notifyUserActivity, presentAmbientUtterance, presentProactiveUtterance, reportProactiveTestStatus, selectedPackage?.manifest.id, showSpeech, startReaction, stopDesktopMotion]);

  useEffect(() => {
    if (!selectedPackage) return;
    const key = `deskling.proactiveHistory.${selectedPackage.manifest.id}`;
    try { proactiveHistoryRef.current = { ...emptyProactiveHistory(), ...JSON.parse(localStorage.getItem(key) ?? "{}") }; }
    catch { proactiveHistoryRef.current = emptyProactiveHistory(); }
    const check = (force = false) => {
      const snapshot = behaviorEngineRef.current.snapshot;
      const now = new Date();
      const runtimeContext = {
        conversationOpen,
        activeRequest: proactiveActiveRef.current || Boolean(agentActivityEngineRef.current.event) || conversationStatus === "thinking" || conversationStatus === "talking",
        dragging: snapshot.dragging,
        sleeping: snapshot.sleeping,
        userTyping,
        petVisible: document.visibilityState === "visible",
        idleMinutes: (now.getTime() - lastInteractionAtRef.current) / 60_000,
      };
      const blockReason = proactiveOperationalBlockReason(runtimeContext);
      if (force && !proactiveSettings.enabled) {
        reportProactiveTestStatus({ kind: "blocked", message: "請先開啟「主動陪伴」。" });
        return;
      }
      if (force && blockReason) {
        reportProactiveTestStatus({ kind: "blocked", message: blockReason });
        return;
      }
      if (!force && !canStartProactiveInteraction(proactiveSettings, runtimeContext, proactiveHistoryRef.current, now)) return;
      if (!force) proactiveHistoryRef.current = recordProactiveAttempt(proactiveHistoryRef.current, now);
      if (snapshot.sleeping) schedulerRef.current?.notifyActivity();
      const personality = effectivePersonality(selectedPackage.manifest, personalityOverrides);
      const hour = now.getHours();
      const timeOfDay: NonsensePresenceContext["timeOfDay"] = hour < 12
        ? "morning"
        : hour < 18 ? "afternoon" : "evening";
      const generationContext = {
        timeOfDay,
        idleMinutes: Math.floor((now.getTime() - lastInteractionAtRef.current) / 60_000),
        lastInteractionResult: lastConversationResultRef.current,
        behavior: behaviorEngineRef.current.state,
        personality: personality.traits,
      };
      proactiveActiveRef.current = true;
      if (!proactiveSettings.useAi) {
        proactivePresentationRef.current = "invitation";
        if (!force) localStorage.setItem(key, JSON.stringify(proactiveHistoryRef.current));
        presentProactiveUtterance(localProactiveUtterance(personality, timeOfDay), !force);
        if (force) reportProactiveTestStatus({ kind: "success", message: "已使用本機 personality 短句觸發。" });
        return;
      }
      const beat = selectNonsensePresenceBeat(
        now,
        selectedPackage.manifest.id,
        proactiveHistoryRef.current.presenceSequence,
        proactiveHistoryRef.current.recentBeatIds,
      );
      proactiveHistoryRef.current = recordPresenceBeat(proactiveHistoryRef.current, beat.id);
      localStorage.setItem(key, JSON.stringify(proactiveHistoryRef.current));
      proactivePresentationRef.current = "ambient";
      proactiveAmbientAnimationRef.current = beat.animation;
      const prompt = composeNonsensePresencePrompt(
        beat,
        generationContext,
        personality.preferredLanguage,
      );
      void startPetConversation(prompt, personality.nickname ?? selectedPackage.manifest.name, composePetInstructions(selectedPackage.manifest, personalityOverrides), "proactive", [], agentProvider, "ambient-nonsense")
        .then((requestId) => {
          if (force) {
            proactiveTestRequestRef.current = requestId;
            reportProactiveTestStatus({ kind: "success", message: `已交給 ${AGENT_PROVIDER_LABELS[agentProvider]} 產生陪伴碎念。` });
          }
        })
        .catch((error) => {
          proactiveActiveRef.current = false;
          proactivePresentationRef.current = "invitation";
          setAnimation("idle");
          if (force) reportProactiveTestStatus({ kind: "error", message: String(error) });
        });
    };
    testProactiveRef.current = () => check(true);
    const timer = window.setInterval(() => check(false), 60_000);
    check(false);
    return () => { window.clearInterval(timer); testProactiveRef.current = () => undefined; };
  }, [agentProvider, conversationOpen, conversationStatus, personalityOverrides, presentProactiveUtterance, proactiveSettings, reportProactiveTestStatus, selectedPackage, userTyping]);

  useEffect(() => {
    if (behaviorState !== "idle") return;
    if (proactiveActiveRef.current) return;
    if (!agentEvent) {
      setAnimation("idle");
      return;
    }
    setAnimation(AGENT_ACTIVITY_ANIMATION[agentEvent.activity]);
    const message = agentEvent.message ?? AGENT_ACTIVITY_SPEECH[agentEvent.activity];
    if (message) showSpeech(message, agentEvent.activity === "thinking" || agentEvent.activity === "talking" ? 4_000 : AGENT_REACTION_DURATION_MS);
  }, [agentEvent, behaviorState, showSpeech]);

  useEffect(() => {
    if (!selectedPackage) return;
    void resetPetConversation(readAgentProvider());
    stopDesktopMotion();
    localStorage.setItem(DESKTOP_STORAGE.petId, selectedPackage.manifest.id);
    const renderer = new SpriteRenderer();
    rendererRef.current = renderer;
    void renderer.load(selectedPackage).then(() => renderer.play("idle"));
    behaviorEngineRef.current.clear();
    agentActivityEngineRef.current.clear();
    if (agentActivityTimerRef.current) window.clearTimeout(agentActivityTimerRef.current);
    agentActivityTimerRef.current = null;
    setAgentEvent(null);
    setConversationOpen(false);
    setConversationResponse("");
    setLastDirectMessage("");
    conversationResponseRef.current = "";
    setConversationStatus("idle");
    setMemorySaveStatus("");
    lastConversationResultRef.current = "none";
    setBehaviorState("idle");
    schedulerRef.current?.notifyActivity();
    lastInteractionAtRef.current = Date.now();
    lastWindowSnapshotRef.current = null;
    lastWindowFeetXRef.current = null;
    setAnimation("idle");
    try {
      const saved = JSON.parse(localStorage.getItem(`${DESKTOP_STORAGE.conversationHistorySettings}.${selectedPackage.manifest.id}`) ?? "{}");
      const settings = { ...DEFAULT_HISTORY_SETTINGS, ...saved };
      historySettingsRef.current = settings;
      setHistorySettings(settings);
    } catch { historySettingsRef.current = DEFAULT_HISTORY_SETTINGS; setHistorySettings(DEFAULT_HISTORY_SETTINGS); }
    void loadConversationHistory(selectedPackage.manifest.id, historySettingsRef.current).catch(() => undefined);
    try {
      const next = { ...DEFAULT_MEMORY_SETTINGS, ...JSON.parse(localStorage.getItem(`${DESKTOP_STORAGE.petMemorySettings}.${selectedPackage.manifest.id}`) ?? "{}") };
      memorySettingsRef.current = next; setMemorySettings(next);
    } catch { memorySettingsRef.current = DEFAULT_MEMORY_SETTINGS; setMemorySettings(DEFAULT_MEMORY_SETTINGS); }
    void loadPetPersonality(selectedPackage.manifest.id).then((settings) => {
      setPersonalityOverrides(settings);
      showSpeech(`嗨，我是 ${effectivePersonality(selectedPackage.manifest, settings).nickname ?? selectedPackage.manifest.name}。`);
    });
  }, [selectedPackage, showSpeech, stopDesktopMotion]);

  useEffect(() => { historySettingsRef.current = historySettings; }, [historySettings]);

  useEffect(() => {
    rendererRef.current.play(animation);
  }, [animation]);

  useEffect(() => {
    rendererRef.current.setFacing(facing);
  }, [facing]);

  const setCursorEventsIgnored = useCallback((ignored: boolean) => {
    if (!isDesktopRuntime() || cursorEventsIgnoredRef.current === ignored) return;
    cursorEventsIgnoredRef.current = ignored;
    const appWindow = getCurrentWindow();
    cursorEventsUpdateRef.current = cursorEventsUpdateRef.current
      .catch(() => undefined)
      .then(() => appWindow.setIgnoreCursorEvents(ignored))
      .catch(() => {
        if (cursorEventsIgnoredRef.current === ignored) cursorEventsIgnoredRef.current = null;
      });
  }, []);

  useEffect(() => {
    if (!isDesktopRuntime() || !selectedPackage) return;
    writeBooleanSetting(DESKTOP_STORAGE.clickThrough, clickThrough);

    if (clickThrough) {
      setCursorEventsIgnored(true);
      return;
    }

    const appWindow = getCurrentWindow();
    let active = true;
    let polling = false;

    const poll = async () => {
      if (!active || polling) return;
      polling = true;
      try {
        if (activeGestureRef.current) {
          setCursorEventsIgnored(false);
          return;
        }

        const overlay = overlayRef.current;
        const sprite = overlay?.querySelector<HTMLElement>(".sprite-avatar");
        if (!overlay || !sprite) {
          setCursorEventsIgnored(true);
          return;
        }

        const [cursor, contentOrigin, scaleFactor] = await Promise.all([
          cursorPosition(),
          appWindow.innerPosition(),
          appWindow.scaleFactor(),
        ]);
        if (!active) return;

        const clientPoint = clientPointFromPhysicalCursor(cursor, contentOrigin, scaleFactor);
        const insideOverlay = pointInsideBounds(clientPoint, overlay.getBoundingClientRect());
        const spriteRect = sprite.getBoundingClientRect();
        const framePoint = framePointFromClient(
          clientPoint,
          spriteRect,
          selectedPackage.manifest.renderer.frameWidth,
          selectedPackage.manifest.renderer.frameHeight,
        );
        const overPet = framePoint !== null && rendererRef.current.hitTest(framePoint) !== null;
        const clickableBubble = overlay.querySelector<HTMLElement>('.speech-bubble[data-clickable="true"]');
        const overClickableBubble = insideOverlay && clickableBubble !== null
          && pointInsideBounds(clientPoint, clickableBubble.getBoundingClientRect());
        const explicitInteractive = overlay.querySelector<HTMLElement>("[data-click-through-interactive]");
        const overExplicitInteractive = insideOverlay && explicitInteractive !== null
          && pointInsideBounds(clientPoint, explicitInteractive.getBoundingClientRect());

        setCursorEventsIgnored(!(overPet || overClickableBubble || overExplicitInteractive));
      } catch {
        // Keep the previous mode if native cursor/window geometry is temporarily unavailable.
      } finally {
        polling = false;
      }
    };

    void poll();
    const timer = window.setInterval(() => void poll(), REGIONAL_CLICK_THROUGH_INTERVAL_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [clickThrough, selectedPackage, setCursorEventsIgnored]);

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
          if (Date.now() < conversationFocusGraceUntilRef.current) return;
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
        await appWindow.onMoved(async ({ payload }) => {
          if (activeGestureRef.current) activeGestureRef.current.moved = true;
          if (surfaceModeRef.current !== "manual") return;
          persistPetWindowPosition(payload);
          if (conversationOpenRef.current) void positionConversationRef.current();
          if (constrainTimer) globalThis.clearTimeout(constrainTimer);
          if (!conversationOpenRef.current) constrainTimer = globalThis.setTimeout(() => void constrainPetWindow(appWindow), 350);
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
      if (cursorAttentionTimerRef.current) window.clearTimeout(cursorAttentionTimerRef.current);
      if (agentActivityTimerRef.current) window.clearTimeout(agentActivityTimerRef.current);
      if (proactiveIgnoreTimerRef.current) window.clearTimeout(proactiveIgnoreTimerRef.current);
    },
    [],
  );

  const handlePointerDown = async (
    event: ReactPointerEvent<HTMLDivElement>,
    _point: Point,
    region: HitRegion | null,
  ) => {
    if (!region) return;

    clearCursorAttention();
    stopDesktopMotion();
    notifyUserActivity();
    dispatchBehavior("dragStarted");
    dispatchSurface("manualPositioned");
    lastWindowSnapshotRef.current = null;
    lastWindowFeetXRef.current = null;

    const openConversationOnDoubleClick = () => {
      const now = Date.now();
      const doubleClick = now - lastPetTapAtRef.current <= PET_DOUBLE_CLICK_MS;
      lastPetTapAtRef.current = doubleClick ? 0 : now;
      if (!doubleClick) return false;
      if (reactionTimerRef.current) window.clearTimeout(reactionTimerRef.current);
      reactionTimerRef.current = null;
      dispatchBehavior("reactionCompleted");
      setConversationOpen(true);
      setSpeech(null);
      return true;
    };
    const reactToSingleClick = () => {
      if (proactiveActiveRef.current || agentActivityEngineRef.current.event || conversationSendPendingRef.current || !selectedPackage) return;
      const personality = effectivePersonality(selectedPackage.manifest, personalityOverrides);
      const reaction = reactionForInteraction(region === "head" ? "head-tap" : "body-tap", personality);
      startReaction(reaction.animation, reaction.durationMs);
      showSpeech(reaction.speech, Math.min(reaction.durationMs, 2_200));
    };

    if (!isDesktopRuntime()) {
      const opened = openConversationOnDoubleClick();
      dispatchBehavior("dragEnded");
      if (!opened) reactToSingleClick();
      return;
    }

    // Every visible hit region can move the native window. The operating system
    // applies its own movement threshold, so a stationary head click remains a tap.
    const gesture: ActivePetGesture = { region, moved: false };
    activeGestureRef.current = gesture;
    setCursorEventsIgnored(false);
    setSpeech(null);

    try {
      event.currentTarget.setPointerCapture(event.pointerId);
      await getCurrentWindow().startDragging();
    } finally {
      if (activeGestureRef.current === gesture) {
        let opened = false;
        if (!gesture.moved) {
          opened = openConversationOnDoubleClick();
          if (opened && proactiveMessage) {
            proactiveHistoryRef.current = recordProactiveOpened(proactiveHistoryRef.current);
            localStorage.setItem(`deskling.proactiveHistory.${selectedPackage.manifest.id}`, JSON.stringify(proactiveHistoryRef.current));
            if (proactiveIgnoreTimerRef.current) window.clearTimeout(proactiveIgnoreTimerRef.current);
            proactiveIgnoreTimerRef.current = null;
            setConversationResponse(proactiveMessage);
            void addHistoryEntry({ id: crypto.randomUUID(), role: "pet", content: proactiveMessage, source: "proactive", createdAt: Date.now() });
            setProactiveMessage(null);
            proactiveActiveRef.current = false;
          }
        }
        activeGestureRef.current = null;
        dispatchBehavior("dragEnded");
        if (!gesture.moved && !opened) reactToSingleClick();
        lastWindowSnapshotRef.current = null;
        lastWindowFeetXRef.current = null;
      }
    }
  };

  const handlePointerMove = (
    event: ReactPointerEvent<HTMLDivElement>,
    point: Point,
    region: HitRegion | null,
  ) => {
    if (event.buttons !== 0) {
      clearCursorAttention();
      return;
    }
    const available = behaviorEngineRef.current.state === "idle"
      && !agentActivityEngineRef.current.event
      && !proactiveActiveRef.current
      && !conversationOpenRef.current
      && !conversationSendPendingRef.current;
    if (!available || !selectedPackage) {
      clearCursorAttention();
      return;
    }

    const headAnchor = rendererRef.current.getAnchor("head");
    const nearHead = Boolean(headAnchor && cursorNearHead(point, headAnchor));
    if (nearHead && headAnchor) {
      setCursorAware(true);
      const nextFacing = facingForCursor(point, headAnchor, facing);
      if (nextFacing !== facing) setFacing(nextFacing);
      setAnimation((current) => current === "idle" || current === "look" ? "look" : current);
      if (cursorAttentionTimerRef.current) window.clearTimeout(cursorAttentionTimerRef.current);
      cursorAttentionTimerRef.current = window.setTimeout(clearCursorAttention, CURSOR_ATTENTION_TIMEOUT_MS);
    } else {
      clearCursorAttention();
    }

    if (!pettingGestureRef.current.record(point, region, event.timeStamp)) return;
    const reaction = reactionForInteraction(
      "petting",
      effectivePersonality(selectedPackage.manifest, personalityOverrides),
    );
    clearCursorAttention();
    notifyUserActivity();
    startReaction(reaction.animation, reaction.durationMs);
    showSpeech(reaction.speech, Math.min(reaction.durationMs, 2_400));
  };

  const openProactiveConversation = () => {
    if (!proactiveMessage || !selectedPackage) return;
    proactiveHistoryRef.current = recordProactiveOpened(proactiveHistoryRef.current);
    localStorage.setItem(`deskling.proactiveHistory.${selectedPackage.manifest.id}`, JSON.stringify(proactiveHistoryRef.current));
    if (proactiveIgnoreTimerRef.current) window.clearTimeout(proactiveIgnoreTimerRef.current);
    proactiveIgnoreTimerRef.current = null;
    setConversationResponse(proactiveMessage);
    void addHistoryEntry({ id: crypto.randomUUID(), role: "pet", content: proactiveMessage, source: "proactive", createdAt: Date.now() });
    setConversationStatus("idle");
    setProactiveMessage(null);
    proactiveActiveRef.current = false;
    setSpeech(null);
    setConversationOpen(true);
    notifyUserActivity();
  };

  const positionConversationWindow = useCallback(async () => {
    if (!isDesktopRuntime() || conversationDraggingRef.current) return;
    const petWindow = getCurrentWindow();
    const conversationWindow = await WebviewWindow.getByLabel("conversation");
    if (!conversationWindow) return;
    const [petPosition, petSize, conversationSize, monitor] = await Promise.all([
      petWindow.outerPosition(), petWindow.outerSize(), conversationWindow.outerSize(), currentMonitor(),
    ]);
    const target = conversationWindowPosition(
      petPosition,
      petSize,
      conversationSize,
      conversationSide,
      12 * (monitor?.scaleFactor ?? 1),
      monitor ? {
        x: monitor.workArea.position.x,
        y: monitor.workArea.position.y,
        width: monitor.workArea.size.width,
        height: monitor.workArea.size.height,
      } : undefined,
      conversationOffset,
    );
    await conversationWindow.setPosition(new PhysicalPosition(target.x, target.y));
  }, [conversationOffset, conversationSide]);
  positionConversationRef.current = positionConversationWindow;

  useEffect(() => {
    if (!isDesktopRuntime()) return;
    void (async () => {
      const conversationWindow = await WebviewWindow.getByLabel("conversation");
      if (!conversationWindow) return;
      if (!conversationOpen) { await conversationWindow.hide(); return; }
      await positionConversationWindow();
      await conversationWindow.show();
      await conversationWindow.setFocus();
    })();
  }, [conversationOpen, conversationSide, positionConversationWindow]);

  useEffect(() => {
    if (!conversationOpen || !selectedPackage) return;
    const state: ConversationUiState = {
      petName: effectivePersonality(selectedPackage.manifest, personalityOverrides).nickname ?? selectedPackage.manifest.name,
      response: conversationResponse,
      memoryCandidate: lastDirectMessage,
      status: conversationStatus,
      runtimeAvailable,
      memoryStatus: memorySaveStatus,
      side: conversationSide,
      providerLabel: AGENT_PROVIDER_LABELS[agentProvider],
    };
    void emitToConversation(DESKTOP_EVENTS.conversationUiState, state);
  }, [agentProvider, conversationOpen, conversationResponse, conversationSide, conversationStatus, lastDirectMessage, memorySaveStatus, personalityOverrides, runtimeAvailable, selectedPackage]);

  useEffect(() => {
    if (!selectedPackage) return;
    let active = true;
    let unlisten: () => void = () => undefined;
    void listenDesktop<ConversationUiAction>(DESKTOP_EVENTS.conversationUiAction, (action) => {
      if (action.type === "close") {
        notifyUserActivity();
        conversationFocusGraceUntilRef.current = Date.now() + 1_000;
        setConversationOpen(false);
        setUserTyping(false);
        return;
      }
      if (action.type === "typing") { setUserTyping(action.typing); if (action.typing) notifyUserActivity(); return; }
      if (action.type === "drag-start") { notifyUserActivity(); conversationDraggingRef.current = true; return; }
      if (action.type === "drag-cancel") { conversationDraggingRef.current = false; return; }
      if (action.type === "drag-end") {
        void (async () => {
          try {
            const petWindow = getCurrentWindow();
            const [petPosition, petSize, conversationWindow] = await Promise.all([
              petWindow.outerPosition(), petWindow.outerSize(), WebviewWindow.getByLabel("conversation"),
            ]);
            const offset = relativeWindowOffset(action.position, petPosition);
            const nextSide = conversationWindow
              ? action.position.x + (await conversationWindow.outerSize()).width / 2 < petPosition.x + petSize.width / 2 ? "left" : "right"
              : conversationSide;
            localStorage.setItem(DESKTOP_STORAGE.conversationPositionOffset, JSON.stringify(offset));
            localStorage.setItem("deskling.conversationSide", nextSide);
            setConversationOffset(offset);
            setConversationSide(nextSide);
          } catch {
            conversationDraggingRef.current = false;
            void positionConversationRef.current();
          } finally {
            conversationDraggingRef.current = false;
          }
        })();
        return;
      }
      if (action.type === "side") {
        notifyUserActivity();
        conversationDraggingRef.current = false;
        localStorage.removeItem(DESKTOP_STORAGE.conversationPositionOffset);
        localStorage.setItem("deskling.conversationSide", action.side);
        setConversationOffset(null);
        setConversationSide(action.side);
        return;
      }
      if (action.type === "stop") {
        notifyUserActivity();
        conversationSendPendingRef.current = false;
        void stopPetConversation().then(() => { agentActivityEngineRef.current.clear(); setAgentEvent(null); setConversationStatus("idle"); setConversationResponse("已停止。"); schedulerRef.current?.notifyActivity(); });
        return;
      }
      if (action.type === "remember") {
        notifyUserActivity();
        const reason = sensitiveMemoryReason(action.content);
        if (reason) { setMemorySaveStatus(reason); return; }
        const now = Date.now();
        const memory: PetMemory = { id: crypto.randomUUID(), category: action.category, content: action.content, createdAt: now, updatedAt: now, sourceConversationId: conversationRequestIdRef.current ?? undefined };
        setMemorySaveStatus("正在保存記憶…");
        void savePetMemory(selectedPackage.manifest.id, memory, memorySettings.maxEntries).then((saved) => {
          if (!saved.some((item) => item.id === memory.id)) throw new Error("記憶未成功寫入，請稍後再試。");
          setMemorySaveStatus("已保存至 Pet Lab → MEMORY");
        }).catch((error) => setMemorySaveStatus(`保存失敗：${String(error)}`));
        return;
      }
      if (action.type === "send") {
        if (conversationSendPendingRef.current) return;
        conversationSendPendingRef.current = true;
        void (async () => {
          try {
            notifyUserActivity(); setMemorySaveStatus(""); setLastDirectMessage(action.message); setUserTyping(false); setConversationStatus("thinking");
            await addHistoryEntry({ id: crypto.randomUUID(), role: "user", content: action.message, source: "direct", createdAt: Date.now() });
            const personality = effectivePersonality(selectedPackage.manifest, personalityOverrides);
            const stored = memorySettings.enabled ? await loadPetMemory(selectedPackage.manifest.id, memorySettings.maxEntries) : [];
            await startPetConversation(action.message, personality.nickname ?? selectedPackage.manifest.name, composePetInstructions(selectedPackage.manifest, personalityOverrides), "conversation", selectRelevantMemories(stored, action.message), agentProvider);
          } catch (error) {
            conversationSendPendingRef.current = false;
            setConversationStatus("error");
            setConversationResponse(String(error));
          }
        })();
      }
    }).then((value) => {
      if (active) unlisten = value;
      else value();
    });
    return () => { active = false; unlisten(); };
  }, [addHistoryEntry, agentProvider, conversationSide, memorySettings.enabled, memorySettings.maxEntries, notifyUserActivity, personalityOverrides, selectedPackage]);

  if (error) return <div className="overlay-error">{error}</div>;
  if (!selectedPackage) return null;

  return (
    <main
      ref={overlayRef}
      className={`pet-overlay ${clickThrough ? "pet-overlay--click-through" : ""}`}
      data-behavior-state={behaviorState}
      data-surface-state={surfaceState}
      data-agent-activity={agentEvent?.activity ?? "idle"}
      data-cursor-aware={cursorAware}
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
          onPointerMove={handlePointerMove}
          onPointerUp={() => undefined}
          onPointerLeave={clearCursorAttention}
          onSpeechClick={proactiveMessage ? openProactiveConversation : undefined}
        />
      </div>
      {debug && (
        <button data-click-through-interactive className="overlay-facing" onClick={() => setFacing(facing === "left" ? "right" : "left")}>
          facing: {facing}
        </button>
      )}
      {!isDesktopRuntime() && <span className="overlay-browser-note">Desktop overlay preview</span>}
    </main>
  );
}
