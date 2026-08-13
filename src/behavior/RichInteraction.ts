import type { Facing, HitRegion, PetPersonality, Point } from "../domain/avatar";

export type LocalInteractionKind = "head-tap" | "body-tap" | "petting";

export interface LocalInteractionReaction {
  animation: "happy" | "annoyed" | "surprised";
  speech: string;
  durationMs: number;
}

export interface PettingGestureOptions {
  windowMs: number;
  cooldownMs: number;
  minimumDistance: number;
  minimumReversals: number;
  minimumDurationMs: number;
  minimumDirectionalStep: number;
}

const DEFAULT_PETTING_OPTIONS: PettingGestureOptions = {
  windowMs: 1_400,
  cooldownMs: 4_500,
  minimumDistance: 60,
  minimumReversals: 2,
  minimumDurationMs: 240,
  minimumDirectionalStep: 3,
};

const SPEECH = {
  "zh-TW": {
    pettingWarm: "嗯…好舒服。",
    pettingLively: "嘿嘿，好癢！",
    pettingPlayful: "再摸一下就原諒你。",
    pettingBoundary: "慢一點，我還在適應。",
    headFriendly: "嘿嘿，被摸到了。",
    headPlayful: "我的髮型要亂啦。",
    headBoundary: "先打聲招呼嘛。",
    bodyFriendly: "我在這裡。",
    bodyEnergetic: "找到我了！",
    bodyBoundary: "嗯？怎麼了？",
  },
  en: {
    pettingWarm: "Mm… that feels nice.",
    pettingLively: "Hehe, that tickles!",
    pettingPlayful: "One more and I'll forgive you.",
    pettingBoundary: "Easy—I’m still getting used to this.",
    headFriendly: "Hehe, you found me.",
    headPlayful: "You're messing up my hair!",
    headBoundary: "Say hello first.",
    bodyFriendly: "I'm right here.",
    bodyEnergetic: "You found me!",
    bodyBoundary: "Hm? What is it?",
  },
  ja: {
    pettingWarm: "ん…気持ちいい。",
    pettingLively: "ふふ、くすぐったい！",
    pettingPlayful: "もう一回なら許してあげる。",
    pettingBoundary: "ゆっくりね、まだ慣れてないから。",
    headFriendly: "ふふ、なでられた。",
    headPlayful: "髪型がくずれちゃうよ。",
    headBoundary: "まずは挨拶してね。",
    bodyFriendly: "ここにいるよ。",
    bodyEnergetic: "見つかった！",
    bodyBoundary: "ん？どうしたの？",
  },
} as const;

type SpeechKey = keyof (typeof SPEECH)["zh-TW"];

function localizedSpeech(personality: Pick<PetPersonality, "preferredLanguage">, key: SpeechKey): string {
  const language = personality.preferredLanguage === "en" || personality.preferredLanguage === "ja"
    ? personality.preferredLanguage
    : "zh-TW";
  return SPEECH[language][key];
}

export function reactionForInteraction(
  kind: LocalInteractionKind,
  personality: Pick<PetPersonality, "preferredLanguage" | "traits">,
): LocalInteractionReaction {
  const { warmth, energy, humor, directness } = personality.traits;
  if (kind === "petting") {
    if (warmth < 35 || directness >= 85) {
      return { animation: "annoyed", speech: localizedSpeech(personality, "pettingBoundary"), durationMs: 2_600 };
    }
    if (humor >= 70) {
      return { animation: "happy", speech: localizedSpeech(personality, "pettingPlayful"), durationMs: 2_400 };
    }
    if (energy >= 70) {
      return { animation: "happy", speech: localizedSpeech(personality, "pettingLively"), durationMs: 2_200 };
    }
    return { animation: "happy", speech: localizedSpeech(personality, "pettingWarm"), durationMs: 2_400 };
  }

  if (kind === "head-tap") {
    if (warmth < 30 || directness >= 90) {
      return { animation: "annoyed", speech: localizedSpeech(personality, "headBoundary"), durationMs: 2_200 };
    }
    if (humor >= 65) {
      return { animation: "happy", speech: localizedSpeech(personality, "headPlayful"), durationMs: 2_000 };
    }
    return { animation: "happy", speech: localizedSpeech(personality, "headFriendly"), durationMs: 2_000 };
  }

  if (energy >= 70) {
    return { animation: "surprised", speech: localizedSpeech(personality, "bodyEnergetic"), durationMs: 2_000 };
  }
  if (warmth >= 45) {
    return { animation: "happy", speech: localizedSpeech(personality, "bodyFriendly"), durationMs: 2_000 };
  }
  return { animation: "surprised", speech: localizedSpeech(personality, "bodyBoundary"), durationMs: 2_000 };
}

export function cursorNearHead(point: Point, headAnchor: Point, radius = 52): boolean {
  const x = point.x - headAnchor.x;
  const y = point.y - headAnchor.y;
  return x * x + y * y <= radius * radius;
}

export function facingForCursor(
  point: Point,
  headAnchor: Point,
  current: Facing,
  hysteresis = 8,
): Facing {
  if (point.x < headAnchor.x - hysteresis) return "left";
  if (point.x > headAnchor.x + hysteresis) return "right";
  return current;
}

export class PettingGestureTracker {
  private readonly options: PettingGestureOptions;
  private startedAt: number | null = null;
  private lastPoint: Point | null = null;
  private lastDirection = 0;
  private distance = 0;
  private reversals = 0;
  private cooldownUntil = 0;

  constructor(options: Partial<PettingGestureOptions> = {}) {
    this.options = { ...DEFAULT_PETTING_OPTIONS, ...options };
  }

  record(point: Point, region: HitRegion | null, timestamp: number): boolean {
    if (region !== "head" || !Number.isFinite(timestamp)) {
      this.resetSequence();
      return false;
    }
    if (timestamp < this.cooldownUntil) {
      this.resetSequence();
      return false;
    }
    if (this.startedAt === null || timestamp < this.startedAt || timestamp - this.startedAt > this.options.windowMs) {
      this.begin(point, timestamp);
      return false;
    }

    const previous = this.lastPoint;
    if (!previous) {
      this.begin(point, timestamp);
      return false;
    }
    const dx = point.x - previous.x;
    const dy = point.y - previous.y;
    this.distance += Math.hypot(dx, dy);
    this.lastPoint = point;

    if (Math.abs(dx) >= this.options.minimumDirectionalStep) {
      const direction = Math.sign(dx);
      if (this.lastDirection !== 0 && direction !== this.lastDirection) this.reversals += 1;
      this.lastDirection = direction;
    }

    const duration = timestamp - this.startedAt;
    if (
      duration >= this.options.minimumDurationMs
      && this.distance >= this.options.minimumDistance
      && this.reversals >= this.options.minimumReversals
    ) {
      this.cooldownUntil = timestamp + this.options.cooldownMs;
      this.resetSequence();
      return true;
    }
    return false;
  }

  resetSequence(): void {
    this.startedAt = null;
    this.lastPoint = null;
    this.lastDirection = 0;
    this.distance = 0;
    this.reversals = 0;
  }

  private begin(point: Point, timestamp: number): void {
    this.resetSequence();
    this.startedAt = timestamp;
    this.lastPoint = point;
  }
}
