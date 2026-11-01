-- Claude API usage, recorded by the app after each AI request (all PCs add
-- to the same rows). An estimate for the user; the bill is in the Claude
-- Console.

CREATE TABLE ai_usage (
  day                TEXT    NOT NULL,  -- YYYY-MM-DD (UTC)
  model              TEXT    NOT NULL,  -- the model that answered (may be a fallback)
  requests           INTEGER NOT NULL DEFAULT 0,
  input_tokens       INTEGER NOT NULL DEFAULT 0,
  output_tokens      INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens  INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, model)
);
