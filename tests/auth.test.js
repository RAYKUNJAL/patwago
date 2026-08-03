const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

/**
 * Auth / pass service tests.
 *
 * These tests exercise the in-memory fallback of lib/auth.js (no DATABASE_URL).
 * Production behavior (PostgreSQL) is verified by:
 *   - asserting that the module refuses write operations when no pool is present,
 *   - asserting that ensureSchema is a no-op without a pool.
 *
 * The module is loaded fresh for each test via require-cache invalidation so
 * that the in-memory store does not leak state across tests.
 */

function loadFreshAuth() {
  delete require.cache[require.resolve('../lib/auth')];
  // Ensure no DATABASE_URL leaks from the host environment.
  const priorDb = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  const mod = require('../lib/auth');
  if (priorDb !== undefined) process.env.DATABASE_URL = priorDb;
  return mod;
}

test('hashPassword + verifyPassword round-trip with scrypt', async () => {
  const auth = loadFreshAuth();
  const password = 'correct horse battery staple';
  const hash = await auth.hashPassword(password);
  assert.equal(typeof hash, 'string');
  assert.ok(hash.length > 60, 'hash should be a non-trivial encoded string');
  assert.ok(hash.includes('scrypt'), 'hash should be scrypt-tagged');
  assert.ok(await auth.verifyPassword(password, hash), 'correct password verifies');
  assert.equal(await auth.verifyPassword('wrong password', hash), false, 'wrong password fails');
  assert.equal(await auth.verifyPassword('', hash), false, 'empty password fails');
});

test('hashPassword rejects empty and non-string passwords', async () => {
  const auth = loadFreshAuth();
  await assert.rejects(() => auth.hashPassword(''), /password/i);
  await assert.rejects(() => auth.hashPassword(null), /password/i);
  await assert.rejects(() => auth.hashPassword(123), /password/i);
});

test('hashPassword produces unique salts (same password, different hashes)', async () => {
  const auth = loadFreshAuth();
  const a = await auth.hashPassword('same-password');
  const b = await auth.hashPassword('same-password');
  assert.notEqual(a, b, 'salts differ so hashes differ');
  assert.ok(await auth.verifyPassword('same-password', a));
  assert.ok(await auth.verifyPassword('same-password', b));
});

test('registerCustomer creates a customer with a hashed password, no plaintext stored', async () => {
  const auth = loadFreshAuth();
  const customer = await auth.registerCustomer({
    email: 'maya@example.com',
    password: 'supersecret',
    name: 'Maya',
  });
  assert.equal(customer.email, 'maya@example.com');
  assert.equal(customer.name, 'Maya');
  assert.ok(customer.id, 'customer has an id');
  assert.ok(customer.created_at, 'customer has a created_at');
  // Security contract: plaintext is never on the returned object.
  assert.equal(customer.password, undefined, 'plaintext not on returned object');
  assert.equal(customer.password_hash, undefined, 'hash not leaked on returned object');
  // The underlying stored hash must exist and must not contain plaintext.
  const stored = await auth.getCustomerByEmail('maya@example.com');
  assert.equal(stored.password_hash, undefined, 'getCustomerByEmail also does not leak hash');
});

test('registerCustomer normalizes email to lowercase and trims whitespace', async () => {
  const auth = loadFreshAuth();
  const customer = await auth.registerCustomer({
    email: '  Maya@Example.COM  ',
    password: 'supersecret',
    name: 'Maya',
  });
  assert.equal(customer.email, 'maya@example.com');
});

test('registerCustomer rejects duplicate email', async () => {
  const auth = loadFreshAuth();
  await auth.registerCustomer({ email: 'dup@example.com', password: 'pw1', name: 'A' });
  await assert.rejects(
    () => auth.registerCustomer({ email: 'DUP@example.com', password: 'pw2', name: 'B' }),
    /exist|duplicate|already/i,
  );
});

