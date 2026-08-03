-- 003_payments.sql
-- Completed PayPal payment records for PatWaGo passes.
--
-- Server-authoritative pricing lives in lib/paypal.js (PLAN_PRICES).
-- The amount stored here always comes from the server price table, never from
-- the client.  The paypal_order_id / capture_id pair provides idempotency and
-- audit linkage back to PayPal.

CREATE TABLE IF NOT EXISTS payments (
  id                text        PRIMARY KEY,
  paypal_order_id   text        NOT NULL UNIQUE,
  capture_id        text,
  customer_id       text,
  plan              varchar(20) NOT NULL,
  amount            numeric(10, 2) NOT NULL,
  currency          text        NOT NULL DEFAULT 'USD',
  status            text        NOT NULL DEFAULT 'created'
                      CHECK (status IN ('created', 'approved', 'completed', 'pending', 'failed', 'refunded')),
  payer_email       text,
  payer_id          text,
  pass_activated    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  paypal_raw        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  captured_at       timestamptz
);

-- Indexes for common query patterns.
CREATE INDEX IF NOT EXISTS payments_status_idx     ON payments(status);
CREATE INDEX IF NOT EXISTS payments_plan_idx        ON payments(plan);
CREATE INDEX IF NOT EXISTS payments_customer_idx    ON payments(customer_id);
CREATE INDEX IF NOT EXISTS payments_payer_email_idx ON payments(payer_email);
CREATE INDEX IF NOT EXISTS payments_captured_at_idx  ON payments(captured_at DESC);

-- Idempotency: a PayPal order can only have one completed payment row.
-- The UNIQUE constraint on paypal_order_id already enforces that at insert
-- time; this partial index additionally prevents duplicate completions when
-- using upsert patterns.
CREATE UNIQUE INDEX IF NOT EXISTS payments_paypal_order_completed_uq
  ON payments(paypal_order_id)
  WHERE status = 'completed';
