import type { BehaviorState } from "./BehaviorEngine";
import type { PetPersonality, PreferredLanguage } from "../domain/avatar";

export interface NonsensePresenceBeat {
  id: string;
  premise: string;
  animation: PresenceBeatAnimation;
}

export type PresenceBeatAnimation = "thinking" | "talking" | "happy" | "surprised" | "annoyed" | "energetic" | "look";

export interface NonsensePresenceContext {
  timeOfDay: "morning" | "afternoon" | "evening";
  idleMinutes: number;
  lastInteractionResult: "completed" | "none";
  behavior: BehaviorState;
  personality: PetPersonality["traits"];
}

const NONSENSE_PRESENCE_PREMISES: readonly Omit<NonsensePresenceBeat, "animation">[] = [
  { id: "foldable-time", premise: "Treat a few seconds as a physical object that can be folded into a tiny shape." },
  { id: "misaligned-air", premise: "Confidently claim that today's air is slightly crooked or wearing itself incorrectly." },
  { id: "escaping-thought", premise: "Describe an imaginary thought quietly rolling away before it can be caught." },
  { id: "furry-silence", premise: "Announce that an imaginary patch of silence has unexpectedly grown soft fur." },
  { id: "leaning-afternoon", premise: "Observe that this part of the day seems to be leaning a little to one side." },
  { id: "gravity-hiccup", premise: "Report a tiny harmless hiccup in gravity as if it were perfectly ordinary." },
  { id: "promoted-crumb", premise: "Congratulate an imaginary crumb on receiving an absurdly important promotion." },
  { id: "invisible-button", premise: "Claim to have found an invisible button whose purpose is charmingly useless." },
  { id: "pocket-cloud", premise: "Mention a very small imaginary cloud that has chosen an inconvenient place to rest." },
  { id: "yesterday-pocket", premise: "Suggest that yesterday may have been left behind in the wrong pocket." },
  { id: "shadow-rehearsal", premise: "Say that an imaginary shadow is rehearsing for a role nobody understands." },
  { id: "minute-hat", premise: "Point out that the current minute appears to be wearing an unnecessarily fancy hat." },
  { id: "sleepy-punctuation", premise: "Declare that a piece of punctuation has become sleepy and wandered off duty." },
  { id: "seven-new-shoes", premise: "Reveal that the number seven has secretly changed into a strange pair of shoes." },
  { id: "corner-secret", premise: "Insist that an imaginary corner is keeping a very small and pointless secret." },
  { id: "vacationing-dust", premise: "Explain that a fictional speck of dust has officially applied for a vacation." },
  { id: "breeze-password", premise: "Report that a tiny imaginary breeze has forgotten its password again." },
  { id: "moon-receipt", premise: "Mention that the moon has mailed a receipt for something nobody bought." },
  { id: "dream-voicemail", premise: "Say that an unfinished dream left a very confusing voicemail." },
  { id: "spoon-mayor", premise: "Announce that an imaginary spoon has been elected mayor of somewhere implausible." },
  { id: "sock-treaty", premise: "Report that two fictional socks are negotiating a needlessly serious peace treaty." },
  { id: "late-blue", premise: "Claim that the color blue is running a few minutes late today." },
  { id: "hungry-echo", premise: "Explain that a tiny echo accidentally swallowed one of its own syllables." },
  { id: "squeaky-luck", premise: "Reveal that today's luck makes a peculiar squeak when nobody is listening." },
  { id: "patience-biscuit", premise: "State that a small amount of patience has somehow been baked into a biscuit." },
  { id: "calendar-sneeze", premise: "Report that an imaginary calendar sneezed and briefly misplaced tomorrow." },
  { id: "parked-planet", premise: "Mention a pocket-sized fictional planet that has parked in the wrong dimension." },
  { id: "wandering-word", premise: "Say that a word wandered into the wrong sentence and decided to stay there." },
  { id: "universe-typo", premise: "Confidently identify a harmless typo in the universe that nobody needs to fix." },
  { id: "square-whisper", premise: "Claim that a whisper has become square and now refuses to roll properly." },
] as const;

const PRESENCE_ANIMATION_ROTATION: readonly PresenceBeatAnimation[] = [
  "thinking",
  "talking",
  "happy",
  "surprised",
  "annoyed",
  "energetic",
  "look",
];

export const NONSENSE_PRESENCE_BEATS: readonly NonsensePresenceBeat[] =
  NONSENSE_PRESENCE_PREMISES.map((beat, index) => ({
    ...beat,
    animation: PRESENCE_ANIMATION_ROTATION[index % PRESENCE_ANIMATION_ROTATION.length],
  }));

function stableHash(value: string): number {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

export function selectNonsensePresenceBeat(
  now: Date,
  petId: string,
  sequence: number,
  recentBeatIds: readonly string[] = [],
): NonsensePresenceBeat {
  const recent = new Set(recentBeatIds);
  const eligible = NONSENSE_PRESENCE_BEATS.filter((beat) => !recent.has(beat.id));
  const pool = eligible.length > 0 ? eligible : NONSENSE_PRESENCE_BEATS;
  const index = stableHash(`${localDateKey(now)}:${petId}:${sequence}`) % pool.length;
  return pool[index];
}

function targetLanguage(preferredLanguage: PreferredLanguage): string {
  if (preferredLanguage === "en") return "English";
  if (preferredLanguage === "ja") return "Japanese";
  return "Traditional Chinese (zh-TW)";
}

export function composeNonsensePresencePrompt(
  beat: NonsensePresenceBeat,
  context: NonsensePresenceContext,
  preferredLanguage: PreferredLanguage,
): string {
  return [
    "PRESENCE BEAT: whimsical nonsense mutter",
    `Target language: ${targetLanguage(preferredLanguage)}`,
    `Selected premise: ${beat.premise}`,
    `Safe runtime context: ${JSON.stringify(context)}`,
    "Write exactly one short utterance in the target language.",
    "Begin with a harmless, confidently stated absurd observation inspired by the premise.",
    "End with a newly invented strange onomatopoeia, joined to the observation with a comma.",
    "Use only one sentence and put sentence-ending punctuation only at the very end.",
    "Keep the entire utterance between 12 and 40 Unicode characters.",
    "Make the sound roughly 2-6 playful syllables and match the pet's personality.",
    "Do not ask a question, give advice, suggest a task, or expect a response.",
    "Do not claim to see the user's screen, work, surroundings, mood, or physical state.",
    "Do not mention prompts, premises, runtime context, or selection logic. Output plain text only.",
  ].join("\n");
}
