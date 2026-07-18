// D-038: per-tenant display identity. Single source of truth for every
// user-visible tenant string (header, placeholder, analysis label, warehouse
// card, page metadata) AND for the company identity fed into LLM prompts
// (sqlGenerator, narrator) — so the UI shell and the model's own references
// to "the company" never contradict each other.
//
// Server Components call getActiveTenantConfig() (reads ACTIVE_TENANT) and
// pass the resolved plain object down as props. Client Components never call
// getActiveTenantConfig() themselves — process.env.ACTIVE_TENANT is not
// NEXT_PUBLIC_-prefixed, so it is not available in the browser bundle; they
// only ever read fields off the config object they were handed.

export interface TenantConfig {
  id: string;
  company: string;          // full legal-style name, e.g. "Summit Industrial Supply Co."
  headerPill: string;       // TopHeader badge, e.g. "Summit Industrial Supply Co. ERP"
  searchPlaceholder: string;
  analysisLabel: string;    // "Analysis · {company}"
  warehouseLabel: string;   // DataOverviewCard subtitle
  metaDescription: string;  // page <meta description>
  llmDescriptor: string;    // short descriptor used inside LLM system prompts
}

export const TENANTS: Record<string, TenantConfig> = {
  mro: {
    id: "mro",
    company: "Summit Industrial Supply Co.",
    headerPill: "Summit Industrial Supply Co. ERP",
    searchPlaceholder: "Ask anything about Summit Industrial Supply Co. — revenue, margins, suppliers…",
    analysisLabel: "Analysis · Summit Industrial Supply Co.",
    warehouseLabel: "Summit Industrial Supply Co. warehouse",
    metaDescription: "Conversational analytics for Summit Industrial Supply Co. — ask questions, get answers.",
    llmDescriptor: "Summit Industrial Supply Co., an industrial MRO (maintenance, repair & operations) distributor",
  },
  northwind: {
    id: "northwind",
    company: "Northwind Furniture",
    headerPill: "Northwind Furniture ERP",
    searchPlaceholder: "Ask anything about Northwind Furniture — revenue, margins, customers…",
    analysisLabel: "Analysis · Northwind Furniture",
    warehouseLabel: "Northwind Furniture warehouse",
    metaDescription: "Conversational analytics for Northwind Furniture — ask questions, get answers.",
    llmDescriptor: "Northwind Furniture, a ~$50M B2B furniture company",
  },
};

const DEFAULT_TENANT_ID = "mro";

export function getTenantConfig(tenantId: string): TenantConfig {
  return TENANTS[tenantId] ?? TENANTS[DEFAULT_TENANT_ID];
}

/** Server-only convenience — reads ACTIVE_TENANT. Never call from a Client Component. */
export function getActiveTenantConfig(): TenantConfig {
  return getTenantConfig(process.env.ACTIVE_TENANT ?? DEFAULT_TENANT_ID);
}
