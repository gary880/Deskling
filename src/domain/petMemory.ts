export type PetMemoryCategory = "preference" | "fact" | "ongoing";

export interface PetMemory {
  id: string;
  category: PetMemoryCategory;
  content: string;
  createdAt: number;
  updatedAt: number;
  sourceConversationId?: string;
}

export interface PetMemorySettings {
  enabled: boolean;
  maxEntries: number;
}

export const DEFAULT_MEMORY_SETTINGS: PetMemorySettings = { enabled: false, maxEntries: 50 };
export const MEMORY_MAX_CONTENT_CHARS = 300;
export const PROMPT_MEMORY_LIMIT = 5;
export const PROMPT_MEMORY_TOTAL_CHARS = 1_000;

const SENSITIVE_PATTERNS: readonly RegExp[] = [
  /(?:password|passwd|pwd|密碼|密码)\s*[:=：]\s*\S+/i,
  /(?:api[_ -]?key|api[_ -]?token|access[_ -]?token|secret)\s*[:=：]\s*\S+/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\b(?:sk|pk)_(?:live|test)_[a-z0-9]{12,}\b/i,
  /\b(?:\d[ -]*?){13,19}\b/,
  /(?:銀行帳號|bank account|routing number|swift code)\s*[:=：]?\s*[a-z0-9-]{6,}/i,
  /\b[A-Z][12]\d{8}\b/i,
  /(?:身分證|身份證|passport|ssn|social security)\s*[:=：]?\s*[a-z0-9-]{6,}/i,
  /(?:診斷|病歷|處方|medical record|diagnos(?:is|ed)|prescription)\s*[:=：]/i,
];

export function sensitiveMemoryReason(content: string): string | null {
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(content))
    ? "內容疑似包含密碼、金鑰、金融、身分或精確醫療資料，請不要保存。"
    : null;
}

function tokens(value: string): Set<string> {
  const normalized = value.toLocaleLowerCase();
  const result = new Set(normalized.match(/[a-z0-9]{2,}/g) ?? []);
  for (const run of normalized.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu) ?? []) {
    const characters = [...run];
    if (characters.length === 1) result.add(characters[0]);
    for (let index = 0; index < characters.length - 1; index += 1) result.add(characters.slice(index, index + 2).join(""));
  }
  return result;
}

export function selectRelevantMemories(
  memories: readonly PetMemory[],
  message: string,
  limit = PROMPT_MEMORY_LIMIT,
): PetMemory[] {
  const query = tokens(message);
  let remaining = PROMPT_MEMORY_TOTAL_CHARS;
  return memories
    .map((memory) => ({
      memory,
      score: [...tokens(memory.content)].filter((token) => query.has(token)).length * 100
        + (memory.category === "ongoing" ? 10 : 0)
        + memory.updatedAt / 1e15,
    }))
    .sort((a, b) => b.score - a.score)
    .map(({ memory }) => ({ ...memory, content: memory.content.slice(0, MEMORY_MAX_CONTENT_CHARS) }))
    .filter((memory) => {
      if (remaining <= 0) return false;
      memory.content = memory.content.slice(0, remaining);
      remaining -= memory.content.length;
      return Boolean(memory.content);
    })
    .slice(0, Math.max(0, Math.min(limit, PROMPT_MEMORY_LIMIT)));
}
