import type { PetPersonality } from "../domain/avatar";

export type ProactiveFrequency = "rare" | "sometimes" | "often";

export interface ProactiveInteractionSettings {
  enabled: boolean;
  frequency: ProactiveFrequency;
  quietHoursStart: string;
  quietHoursEnd: string;
  dailyLimit: number;
  useAi: boolean;
}

export const DEFAULT_PROACTIVE_SETTINGS: ProactiveInteractionSettings = {
  enabled: false,
  frequency: "rare",
  quietHoursStart: "22:00",
  quietHoursEnd: "08:00",
  dailyLimit: 3,
  useAi: true,
};

export interface ProactiveRuntimeContext {
  conversationOpen: boolean;
  activeRequest: boolean;
  dragging: boolean;
  sleeping: boolean;
  userTyping: boolean;
  petVisible: boolean;
  idleMinutes: number;
}

export interface ProactiveHistory {
  day: string;
  count: number;
  lastAttemptAt: number;
  consecutiveIgnored: number;
  pausedUntilDay?: string;
}

export const MIN_PROACTIVE_COOLDOWN_MS = 30 * 60_000;
const FREQUENCY_MS: Record<ProactiveFrequency, number> = {
  rare: 3 * 60 * 60_000,
  sometimes: 90 * 60_000,
  often: MIN_PROACTIVE_COOLDOWN_MS,
};

export const PROACTIVE_IDLE_MINUTES: Record<ProactiveFrequency, number> = {
  rare: 30,
  sometimes: 20,
  often: 10,
};

export type ProactiveTestStatusKind = "checking" | "success" | "blocked" | "error";

export interface ProactiveTestStatus {
  kind: ProactiveTestStatusKind;
  message: string;
}

export type LocalProactiveTimeOfDay = "morning" | "afternoon" | "evening";

const dayKey = (date: Date) => `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
const minutes = (time: string) => {
  const match = /^(\d\d):(\d\d)$/.exec(time);
  if (!match) return 0;
  return Math.min(1439, Number(match[1]) * 60 + Number(match[2]));
};

export function isQuietHour(now: Date, start: string, end: string): boolean {
  const current = now.getHours() * 60 + now.getMinutes();
  const from = minutes(start);
  const to = minutes(end);
  return from === to ? false : from < to ? current >= from && current < to : current >= from || current < to;
}

export function canStartProactiveInteraction(
  settings: ProactiveInteractionSettings,
  context: ProactiveRuntimeContext,
  history: ProactiveHistory,
  now = new Date(),
): boolean {
  const today = dayKey(now);
  const count = history.day === today ? history.count : 0;
  const ignoredMultiplier = history.consecutiveIgnored >= 2 ? 2 : 1;
  return settings.enabled
    && !context.conversationOpen && !context.activeRequest && !context.dragging
    && !context.userTyping && context.petVisible
    && context.idleMinutes >= PROACTIVE_IDLE_MINUTES[settings.frequency]
    && history.pausedUntilDay !== today
    && !isQuietHour(now, settings.quietHoursStart, settings.quietHoursEnd)
    && count < Math.max(1, Math.min(10, settings.dailyLimit))
    && now.getTime() - history.lastAttemptAt >= FREQUENCY_MS[settings.frequency] * ignoredMultiplier;
}

export function proactiveOperationalBlockReason(context: ProactiveRuntimeContext): string | null {
  if (context.conversationOpen) return "請先關閉目前的對話框。";
  if (context.activeRequest) return "Pet 正在處理另一個回應。";
  if (context.dragging) return "請先放開正在拖曳的 Pet。";
  if (context.userTyping) return "你正在輸入訊息，這次先不打擾。";
  if (!context.petVisible) return "Pet 視窗目前不可見。";
  return null;
}

export function localProactiveUtterance(
  personality: Pick<PetPersonality, "preferredLanguage" | "traits">,
  timeOfDay: LocalProactiveTimeOfDay,
): string {
  const language = personality.preferredLanguage === "en" || personality.preferredLanguage === "ja"
    ? personality.preferredLanguage
    : "zh-TW";
  const energetic = personality.traits.energy >= 70;
  const playful = personality.traits.humor >= 65;
  const warm = personality.traits.warmth >= 60;
  const key = playful ? "playful" : energetic ? "energetic" : warm ? "warm" : "neutral";
  const utterances = {
    "zh-TW": {
      playful: timeOfDay === "evening" ? "今天辛苦了，要不要讓眼睛先下班一下？" : "工作進度巡邏中，也別忘了伸個懶腰。",
      energetic: timeOfDay === "morning" ? "早安！先喝口水再一起出發吧。" : "休息一下，我們等一下再繼續衝！",
      warm: timeOfDay === "evening" ? "今天已經做得很好了，慢慢收尾吧。" : "我在這裡，記得讓自己喘口氣。",
      neutral: "要不要短暫休息一下？",
    },
    en: {
      playful: timeOfDay === "evening" ? "You've done enough—want to let your eyes clock out too?" : "Progress patrol here: don't forget a quick stretch.",
      energetic: timeOfDay === "morning" ? "Good morning! Grab some water and let's get going." : "Quick break, then we can jump back in!",
      warm: timeOfDay === "evening" ? "You did well today; let's wind down gently." : "I'm here—remember to give yourself a breath.",
      neutral: "How about a short break?",
    },
    ja: {
      playful: timeOfDay === "evening" ? "今日は頑張ったね。目もそろそろ退勤させない？" : "進捗パトロール中。少し伸びも忘れずにね。",
      energetic: timeOfDay === "morning" ? "おはよう！水を飲んで、一緒に始めよう。" : "少し休んだら、また一緒に頑張ろう！",
      warm: timeOfDay === "evening" ? "今日はよく頑張ったね。ゆっくり終わろう。" : "ここにいるよ。少し息抜きもしてね。",
      neutral: "少し休憩しない？",
    },
  } as const;
  return utterances[language][key];
}

export function recordProactiveAttempt(history: ProactiveHistory, now = new Date()): ProactiveHistory {
  const today = dayKey(now);
  return { ...history, day: today, count: history.day === today ? history.count + 1 : 1, lastAttemptAt: now.getTime() };
}

export function recordProactiveIgnored(history: ProactiveHistory, now = new Date()): ProactiveHistory {
  const consecutiveIgnored = history.consecutiveIgnored + 1;
  return { ...history, consecutiveIgnored, ...(consecutiveIgnored >= 3 ? { pausedUntilDay: dayKey(now) } : {}) };
}

export function recordProactiveOpened(history: ProactiveHistory): ProactiveHistory {
  return { ...history, consecutiveIgnored: 0, pausedUntilDay: undefined };
}

export function emptyProactiveHistory(): ProactiveHistory {
  return { day: "", count: 0, lastAttemptAt: 0, consecutiveIgnored: 0 };
}

export function formatProactiveUtterance(value: string, maxCharacters = 80): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  const characters = Array.from(normalized);
  const sentenceEnd = characters.findIndex((character) => ".!?。！？".includes(character));
  if (sentenceEnd >= 0 && sentenceEnd < maxCharacters) return characters.slice(0, sentenceEnd + 1).join("");
  if (characters.length <= maxCharacters) return normalized;
  return `${characters.slice(0, Math.max(0, maxCharacters - 1)).join("").trimEnd()}…`;
}
