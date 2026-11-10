// Shared cost estimation (D-043). Extracted from benchmark/run_benchmark.ts so the harness
// and production tracing use ONE price table. $/token [in, out].
export const DEFAULT_PRICE_MODEL = "claude-haiku-4-5-20251001";
export const PRICES: Record<string, [number, number]> = {
  "claude-haiku-4-5-20251001": [1.0 / 1e6, 5.0 / 1e6],
  "claude-sonnet-4-5": [3.0 / 1e6, 15.0 / 1e6],
};
export function priceFor(model: string): [number, number] {
  const p = PRICES[model];
  if (!p) { console.warn(`WARN: no price entry for ${model}; using Haiku rates for cost estimates`); return PRICES[DEFAULT_PRICE_MODEL]; }
  return p;
}
export function estimateCostUsd(model: string, tokensIn: number, tokensOut: number): number {
  const [pi, po] = priceFor(model);
  return tokensIn * pi + tokensOut * po;
}