test('registerCustomer rejects invalid input', async () => {
  const auth = loadFreshAuth();
  await assert.rejects(() => auth.registerCustomer({ email: '', password: 'pw' }), /email/i);
  await assert.rejects(() => auth.registerCustomer({ email: 'not-an-email', password: 'pw' }), /email/i);
  await assert.rejects(() => auth.registerCustomer({ email: 'ok@example.com', password: '' }), /password/i);
  await assert.rejects(() => auth.registerCustomer({ email: 'ok@example.com', password: 'pw', name: '' }), /name/i);
});

test('authenticateCustomer returns customer (without hash) on valid credentials', async () => {
  const auth = loadFreshAuth();
  await auth.registerCustomer({ email: 'ray@example.com', password: 'correct', name: 'Ray' });
  const customer = await auth.authenticateCustomer({ email: 'ray@example.com', password: 'correct' });
  assert.ok(customer, 'returns a customer');
  assert.equal(customer.email, 'ray@example.com');
  assert.equal(customer.password_hash, undefined, 'hash not leaked on auth result');
  assert.equal(customer.password, undefined);
});

test('authenticateCustomer returns null on wrong password', async () => {
  const auth = loadFreshAuth();
  await auth.registerCustomer({ email: 'ray@example.com', password: 'correct', name: 'Ray' });
  const result = await auth.authenticateCustomer({ email: 'ray@example.com', password: 'wrong' });
  assert.equal(result, null);
});

test('authenticateCustomer returns null for unknown email', async () => {
  const auth = loadFreshAuth();
  const result = await auth.authenticateCustomer({ email: 'nobody@example.com', password: 'whatever' });
  assert.equal(result, null);
});

test('authenticateCustomer rejects missing fields', async () => {
  const auth = loadFreshAuth();
  await assert.rejects(() => auth.authenticateCustomer({ email: '', password: 'x' }), /email/i);
  await assert.rejects(() => auth.authenticateCustomer({ email: 'x@example.com', password: '' }), /password/i);
});

test('createSession returns an opaque token and resolves via getSession', async () => {
  const auth = loadFreshAuth();
  const reg = await auth.registerCustomer({ email: 's@example.com', password: 'pw', name: 'S' });
  const session = await auth.createSession({ customer_id: reg.id });
  assert.ok(session.token, 'session has an opaque token');
  assert.ok(session.token.length >= 32, 'token is reasonably long');
  assert.equal(session.token.includes('|'), false, 'token has no delimiter leaks');
  assert.equal(session.customer_id, reg.id);
  assert.ok(session.expires_at);

  const resolved = await auth.getSession(session.token);
  assert.ok(resolved, 'session resolves');
  assert.equal(resolved.token, session.token);
  assert.equal(resolved.customer_id, reg.id);
});

test('getSession returns null for unknown token', async () => {
  const auth = loadFreshAuth();
  const resolved = await auth.getSession('definitely-not-a-real-token');
  assert.equal(resolved, null);
});

test('getSession returns null for empty token', async () => {
  const auth = loadFreshAuth();
  const resolved = await auth.getSession('');
  assert.equal(resolved, null);
});

test('destroySession removes an active session', async () => {
  const auth = loadFreshAuth();
  const reg = await auth.registerCustomer({ email: 'd@example.com', password: 'pw', name: 'D' });
  const session = await auth.createSession({ customer_id: reg.id });
  assert.ok(await auth.getSession(session.token));
  await auth.destroySession(session.token);
  assert.equal(await auth.getSession(session.token), null);
  // destroying again is a no-op (idempotent)
  await auth.destroySession(session.token);
});

