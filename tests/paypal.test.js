'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const { createPayPalService, PLAN_PRICES } = require('../lib/paypal');

// ---------- helpers -------------------------------------------------

/**
 * Build a controllable fetch that records every call and returns scripted
 * responses based on URL substring matching.  Each script entry is either a
 * Response-like object { status, headers, body } or a function (url, init) => ...
 *
 * @param {Array<[string|RegExp, object|Function]>} scripts
 * @param {Array} calls  array to push call records onto
 */
function mockFetch(scripts, calls) {
  return async (url, init) => {
    const method = (init && init.method) || 'GET';
    calls.push({ url: String(url), method, init });
    for (const [matcher, responder] of scripts) {
      if (typeof matcher === 'string' ? String(url).includes(matcher) : matcher.test(String(url))) {
        const res = typeof responder === 'function' ? responder(url, init) : responder;
        return new Response(res.body, {
          status: res.status || 200,
          headers: res.headers || { 'Content-Type': 'application/json' },
        });
      }
    }
    throw new Error(`mockFetch: no script matched ${url}`);
  };
}

function baseEnv() {
  return {
    PAYPAL_CLIENT_ID: 'test-client-id',
    PAYPAL_CLIENT_SECRET: 'test-client-secret',
    PAYPAL_WEBHOOK_ID: 'WH-TEST-123',
    PAYPAL_API_BASE: 'https://api-m.sandbox.paypal.com',
    NODE_ENV: 'test',
  };
}

function pp(code) {
  return { status: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(code) };
}

// ---------- 1. server-authoritative prices --------------------------

test('PLAN_PRICES is the single source of truth and never trusts client amount', () => {
  assert.equal(PLAN_PRICES.day, 9.99);
  assert.equal(PLAN_PRICES.week, 29.99);
  assert.equal(PLAN_PRICES.trip, 29.99);
  assert.equal(Object.keys(PLAN_PRICES).length, 3);
});

test('createOrder supports the week pass at server price', async () => {
  const calls = [];
  const fetch = mockFetch([
    ['/oauth2/token', pp({ access_token: 'tok-week', expires_in: 3200, token_type: 'Bearer' })],
    ['/v2/checkout/orders', pp({ id: 'PAYPAL-WEEK-1', status: 'CREATED', links: [{ rel: 'approve', href: 'https://paypal.com/approve/week' }] })],
  ], calls);
  const svc = createPayPalService({ env: baseEnv(), fetch });
  const order = await svc.createOrder({ plan: 'week', amount: 0.01 });
  assert.equal(order.plan, 'week');
  assert.equal(order.amount, 29.99);
  const sentBody = JSON.parse(calls.find((c) => c.url.includes('/v2/checkout/orders')).init.body);
  assert.equal(sentBody.purchase_units[0].amount.value, '29.99');
});

