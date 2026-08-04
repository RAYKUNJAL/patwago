'use strict';

/**
 * lib/appstore.js — StoreKit 2 transaction verification for PatWaGo.
 *
 * When the native iOS app buys a Day/Trip pass, it purchases it as an Apple
 * In-App Purchase (Apple Guideline 3.1.1 requires this for digital
 * features/content unlocked inside the app — see lib/paypal.js, which is
 * refused for iOS-app clients). StoreKit 2 gives the client a signed JWS
 * transaction; this module verifies that JWS server-side before crediting a
 * pass, so a jailbroken/tampered client can't forge a purchase.
 *
 * Verification (per Apple's documented StoreKit 2 JWS format):
 *   1. Parse the compact JWS (header.payload.signature).
 *   2. Read the certificate chain from the header's `x5c` (leaf, then one
 *      or more intermediates — Apple does not include the root).
 *   3. Verify each certificate's validity window and that each was signed
 *      by the next one up the chain, and that the top of the supplied
 *      chain was itself signed by our trusted root CA (configured
 *      out-of-band via APPSTORE_ROOT_CA_PEM — never trust a root shipped
 *      inside the JWS itself).
 *   4. Verify the JWS signature (ES256 / ECDSA P-256) against the leaf
 *      certificate's public key.
 *   5. Check the decoded payload's bundleId, environment, and productId.
 *
 * Fails closed: missing configuration (root CA, bundle id) throws rather
 * than silently accepting unverified transactions.
 */

const crypto = require('node:crypto');

/**
 * Maps App Store Connect product ids to PatWaGo plans. Products should be
 * configured as Non-Renewing Subscriptions (Apple's recommended type for a
 * fixed-duration pass like ours — see lib/auth.js PLAN_DURATIONS_MS), so
 * Apple does not track expiry for us; we apply our own duration on redeem.
 * @readonly
 */
const PRODUCT_TO_PLAN = Object.freeze({
  'com.patwago.pass.day': 'day',
  'com.patwago.pass.trip': 'trip',
});

function getEnv(env, key) {
  return (env && (env[key] || env[key.toLowerCase()])) || process.env[key] || undefined;
}

function requireEnv(env, key, label) {
  const v = getEnv(env, key);
  if (!v || !String(v).trim()) {
    throw new Error(`App Store verification requires ${label || key} — set ${key}`);
  }
  return String(v).trim();
}