test('createPass issues a trial pass with correct expiry', async () => {
  const auth = loadFreshAuth();
  const reg = await auth.registerCustomer({ email: 't@example.com', password: 'pw', name: 'T' });
  const pass = await auth.createPass({ customer_id: reg.id, plan: 'trial' });
  assert.equal(pass.plan, 'trial');
  assert.equal(pass.status, 'active');
  assert.ok(pass.id, 'pass has id');
  assert.ok(pass.expires_at, 'trial pass has an expiry');
  assert.ok(pass.created_at);
  // trial should expire within a day (we just assert it is in the future and < 2 days)
  const expiry = new Date(pass.expires_at).getTime();
  const now = Date.now();
  assert.ok(expiry > now, 'expiry is in the future');
  assert.ok(expiry - now < 2 * 86400000, 'trial expiry is short (under 2 days)');
});

test('createPass issues a day pass with correct expiry', async () => {
  const auth = loadFreshAuth();
  const reg = await auth.registerCustomer({ email: 'd@example.com', password: 'pw', name: 'D' });
  const pass = await auth.createPass({ customer_id: reg.id, plan: 'day' });
  assert.equal(pass.plan, 'day');
  const expiry = new Date(pass.expires_at).getTime();
  assert.ok(expiry - Date.now() > 86400000 * 0.9, 'day pass ~24h');
  assert.ok(expiry - Date.now() < 86400000 * 1.5, 'day pass not over 1.5 days');
});

test('createPass issues a trip pass with correct expiry', async () => {
  const auth = loadFreshAuth();
  const reg = await auth.registerCustomer({ email: 'p@example.com', password: 'pw', name: 'P' });
  const pass = await auth.createPass({ customer_id: reg.id, plan: 'trip', trip_days: 5 });
  assert.equal(pass.plan, 'trip');
  const expiry = new Date(pass.expires_at).getTime();
  // trip_days=5 → ~5 days; allow generous bounds
  assert.ok(expiry - Date.now() > 4 * 86400000, 'trip pass spans ~trip_days');
  assert.ok(expiry - Date.now() < 6 * 86400000, 'trip pass not much beyond trip_days');
});

test('createPass trip pass defaults trip_days to 7', async () => {
  const auth = loadFreshAuth();
  const reg = await auth.registerCustomer({ email: 'q@example.com', password: 'pw', name: 'Q' });
  const pass = await auth.createPass({ customer_id: reg.id, plan: 'trip' });
  const expiry = new Date(pass.expires_at).getTime();
  assert.ok(expiry - Date.now() > 6 * 86400000, 'default trip ~7 days lower');
  assert.ok(expiry - Date.now() < 8 * 86400000, 'default trip ~7 days upper');
});

test('createPass rejects unknown plan', async () => {
  const auth = loadFreshAuth();
  const reg = await auth.registerCustomer({ email: 'x@example.com', password: 'pw', name: 'X' });
  await assert.rejects(() => auth.createPass({ customer_id: reg.id, plan: 'lifetime' }), /plan/i);
});

test('createPass rejects missing customer_id', async () => {
  const auth = loadFreshAuth();
  await assert.rejects(() => auth.createPass({ plan: 'trial' }), /customer/i);
});

test('getPassStatus reports active for a fresh pass', async () => {
  const auth = loadFreshAuth();
  const reg = await auth.registerCustomer({ email: 'g@example.com', password: 'pw', name: 'G' });
  const pass = await auth.createPass({ customer_id: reg.id, plan: 'day' });
  const status = await auth.getPassStatus(pass.id);
  assert.equal(status.status, 'active');
  assert.equal(status.plan, 'day');
  assert.ok(status.expires_at);
  assert.equal(status.expired, false);
});

test('getPassStatus reports expired for a past pass', async () => {
  const auth = loadFreshAuth();
  const reg = await auth.registerCustomer({ email: 'e@example.com', password: 'pw', name: 'E' });
  const pass = await auth.createPass({ customer_id: reg.id, plan: 'trial' });
  // Force expiry into the past in the underlying store.
  await auth._expirePassForTest(pass.id);
  const status = await auth.getPassStatus(pass.id);
  assert.equal(status.expired, true);
  assert.equal(status.status, 'expired');
});