test('createOrder ignores client amount and uses server plan price', async () => {
  const calls = [];
  const fetch = mockFetch([
    ['/oauth2/token', pp({ access_token: 'tok-1', expires_in: 3200, token_type: 'Bearer' })],
    ['/v2/checkout/orders', pp({
      id: 'PAYPAL-ORD-1',
      status: 'CREATED',
      links: [{ rel: 'approve', href: 'https://paypal.com/approve/1' }],
    })],
  ], calls);

  const env = baseEnv();
  const svc = createPayPalService({ env, fetch });

  const order = await svc.createOrder({ plan: 'day', amount: 999.99, description: 'Day Pass' });

  assert.equal(order.order_id, 'PAYPAL-ORD-1');
  assert.equal(order.amount, 9.99, 'amount must come from PLAN_PRICES, not client');
  assert.equal(order.plan, 'day');
  assert.match(order.approval_url, /^https:\/\//);

  // verify the PayPal order body was built with server price
  const createCall = calls.find((c) => c.url.includes('/v2/checkout/orders'));
  const sentBody = JSON.parse(createCall.init.body);
  assert.equal(sentBody.purchase_units[0].amount.value, '9.99');
  assert.equal(sentBody.intent, 'CAPTURE');
});

test('createOrder rejects unknown plan', async () => {
  const svc = createPayPalService({ env: baseEnv(), fetch: mockFetch([], []) });
  await assert.rejects(() => svc.createOrder({ plan: 'year', amount: 5 }), /unknown plan/i);
});

test('createOrder rejects missing plan', async () => {
  const svc = createPayPalService({ env: baseEnv(), fetch: mockFetch([], []) });
  await assert.rejects(() => svc.createOrder({ amount: 5 }), /plan/i);
});

// ---------- 2. OAuth -------------------------------------------------

test('OAuth token is requested with client-credentials grant and cached', async () => {
  const calls = [];
  const fetch = mockFetch([
    ['/oauth2/token', (url, init) => {
      const auth = init.headers['Authorization'] || init.headers.authorization;
      assert.ok(auth, 'Basic auth header present');
      const body = Buffer.from(auth.replace(/^Basic /, ''), 'base64').toString();
      assert.equal(body, 'test-client-id:test-client-secret');
      assert.match(init.body, /grant_type=client_credentials/);
      return pp({ access_token: 'tok-cached', expires_in: 3200, token_type: 'Bearer' });
    }],
    ['/v2/checkout/orders', pp({ id: 'O1', status: 'CREATED', links: [{ rel: 'approve', href: 'https://x' }] })],
  ], calls);

  const svc = createPayPalService({ env: baseEnv(), fetch });
  await svc.createOrder({ plan: 'day' });
  await svc.createOrder({ plan: 'trip' });

  const tokenCalls = calls.filter((c) => c.url.includes('/oauth2/token'));
  assert.equal(tokenCalls.length, 1, 'token cached across calls');
  assert.equal(svc.getCachedToken(), 'tok-cached');
});

test('expired token is re-fetched', async () => {
  const calls = [];
  let tok = 0;
  const fetch = mockFetch([
    ['/oauth2/token', () => pp({ access_token: `tok-${++tok}`, expires_in: 0, token_type: 'Bearer' })],
    ['/v2/checkout/orders', pp({ id: 'O', status: 'CREATED', links: [{ rel: 'approve', href: 'https://x' }] })],
  ], calls);

  const svc = createPayPalService({ env: baseEnv(), fetch, tokenTtlMs: 0 });
  await svc.createOrder({ plan: 'day' });
  await svc.createOrder({ plan: 'trip' });

  const tokenCalls = calls.filter((c) => c.url.includes('/oauth2/token'));
  assert.equal(tokenCalls.length, 2, 'expired token re-fetched');
});

// ---------- 3. capture order --------------------------------------

test('captureOrder returns completed payment contract with server amount', async () => {
  const calls = [];
  const fetch = mockFetch([
    ['/oauth2/token', pp({ access_token: 'tok-c', expires_in: 3200, token_type: 'Bearer' })],
    ['/capture', pp({
      id: 'PAYPAL-CAP-1',
      status: 'COMPLETED',
      payer: { email_address: 'buyer@example.com', payer_id: 'PAYER-1' },
      purchase_units: [{
        reference_id: 'day',
        payments: { captures: [{ id: 'CAP-1', amount: { value: '9.99', currency_code: 'USD' } }] },
      }],
    })],
  ], calls);

  const svc = createPayPalService({ env: baseEnv(), fetch });
  const result = await svc.captureOrder('PAYPAL-ORD-1');

  assert.equal(result.status, 'completed');
  assert.equal(result.paypal_order_id, 'PAYPAL-ORD-1');
  assert.equal(result.plan, 'day');
  assert.equal(result.amount, 9.99);
  assert.equal(result.currency, 'USD');
  assert.equal(result.capture_id, 'CAP-1');
  assert.equal(result.payer_email, 'buyer@example.com');
  assert.equal(result.payer_id, 'PAYER-1');
  assert.equal(typeof result.captured_at, 'string');
  assert.ok(result.captured_at.length > 0);
  assert.ok(Array.isArray(result.pass_activated) || result.pass_activated === true || typeof result.pass_activated === 'object',
    'pass activation output present');

  const captureCall = calls.find((c) => c.url.includes('/capture'));
  assert.match(captureCall.init.method, /POST/);
  assert.match(captureCall.init.headers.Authorization, /Bearer tok-c/);
});

test('captureOrder with non-completed status returns capture payload with status', async () => {
  const fetch = mockFetch([
    ['/oauth2/token', pp({ access_token: 'tok-c', expires_in: 3200, token_type: 'Bearer' })],
    ['/capture', pp({ id: 'CAP-1', status: 'PENDING', purchase_units: [{ payments: { captures: [{ id: 'CAP-1', amount: { value: '29.99' } }] }, reference_id: 'trip' }] })],
  ], []);

  const svc = createPayPalService({ env: baseEnv(), fetch });
  const result = await svc.captureOrder('ORD-1');

  assert.equal(result.status, 'pending');
  assert.equal(result.amount, 29.99);
  assert.equal(result.plan, 'trip');
});

test('captureOrder maps purchase_units[0].reference_id to plan; falls back to trip', async () => {
  const fetch = mockFetch([
    ['/oauth2/token', pp({ access_token: 'tok-c', expires_in: 3200, token_type: 'Bearer' })],
    ['/capture', pp({ id: 'CAP-1', status: 'COMPLETED', purchase_units: [{ payments: { captures: [{ id: 'CAP-1', amount: { value: '29.99', currency_code: 'USD' } }] }, reference_id: 'trip' }], payer: {} })],
  ], []);

  const svc = createPayPalService({ env: baseEnv(), fetch });
  const result = await svc.captureOrder('ORD-1');

  assert.equal(result.plan, 'trip');
  assert.equal(result.amount, 29.99);
  assert.equal(result.status, 'completed');
});

test('captureOrder rejects if PayPal capture call returns error status', async () => {
  const fetch = mockFetch([
    ['/oauth2/token', pp({ access_token: 'tok-c', expires_in: 3200, token_type: 'Bearer' })],
    ['/capture', { status: 404, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'RESOURCE_NOT_FOUND', message: 'order not found' }) }],
  ], []);

  const svc = createPayPalService({ env: baseEnv(), fetch });
  await assert.rejects(() => svc.captureOrder('BAD-ORD'), /RESOURCE_NOT_FOUND|not found|404/i);
});

