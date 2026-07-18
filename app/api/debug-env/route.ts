import { NextResponse } from "next/server";

// TEMPORARY — D-037 deploy diagnostics. Booleans and non-secret config only,
// never a token value. Delete once the MOTHERDUCK_TOKEN visibility issue is resolved.
// force-dynamic: this route has no request-derived data, so Next.js statically
// optimized (and Vercel's edge cached) it — every hit was serving a frozen
// response from first build instead of re-reading process.env per request.
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    motherduck_token_present: Boolean(process.env.MOTHERDUCK_TOKEN),
    motherduck_token_length: process.env.MOTHERDUCK_TOKEN?.length ?? 0,
    active_tenant: process.env.ACTIVE_TENANT ?? null,
    retrieval_mode: process.env.RETRIEVAL_MODE ?? null,
    use_retrieval: process.env.USE_RETRIEVAL ?? null,
    vercel_env: process.env.VERCEL_ENV ?? null,
    vercel_git_commit_sha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
  });
}
