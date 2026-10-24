CREATE TABLE IF NOT EXISTS teachers (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS auth_sessions (
  sid TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_sessions_expiry ON auth_sessions(expires_at);
CREATE TABLE IF NOT EXISTS quizzes (
  id UUID PRIMARY KEY,
  owner_id UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  questions JSONB NOT NULL DEFAULT '[]',
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS quizzes_owner ON quizzes(owner_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS game_sessions (
  pin TEXT PRIMARY KEY,
  host_id UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  quiz_id UUID REFERENCES quizzes(id) ON DELETE SET NULL,
  snapshot JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS games_expiry ON game_sessions(expires_at);
