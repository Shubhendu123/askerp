"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  MessageCircle,
  LayoutDashboard,
  Bookmark,
  Database,
  type LucideIcon,
} from "lucide-react";

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /** Structural stub — present for navigational signal, not wired up. */
  soon?: boolean;
}

const NAV: NavItem[] = [
  { label: "Ask", href: "/chat", icon: MessageCircle },
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, soon: true },
  { label: "Saved", href: "/saved", icon: Bookmark, soon: true },
  { label: "Data", href: "/data", icon: Database, soon: true },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <nav
      className="shrink-0 flex flex-col gap-2 py-3 px-2"
      style={{
        width: 150,
        background: "var(--bg-surface)",
        borderRight: "1px solid var(--border)",
      }}
    >
      {NAV.map((item) => {
        const active = pathname === item.href || (item.href === "/chat" && pathname === "/");
        const Icon = item.icon;

        const inner = (
          <div
            className="group flex items-center gap-2 transition-colors"
            style={{
              padding: 8,
              borderRadius: "var(--radius-sm)",
              background: active ? "var(--accent-subtle)" : "transparent",
              color: active ? "var(--accent)" : "var(--text-secondary)",
            }}
            onMouseEnter={(e) => {
              if (!active) e.currentTarget.style.background = "var(--bg-subtle)";
            }}
            onMouseLeave={(e) => {
              if (!active) e.currentTarget.style.background = "transparent";
            }}
          >
            <Icon size={16} strokeWidth={2} />
            <span className="text-[13px] font-medium leading-none flex-1">{item.label}</span>
            {item.soon && (
              <span
                className="text-[8px] uppercase tracking-wide px-1 py-0.5 rounded leading-none"
                style={{ background: "var(--bg-subtle)", color: "var(--text-tertiary)" }}
              >
                Soon
              </span>
            )}
          </div>
        );

        // Active item links normally; stubs are inert (clicking does nothing harmful).
        return item.soon ? (
          <div key={item.label} aria-disabled className="cursor-default select-none">
            {inner}
          </div>
        ) : (
          <Link key={item.label} href={item.href} className="block">
            {inner}
          </Link>
        );
      })}
    </nav>
  );
}
