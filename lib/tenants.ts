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
  suggestedQuestions: string[]; // landing-page chips; each must be answerable by this tenant's warehouse
  // D-050: per-tenant branding. Defaults (see BRAND_DEFAULT) reproduce the original AskERP UI exactly.
  productName: string;       // header wordmark + page titles
  monogram: string;          // letters inside the header mark
  theme: "default" | "navy"; // sets <html data-theme>; "navy" overrides CSS tokens in globals.css (harborline only)
  showFeaturePills: boolean; // "Natural language" / "AI narration" header pills
  showInsightTabs: boolean;  // Change / Contribution tabs
}

const BRAND_DEFAULT = { productName: "AskERP", monogram: "AE", theme: "default" as const, showFeaturePills: true, showInsightTabs: true };

export const TENANTS: Record<string, TenantConfig> = {
  mro: {
    ...BRAND_DEFAULT,
    id: "mro",
    company: "Summit Industrial Supply Co.",
    headerPill: "Summit Industrial Supply Co. ERP",
    searchPlaceholder: "Ask anything about Summit Industrial Supply Co. — revenue, margins, suppliers…",
    analysisLabel: "Analysis · Summit Industrial Supply Co.",
    warehouseLabel: "Summit Industrial Supply Co. warehouse",
    metaDescription: "Conversational analytics for Summit Industrial Supply Co. — ask questions, get answers.",
    llmDescriptor: "Summit Industrial Supply Co., an industrial MRO (maintenance, repair & operations) distributor",
    suggestedQuestions: [
      "What is our total revenue?",
      "What is our current DSO?",
      "Which item category has the best gross margin?",
      "Who are our top 10 suppliers by spend?",
      "Which warehouse has the worst OTIF?",
    ],
  },
  harborline: {
    ...BRAND_DEFAULT,
    productName: "Harborline Analyst", monogram: "HA", theme: "navy", showFeaturePills: false, showInsightTabs: false, // D-050
    id: "harborline",
    company: "Harborline Global Custody",
    headerPill: "Harborline Global Custody",
    searchPlaceholder: "Ask anything about Harborline — settlement, custody, corporate actions, clients…",
    analysisLabel: "Analysis · Harborline Global Custody",
    warehouseLabel: "Harborline Global Custody warehouse",
    metaDescription: "Conversational analytics for Harborline Global Custody — ask questions, get answers.",
    llmDescriptor: "Harborline Global Custody, a global custodian (securities services) that holds about $700B of assets under custody",
    suggestedQuestions: [
      "What is our overall settlement fail rate?",
      "Which counterparties cost us the most in penalties?",
      "Which corporate action elections did we miss?",
      "What is our tax reclaim filed rate by market?",
    ],
  },
  northwind: {
    ...BRAND_DEFAULT,
    id: "northwind",
    company: "Northwind Furniture",
    headerPill: "Northwind Furniture ERP",
    searchPlaceholder: "Ask anything about Northwind Furniture — revenue, margins, customers…",
    analysisLabel: "Analysis · Northwind Furniture",
    warehouseLabel: "Northwind Furniture warehouse",
    metaDescription: "Conversational analytics for Northwind Furniture — ask questions, get answers.",
    llmDescriptor: "Northwind Furniture, a ~$50M B2B furniture company",
    suggestedQuestions: [
      "What was our total revenue in 2024?",
      "Top 5 customers by order count",
      "Cancellation rate by quarter",
      "Outdoor furniture gross margin in 2025",
      "Which customers churned recently?",
    ],
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
