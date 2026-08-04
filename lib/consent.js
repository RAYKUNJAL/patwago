'use strict';

/**
 * lib/consent.js — hard EU/SGI data consent reader for API routes.
 * Copy into each app and adjust COOKIE_NAME / header if needed.
 */

function b64urlToJson(value) {
  try {
    const padded = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(padded, 'base64').toString('utf8');
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function parseCookie(req, name) {
  const raw = String(req.headers?.cookie || '');
  const parts = raw.split(';').map((p) => p.trim());
  for (const part of parts) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    if (part.slice(0, i) === name) {
      return decodeURIComponent(part.slice(i + 1));
    }
  }
  return '';
}

/**
 * @param {import('http').IncomingMessage} req
 * @param {object} [opts]
 * @param {string} [opts.cookieName]
 * @param {string} [opts.headerName]
 */
function readConsent(req, opts = {}) {
  const cookieName = opts.cookieName || process.env.CONSENT_COOKIE_NAME || 'patwago_data_consent';
  const headerName = (opts.headerName || 'x-data-consent').toLowerCase();
  const headerVal = req.headers?.[headerName];
  if (headerVal) {
    const fromHeader = b64urlToJson(headerVal) || (() => {
      try { return JSON.parse(String(headerVal)); } catch { return null; }
    })();
    if (fromHeader && fromHeader.accepted_at) return normalizeConsent(fromHeader);
  }
  const cookieVal = parseCookie(req, cookieName);
  if (cookieVal) {
    try {
      const parsed = cookieVal.startsWith('{') ? JSON.parse(cookieVal) : b64urlToJson(cookieVal);
      if (parsed && parsed.accepted_at) return normalizeConsent(parsed);
    } catch { /* ignore */ }
  }
  return null;
}

function normalizeConsent(raw) {
  const categories = Object.assign({
    essential: true,
    ai_processing: false,
    analytics: false,
    location: false,
    marketing: false,
  }, raw.categories || {});
  categories.essential = true;
  return {
    version: String(raw.version || process.env.CONSENT_POLICY_VERSION || 'sgi-eu-v1'),
    accepted_at: String(raw.accepted_at),
    categories,
    policy_version: String(raw.policy_version || raw.version || 'sgi-eu-v1'),
    source: String(raw.source || 'unknown'),
    anonymous_id: raw.anonymous_id ? String(raw.anonymous_id).slice(0, 120) : null,
  };
}

/**
 * @returns {boolean} true if OK to proceed; false if response already sent
 */
function requireConsent(req, res, categories = ['ai_processing'], sendJson) {
  const send = sendJson || ((r, code, body) => {
    r.statusCode = code;
    r.setHeader('Content-Type', 'application/json; charset=utf-8');
    r.end(JSON.stringify(body));
  });
  const consent = readConsent(req);
  if (!consent) {
    send(res, 403, {
      ok: false,
      code: 'CONSENT_REQUIRED',
      message: 'Data consent is required before using this feature.',
    });
    return false;
  }
  const needed = Array.isArray(categories) ? categories : [categories];
  for (const cat of needed) {
    if (cat === 'essential') continue;
    if (!consent.categories?.[cat]) {
      send(res, 403, {
        ok: false,
        code: 'CONSENT_CATEGORY_REQUIRED',
        message: `Consent category "${cat}" is required.`,
        category: cat,
      });
      return false;
    }
  }
  req.consent = consent;
  return true;
}

module.exports = { readConsent, requireConsent, normalizeConsent };