// ---------- 4. webhook signature verification ----------------------

test('verifyWebhook returns false when WEBHOOK_ID missing (fail closed)', async () => {
  const env = baseEnv();
  delete env.PAYPAL_WEBHOOK_ID;
  const svc = createPayPalService({ env, fetch: mockFetch([], []) });
  const result = await svc.verifyWebhook({ headers: {}, body: '{}' });
  assert.equal(result.verified, false);
  assert.match(result.reason, /webhook/i);
});

test('verifyWebhook calls PayPal verify endpoint and returns verified true on VERIFIED', async () => {
  const calls = [];
  const fetch = mockFetch([
    ['/oauth2/token', pp({ access_token: 'tok-w', expires_in: 3200, token_type: 'Bearer' })],
    ['/v1/notifications/verify-webhook-signature', (url, init) => {
      const body = JSON.parse(init.body);
      assert.equal(body.transmission_id, 'TID-1');
      assert.equal(body.transmission_time, '2026-01-01T00:00:00Z');
      assert.equal(body.cert_url, 'https://cert');
      assert.equal(body.auth_algo, 'SHA256withRSA');
      assert.equal(body.transmission_signature, 'SIG-1');
      assert.deepEqual(body.webhook_id, 'WH-TEST-123');
      return pp({ verification_status: 'SUCCESS' });
    }],
  ], calls);

  const svc = createPayPalService({ env: baseEnv(), fetch });
  const result = await svc.verifyWebhook({
    headers: {
      'paypal-transmission-id': 'TID-1',
      'paypal-transmission-time': '2026-01-01T00:00:00Z',
      'paypal-cert-url': 'https://cert',
      'paypal-auth-algo': 'SHA256withRSA',
      'paypal-transmission-signature': 'SIG-1',
    },
    body: JSON.stringify({ event_type: 'PAYMENT.CAPTURE.COMPLETED' }),
  });

  assert.equal(result.verified, true);
  assert.equal(calls.filter((c) => c.url.includes('verify-webhook-signature')).length, 1);
});

