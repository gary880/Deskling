import { describe, expect, it } from "vitest";
import { selectRelevantMemories, sensitiveMemoryReason, type PetMemory } from "./petMemory";

const memory = (id: string, content: string, updatedAt: number, category: PetMemory["category"] = "fact"): PetMemory => ({ id, content, category, createdAt: updatedAt, updatedAt });

describe("pet memory", () => {
  it("rejects common sensitive values", () => {
    expect(sensitiveMemoryReason("API token: sk_live_abcdefghijklmnop")).toBeTruthy();
    expect(sensitiveMemoryReason("信用卡 4242 4242 4242 4242")).toBeTruthy();
    expect(sensitiveMemoryReason("我喜歡烏龍茶")).toBeNull();
  });

  it("selects relevant approved memories within the fixed budget", () => {
    const selected = selectRelevantMemories([
      memory("1", "使用者喜歡烏龍茶", 1),
      memory("2", "正在準備產品發表", 2, "ongoing"),
      memory("3", "使用者住在台北", 3),
    ], "今天想喝烏龍茶", 2);
    expect(selected).toHaveLength(2);
    expect(selected[0].id).toBe("1");
    expect(selected.reduce((sum, item) => sum + item.content.length, 0)).toBeLessThanOrEqual(1_000);
  });
});
