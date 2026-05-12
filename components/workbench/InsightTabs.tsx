"use client";

interface Tab {
  id: string;
  label: string;
  enabled: boolean;
}

interface Props {
  activeTab: string;
  onTabChange: (id: string) => void;
  enabledTabs: Record<string, boolean>;
}

const TAB_ORDER: Tab[] = [
  { id: "change", label: "Change", enabled: true },
  { id: "contribution", label: "Contribution", enabled: false },
  { id: "trend", label: "Trend", enabled: false },
  { id: "drivers", label: "Drivers", enabled: false },
];

export default function InsightTabs({ activeTab, onTabChange, enabledTabs }: Props) {
  return (
    <div className="flex items-center gap-1.5">
      {TAB_ORDER.map((tab) => {
        const enabled = enabledTabs[tab.id] ?? tab.enabled;
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            onClick={() => enabled && onTabChange(tab.id)}
            disabled={!enabled}
            className="px-3.5 py-1.5 rounded-full text-[12px] font-medium transition-colors"
            style={{
              background: isActive ? "var(--accent-primary)" : "transparent",
              color: isActive ? "#fff" : "var(--text-secondary)",
              opacity: enabled ? 1 : 0.35,
              cursor: enabled ? "pointer" : "default",
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