function base64UrlDecode(segment) {
  const padded = segment.length % 4 === 0 ? segment : segment + '='.repeat(4 - (segment.length % 4));
  return Buffer.from(padded.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function parseCompactJws(signed) {
  const parts = String(signed || '').split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed signed transaction: expected JWS compact serialization');
  }
  const [headerB64, payloadB64, signatureB64] = parts;
  let header, payload;
  try {
    header = JSON.parse(base64UrlDecode(headerB64).toString('utf8'));
    payload = JSON.parse(base64UrlDecode(payloadB64).toString('utf8'));
  } catch {
    throw new Error('Malformed signed transaction: header/payload is not valid JSON');
  }
  return {
    header,
    payload,
    signature: base64UrlDecode(signatureB64),
    signedData: Buffer.from(`${headerB64}.${payloadB64}`, 'utf8'),
  };
}

function certFromBase64Der(b64) {
  try {
    return new crypto.X509Certificate(Buffer.from(String(b64), 'base64'));
  } catch {
    throw new Error('Malformed certificate in signed transaction chain');
  }
}

/**
 * Verifies the x5c certificate chain leads to `trustedRoot` and every
 * certificate is currently valid. Returns the leaf certificate.
 */
function verifyChain(x5c, trustedRoot, now) {
  if (!Array.isArray(x5c) || x5c.length < 1) {
    throw new Error('Signed transaction is missing its certificate chain (x5c)');
  }
  const certs = x5c.map(certFromBase64Der);

  for (const cert of certs) {
    if (now < new Date(cert.validFrom) || now > new Date(cert.validTo)) {
      throw new Error(`Certificate "${cert.subject}" is not valid at ${now.toISOString()}`);
    }
  }

  for (let i = 0; i < certs.length - 1; i++) {
    if (!certs[i].verify(certs[i + 1].publicKey)) {
      throw new Error('Certificate chain signature verification failed');
    }
  }

  const top = certs[certs.length - 1];
  if (!top.verify(trustedRoot.publicKey)) {
    throw new Error('Certificate chain does not lead to the trusted Apple root CA');
  }

  return certs[0];
}

function verifyJwsSignature(leafCert, signedData, signature) {
  const ok = crypto.verify('sha256', signedData, { key: leafCert.publicKey, dsaEncoding: 'ieee-p1363' }, signature);
  if (!ok) throw new Error('Signed transaction signature verification failed');
}

function loadTrustedRoot(env) {
  const pem = requireEnv(
    env,
    'APPSTORE_ROOT_CA_PEM',
    "Apple's current Root CA (G3) certificate PEM — download and verify the fingerprint from https://www.apple.com/certificateauthority/, do not fetch it automatically",
  );
  try {
    return new crypto.X509Certificate(pem);
  } catch {
    throw new Error('APPSTORE_ROOT_CA_PEM is not a valid PEM certificate');
  }
}

/**
 * Factory for an App Store transaction verifier.
 *
 * @param {object} opts
 * @param {object} [opts.env]             Environment-like object (defaults to process.env).
 * @param {crypto.X509Certificate} [opts.trustedRootCert] Override the trusted root (tests only).
 * @param {Function} [opts.now]           Override the current time (tests only).
 */
function createAppStoreVerifier(opts) {
  const env = (opts && opts.env) || process.env;
  const nodeEnv = getEnv(env, 'NODE_ENV') || 'development';
  const bundleId = requireEnv(env, 'APPSTORE_BUNDLE_ID', 'the iOS app bundle identifier');
  const trustedRoot = (opts && opts.trustedRootCert) || loadTrustedRoot(env);
  const allowedEnvironments = nodeEnv === 'production' ? ['Production'] : ['Production', 'Sandbox'];
  const now = (opts && opts.now) || (() => new Date());

  function verifyTransaction(signedTransactionInfo) {
    const { header, payload, signature, signedData } = parseCompactJws(signedTransactionInfo);

    if (header.alg !== 'ES256') {
      throw new Error(`Unsupported signature algorithm: ${header.alg}`);
    }

    const leaf = verifyChain(header.x5c, trustedRoot, now());
    verifyJwsSignature(leaf, signedData, signature);

    if (payload.bundleId !== bundleId) {
      throw new Error(`Transaction bundleId "${payload.bundleId}" does not match configured ${bundleId}`);
    }
    if (!allowedEnvironments.includes(payload.environment)) {
      throw new Error(`Unexpected StoreKit environment: ${payload.environment}`);
    }
    if (!Object.prototype.hasOwnProperty.call(PRODUCT_TO_PLAN, payload.productId)) {
      throw new Error(`Unknown product id: ${payload.productId}`);
    }
    if (payload.revocationDate) {
      throw new Error('Transaction was refunded or revoked by Apple');
    }
    if (!payload.transactionId) {
      throw new Error('Signed transaction is missing transactionId');
    }

    return {
      transactionId: String(payload.transactionId),
      originalTransactionId: String(payload.originalTransactionId || payload.transactionId),
      productId: payload.productId,
      plan: PRODUCT_TO_PLAN[payload.productId],
      purchaseDate: new Date(payload.purchaseDate).toISOString(),
      bundleId: payload.bundleId,
      environment: payload.environment,
    };
  }

  return { verifyTransaction };
}

module.exports = { createAppStoreVerifier, PRODUCT_TO_PLAN };
