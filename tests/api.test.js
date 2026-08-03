const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const seedFile = path.join(repoRoot, 'data', 'seed.json');

function makeTempDataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'patwago-test-'));
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  fs.copyFileSync(seedFile, path.join(dir, 'data', 'seed.json'));
  return path.join(dir, 'data');
}

function loadFreshServer(dataDir) {
  process.env.PATWAGO_DATA_DIR = dataDir;
  process.env.PATWAGO_STATE_FILE = path.join(dataDir, 'state.json');
  delete require.cache[require.resolve('../lib/store')];
  delete require.cache[require.resolve('../server')];
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
    await new Promise((resolve) => server.close(resolve));
  }
}

test('health and seed data are served', async () => {
  await withServer(async ({ base }) => {
    const health = await fetch(`${base}/api/health`).then((r) => r.json());
    assert.equal(health.ok, true);
    assert.equal(health.service, 'patwago');
    assert.ok(health.stats.vendors >= 5);

    const vendors = await fetch(`${base}/api/vendors?limit=2`).then((r) => r.json());
    assert.equal(vendors.ok, true);
    assert.equal(vendors.data.length, 2);
    assert.match(vendors.data[0].photo_url, /^(\/images\/|https:\/\/)/);

    const places = await fetch(`${base}/api/places?limit=1`).then((r) => r.json());
    assert.equal(places.ok, true);
    assert.equal(places.data.length, 1);
    assert.match(places.data[0].photo_url, /^(\/images\/|https:\/\/)/);
  });
});

test('trips, guardian check-ins, and vendor signups persist', async () => {
  await withServer(async ({ base }) => {
    const tripRes = await fetch(`${base}/api/trips`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Beach and Culture',
        destination: 'Jamaica',
        days: 4,
        startDate: '2026-08-10',
        notes: 'Start in Kingston, then head west.',
      }),
    }).then((r) => r.json());
    assert.equal(tripRes.ok, true);
    const tripId = tripRes.data.id;

    const itemRes = await fetch(`${base}/api/trips/${encodeURIComponent(tripId)}/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Seven Mile Beach', note: 'Sunset swim', place_id: 'seven-mile-beach' }),
    }).then((r) => r.json());
    assert.equal(itemRes.ok, true);
    assert.equal(itemRes.data.trip.items.length, 1);

    const signup = await fetch(`${base}/api/vendor-signups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Blue Lagoon Water Sports',
        email: 'hello@example.com',
        category: 'water_sports',
        location: 'Port Antonio',
      }),
    }).then((r) => r.json());
    assert.equal(signup.ok, true);

    const checkin = await fetch(`${base}/api/guardian/checkins`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ traveler_name: 'Ray', contact: 'Maya', hours: 2, note: 'Beach day' }),
    }).then((r) => r.json());
    assert.equal(checkin.ok, true);

    const trips = await fetch(`${base}/api/trips`).then((r) => r.json());
    assert.equal(trips.data.length >= 2, true);

    const signups = await fetch(`${base}/api/vendor-signups`).then((r) => r.json());
    assert.equal(signups.data.length, 1);

    const checkins = await fetch(`${base}/api/guardian/checkins`).then((r) => r.json());
    assert.equal(checkins.data.length >= 2, true);
  });
});

test('reviews update vendor stats and checkout flow exists', async () => {
  await withServer(async ({ base }) => {
    const before = await fetch(`${base}/api/vendors?q=Negril`).then((r) => r.json());
    assert.equal(before.ok, true);
    const vendor = before.data[0];
    const priorCount = vendor.review_count;

    const review = await fetch(`${base}/api/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        vendor_id: vendor.id,
        author: 'Test Traveler',
        country: 'TT',
        rating: 5,
        body: 'Loved it.',
      }),
    }).then((r) => r.json());
    assert.equal(review.ok, true);

    const after = await fetch(`${base}/api/vendors?q=Negril`).then((r) => r.json());
    assert.equal(after.data[0].review_count, priorCount + 1);
    assert.ok(after.data[0].avg_rating >= vendor.avg_rating);

    const order = await fetch(`${base}/api/paypal/purchase-pass`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: 'day', amount: 9.99, description: 'Day Pass' }),
    }).then((r) => r.json());
    assert.equal(order.ok, true);
    assert.match(order.approval_url, /^\/checkout\/paypal\//);

    const checkout = await fetch(`${base}${order.approval_url}`).then((r) => r.text());
    assert.match(checkout, /Confirm checkout/);
  });
});
