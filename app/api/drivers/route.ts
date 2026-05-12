import { NextRequest, NextResponse } from "next/server";
import { runDrivers } from "@/lib/driversAgent";

export async function POST(req: NextRequest) {
  let body: { original_sql?: string; metric_used?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { original_sql, metric_used } = body;
  if (!original_sql) {
    return NextResponse.json({ error: "original_sql is required" }, { status: 400 });
  }

  try {
    const drivers = await runDrivers(original_sql, metric_used ?? null);
    return NextResponse.json({ drivers, error: null });
  } catch (err) {
    return NextResponse.json({
      drivers: [],
      error: err instanceof Error ? err.message : String(err),
    }, { status: 500 });
  }
}
