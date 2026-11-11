import AppShell from "@/components/shell/AppShell";
import Workbench from "@/components/workbench/Workbench";
import { getActiveTenantConfig } from "@/lib/tenants";

export function generateMetadata() {
  const t = getActiveTenantConfig();
  return { title: `${t.productName} — Workbench`, description: t.metaDescription };
}

export default function ChatPage() {
  const tenant = getActiveTenantConfig();
  return (
    <AppShell>
      <Workbench tenant={tenant} />
    </AppShell>
  );
}
