'use strict';

const crypto = require('node:crypto');
const { Pool } = require('pg');

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : false,
    })
  : null;

const mem = { payments: [] };

function memoryAllowed() {
  return process.env.NODE_ENV !== 'production' || process.env.ALLOW_IN_MEMORY_AUTH === 'true';
}

function assertPool() {
  if (!pool && !memoryAllowed()) throw new Error('DATABASE_URL is required for production payment persistence');
  if (!pool) return false;
  return true;
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS payments (
  id                text        PRIMARY KEY,
  paypal_order_id   text        NOT NULL UNIQUE,
  capture_id        text,
  customer_id       text,
  plan              varchar(20) NOT NULL,
  amount            numeric(10, 2) NOT NULL,
  currency          text        NOT NULL DEFAULT 'USD',
  status            text        NOT NULL DEFAULT 'created',
  payer_email       text,
  payer_id          text,
  pass_activated    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  paypal_raw        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  captured_at       timestamptz
);
CREATE INDEX IF NOT EXISTS payments_status_idx      ON payments(status);
CREATE INDEX IF NOT EXISTS payments_plan_idx         ON payments(plan);
CREATE INDEX IF NOT EXISTS payments_customer_idx     ON payments(customer_id);
CREATE INDEX IF NOT EXISTS payments_payer_email_idx  ON payments(payer_email);
CREATE INDEX IF NOT EXISTS payments_captured_at_idx  ON payments(captured_at DESC);
`;

let schemaEnsured = false;

async function ensureSchema() {
  if (!pool) return;
  if (schemaEnsured) return;
  await pool.query(SCHEMA_SQL);
  schemaEnsured = true;
}

function paymentId() {
  return `pay_${crypto.randomBytes(12).toString('hex')}`;
}

function nowIso() {
  return new Date().toISOString();
}

async function recordOrderCreated({ order_id, plan, amount, currency, customer_id }) {
  if (!order_id) throw new Error('recordOrderCreated requires order_id');
  const id = paymentId();
  const row = {
    id,
    paypal_order_id: order_id,
    capture_id: null,
    customer_id: customer_id || null,
    plan,
    amount,
    currency: currency || 'USD',
    status: 'created',
    payer_email: null,
    payer_id: null,
    pass_activated: {},
    paypal_raw: {},
    created_at: nowIso(),
    captured_at: null,
  };

  if (assertPool()) {
    await ensureSchema();
    await pool.query(
      `INSERT INTO payments (id, paypal_order_id, customer_id, plan, amount, currency, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (paypal_order_id) DO NOTHING`,
      [id, order_id, row.customer_id, plan, amount, row.currency, 'created', row.created_at],
    );
  } else if (!mem.payments.some((payment) => payment.paypal_order_id === order_id)) {
    mem.payments.push(row);
  }
  return row;
}

async function recordCapture(payment, { customer_id } = {}) {
  if (!payment || !payment.paypal_order_id) throw new Error('recordCapture requires paypal_order_id');
  const existing = await getByOrderId(payment.paypal_order_id);
  const wasAlreadyCompleted = !!(existing && existing.status === 'completed');
  const id = (existing && existing.id) || paymentId();
  const resolvedCustomerId = customer_id || (existing && existing.customer_id) || null;

  if (assertPool()) {
    await ensureSchema();
    await pool.query(
      `INSERT INTO payments (id, paypal_order_id, capture_id, customer_id, plan, amount, currency, status, payer_email, payer_id, pass_activated, paypal_raw, captured_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (paypal_order_id) DO UPDATE SET
         capture_id = EXCLUDED.capture_id,
         customer_id = COALESCE(payments.customer_id, EXCLUDED.customer_id),
         status = EXCLUDED.status,
         payer_email = EXCLUDED.payer_email,
         payer_id = EXCLUDED.payer_id,
         pass_activated = EXCLUDED.pass_activated,
         paypal_raw = EXCLUDED.paypal_raw,
         captured_at = EXCLUDED.captured_at`,
      [
        id,
        payment.paypal_order_id,
        payment.capture_id || null,
        resolvedCustomerId,
        payment.plan,
        payment.amount,
        payment.currency || 'USD',
        payment.status,
        payment.payer_email || null,
        payment.payer_id || null,
        JSON.stringify(payment.pass_activated || {}),
        JSON.stringify(payment.paypal_raw || {}),
        payment.captured_at || null,
      ],
    );
  } else {
    const idx = mem.payments.findIndex((row) => row.paypal_order_id === payment.paypal_order_id);
    const row = {
      id,
      paypal_order_id: payment.paypal_order_id,
      capture_id: payment.capture_id || null,
      customer_id: resolvedCustomerId,
      plan: payment.plan,
      amount: payment.amount,
      currency: payment.currency || 'USD',
      status: payment.status,
      payer_email: payment.payer_email || null,
      payer_id: payment.payer_id || null,
      pass_activated: payment.pass_activated || {},
      paypal_raw: payment.paypal_raw || {},
      created_at: (existing && existing.created_at) || nowIso(),
      captured_at: payment.captured_at || null,
    };
    if (idx >= 0) mem.payments[idx] = row;
    else mem.payments.push(row);
  }
  return { wasAlreadyCompleted };
}

async function getByOrderId(orderId) {
  if (!orderId) return null;
  if (assertPool()) {
    await ensureSchema();
    const result = await pool.query('SELECT * FROM payments WHERE paypal_order_id=$1', [orderId]);
    return result.rows[0] || null;
  }
  return mem.payments.find((payment) => payment.paypal_order_id === orderId) || null;
}

async function listByCustomer(customerId) {
  if (!customerId) return [];
  if (assertPool()) {
    await ensureSchema();
    const result = await pool.query('SELECT * FROM payments WHERE customer_id=$1 ORDER BY created_at DESC', [customerId]);
    return result.rows;
  }
  return mem.payments
    .filter((payment) => payment.customer_id === customerId)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

function extractIdsFromCaptureEvent(event) {
  const resource = (event && event.resource) || {};
  const orderId = resource?.supplementary_data?.related_ids?.order_id || null;
  const captureId = resource.id || null;
  return { orderId, captureId };
}

module.exports = {
  ensureSchema,
  recordOrderCreated,
  recordCapture,
  getByOrderId,
  listByCustomer,
  extractIdsFromCaptureEvent,
  _mem: mem,
};
