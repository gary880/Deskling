import type { AnimationDefinition } from "./avatar";

const FALLBACKS: Record<string, string[]> = {
  annoyed: ["surprised", "idle"],
  surprised: ["idle"],
  energetic: ["happy", "walk", "idle"],
  happy: ["idle"],
  talking: ["thinking", "idle"],
  thinking: ["look", "idle"],
  look: ["idle"],
  sleep: ["idle"],
  walk: ["idle"],
};

export function resolveAnimation(
  requested: string,
  animations: Record<string, AnimationDefinition>,
): string {
  if (animations[requested]) return requested;

  for (const candidate of FALLBACKS[requested] ?? ["idle"]) {
    if (animations[candidate]) return candidate;
  }

  return Object.keys(animations)[0] ?? "idle";
}
