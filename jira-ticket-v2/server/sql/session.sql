-- Persist login sessions so a restart does not log everyone out.
-- Token is stored hashed: the raw value never touches the database.
CREATE TABLE IF NOT EXISTS session (
    token_hash CHAR(64) NOT NULL,
    kind VARCHAR(16) NOT NULL,               -- 'monitoring' | 'admin'
    user_id INT NULL,
    user_json JSON NOT NULL,
    created_at BIGINT NOT NULL,              -- epoch ms, matches Date.now()
    PRIMARY KEY (token_hash),
    KEY idx_session_kind (kind),
    KEY idx_session_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='Login sessions (survive restart)';
