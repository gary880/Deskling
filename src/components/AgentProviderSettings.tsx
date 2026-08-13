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
  const [changingTo, setChangingTo] = useState<AgentProvider | null>(null);

  const refresh = useCallback(async () => {
    if (!isDesktopRuntime()) return;
    setRefreshing(true);
    try { setStatuses(await agentProviderStatuses()); }
    finally { setRefreshing(false); }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const select = async (next: AgentProvider) => {
    if (next === provider || changingTo) return;
    setChangingTo(next);
    const minimumLoadingTime = new Promise<void>((resolve) => window.setTimeout(resolve, 180));
    try { await onChange(next); }
    finally {
      await minimumLoadingTime;
      setChangingTo(null);
    }
  };

  const displayedProvider = changingTo ?? provider;

  return <div className="agent-provider-settings" aria-busy={changingTo !== null}>
    <div className="agent-provider-settings__heading">
      <div><p className="eyebrow">AI PROVIDER</p><small>使用已登入的 CLI 訂閱，不儲存 API key</small></div>
      <button type="button" disabled={!isDesktopRuntime() || refreshing || changingTo !== null} onClick={() => void refresh()}>{refreshing ? "…" : "刷新"}</button>
    </div>
    <div className="agent-provider-settings__options">
      {PROVIDERS.map((item) => {
        const status = statuses.find((value) => value.provider === item);
        const ready = status?.installed && status.authenticated;
        const stateLabel = !status ? "Checking" : ready ? "Ready" : status.installed ? "Login required" : "Not installed";
        return <button
          type="button"
          className={displayedProvider === item ? "active" : ""}
          aria-pressed={displayedProvider === item}
          aria-busy={changingTo === item}
          disabled={changingTo !== null || !isDesktopRuntime()}
          key={item}
          onClick={() => void select(item)}
        >
          <span><strong>{AGENT_PROVIDER_LABELS[item]}</strong><i className={ready ? "ready" : ""}>{stateLabel}</i></span>
          {changingTo === item
            ? <small className="agent-provider-settings__switching" role="status">切換中…</small>
            : <small>{status?.version ?? (isDesktopRuntime() ? "檢查中…" : "Desktop only")}</small>}
        </button>;
      })}
    </div>
    {statuses.find((item) => item.provider === provider) && <div className="agent-provider-settings__detail">
      <p>{statuses.find((item) => item.provider === provider)?.billingNote}</p>
      {!statuses.find((item) => item.provider === provider)?.authenticated && <code>{statuses.find((item) => item.provider === provider)?.loginCommand}</code>}
    </div>}
  </div>;
}
