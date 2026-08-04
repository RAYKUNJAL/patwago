/**
 * PatWaGo customer auth, session, and pass service.
 *
 * Production: PostgreSQL-backed (requires DATABASE_URL + pg pool).
 * Tests / dev: in-memory fallback when DATABASE_URL is absent — tests only.
 *
 * Security:
 *   - Passwords hashed with Node crypto.scrypt (N=16384, r=8, p=1), random 16B salt,
 *     encoded as "scrypt:<saltHex>:<hashHex>".
 *   - Sessions use opaque, cryptographically-random tokens (32 bytes, base64url).
 *   - Customer-facing results never leak password_hash or plaintext password.
 *
 * Passes:
 *   - trial: ~24h (one-time)
 *   - day:   ~24h
 *   - trip:  trip_days * 24h (default 7)
 *
 * Fails closed: when DATABASE_URL is set in production but the pool is unavailable
 * or queries fail, write operations reject rather than silently fall back to memory.
 *
 * Exported surface (stable for parent wiring):
 *   hashPassword, verifyPassword,
 *   registerCustomer, authenticateCustomer,
 *   getCustomerByEmail, getCustomerById, updateCustomer,
 *   createSession, getSession, destroySession,
 *   createPass, getPassStatus, listPasses, hasActivePass,
 *   ownsPass, ownsSession,
 *   ensureSchema, storageMode,
 *   _expirePassForTest  (test helper; no-op in production)
 */

const crypto = require('node:crypto');
const { Pool } = require('pg');

// ---------------------------------------------------------------------------
// Pool setup (mirrors analytics.js conventions)
// ---------------------------------------------------------------------------

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : false,
    })
  : null;

// In-memory fallback — TEST / DEV ONLY. Never used in production (pool !== null).
const mem = {
  customers: [],
  sessions: [],
  passes: [],
  appstoreTransactions: [],
};

function memoryAllowed() {
  return process.env.NODE_ENV !== 'production' || process.env.ALLOW_IN_MEMORY_AUTH === 'true';
}

// ---------------------------------------------------------------------------
// Password hashing (scrypt)
// ---------------------------------------------------------------------------

const SCRYPT_KEYLEN = 32;
const SCRYPT_SALTLEN = 16;
// scrypt parameters chosen for ~100ms on commodity hardware.
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function cleanName(value, max = 120) {
  return String(value || '').trim().slice(0, max);
}

