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
  return settings.enabled && settings.useAi
    && !context.conversationOpen && !context.activeRequest && !context.dragging
    && !context.sleeping && !context.userTyping && context.petVisible
    && context.idleMinutes >= 30
    && history.pausedUntilDay !== today
    && !isQuietHour(now, settings.quietHoursStart, settings.quietHoursEnd)
    && count < Math.max(1, Math.min(10, settings.dailyLimit))
    && now.getTime() - history.lastAttemptAt >= FREQUENCY_MS[settings.frequency] * ignoredMultiplier;
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