test('verifyWebhook returns false when PayPal responds FAILURE', async () => {
  const fetch = mockFetch([
    ['/oauth2/token', pp({ access_token: 'tok-w', expires_in: 3200, token_type: 'Bearer' })],
    ['/v1/notifications/verify-webhook-signature', pp({ verification_status: 'FAILURE' })],
  ], []);

  const svc = createPayPalService({ env: baseEnv(), fetch });
  const result = await svc.verifyWebhook({
    headers: {
      'paypal-transmission-id': 'TID-1',
      'paypal-transmission-time': 'T1',
      'paypal-cert-url': 'https://cert',
      'paypal-auth-algo': 'SHA256withRSA',
      'paypal-transmission-signature': 'SIG-1',
    },
    body: '{}',
  });

  assert.equal(result.verified, false);
  assert.match(result.reason, /fail/i);
});

test('verifyWebhook fails closed when required headers missing', async () => {
  const svc = createPayPalService({ env: baseEnv(), fetch: mockFetch([], []) });
  const result = await svc.verifyWebhook({ headers: {}, body: '{}' });
  assert.equal(result.verified, false);
  assert.match(result.reason, /header/i);
});

test('verifyWebhook helper returns parsed event on success', async () => {
  const eventPayload = { id: 'WH-EVT-1', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'CAP-1' } };
  const fetch = mockFetch([
    ['/oauth2/token', pp({ access_token: 'tok-w', expires_in: 3200, token_type: 'Bearer' })],
    ['/v1/notifications/verify-webhook-signature', pp({ verification_status: 'SUCCESS' })],
  ], []);

  const svc = createPayPalService({ env: baseEnv(), fetch });
  const { verified, event } = await svc.verifyWebhook({
    headers: {
      'paypal-transmission-id': 'TID-1',
      'paypal-transmission-time': 'T1',
      'paypal-cert-url': 'https://cert',
      'paypal-auth-algo': 'SHA256withRSA',
      'paypal-transmission-signature': 'SIG-1',
    },
    body: JSON.stringify(eventPayload),
  });

  assert.equal(verified, true);
  assert.equal(event.id, 'WH-EVT-1');
  assert.equal(event.event_type, 'PAYMENT.CAPTURE.COMPLETED');
});

// ---------- 5. fail-closed when creds missing ---------------------

test('createPayPalService throws / disabled when client id missing', () => {
  const env = baseEnv();
  delete env.PAYPAL_CLIENT_ID;
  assert.throws(() => createPayPalService({ env, fetch: mockFetch([], []) }), /client.id|client_id|PAYPAL_CLIENT_ID/i);
});

test('createPayPalService throws when client secret missing', () => {
  const env = baseEnv();
  delete env.PAYPAL_CLIENT_SECRET;
  assert.throws(() => createPayPalService({ env, fetch: mockFetch([], []) }), /client.secret|client_secret|PAYPAL_CLIENT_SECRET/i);
});

test('createPayPalService throws when api base missing', () => {
  const env = baseEnv();
  delete env.PAYPAL_API_BASE;
  assert.throws(() => createPayPalService({ env, fetch: mockFetch([], []) }), /api.base|api_base|PAYPAL_API_BASE/i);
});

test('createPayPalService throws when api base is not https in production', () => {
  const env = baseEnv();
  env.PAYPAL_API_BASE = 'http://insecure.example.com';
  env.NODE_ENV = 'production';
  assert.throws(() => createPayPalService({ env, fetch: mockFetch([], []) }), /https/i);
});

test('sandbox http api base is allowed in non-production (test/dev)', () => {
  const env = baseEnv();
  env.PAYPAL_API_BASE = 'http://localhost:9000';
  env.NODE_ENV = 'test';
  // should NOT throw
  const svc = createPayPalService({ env, fetch: mockFetch([], []) });
  assert.ok(svc);
});

// ---------- 6. completed payment record contract -------------------