async function hashPassword(password) {
  if (!isNonEmptyString(password)) {
    throw new Error('password is required and must be a non-empty string');
  }
  const salt = crypto.randomBytes(SCRYPT_SALTLEN);
  const hash = await new Promise((resolve, reject) => {
    crypto.scrypt(Buffer.from(password, 'utf8'), salt, SCRYPT_KEYLEN, SCRYPT_PARAMS, (err, derived) => {
      if (err) reject(err);
      else resolve(derived);
    });
  });
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

async function verifyPassword(password, encoded) {
  if (!isNonEmptyString(password) || typeof encoded !== 'string') return false;
  const parts = encoded.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  if (salt.length === 0 || expected.length === 0) return false;
  try {
    const derived = await new Promise((resolve, reject) => {
      crypto.scrypt(Buffer.from(password, 'utf8'), salt, expected.length, SCRYPT_PARAMS, (err, buf) => {
        if (err) reject(err);
        else resolve(buf);
      });
    });
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function customerId() {
  return `cust-${crypto.randomUUID()}`;
}
function sessionId() {
  return `sess-${crypto.randomUUID()}`;
}
function passId() {
  return `pass-${crypto.randomUUID()}`;
}
function newOpaqueToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function nowIso() {
  return new Date().toISOString();
}
function nowMs() {
  return Date.now();
}

/** Strip sensitive fields before returning a customer to callers. */
function publicCustomer(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    created_at: row.created_at,
  };
}

/** Strip sensitive fields before returning a session. */
function publicSession(row) {
  if (!row) return null;
  return {
    token: row.token,
    customer_id: row.customer_id,
    created_at: row.created_at,
    expires_at: row.expires_at,
  };
}

function publicPass(row) {
  if (!row) return null;
  return {
    id: row.id,
    customer_id: row.customer_id,
    plan: row.plan,
    status: row.status,
    created_at: row.created_at,
    expires_at: row.expires_at,
  };
}

// ---------------------------------------------------------------------------
// Schema bootstrap (PostgreSQL)
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
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

-- One row per Apple-verified StoreKit 2 transaction. The PRIMARY KEY makes
-- redemption idempotent: StoreKit can (and does) redeliver the same
-- transaction (app relaunch, Transaction.updates replay), and this table
-- ensures we credit a pass for it exactly once.
CREATE TABLE IF NOT EXISTS auth_appstore_transactions (
  transaction_id text PRIMARY KEY,
  customer_id text NOT NULL REFERENCES auth_customers(id) ON DELETE CASCADE,
  pass_id text NOT NULL REFERENCES auth_passes(id) ON DELETE CASCADE,
  product_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_appstore_transactions_customer_idx ON auth_appstore_transactions(customer_id);
`;

let schemaEnsured = false;

async function ensureSchema() {
  if (!pool) return; // no-op in memory mode
  if (schemaEnsured) return;
  await pool.query(SCHEMA_SQL);
  schemaEnsured = true;
}

// ---------------------------------------------------------------------------
// Production fail-closed guard
// ---------------------------------------------------------------------------

/**
 * In production (pool present), we MUST use the DB and never fall back to memory.
 * If pool is null (no DATABASE_URL), tests use the in-memory store.
 */
function assertPool() {
  if (!pool && !memoryAllowed()) throw new Error('DATABASE_URL is required for production authentication');
  if (!pool) return false; // memory mode
  return true;
}

// ---------------------------------------------------------------------------
// Customer registration / authentication
// ---------------------------------------------------------------------------

async function registerCustomer({ email, password, name }) {
  if (!isValidEmail(email)) throw new Error('A valid email is required');
  if (!isNonEmptyString(password)) throw new Error('A non-empty password is required');
  const cleanN = cleanName(name);
  if (!cleanN) throw new Error('A name is required');
  const normalizedEmail = normalizeEmail(email);
  const hash = await hashPassword(password);
  const id = customerId();
  const created_at = nowIso();

  if (assertPool()) {
    await ensureSchema();
    try {
      await pool.query(
        'INSERT INTO auth_customers(id, email, name, password_hash, created_at) VALUES($1,$2,$3,$4,$5)',
        [id, normalizedEmail, cleanN, hash, created_at],
      );
    } catch (err) {
      if (err && /duplicate/i.test(String(err.message || err))) {
        throw new Error('A customer with that email already exists');
      }
      throw err;
    }
    return publicCustomer({ id, email: normalizedEmail, name: cleanN, password_hash: hash, created_at });
  }

  // memory mode
  if (mem.customers.some((c) => c.email === normalizedEmail)) {
    throw new Error('A customer with that email already exists');
  }
  const row = { id, email: normalizedEmail, name: cleanN, password_hash: hash, created_at };
  mem.customers.push(row);
  return publicCustomer(row);
}

async function authenticateCustomer({ email, password }) {
  if (!isValidEmail(email)) throw new Error('A valid email is required');
  if (!isNonEmptyString(password)) throw new Error('A non-empty password is required');
  const normalizedEmail = normalizeEmail(email);

  let row;
  if (assertPool()) {
    await ensureSchema();
    const result = await pool.query(
      'SELECT id, email, name, password_hash, created_at FROM auth_customers WHERE email=$1',
      [normalizedEmail],
    );
    row = result.rows[0] || null;
  } else {
    row = mem.customers.find((c) => c.email === normalizedEmail) || null;
  }

  if (!row) return null;
  const ok = await verifyPassword(password, row.password_hash);
  if (!ok) return null;
  return publicCustomer(row);
}

async function getCustomerByEmail(email) {
  if (!isValidEmail(email)) return null;
  const normalizedEmail = normalizeEmail(email);
  let row;
  if (assertPool()) {
    await ensureSchema();
    const result = await pool.query(
      'SELECT id, email, name, created_at FROM auth_customers WHERE email=$1',
      [normalizedEmail],
    );
    row = result.rows[0] || null;
  } else {
    row = mem.customers.find((c) => c.email === normalizedEmail) || null;
  }
  return publicCustomer(row);
}

async function getCustomerById(id) {
  if (!isNonEmptyString(id)) return null;
  let row;
  if (assertPool()) {
    await ensureSchema();
    const result = await pool.query(
      'SELECT id, email, name, created_at FROM auth_customers WHERE id=$1',
      [id],
    );
    row = result.rows[0] || null;
  } else {
    row = mem.customers.find((c) => c.id === id) || null;
  }
  return publicCustomer(row);
}

async function updateCustomer(id, { name, password } = {}) {
  if (!isNonEmptyString(id)) throw new Error('customer id is required');
  let row;
  if (assertPool()) {
    await ensureSchema();
    const result = await pool.query(
      'SELECT id, email, name, password_hash, created_at FROM auth_customers WHERE id=$1',
      [id],
    );
    row = result.rows[0] || null;
    if (!row) throw new Error('customer not found');
    const updates = [];
    const params = [];
    let idx = 1;
    const newName = cleanName(name);
    if (newName) {
      updates.push(`name=$${idx}`);
      params.push(newName);
      idx++;
    }
    if (isNonEmptyString(password)) {
      const newHash = await hashPassword(password);
      updates.push(`password_hash=$${idx}`);
      params.push(newHash);
      idx++;
    }
    if (updates.length) {
      params.push(id);
      await pool.query(`UPDATE auth_customers SET ${updates.join(', ')} WHERE id=$${idx}`, params);
      row.name = newName || row.name;
      if (password) row.password_hash = (await hashPassword(password));
    }
    return publicCustomer(row);
  }

  // memory
  row = mem.customers.find((c) => c.id === id);
  if (!row) throw new Error('customer not found');
  const newName = cleanName(name);
  if (newName) row.name = newName;
  if (isNonEmptyString(password)) {
    row.password_hash = await hashPassword(password);
  }
  return publicCustomer(row);
}

/**
 * Permanently delete a customer and all owned data (Apple Guideline 5.1.1(v):
 * self-service, in-app account deletion). In Postgres, auth_sessions,
 * auth_passes, customer_trips, customer_checkins, and customer_transcripts
 * all reference auth_customers with ON DELETE CASCADE, so one delete here
 * removes everything. In memory mode we clear the customer/session/pass rows
 * directly; callers must also call customerData.purgeCustomer(id).
 */
async function deleteCustomer(id) {
  if (!isNonEmptyString(id)) throw new Error('customer id is required');
  if (assertPool()) {
    await ensureSchema();
    const result = await pool.query('DELETE FROM auth_customers WHERE id=$1', [id]);
    return result.rowCount > 0;
  }
  const before = mem.customers.length;
  mem.customers = mem.customers.filter((c) => c.id !== id);
  mem.sessions = mem.sessions.filter((s) => s.customer_id !== id);
  mem.passes = mem.passes.filter((p) => p.customer_id !== id);
  mem.appstoreTransactions = mem.appstoreTransactions.filter((t) => t.customer_id !== id);
  return mem.customers.length < before;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

const SESSION_TTL_MS = 7 * 86400000; // 7 days, opaque and revocable

async function createSession({ customer_id }) {
  if (!isNonEmptyString(customer_id)) throw new Error('customer_id is required');
  const token = newOpaqueToken();
  const created_at = nowIso();
  const expires_at = new Date(nowMs() + SESSION_TTL_MS).toISOString();

  if (assertPool()) {
    await ensureSchema();
    await pool.query(
      'INSERT INTO auth_sessions(token, customer_id, created_at, expires_at) VALUES($1,$2,$3,$4)',
      [token, customer_id, created_at, expires_at],
    );
  } else {
    mem.sessions.push({ token, customer_id, created_at, expires_at });
  }
  return publicSession({ token, customer_id, created_at, expires_at });
}

async function getSession(token) {
  if (!isNonEmptyString(token)) return null;
  let row;
  if (assertPool()) {
    await ensureSchema();
    const result = await pool.query(
      'SELECT token, customer_id, created_at, expires_at FROM auth_sessions WHERE token=$1',
      [token],
    );
    row = result.rows[0] || null;
  } else {
    row = mem.sessions.find((s) => s.token === token) || null;
  }
  if (!row) return null;
  // Expired sessions are treated as absent (and pruned opportunistically).
  if (new Date(row.expires_at).getTime() < nowMs()) {
    await destroySession(token);
    return null;
  }
  return publicSession(row);
}

async function destroySession(token) {
  if (!isNonEmptyString(token)) return;
  if (assertPool()) {
    await ensureSchema();
    await pool.query('DELETE FROM auth_sessions WHERE token=$1', [token]);
  } else {
    mem.sessions = mem.sessions.filter((s) => s.token !== token);
  }
}

// ---------------------------------------------------------------------------
// Passes
// ---------------------------------------------------------------------------

const PLAN_DURATIONS_MS = {
  trial: 24 * 3600000, // ~24h
  day: 24 * 3600000, // ~24h
  trip: null, // computed from trip_days (default 7)
};
const VALID_PLANS = new Set(['trial', 'day', 'trip']);
const DEFAULT_TRIP_DAYS = 7;

async function createPass({ customer_id, plan, trip_days } = {}) {
  if (!isNonEmptyString(customer_id)) throw new Error('customer_id is required');
  if (!VALID_PLANS.has(plan)) throw new Error('plan must be one of: trial, day, trip');

  // Verify the customer exists (fail closed).
  const customer = await getCustomerById(customer_id);
  if (!customer) throw new Error('customer not found');

  let durationMs;
  if (plan === 'trip') {
    const days = Math.max(1, Math.min(60, Number(trip_days) || DEFAULT_TRIP_DAYS));
    durationMs = days * 24 * 3600000;
  } else {
    durationMs = PLAN_DURATIONS_MS[plan];
  }

  const id = passId();
  const created_at = nowIso();
  const expires_at = new Date(nowMs() + durationMs).toISOString();
  const status = 'active';

  if (assertPool()) {
    await ensureSchema();
    await pool.query(
      'INSERT INTO auth_passes(id, customer_id, plan, status, created_at, expires_at) VALUES($1,$2,$3,$4,$5,$6)',
      [id, customer_id, plan, status, created_at, expires_at],
    );
  } else {
    mem.passes.push({ id, customer_id, plan, status, created_at, expires_at });
  }
  return publicPass({ id, customer_id, plan, status, created_at, expires_at });
}

/**
 * Credit a pass for a verified StoreKit 2 transaction, exactly once.
 * Idempotent: if this transaction_id was already redeemed (e.g. the client
 * retried after a network blip, or StoreKit redelivered the transaction),
 * returns the pass created the first time instead of creating a second one.
 * Caller must have already verified the JWS (see lib/appstore.js) — this
 * function trusts its input.
 */
async function redeemAppStoreTransaction({ customer_id, transaction_id, product_id, plan, trip_days }) {
  if (!isNonEmptyString(customer_id)) throw new Error('customer_id is required');
  if (!isNonEmptyString(transaction_id)) throw new Error('transaction_id is required');
  if (!VALID_PLANS.has(plan)) throw new Error('plan must be one of: trial, day, trip');

  if (assertPool()) {
    await ensureSchema();
    const existing = await pool.query(
      'SELECT pass_id FROM auth_appstore_transactions WHERE transaction_id=$1',
      [transaction_id],
    );
    if (existing.rows[0]) {
      return { pass: await getPassStatus(existing.rows[0].pass_id), redeemed: false };
    }
    const pass = await createPass({ customer_id, plan, trip_days });
    try {
      await pool.query(
        'INSERT INTO auth_appstore_transactions(transaction_id, customer_id, pass_id, product_id) VALUES($1,$2,$3,$4)',
        [transaction_id, customer_id, pass.id, product_id || plan],
      );
    } catch (err) {
      if (err && /duplicate/i.test(String(err.message || err))) {
        // Lost a race against a concurrent request for the same transaction.
        const row = await pool.query(
          'SELECT pass_id FROM auth_appstore_transactions WHERE transaction_id=$1',
          [transaction_id],
        );
        return { pass: await getPassStatus(row.rows[0].pass_id), redeemed: false };
      }
      throw err;
    }
    return { pass, redeemed: true };
  }

  // memory mode
  const existing = mem.appstoreTransactions.find((t) => t.transaction_id === transaction_id);
  if (existing) {
    return { pass: await getPassStatus(existing.pass_id), redeemed: false };
  }
  const pass = await createPass({ customer_id, plan, trip_days });
  mem.appstoreTransactions.push({ transaction_id, customer_id, pass_id: pass.id, product_id: product_id || plan });
  return { pass, redeemed: true };
}

async function _getPassRow(id) {
  if (!isNonEmptyString(id)) return null;
  if (assertPool()) {
    await ensureSchema();
    const result = await pool.query(
      'SELECT id, customer_id, plan, status, created_at, expires_at FROM auth_passes WHERE id=$1',
      [id],
    );
    return result.rows[0] || null;
  }
  return mem.passes.find((p) => p.id === id) || null;
}

async function getPassStatus(passId) {
  const row = await _getPassRow(passId);
  if (!row) return null;
  const expired = new Date(row.expires_at).getTime() < nowMs();
  return {
    ...publicPass(row),
    expired,
    status: expired ? 'expired' : row.status,
  };
}

async function listPasses(customer_id) {
  if (!isNonEmptyString(customer_id)) return [];
  let rows;
  if (assertPool()) {
    await ensureSchema();
    const result = await pool.query(
      'SELECT id, customer_id, plan, status, created_at, expires_at FROM auth_passes WHERE customer_id=$1 ORDER BY created_at DESC',
      [customer_id],
    );
    rows = result.rows;
  } else {
    rows = mem.passes
      .filter((p) => p.customer_id === customer_id)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }
  return rows.map(publicPass);
}

async function hasActivePass(customer_id) {
  if (!isNonEmptyString(customer_id)) return false;
  const passes = await listPasses(customer_id);
  return passes.some((p) => new Date(p.expires_at).getTime() >= nowMs());
}

async function ownsPass(customer_id, passId) {
  if (!isNonEmptyString(customer_id) || !isNonEmptyString(passId)) return false;
  const row = await _getPassRow(passId);
  return Boolean(row && row.customer_id === customer_id);
}

async function ownsSession(customer_id, token) {
  if (!isNonEmptyString(customer_id) || !isNonEmptyString(token)) return false;
  const session = await getSession(token);
  return Boolean(session && session.customer_id === customer_id);
}

// ---------------------------------------------------------------------------
// Test helper: force a pass into the expired state (memory only).
// In production (pool present) this is a no-op — tests run without DATABASE_URL.
// ---------------------------------------------------------------------------

async function _expirePassForTest(passId) {
  if (assertPool()) return; // no-op in production
  const row = mem.passes.find((p) => p.id === passId);
  if (!row) return;
  row.expires_at = new Date(nowMs() - 1000).toISOString();
}

// ---------------------------------------------------------------------------
// Introspection
// ---------------------------------------------------------------------------

function storageMode() {
  return pool ? 'postgres' : 'memory';
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  // Password hashing
  hashPassword,
  verifyPassword,
  // Customers
  registerCustomer,
  authenticateCustomer,
  getCustomerByEmail,
  getCustomerById,
  updateCustomer,
  deleteCustomer,
  // Sessions
  createSession,
  getSession,
  destroySession,
  // Passes
  createPass,
  getPassStatus,
  listPasses,
  hasActivePass,
  ownsPass,
  ownsSession,
  redeemAppStoreTransaction,
  // Schema / introspection
  ensureSchema,
  storageMode,
  // Test helper (no-op in production)
  _expirePassForTest,
};
