const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const seedFile = path.join(repoRoot, 'data', 'seed.json');

function consentHeader(categories) {
  const record = {
    version: '2026-08-04',
    accepted_at: new Date().toISOString(),
    categories: Object.assign({
      essential: true,
      ai_processing: false,
      analytics: false,
      location: false,
      marketing: false,
    }, categories),
    policy_version: 'sgi-eu-v1',
    source: 'test',
    anonymous_id: 'anon-test',
  };
  return Buffer.from(JSON.stringify(record), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function makeTempDataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'patwago-consent-'));
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  fs.copyFileSync(seedFile, path.join(dir, 'data', 'seed.json'));
  return path.join(dir, 'data');
}

function loadFreshServer(dataDir) {
  process.env.PATWAGO_DATA_DIR = dataDir;
  process.env.PATWAGO_STATE_FILE = path.join(dataDir, 'state.json');
  process.env.GENERATION_LOG_PATH = path.join(dataDir, 'generation-log.jsonl');
  process.env.AUDIT_IP_SALT = 'test-salt';
  process.env.NODE_ENV = 'test';
  process.env.CONSENT_ENFORCE = '1';
  process.env.ALLOW_IN_MEMORY_AUTH = 'true';
  for (const rel of [
    '../lib/store',
    '../lib/auth',
    '../lib/customer-data',
    '../lib/analytics',
    '../lib/payments',
    '../lib/rate-limit',
    '../lib/google-maps',
    '../lib/ai-agent',
    '../lib/app-pages',
    '../lib/consent',
    '../lib/generation-log',
    '../server',
  ]) {
    try { delete require.cache[require.resolve(rel)]; } catch (_) {}
  }
  return require('../server');
}

async function withServer(fn) {
  const dataDir = makeTempDataDir();
  const { createServer } = loadFreshServer(dataDir);
  const server = createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    await fn({ base, dataDir });
  } finally {
    delete process.env.CONSENT_ENFORCE;
    await new Promise((resolve) => server.close(resolve));
  }
}

test('AI routes require consent and write generation audit log', async () => {
  await withServer(async ({ base, dataDir }) => {
    const blocked = await fetch(`${base}/api/demo/concierge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Where is jerk chicken?' }),
    });
    assert.equal(blocked.status, 403);
    const blockedBody = await blocked.json();
    assert.equal(blockedBody.code, 'CONSENT_REQUIRED');

    const essentialOnly = await fetch(`${base}/api/demo/concierge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Data-Consent': consentHeader({ ai_processing: false }),
      },
      body: JSON.stringify({ message: 'Where is jerk chicken?' }),
    });
    assert.equal(essentialOnly.status, 403);
    assert.equal((await essentialOnly.json()).code, 'CONSENT_CATEGORY_REQUIRED');

    const ok = await fetch(`${base}/api/demo/concierge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Data-Consent': consentHeader({ ai_processing: true }),
      },
      body: JSON.stringify({ message: 'Where is jerk chicken near Negril?' }),
    });
    assert.equal(ok.status, 200);
    const payload = await ok.json();
    assert.equal(payload.ok, true);
    assert.ok(payload.generation_id, 'generation_id required');
    assert.ok(payload.data?.reply);

    const logPath = path.join(dataDir, 'generation-log.jsonl');
    assert.ok(fs.existsSync(logPath), 'generation log file should exist');
    const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean);
    assert.ok(lines.length >= 1);
    const row = JSON.parse(lines.at(-1));
    assert.equal(row.id, payload.generation_id);
    assert.ok(row.created_at);
    assert.match(row.created_at, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(row.feature, 'demo_concierge');
    assert.equal(row.app, 'patwago');
    assert.ok(row.prompt_hash);
    assert.ok(row.output_hash);
    assert.equal(row.success, true);
  });
});

test('analytics events require analytics consent category', async () => {
  await withServer(async ({ base }) => {
    const blocked = await fetch(`${base}/api/analytics/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'page_view', properties: { path: '/' } }),
    });
    assert.equal(blocked.status, 403);

    const ok = await fetch(`${base}/api/analytics/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Data-Consent': consentHeader({ analytics: true }),
      },
      body: JSON.stringify({
        name: 'page_view',
        session_id: 's1',
        anonymous_id: 'a1',
        properties: { path: '/' },
      }),
    });
    assert.equal(ok.status, 202);
  });
});

test('consent gate script and legal notice are served', async () => {
  await withServer(async ({ base }) => {
    const js = await fetch(`${base}/app/consent-gate.js`);
    assert.equal(js.status, 200);
    assert.match(await js.text(), /euConsentGate|AppConsent|ai_processing/);

    const landing = await fetch(`${base}/`);
    assert.equal(landing.status, 200);
    const html = await landing.text();
    assert.match(html, /consent-gate\.js/);
    assert.match(html, /eu-consent|EU Data Consent/);
  });
});
