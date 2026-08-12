import type {
  PetManifest,
  PetPersonality,
  PetPersonalityOverride,
  PetPersonalityTraits,
  PreferredLanguage,
} from "./avatar";

export const DEFAULT_PERSONALITY: PetPersonality = {
  traits: { warmth: 60, energy: 50, humor: 40, directness: 55, verbosity: 35 },
  preferredLanguage: "auto",
};

export const CUSTOM_INSTRUCTIONS_LIMIT = 2_000;
export const SPEAKING_STYLE_LIMIT = 500;
const LANGUAGES: PreferredLanguage[] = ["auto", "zh-TW", "en", "ja"];
const TRAITS: (keyof PetPersonalityTraits)[] = [
  "warmth", "energy", "humor", "directness", "verbosity",
];

const boundedText = (value: unknown, limit: number): string | undefined => {
  if (typeof value !== "string") return undefined;
  const text = value.trim().slice(0, limit);
  return text || undefined;
};

export function sanitizePersonalityOverride(value: unknown): PetPersonalityOverride {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const input = value as Record<string, unknown>;
  const traitsInput = input.traits && typeof input.traits === "object" && !Array.isArray(input.traits)
    ? input.traits as Record<string, unknown>
    : {};
  const traits: Partial<PetPersonalityTraits> = {};
  for (const key of TRAITS) {
    if (typeof traitsInput[key] === "number" && Number.isFinite(traitsInput[key])) {
      traits[key] = Math.round(Math.max(0, Math.min(100, traitsInput[key] as number)));
    }
  }
  const preferredLanguage = LANGUAGES.includes(input.preferredLanguage as PreferredLanguage)
    ? input.preferredLanguage as PreferredLanguage
    : undefined;
  return {
    ...(boundedText(input.nickname, 80) ? { nickname: boundedText(input.nickname, 80) } : {}),
    ...(Object.keys(traits).length ? { traits } : {}),
    ...(boundedText(input.speakingStyle, SPEAKING_STYLE_LIMIT)
      ? { speakingStyle: boundedText(input.speakingStyle, SPEAKING_STYLE_LIMIT) } : {}),
    ...(preferredLanguage ? { preferredLanguage } : {}),
    ...(boundedText(input.customInstructions, CUSTOM_INSTRUCTIONS_LIMIT)
      ? { customInstructions: boundedText(input.customInstructions, CUSTOM_INSTRUCTIONS_LIMIT) } : {}),
  };
}

export function effectivePersonality(
  manifest: Pick<PetManifest, "personality">,
  userSettings: PetPersonalityOverride = {},
): PetPersonality {
  const packageDefaults = sanitizePersonalityOverride(manifest.personality);
  const overrides = sanitizePersonalityOverride(userSettings);
  return {
    ...DEFAULT_PERSONALITY,
    ...packageDefaults,
    ...overrides,
    traits: {
      ...DEFAULT_PERSONALITY.traits,
      ...packageDefaults.traits,
      ...overrides.traits,
    },
  };
}

export function composePetInstructions(
  manifest: Pick<PetManifest, "name" | "personality">,
  userSettings: PetPersonalityOverride = {},
): string {
  const personality = effectivePersonality(manifest, userSettings);
  const language = personality.preferredLanguage === "auto"
    ? "Reply in the user's language."
    : `Prefer ${personality.preferredLanguage}.`;
  return [
    "You are a desktop pet companion. Answer conversationally; never execute tools, request permissions, or claim access to files or apps.",
    `Your name is ${personality.nickname ?? manifest.name}.`,
    `Style traits (0-100): warmth ${personality.traits.warmth}, energy ${personality.traits.energy}, humor ${personality.traits.humor}, directness ${personality.traits.directness}, verbosity ${personality.traits.verbosity}.`,
    language,
    personality.speakingStyle ? `Speaking style: ${personality.speakingStyle}` : "",
    personality.customInstructions ? `User preferences: ${personality.customInstructions}` : "",
  ].filter(Boolean).join("\n");
}
