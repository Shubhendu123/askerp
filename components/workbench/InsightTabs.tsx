"use client";

interface Tab { id: string; label: string; icon: string; }
interface Props {
  activeTab: string;
  onTabChange: (id: string) => void;
  enabledTabs: Record<string, boolean>;
}

const TAB_ORDER: Tab[] = [
  { id: "change",       label: "Change",       icon: "◈" },
  { id: "contribution", label: "Contribution", icon: "◫" },
  { id: "trend",        label: "Trend",        icon: "◬" },
  { id: "drivers",      label: "Drivers",      icon: "◭" },
];

export default function InsightTabs({ activeTab, onTabChange, enabledTabs }: Props) {
  return (
    <div
      className="flex items-center gap-1 p-1 rounded-xl w-fit"
      style={{ background: "var(--bg-card)", border: "1px solid var(--divider)" }}
    >
      {TAB_ORDER.map((tab) => {
        const enabled = enabledTabs[tab.id] ?? false;
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            onClick={() => enabled && onTabChange(tab.id)}
            disabled={!enabled}
            className="px-4 py-1.5 rounded-lg text-[12px] font-medium transition-all duration-150 flex items-center gap-1.5"
            style={{
              background: isActive
                ? "linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)"
                : "transparent",
              color: isActive
                ? "#fff"
                : enabled
                ? "var(--text-secondary)"
                : "var(--text-tertiary)",
              opacity: enabled ? 1 : 0.4,
              cursor: enabled ? "pointer" : "default",
              boxShadow: isActive ? "0 0 12px rgba(99,102,241,0.4)" : "none",
            }}
          >
            <span className="text-[10px] opacity-70">{tab.icon}</span>
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