test('completed payment record has all required contract fields', async () => {
  const fetch = mockFetch([
    ['/oauth2/token', pp({ access_token: 'tok-c', expires_in: 3200, token_type: 'Bearer' })],
    ['/capture', pp({
      id: 'CAP-2', status: 'COMPLETED',
      purchase_units: [{ payments: { captures: [{ id: 'CAP-2', amount: { value: '29.99', currency_code: 'USD' } }] }, reference_id: 'trip' }],
      payer: { email_address: 'x@y.com', payer_id: 'PID-1' },
    })],
  ], []);

  const svc = createPayPalService({ env: baseEnv(), fetch });
  const record = await svc.captureOrder('ORD-CONTRACT');

  const required = ['status', 'paypal_order_id', 'plan', 'amount', 'currency', 'capture_id', 'payer_email', 'payer_id', 'captured_at', 'pass_activated'];
  for (const field of required) {
    assert.ok(field in record, `record must have field: ${field}`);
  }
  assert.equal(record.status, 'completed');
  assert.equal(record.plan, 'trip');
  assert.equal(record.amount, 29.99);
  assert.equal(record.currency, 'USD');
  assert.equal(record.capture_id, 'CAP-2');
  assert.equal(record.paypal_email || record.payer_email, 'x@y.com');
});

// ---------- 7. createOrder full output contract --------------------

test('createOrder returns approval_url, order_id, amount, plan, environment', async () => {
  const fetch = mockFetch([
    ['/oauth2/token', pp({ access_token: 'tok', expires_in: 3200, token_type: 'Bearer' })],
    ['/v2/checkout/orders', pp({
      id: 'ORD-FULL', status: 'CREATED',
      links: [{ rel: 'approve', href: 'https://sandbox.paypal.com/authorize?token=ORD-FULL' }],
    })],
  ], []);

  const env = baseEnv();
  const svc = createPayPalService({ env, fetch });
  const order = await svc.createOrder({ plan: 'day' });

  assert.equal(order.order_id, 'ORD-FULL');
  assert.equal(order.plan, 'day');
  assert.equal(order.amount, 9.99);
  assert.equal(order.currency, 'USD');
  assert.equal(order.status, 'created');
  assert.match(order.approval_url, /^https:\/\//);
  assert.ok(['sandbox', 'live', 'production'].includes(order.environment) || typeof order.environment === 'string');
});

// ---------- 8. pass activation output ------------------------------

test('captureOrder pass_activated signals activation with plan and pass_type', async () => {
  const fetch = mockFetch([
    ['/oauth2/token', pp({ access_token: 'tok', expires_in: 3200, token_type: 'Bearer' })],
    ['/capture', pp({
      id: 'CAP-A', status: 'COMPLETED',
      purchase_units: [{ payments: { captures: [{ id: 'CAP-A', amount: { value: '9.99', currency_code: 'USD' } }] }, reference_id: 'day' }],
      payer: { email_address: 'a@b.com', payer_id: 'P1' },
    })],
  ], []);

  const svc = createPayPalService({ env: baseEnv(), fetch });
  const result = await svc.captureOrder('ORD-A');

  assert.ok(result.pass_activated, 'pass_activated is truthy');
  if (typeof result.pass_activated === 'object') {
    assert.equal(result.pass_activated.plan, 'day');
    assert.ok(['day_pass', 'day', 'week_pass', 'week', 'trip_pass', 'trip'].includes(result.pass_activated.pass_type));
  }
});

// ---------- 9. regression: client amount never overrides server price ----------

test('client-supplied amount of 0.01 still charges full plan price', async () => {
  const calls = [];
  const fetch = mockFetch([
    ['/oauth2/token', pp({ access_token: 'tok', expires_in: 3200, token_type: 'Bearer' })],
    ['/v2/checkout/orders', pp({ id: 'ORD', status: 'CREATED', links: [{ rel: 'approve', href: 'https://x' }] })],
  ], calls);

  const svc = createPayPalService({ env: baseEnv(), fetch });
  const order = await svc.createOrder({ plan: 'trip', amount: 0.01 });
  assert.equal(order.amount, 29.99, 'server price enforced');

  const sent = JSON.parse(calls.find((c) => c.url.includes('/v2/checkout/orders')).init.body);
  assert.equal(sent.purchase_units[0].amount.value, '29.99');
});
