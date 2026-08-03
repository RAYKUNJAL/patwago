'use strict';

/**
 * lib/paypal.js — Real PayPal payment service for PatWaGo.
 *
 * Security model
 *   - Prices are server-authoritative: PLAN_PRICES is the single source of
 *     truth.  Any client-supplied `amount` is ignored.
 *   - PayPal OAuth2 client-credentials token is fetched and cached with a
 *     short safety margin before expiry.
 *   - Order creation and capture use the cached bearer token.
 *   - Webhook signature verification calls PayPal's verify-webhook-signature
 *     endpoint; if WEBHOOK_ID is missing the service fails closed.
 *   - Production requires HTTPS API base and all credentials present.
 *
 * Tests inject a controllable `fetch` so no real network calls are made.
 */

const crypto = require('node:crypto');

/**
 * Server-authoritative plan prices (USD).  Never trust client amounts.
 * @readonly
 */
const PLAN_PRICES = Object.freeze({
  day: 9.99,
  trip: 29.99,
});

const CURRENCY = 'USD';

const PLAN_DESCRIPTIONS = Object.freeze({
  day: 'PatWaGo Day Pass — 24 hours of Jamaica travel companion',
  trip: 'PatWaGo Trip Pass — full trip coverage',
});

// ------------------------------------------------------------------
// environment helpers
// ------------------------------------------------------------------

function getEnv(env, key) {
  return (env && (env[key] || env[key.toLowerCase()])) || process.env[key] || undefined;
}

function requireEnv(env, key, label) {
  const v = getEnv(env, key);
  if (!v || !String(v).trim()) {
    throw new Error(`PayPal service requires ${label || key} — set ${key}`);
  }
  return String(v).trim();
}

/**
 * Factory for a PayPal service instance.
 *
 * @param {object}  opts
 * @param {object}  opts.env      Environment-like object (defaults to process.env).
 * @param {Function} [opts.fetch] Injectable fetch (defaults to global fetch).
 * @param {number}  [opts.tokenTtlMs] Override token lifetime for testing.
 */
