'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function loadFreshPayments() {
  const priorDb = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  delete require.cache[require.resolve('../lib/payments')];
  const mod = require('../lib/payments');
  if (priorDb !== undefined) process.env.DATABASE_URL = priorDb;
  return mod;
}

test('recordOrderCreated stores a created PayPal order', async () => {
  const payments = loadFreshPayments();
  const row = await payments.recordOrderCreated({ order_id: 'ORD-1', plan: 'day', amount: 9.99, currency: 'USD', customer_id: 'cust-1' });
  assert.equal(row.paypal_order_id, 'ORD-1');
  assert.equal(row.plan, 'day');
  assert.equal(row.status, 'created');
  const found = await payments.getByOrderId('ORD-1');
  assert.equal(found.customer_id, 'cust-1');
});

test('recordOrderCreated is idempotent per PayPal order id', async () => {
  const payments = loadFreshPayments();
  await payments.recordOrderCreated({ order_id: 'ORD-2', plan: 'day', amount: 9.99, customer_id: 'cust-1' });
  await payments.recordOrderCreated({ order_id: 'ORD-2', plan: 'trip', amount: 49.99, customer_id: 'cust-2' });
  assert.equal(payments._mem.payments.length, 1);
  assert.equal((await payments.getByOrderId('ORD-2')).plan, 'day');
});

test('recordCapture upserts capture data and reports completion idempotency', async () => {
  const payments = loadFreshPayments();
  await payments.recordOrderCreated({ order_id: 'ORD-3', plan: 'week', amount: 29.99, customer_id: 'cust-3' });
  const first = await payments.recordCapture({
    paypal_order_id: 'ORD-3',
    capture_id: 'CAP-3',
    plan: 'week',
    amount: 29.99,
    currency: 'USD',
    status: 'completed',
    payer_email: 'buyer@example.com',
    payer_id: 'PAYER-3',
    captured_at: '2026-08-03T00:00:00.000Z',
    pass_activated: { activated: true, plan: 'week' },
    paypal_raw: { id: 'ORD-3' },
  });
  assert.equal(first.wasAlreadyCompleted, false);
  const row = await payments.getByOrderId('ORD-3');
  assert.equal(row.status, 'completed');
  assert.equal(row.capture_id, 'CAP-3');
  const second = await payments.recordCapture({ ...row, paypal_order_id: 'ORD-3', status: 'completed' }, { customer_id: 'cust-3' });
  assert.equal(second.wasAlreadyCompleted, true);
});

test('listByCustomer returns only that customer newest first', async () => {
  const payments = loadFreshPayments();
  await payments.recordOrderCreated({ order_id: 'ORD-A', plan: 'day', amount: 9.99, customer_id: 'cust-a' });
  await payments.recordOrderCreated({ order_id: 'ORD-B', plan: 'trip', amount: 49.99, customer_id: 'cust-b' });
  await payments.recordOrderCreated({ order_id: 'ORD-C', plan: 'week', amount: 29.99, customer_id: 'cust-a' });
  const rows = await payments.listByCustomer('cust-a');
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => row.customer_id), ['cust-a', 'cust-a']);
});

test('extractIdsFromCaptureEvent returns order and capture ids', () => {
  const payments = loadFreshPayments();
  const ids = payments.extractIdsFromCaptureEvent({
    resource: {
      id: 'CAP-123',
      supplementary_data: { related_ids: { order_id: 'ORD-123' } },
    },
  });
  assert.deepEqual(ids, { orderId: 'ORD-123', captureId: 'CAP-123' });
});

test('extractIdsFromCaptureEvent handles malformed input', () => {
  const payments = loadFreshPayments();
  assert.deepEqual(payments.extractIdsFromCaptureEvent(null), { orderId: null, captureId: null });
});
