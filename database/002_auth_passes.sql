-- PatWaGo customer auth, session, and pass schema.
-- Companion to lib/auth.js. Safe to run multiple times (IF NOT EXISTS).

CREATE TABLE IF NOT EXISTS auth_customers (
  id text PRIMARY KEY,
  email varchar(254) UNIQUE NOT NULL,
  name varchar(120) NOT NULL DEFAULT '',
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_customers_email_idx ON auth_customers(email);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token varchar(80) PRIMARY KEY,
  customer_id text NOT NULL REFERENCES auth_customers(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_sessions_customer_idx ON auth_sessions(customer_id);
CREATE INDEX IF NOT EXISTS auth_sessions_expires_idx ON auth_sessions(expires_at);

CREATE TABLE IF NOT EXISTS auth_passes (
  id text PRIMARY KEY,
  customer_id text NOT NULL REFERENCES auth_customers(id) ON DELETE CASCADE,
  plan varchar(20) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_passes_customer_idx ON auth_passes(customer_id);
CREATE INDEX IF NOT EXISTS auth_passes_status_idx ON auth_passes(status);
