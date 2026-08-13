import { useCallback, useEffect, useState } from "react";
import { AGENT_PROVIDER_LABELS, type AgentProvider, type AgentProviderStatus } from "../agent/conversation";
import { agentProviderStatuses, isDesktopRuntime } from "../desktop/bridge";

interface AgentProviderSettingsProps {
  provider: AgentProvider;
  onChange: (provider: AgentProvider) => Promise<void>;
}

const PROVIDERS: AgentProvider[] = ["codex", "claude-code"];

export function AgentProviderSettings({ provider, onChange }: AgentProviderSettingsProps) {
  const [statuses, setStatuses] = useState<AgentProviderStatus[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [changing, setChanging] = useState(false);

  const refresh = useCallback(async () => {
    if (!isDesktopRuntime()) return;
    setRefreshing(true);
    try { setStatuses(await agentProviderStatuses()); }
    finally { setRefreshing(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const select = async (next: AgentProvider) => {
    if (next === provider || changing) return;
    setChanging(true);
    try { await onChange(next); }
    finally { setChanging(false); }
  };

  return <div className="agent-provider-settings">
    <div className="agent-provider-settings__heading">
      <div><p className="eyebrow">AI PROVIDER</p><small>使用已登入的 CLI 訂閱，不儲存 API key</small></div>
      <button type="button" disabled={!isDesktopRuntime() || refreshing} onClick={() => void refresh()}>{refreshing ? "…" : "刷新"}</button>
    </div>
    <div className="agent-provider-settings__options">
      {PROVIDERS.map((item) => {
        const status = statuses.find((value) => value.provider === item);
        const ready = status?.installed && status.authenticated;
        const stateLabel = !status ? "Checking" : ready ? "Ready" : status.installed ? "Login required" : "Not installed";
        return <button
          type="button"
          className={provider === item ? "active" : ""}
          aria-pressed={provider === item}
          disabled={changing || !isDesktopRuntime()}
          key={item}
          onClick={() => void select(item)}
        >
          <span><strong>{AGENT_PROVIDER_LABELS[item]}</strong><i className={ready ? "ready" : ""}>{stateLabel}</i></span>
          <small>{status?.version ?? (isDesktopRuntime() ? "檢查中…" : "Desktop only")}</small>
        </button>;
      })}
    </div>
    {statuses.find((item) => item.provider === provider) && <div className="agent-provider-settings__detail">
      <p>{statuses.find((item) => item.provider === provider)?.billingNote}</p>
      {!statuses.find((item) => item.provider === provider)?.authenticated && <code>{statuses.find((item) => item.provider === provider)?.loginCommand}</code>}
    </div>}
  </div>;
}
