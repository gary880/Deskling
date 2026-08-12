export type AgentActivity = "idle" | "thinking" | "talking" | "success" | "error";
export type AgentActivitySource = "codex" | "manual";

export interface AgentActivityEvent {
  source: AgentActivitySource;
  activity: AgentActivity;
  message?: string;
  timestamp: number;
}

export const AGENT_ACTIVITY_ANIMATION: Record<AgentActivity, string> = {
  idle: "idle",
  thinking: "thinking",
  talking: "talking",
  success: "happy",
  error: "annoyed",
};

export const AGENT_ACTIVITY_SPEECH: Record<AgentActivity, string | null> = {
  idle: null,
  thinking: "正在思考…",
  talking: "找到一些線索了。",
  success: "完成！",
  error: "好像遇到問題了。",
};

export const AGENT_ACTIVITY_TIMEOUT_MS = 5 * 60_000;
export const AGENT_REACTION_DURATION_MS = 3_000;

export class AgentActivityEngine {
  private current: AgentActivityEvent | null = null;

  accept(event: AgentActivityEvent): boolean {
    if (!Number.isFinite(event.timestamp) || event.timestamp < 0) return false;
    if (this.current && event.timestamp <= this.current.timestamp) return false;
    this.current = event.activity === "idle" ? null : { ...event };
    return true;
  }

  clear(timestamp = Date.now()): boolean {
    return this.accept({ source: "manual", activity: "idle", timestamp });
  }

  get event(): Readonly<AgentActivityEvent> | null {
    return this.current ? { ...this.current } : null;
  }
}
