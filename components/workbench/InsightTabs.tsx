"use client";

import { useState } from "react";

const TABS = [
  { id: "change", label: "Change", enabled: true },
  { id: "contribution", label: "Contribution", enabled: false },
  { id: "trend", label: "Trend", enabled: false },
  { id: "drivers", label: "Drivers", enabled: false },
];

export default function InsightTabs() {
  const [active, setActive] = useState("change");

  return (
    <div className="flex items-center gap-1.5">
      {TABS.map((tab) => {
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            onClick={() => tab.enabled && setActive(tab.id)}
            disabled={!tab.enabled}
            className="px-3.5 py-1.5 rounded-full text-[12px] font-medium transition-colors"
            style={{
              background: isActive ? "var(--accent-primary)" : "transparent",
              color: isActive
                ? "#fff"
                : "var(--text-secondary)",
              opacity: tab.enabled ? 1 : 0.4,
              cursor: tab.enabled ? "pointer" : "default",
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