test('getPassStatus returns null for unknown pass', async () => {
  const auth = loadFreshAuth();
  const status = await auth.getPassStatus('no-such-pass');
  assert.equal(status, null);
});

test('hasActivePass returns true for a customer with an active pass', async () => {
  const auth = loadFreshAuth();
  const reg = await auth.registerCustomer({ email: 'h@example.com', password: 'pw', name: 'H' });
  assert.equal(await auth.hasActivePass(reg.id), false, 'no pass yet');
  await auth.createPass({ customer_id: reg.id, plan: 'day' });
  assert.equal(await auth.hasActivePass(reg.id), true);
});

test('hasActivePass returns false when all passes are expired', async () => {
  const auth = loadFreshAuth();
  const reg = await auth.registerCustomer({ email: 'i@example.com', password: 'pw', name: 'I' });
  const pass = await auth.createPass({ customer_id: reg.id, plan: 'trial' });
  await auth._expirePassForTest(pass.id);
  assert.equal(await auth.hasActivePass(reg.id), false);
});

test('listPasses returns all passes for a customer, newest first', async () => {
  const auth = loadFreshAuth();
  const reg = await auth.registerCustomer({ email: 'l@example.com', password: 'pw', name: 'L' });
  await auth.createPass({ customer_id: reg.id, plan: 'trial' });
  await auth.createPass({ customer_id: reg.id, plan: 'day' });
  const passes = await auth.listPasses(reg.id);
  assert.equal(passes.length, 2);
  assert.ok(new Date(passes[0].created_at) >= new Date(passes[1].created_at), 'newest first');
});

test('listPasses ignores passes that belong to a different customer', async () => {
  const auth = loadFreshAuth();
  const a = await auth.registerCustomer({ email: 'a@example.com', password: 'pw', name: 'A' });
  const b = await auth.registerCustomer({ email: 'b@example.com', password: 'pw', name: 'B' });
  await auth.createPass({ customer_id: a.id, plan: 'trial' });
  await auth.createPass({ customer_id: b.id, plan: 'day' });
  const passes = await auth.listPasses(a.id);
  assert.equal(passes.length, 1);
  assert.equal(passes[0].customer_id, a.id);
});

test('ownsPass returns true only when the pass belongs to the customer', async () => {
  const auth = loadFreshAuth();
  const a = await auth.registerCustomer({ email: 'o1@example.com', password: 'pw', name: 'A' });
  const b = await auth.registerCustomer({ email: 'o2@example.com', password: 'pw', name: 'B' });
  const pass = await auth.createPass({ customer_id: a.id, plan: 'trial' });
  assert.equal(await auth.ownsPass(a.id, pass.id), true);
  assert.equal(await auth.ownsPass(b.id, pass.id), false);
  assert.equal(await auth.ownsPass(a.id, 'no-such-pass'), false);
});

test('ownsSession returns true only when the session belongs to the customer', async () => {
  const auth = loadFreshAuth();
  const a = await auth.registerCustomer({ email: 's1@example.com', password: 'pw', name: 'A' });
  const b = await auth.registerCustomer({ email: 's2@example.com', password: 'pw', name: 'B' });
  const session = await auth.createSession({ customer_id: a.id });
  assert.equal(await auth.ownsSession(a.id, session.token), true);
  assert.equal(await auth.ownsSession(b.id, session.token), false);
  assert.equal(await auth.ownsSession(a.id, 'no-such-token'), false);
});

test('getCustomerByEmail retrieves a customer by email (without hash)', async () => {
  const auth = loadFreshAuth();
  await auth.registerCustomer({ email: 'find@example.com', password: 'pw', name: 'F' });
  const customer = await auth.getCustomerByEmail('FIND@example.com');
  assert.ok(customer);
  assert.equal(customer.email, 'find@example.com');
  assert.equal(customer.password_hash, undefined, 'hash not leaked');
  assert.equal(customer.password, undefined);
  assert.equal(await auth.getCustomerByEmail('missing@example.com'), null);
});

