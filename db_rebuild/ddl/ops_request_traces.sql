-- D-043: production request traces. `ops` is NOT a tenant schema.
CREATE SCHEMA IF NOT EXISTS ops;
CREATE TABLE IF NOT EXISTS ops.request_traces (
  trace_id UUID,
  created_at TIMESTAMP,
  tenant VARCHAR,
  question VARCHAR,
  retrieval_mode VARCHAR,
  retrieval_k INTEGER,
  expand_tables BOOLEAN,
  chunk_ids VARCHAR,            -- JSON array string
  chunks_returned INTEGER,
  retrieval_ms INTEGER,
  sql_generated VARCHAR,
  model VARCHAR,
  tokens_in INTEGER,            -- SQL generation incl. retries
  tokens_out INTEGER,
  sqlgen_ms INTEGER,
  validation_passed BOOLEAN,
  limit_added BOOLEAN,
  retry_count INTEGER,
  error_type VARCHAR,           -- parser_error|binder_error|timeout|refusal|out_of_scope|permission|other|NULL
  error_message VARCHAR,
  rows_returned INTEGER,
  exec_ms INTEGER,
  narration_tokens_in INTEGER,
  narration_tokens_out INTEGER,
  narrate_ms INTEGER,
  total_ms INTEGER,
  estimated_cost_usd DOUBLE,
  success BOOLEAN
);
