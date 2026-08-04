'use strict';

/**
 * lib/generation-log.js — append-only AI generation audit log.
 * Postgres when DATABASE_URL set; else data/generation-log.jsonl
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = process.cwd();
const JSONL_PATH = process.env.GENERATION_LOG_PATH
  || path.join(ROOT, 'data', 'generation-log.jsonl');

let pool = null;
try {
  if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 5,
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : false,
    });
  }
} catch {
  pool = null;
}

function sha256(text) {
  return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex');
}

function preview(text, max = 160) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length <= max ? s : s.slice(0, max) + '…';
}

function dailyIpHash(ip) {
  const salt = process.env.AUDIT_IP_SALT || 'dev-only-change-me';
  const day = new Date().toISOString().slice(0, 10);
  return sha256(`${day}|${salt}|${ip || ''}`);
}

async function ensureSchema() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_generation_log (
      id text PRIMARY KEY,
      created_at timestamptz NOT NULL DEFAULT now(),
      app text NOT NULL,
      route text,
      feature text,
      model text,
      provider text,
      prompt_hash text,
      prompt_preview text,
      output_hash text,
      output_preview text,
      output_chars integer,
      latency_ms integer,
      success boolean NOT NULL DEFAULT true,
      error text,
      consent_version text,
      consent_categories jsonb NOT NULL DEFAULT '[]'::jsonb,
      anonymous_id text,
      customer_id text,
      session_id text,
      ip_hash text,
      request_id text,
      meta jsonb NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE INDEX IF NOT EXISTS ai_generation_log_created_idx ON ai_generation_log (created_at DESC);
    CREATE INDEX IF NOT EXISTS ai_generation_log_feature_idx ON ai_generation_log (feature);
    CREATE INDEX IF NOT EXISTS ai_generation_log_app_idx ON ai_generation_log (app);
  `);
}

function newId() {
  return `gen-${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
}

/**
 * @param {object} entry
 */
async function recordGeneration(entry = {}) {
  const row = {
    id: entry.id || newId(),
    created_at: entry.created_at || new Date().toISOString(),
    app: String(entry.app || process.env.APP_NAME || 'patwago').slice(0, 80),
    route: entry.route ? String(entry.route).slice(0, 200) : null,
    feature: entry.feature ? String(entry.feature).slice(0, 80) : null,
    model: entry.model ? String(entry.model).slice(0, 120) : null,
    provider: entry.provider ? String(entry.provider).slice(0, 80) : null,
    prompt_hash: entry.prompt_hash || (entry.prompt != null ? sha256(entry.prompt) : null),
    prompt_preview: entry.prompt_preview || (entry.prompt != null ? preview(entry.prompt, 120) : null),
    output_hash: entry.output_hash || (entry.output != null ? sha256(entry.output) : null),
    output_preview: entry.output_preview || (entry.output != null ? preview(entry.output, 200) : null),
    output_chars: Number.isFinite(entry.output_chars)
      ? entry.output_chars
      : (entry.output != null ? String(entry.output).length : null),
    latency_ms: entry.latency_ms != null ? Number(entry.latency_ms) : null,
    success: entry.success !== false,
    error: entry.error ? String(entry.error).slice(0, 500) : null,
    consent_version: entry.consent_version || null,
    consent_categories: Array.isArray(entry.consent_categories) ? entry.consent_categories : [],
    anonymous_id: entry.anonymous_id || null,
    customer_id: entry.customer_id || null,
    session_id: entry.session_id || null,
    ip_hash: entry.ip_hash || (entry.ip ? dailyIpHash(entry.ip) : null),
    request_id: entry.request_id || null,
    meta: entry.meta && typeof entry.meta === 'object' ? entry.meta : {},
  };

  if (pool) {
    await ensureSchema();
    await pool.query(
      `INSERT INTO ai_generation_log (
        id, created_at, app, route, feature, model, provider,
        prompt_hash, prompt_preview, output_hash, output_preview, output_chars,
        latency_ms, success, error, consent_version, consent_categories,
        anonymous_id, customer_id, session_id, ip_hash, request_id, meta
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23
      )`,
      [
        row.id, row.created_at, row.app, row.route, row.feature, row.model, row.provider,
        row.prompt_hash, row.prompt_preview, row.output_hash, row.output_preview, row.output_chars,
        row.latency_ms, row.success, row.error, row.consent_version, JSON.stringify(row.consent_categories),
        row.anonymous_id, row.customer_id, row.session_id, row.ip_hash, row.request_id, JSON.stringify(row.meta),
      ],
    );
  } else {
    fs.mkdirSync(path.dirname(JSONL_PATH), { recursive: true });
    fs.appendFileSync(JSONL_PATH, JSON.stringify(row) + '\n', 'utf8');
  }

  return { id: row.id, created_at: row.created_at };
}

async function listGenerations({ limit = 50, since, feature, app, customer_id } = {}) {
  const lim = Math.max(1, Math.min(1000, Number(limit) || 50));
  if (pool) {
    await ensureSchema();
    const clauses = [];
    const params = [];
    if (since) { params.push(since); clauses.push(`created_at >= $${params.length}`); }
    if (feature) { params.push(feature); clauses.push(`feature = $${params.length}`); }
    if (app) { params.push(app); clauses.push(`app = $${params.length}`); }
    if (customer_id) { params.push(customer_id); clauses.push(`customer_id = $${params.length}`); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    params.push(lim);
    const result = await pool.query(
      `SELECT * FROM ai_generation_log ${where} ORDER BY created_at DESC LIMIT $${params.length}`,
      params,
    );
    return result.rows;
  }

  if (!fs.existsSync(JSONL_PATH)) return [];
  const lines = fs.readFileSync(JSONL_PATH, 'utf8').split('\n').filter(Boolean);
  let rows = lines.map((line) => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
  if (since) rows = rows.filter((r) => r.created_at >= since);
  if (feature) rows = rows.filter((r) => r.feature === feature);
  if (app) rows = rows.filter((r) => r.app === app);
  if (customer_id) rows = rows.filter((r) => r.customer_id === customer_id);
  return rows.slice(-lim).reverse();
}

module.exports = {
  recordGeneration,
  listGenerations,
  sha256,
  preview,
  dailyIpHash,
  ensureSchema,
  JSONL_PATH,
};
