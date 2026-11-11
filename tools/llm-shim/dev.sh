#!/bin/sh
# Local test server: app -> shim -> `claude -p` (subscription). No Anthropic API key, no MotherDuck, no trace writes.
cd "$(dirname "$0")/../.." || exit 1
ANTHROPIC_BASE_URL=http://127.0.0.1:${SHIM_PORT:-8787} ANTHROPIC_API_KEY=shim-not-a-real-key \
TRACING_ENABLED=false MOTHERDUCK_TOKEN= ACTIVE_TENANT=harborline \
exec npx next dev -p ${APP_PORT:-3101}
