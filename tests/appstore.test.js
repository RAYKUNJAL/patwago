'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { createAppStoreVerifier, PRODUCT_TO_PLAN } = require('../lib/appstore');

const FIXTURES = path.join(__dirname, 'fixtures', 'appstore');
const readFixture = (name) => fs.readFileSync(path.join(FIXTURES, name), 'utf8');

const leafPem = readFixture('leaf.pem');
const leafKeyPem = readFixture('leaf-key.pem');
const intermediatePem = readFixture('intermediate.pem');
const rootPem = readFixture('root-ca.pem');
const rogueLeafPem = readFixture('rogue-leaf.pem');
const rogueLeafKeyPem = readFixture('rogue-leaf-key.pem');

const trustedRoot = new crypto.X509Certificate(rootPem);
const BUNDLE_ID = 'com.patwago.app';

function derB64FromPem(pem) {
  return pem.replace(/-----BEGIN CERTIFICATE-----/, '').replace(/-----END CERTIFICATE-----/, '').replace(/\s+/g, '');
}

function base64Url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Builds a StoreKit-2-shaped compact JWS signed with the given key/chain (test fixtures only). */
function signTransaction({ payload, chain = [leafPem, intermediatePem], signingKeyPem = leafKeyPem, alg = 'ES256', headerOverrides = {} } = {}) {
  const header = { alg, x5c: chain.map(derB64FromPem), ...headerOverrides };
  const headerB64 = base64Url(Buffer.from(JSON.stringify(header)));
  const payloadB64 = base64Url(Buffer.from(JSON.stringify(payload)));
  const signedData = Buffer.from(`${headerB64}.${payloadB64}`);
  const signature = crypto.sign('sha256', signedData, { key: signingKeyPem, dsaEncoding: 'ieee-p1363' });
  return `${headerB64}.${payloadB64}.${base64Url(signature)}`;
}

function basePayload(overrides = {}) {
  return {
    transactionId: '2000000000000001',
    originalTransactionId: '2000000000000001',
    bundleId: BUNDLE_ID,
    productId: 'com.patwago.pass.day',
    purchaseDate: Date.now(),
    signedDate: Date.now(),
    environment: 'Sandbox',
    type: 'Non-Renewing Subscription',
    inAppOwnershipType: 'PURCHASED',
    ...overrides,
  };
}

function verifier(overrides = {}) {
  return createAppStoreVerifier({
    env: { APPSTORE_BUNDLE_ID: BUNDLE_ID, NODE_ENV: 'test' },
    trustedRootCert: trustedRoot,
    ...overrides,
  });
}

test('accepts a validly signed Day Pass transaction and maps it to the day plan', () => {
  const jws = signTransaction({ payload: basePayload() });
  const result = verifier().verifyTransaction(jws);
  assert.equal(result.plan, 'day');
  assert.equal(result.productId, 'com.patwago.pass.day');
  assert.equal(result.transactionId, '2000000000000001');
  assert.equal(result.bundleId, BUNDLE_ID);
});

test('accepts a validly signed Trip Pass transaction and maps it to the trip plan', () => {
  const jws = signTransaction({ payload: basePayload({ productId: 'com.patwago.pass.trip', transactionId: '2000000000000002' }) });
  const result = verifier().verifyTransaction(jws);
  assert.equal(result.plan, 'trip');
  assert.equal(PRODUCT_TO_PLAN[result.productId], 'trip');
});

test('rejects a transaction whose payload was tampered with after signing', () => {
  const jws = signTransaction({ payload: basePayload() });
  const [h, p, s] = jws.split('.');
  const tamperedPayload = base64Url(Buffer.from(JSON.stringify(basePayload({ productId: 'com.patwago.pass.trip' }))));
  const tampered = `${h}.${tamperedPayload}.${s}`;
  assert.throws(() => verifier().verifyTransaction(tampered), /signature verification failed/);
});

test('rejects a transaction signed by a certificate chain not rooted in our trusted CA', () => {
  const jws = signTransaction({ payload: basePayload(), chain: [rogueLeafPem], signingKeyPem: rogueLeafKeyPem });
  assert.throws(() => verifier().verifyTransaction(jws), /does not lead to the trusted Apple root CA/);
});

test('rejects a bundleId that does not match the configured app', () => {
  const jws = signTransaction({ payload: basePayload({ bundleId: 'com.someoneelse.app' }) });
  assert.throws(() => verifier().verifyTransaction(jws), /bundleId/);
});

test('rejects an unknown product id', () => {
  const jws = signTransaction({ payload: basePayload({ productId: 'com.patwago.pass.year' }) });
  assert.throws(() => verifier().verifyTransaction(jws), /Unknown product id/);
});

test('rejects a revoked/refunded transaction', () => {
  const jws = signTransaction({ payload: basePayload({ revocationDate: Date.now() }) });
  assert.throws(() => verifier().verifyTransaction(jws), /revoked/);
});

test('rejects Sandbox transactions in production', () => {
  const jws = signTransaction({ payload: basePayload({ environment: 'Sandbox' }) });
  assert.throws(
    () => verifier({ env: { APPSTORE_BUNDLE_ID: BUNDLE_ID, NODE_ENV: 'production' } }).verifyTransaction(jws),
    /Unexpected StoreKit environment/,
  );
});

test('accepts Production transactions in production', () => {
  const jws = signTransaction({ payload: basePayload({ environment: 'Production' }) });
  const result = verifier({ env: { APPSTORE_BUNDLE_ID: BUNDLE_ID, NODE_ENV: 'production' } }).verifyTransaction(jws);
  assert.equal(result.environment, 'Production');
});

test('rejects a certificate chain evaluated outside its validity window', () => {
  const jws = signTransaction({ payload: basePayload() });
  assert.throws(
    () => verifier({ now: () => new Date('2010-01-01T00:00:00Z') }).verifyTransaction(jws),
    /is not valid at/,
  );
});

test('rejects an unsupported signature algorithm', () => {
  const jws = signTransaction({ payload: basePayload(), headerOverrides: { alg: 'none' } });
  assert.throws(() => verifier().verifyTransaction(jws), /Unsupported signature algorithm/);
});

test('rejects malformed input that is not a 3-part JWS', () => {
  assert.throws(() => verifier().verifyTransaction('not-a-jws'), /JWS compact serialization/);
});

test('createAppStoreVerifier fails closed without APPSTORE_BUNDLE_ID', () => {
  assert.throws(() => createAppStoreVerifier({ env: {}, trustedRootCert: trustedRoot }), /APPSTORE_BUNDLE_ID/);
});

test('createAppStoreVerifier fails closed without a configured trusted root', () => {
  assert.throws(
    () => createAppStoreVerifier({ env: { APPSTORE_BUNDLE_ID: BUNDLE_ID } }),
    /APPSTORE_ROOT_CA_PEM/,
  );
});
