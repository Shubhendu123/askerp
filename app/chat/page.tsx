import AppShell from "@/components/shell/AppShell";
import Workbench from "@/components/workbench/Workbench";

export const metadata = {
  title: "AskERP — Workbench",
  description: "Conversational analytics for Northwind Furniture",
};

export default function ChatPage() {
  return (
    <AppShell>
      <Workbench />
    </AppShell>
  );
}
