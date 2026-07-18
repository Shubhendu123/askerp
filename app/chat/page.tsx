import AppShell from "@/components/shell/AppShell";
import Workbench from "@/components/workbench/Workbench";
import { getActiveTenantConfig } from "@/lib/tenants";

export const metadata = {
  title: "AskERP — Workbench",
  description: getActiveTenantConfig().metaDescription,
};

export default function ChatPage() {
  const tenant = getActiveTenantConfig();
  return (
    <AppShell>
      <Workbench tenant={tenant} />
    </AppShell>
  );
}