function createPayPalService(opts) {
  const env = (opts && opts.env) || process.env;
  const fetchImpl = (opts && opts.fetch) || globalThis.fetch;
  const tokenTtlOverride = opts && typeof opts.tokenTtlMs === 'number' ? opts.tokenTtlMs : null;

  // Fail-closed credential checks -----------------------------------
  const clientId = requireEnv(env, 'PAYPAL_CLIENT_ID', 'PayPal client id');
  const clientSecret = requireEnv(env, 'PAYPAL_CLIENT_SECRET', 'PayPal client secret');
  const apiBase = requireEnv(env, 'PAYPAL_API_BASE', 'PayPal API base URL');
  const webhookId = getEnv(env, 'PAYPAL_WEBHOOK_ID');
  const nodeEnv = getEnv(env, 'NODE_ENV') || 'development';

  // In production, the API base must be HTTPS.
  if (nodeEnv === 'production' && !/^https:\/\//i.test(apiBase)) {
    throw new Error('PayPal API base URL must use HTTPS in production');
  }

  // Token cache -----------------------------------------------------
  let cachedToken = null;
  let cachedTokenExpiry = 0; // epoch ms

  function tokenExpired() {
    return Date.now() >= cachedTokenExpiry;
  }

  async function getToken() {
    if (cachedToken && !tokenExpired()) return cachedToken;
    const token = await fetchAccessToken();
    cachedToken = token.access_token;
    // Expire 60s early as a safety margin (unless overridden for tests).
    const ttlMs = tokenTtlOverride !== null ? tokenTtlOverride : (token.expires_in - 60) * 1000;
    cachedTokenExpiry = Date.now() + Math.max(ttlMs, 0);
    return cachedToken;
  }

  async function fetchAccessToken() {
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const url = `${apiBase}/v1/oauth2/token`;
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) {
      const text = await safeText(res);
      throw new Error(`PayPal OAuth failed (${res.status}): ${text}`);
    }
    const data = await res.json();
    if (!data.access_token) {
      throw new Error('PayPal OAuth response missing access_token');
    }
    return data;
  }

  // HTTP helpers ----------------------------------------------------

  async function authedJson(url, init) {
    const token = await getToken();
    const headers = Object.assign({}, init.headers || {}, {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    });
    return fetchImpl(url, Object.assign({}, init, { headers }));
  }

  async function safeText(res) {
    try { return await res.text(); } catch { return ''; }
  }

  // ------------------------------------------------------------------
  // createOrder — server-authoritative price
  // ------------------------------------------------------------------

  /**
   * Create a PayPal order.  The amount is ALWAYS taken from PLAN_PRICES;
   * any `amount` in the payload is ignored.
   *
   * @param {object} payload
   * @param {string} payload.plan       'day' or 'trip' (required)
   * @param {string} [payload.description]
   * @param {string} [payload.return_url]
   * @param {string} [payload.cancel_url]
   * @returns {Promise<object>} { order_id, plan, amount, currency, status, approval_url, environment }
   */
  async function createOrder(payload) {
    if (!payload || !payload.plan) {
      throw new Error('createOrder requires a plan');
    }
    const plan = String(payload.plan).trim();
    if (!Object.prototype.hasOwnProperty.call(PLAN_PRICES, plan)) {
      throw new Error(`Unknown plan: ${plan}`);
    }
    const amount = PLAN_PRICES[plan];
    const description = payload.description
      ? String(payload.description)
      : (PLAN_DESCRIPTIONS[plan] || `${plan} pass`);

    const orderBody = {
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: plan,
        description,
        amount: {
          currency_code: CURRENCY,
          value: amount.toFixed(2),
        },
      }],
      application_context: {
        brand_name: 'PatWaGo',
        user_action: 'PAY_NOW',
        shipping_preference: 'NO_SHIPPING',
      },
    };

    if (payload.return_url) orderBody.application_context.return_url = payload.return_url;
    if (payload.cancel_url) orderBody.application_context.cancel_url = payload.cancel_url;

    const url = `${apiBase}/v2/checkout/orders`;
    const res = await authedJson(url, { method: 'POST', body: JSON.stringify(orderBody) });
    if (!res.ok) {
      const text = await safeText(res);
      throw new Error(`PayPal createOrder failed (${res.status}): ${text}`);
    }
    const data = await res.json();

    const approveLink = (data.links || []).find((l) => l.rel === 'approve');
    const approvalUrl = approveLink ? approveLink.href : '';

    return {
      order_id: data.id,
      plan,
      amount,
      currency: CURRENCY,
      status: (data.status || 'CREATED').toLowerCase(),
      approval_url: approvalUrl,
      environment: detectEnvironment(apiBase),
    };
  }

  // ------------------------------------------------------------------
  // captureOrder — capture a previously-created PayPal order
  // ------------------------------------------------------------------

  /**
   * Capture a PayPal order and return a completed payment record.
   *
   * @param {string} orderId PayPal order ID
   * @returns {Promise<object>} Completed payment record:
   *   { status, paypal_order_id, plan, amount, currency, capture_id,
   *     payer_email, payer_id, captured_at, pass_activated, paypal_raw }
   */
  async function captureOrder(orderId) {
    if (!orderId) throw new Error('captureOrder requires an orderId');

    const url = `${apiBase}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`;
    const res = await authedJson(url, { method: 'POST', body: '{}' });
    if (!res.ok) {
      const text = await safeText(res);
      throw new Error(`PayPal captureOrder failed (${res.status}): ${text}`);
    }
    const data = await res.json();

    // Determine the plan from the purchase_units reference_id.
    const unit = (data.purchase_units || [])[0] || {};
    const planRaw = unit.reference_id || 'trip';
    const plan = Object.prototype.hasOwnProperty.call(PLAN_PRICES, planRaw) ? planRaw : 'trip';
    const amount = PLAN_PRICES[plan];

    const capture = (unit.payments && unit.payments.captures && unit.payments.captures[0]) || {};
    const payer = data.payer || {};

    const statusRaw = (data.status || capture.status || 'unknown').toLowerCase();
    const status = statusRaw === 'completed' ? 'completed'
      : statusRaw === 'pending' ? 'pending'
      : statusRaw === 'declined' ? 'failed'
      : statusRaw;

    const record = {
      status,
      paypal_order_id: orderId,
      plan,
      amount,
      currency: (capture.amount && capture.amount.currency_code) || CURRENCY,
      capture_id: capture.id || null,
      payer_email: payer.email_address || null,
      payer_id: payer.payer_id || null,
      captured_at: new Date().toISOString(),
      pass_activated: buildPassActivation(plan, status, capture),
      paypal_raw: data,
    };

    return record;
  }

  // ------------------------------------------------------------------
  // verifyWebhook — PayPal webhook signature verification
  // ------------------------------------------------------------------

  /**
   * Verify a PayPal webhook notification by calling PayPal's
   * verify-webhook-signature endpoint.  Fails closed when WEBHOOK_ID is
   * missing or any required header is absent.
   *
   * @param {object} ctx
   * @param {object} ctx.headers  Incoming request headers (lower-cased keys).
   * @param {string} ctx.body    Raw webhook body string.
   * @returns {Promise<{verified: boolean, reason?: string, event?: object}>}
   */
  async function verifyWebhook(ctx) {
    if (!webhookId) {
      return { verified: false, reason: 'PayPal webhook ID (PAYPAL_WEBHOOK_ID) is not configured' };
    }

    const headers = ctx.headers || {};
    const required = [
      'paypal-transmission-id',
      'paypal-transmission-time',
      'paypal-cert-url',
      'paypal-auth-algo',
      'paypal-transmission-signature',
    ];
    for (const h of required) {
      if (!headers[h]) {
        return { verified: false, reason: `Missing required header: ${h}` };
      }
    }

    const verifyBody = {
      auth_algo: headers['paypal-auth-algo'],
      cert_url: headers['paypal-cert-url'],
      transmission_id: headers['paypal-transmission-id'],
      transmission_signature: headers['paypal-transmission-signature'],
      transmission_sig: headers['paypal-transmission-signature'],
      transmission_time: headers['paypal-transmission-time'],
      webhook_id: webhookId,
      webhook_event: ctx.body ? safeJsonParse(ctx.body) : {},
    };

    const url = `${apiBase}/v1/notifications/verify-webhook-signature`;
    let res;
    try {
      res = await authedJson(url, { method: 'POST', body: JSON.stringify(verifyBody) });
    } catch (err) {
      return { verified: false, reason: `Webhook verification request failed: ${err.message}` };
    }

    if (!res.ok) {
      const text = await safeText(res);
      return { verified: false, reason: `PayPal verify endpoint returned ${res.status}: ${text}` };
    }

    const data = await res.json();
    const status = (data.verification_status || '').toUpperCase();

    if (status === 'SUCCESS') {
      return {
        verified: true,
        event: ctx.body ? safeJsonParse(ctx.body) : null,
      };
    }

    return { verified: false, reason: `PayPal verification status: ${status || 'FAILURE'}` };
  }

  // ------------------------------------------------------------------
  // utilities
  // ------------------------------------------------------------------

  function detectEnvironment(base) {
    if (/sandbox/i.test(base)) return 'sandbox';
    if (/api-m\.paypal\.com/i.test(base)) return 'live';
    return base.includes('localhost') ? 'local' : 'custom';
  }

  function buildPassActivation(plan, status, capture) {
    if (status !== 'completed') return { activated: false, plan };
    return {
      activated: true,
      plan,
      pass_type: plan === 'day' ? 'day_pass' : 'trip_pass',
      capture_id: capture.id || null,
      activated_at: new Date().toISOString(),
    };
  }

  function safeJsonParse(text) {
    try { return JSON.parse(text); } catch { return {}; }
  }

  return {
    PLAN_PRICES,
    createOrder,
    captureOrder,
    verifyWebhook,
    getToken,   // async — fetches/caches if expired
    getCachedToken: () => cachedToken,  // sync peek for tests/introspection
    getTokenInfo: () => ({ token: cachedToken, expiry: cachedTokenExpiry }),
  };
}

module.exports = { createPayPalService, PLAN_PRICES, CURRENCY };
