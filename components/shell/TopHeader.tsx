import { getActiveTenantConfig } from "@/lib/tenants";

export default function TopHeader() {
  const tenant = getActiveTenantConfig();
  return (
    <header
      className="flex items-center justify-between gap-4"
      style={{
        background: "var(--bg-surface)",
        borderBottom: "1px solid var(--border)",
        padding: "12px 16px",
      }}
    >
      {/* Left: brand mark + wordmark + context */}
      <div className="flex items-center gap-3 min-w-0">
        <div
          className="flex items-center justify-center shrink-0"
          style={{
            width: 28,
            height: 28,
            background: "var(--brand)",
            borderRadius: "var(--radius-sm)",
          }}
        >
          <span className="text-white text-[11px] font-medium tracking-tight">AE</span>
        </div>
        <span
          className="font-medium leading-none"
          style={{ fontSize: 15, color: "var(--text-primary)" }}
        >
          AskERP
        </span>
        <span
          className="hidden sm:inline-block leading-none rounded-full whitespace-nowrap"
          style={{
            fontSize: 11,
            padding: "4px 10px",
            background: "var(--bg-subtle)",
            color: "var(--text-secondary)",
          }}
        >
          {tenant.headerPill}
        </span>
      </div>

      {/* Right: feature pills */}
      <div className="hidden md:flex items-center gap-2 shrink-0">
        <span
          className="leading-none rounded-full whitespace-nowrap"
          style={{
            fontSize: 11,
            padding: "4px 10px",
            background: "var(--accent-subtle)",
            color: "var(--accent)",
          }}
        >
          Natural language
        </span>
        <span
          className="leading-none rounded-full whitespace-nowrap"
          style={{
            fontSize: 11,
            padding: "4px 10px",
            background: "var(--bg-subtle)",
            color: "var(--text-secondary)",
          }}
        >
          AI narration
        </span>
      </div>
    </header>
  );
}
