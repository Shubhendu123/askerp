"use client";

interface Tab { id: string; label: string; }
interface Props {
  activeTab: string;
  onTabChange: (id: string) => void;
  enabledTabs: Record<string, boolean>;
}

const TAB_ORDER: Tab[] = [
  { id: "change",       label: "Change" },
  { id: "contribution", label: "Contribution" },
];

export default function InsightTabs({ activeTab, onTabChange, enabledTabs }: Props) {
  return (
    <div
      className="flex items-center gap-1 w-fit"
      style={{
        background: "var(--bg-subtle)",
        border: "1px solid var(--border)",
        borderRadius: 999,
        padding: 3,
      }}
    >
      {TAB_ORDER.map((tab) => {
        const enabled = enabledTabs[tab.id] ?? false;
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            onClick={() => enabled && onTabChange(tab.id)}
            disabled={!enabled}
            className="transition-all duration-150"
            style={{
              fontSize: 12,
              fontWeight: 500,
              padding: "5px 16px",
              borderRadius: 999,
              background: isActive ? "var(--accent)" : "transparent",
              color: isActive
                ? "#fff"
                : enabled
                ? "var(--text-secondary)"
                : "var(--text-tertiary)",
              opacity: enabled ? 1 : 0.45,
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