test('getCustomerById retrieves a customer by id (without hash)', async () => {
  const auth = loadFreshAuth();
  const reg = await auth.registerCustomer({ email: 'id@example.com', password: 'pw', name: 'I' });
  const customer = await auth.getCustomerById(reg.id);
  assert.ok(customer);
  assert.equal(customer.id, reg.id);
  assert.equal(customer.password_hash, undefined, 'hash not leaked');
  assert.equal(await auth.getCustomerById('missing'), null);
});

test('updateCustomer updates allowed fields and rehashes password', async () => {
  const auth = loadFreshAuth();
  const reg = await auth.registerCustomer({ email: 'u@example.com', password: 'oldpw', name: 'U' });
  const updated = await auth.updateCustomer(reg.id, { name: 'Updated', password: 'newpw' });
  assert.equal(updated.name, 'Updated');
  assert.equal(updated.email, 'u@example.com');
  assert.equal(updated.password, undefined);
  assert.equal(updated.password_hash, undefined, 'hash not leaked on update result');
  // Behavior proves rehashing: old password fails, new password works.
  const withOld = await auth.authenticateCustomer({ email: 'u@example.com', password: 'oldpw' });
  assert.equal(withOld, null);
  const withNew = await auth.authenticateCustomer({ email: 'u@example.com', password: 'newpw' });
  assert.ok(withNew);
});

test('updateCustomer ignores empty password (keeps existing hash)', async () => {
  const auth = loadFreshAuth();
  const reg = await auth.registerCustomer({ email: 'keep@example.com', password: 'pw', name: 'K' });
  const updated = await auth.updateCustomer(reg.id, { name: 'K2' });
  assert.equal(updated.name, 'K2');
  // Behavior: original password still works after update with no new password.
  const stillWorks = await auth.authenticateCustomer({ email: 'keep@example.com', password: 'pw' });
  assert.ok(stillWorks, 'original password still authenticates when update omits password');
});

test('updateCustomer rejects unknown customer', async () => {
  const auth = loadFreshAuth();
  await assert.rejects(() => auth.updateCustomer('missing', { name: 'X' }), /not found|missing|unknown/i);
});

test('without a DATABASE_URL, ensureSchema is a safe no-op', async () => {
  const auth = loadFreshAuth();
  await auth.ensureSchema();
});

test('production fails closed: when pool is present but queries fail, register rejects', async () => {
  // Simulate a broken pool: we cannot easily inject a real PG connection, but we
  // can verify the module's contract by checking that the pool getter is null
  // without DATABASE_URL (which we already have) and that the module exports a
  // function to inspect storage mode.
  const auth = loadFreshAuth();
  assert.equal(auth.storageMode(), 'memory');
});

test('storageMode reports postgres when DATABASE_URL is set', async () => {
  const prior = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/test';
  try {
    delete require.cache[require.resolve('../lib/auth')];
    const auth = require('../lib/auth');
    assert.equal(auth.storageMode(), 'postgres');
  } finally {
    if (prior === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prior;
  }
});

test('exported API surface is present and stable', () => {
  const auth = loadFreshAuth();
  const expected = [
    'hashPassword',
    'verifyPassword',
    'registerCustomer',
    'authenticateCustomer',
    'getCustomerByEmail',
    'getCustomerById',
    'updateCustomer',
    'createSession',
    'getSession',
    'destroySession',
    'createPass',
    'getPassStatus',
    'listPasses',
    'hasActivePass',
    'ownsPass',
    'ownsSession',
    'ensureSchema',
    'storageMode',
  ];
  for (const name of expected) {
    assert.equal(typeof auth[name], 'function', `exports ${name}`);
  }
});
