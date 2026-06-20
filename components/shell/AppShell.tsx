import Sidebar from "./Sidebar";
import TopHeader from "./TopHeader";

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex flex-col"
      style={{ height: "100vh", background: "var(--bg-page)" }}
    >
      {/* Header spans full width at top */}
      <TopHeader />

      {/* Below: [150px sidebar] [1fr main] */}
      <div className="flex flex-1 min-h-0">
        <Sidebar />
        <main
          className="flex-1 min-w-0 overflow-y-auto"
          style={{ background: "var(--bg-page)", padding: 16 }}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
