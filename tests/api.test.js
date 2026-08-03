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
  process.env.NODE_ENV = 'test';
  delete require.cache[require.resolve('../lib/store')];
  delete require.cache[require.resolve('../lib/auth')];
  delete require.cache[require.resolve('../lib/customer-data')];
  delete require.cache[require.resolve('../lib/analytics')];
  delete require.cache[require.resolve('../lib/payments')];
  delete require.cache[require.resolve('../lib/rate-limit')];
  delete require.cache[require.resolve('../lib/ai-agent')];
  delete require.cache[require.resolve('../lib/app-pages')];
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

async function registerTrial(base, suffix = Date.now()) {
  const response = await fetch(`${base}/api/account/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Test Traveler', email: `traveler-${suffix}@example.com`, password: 'commercial-password' }),
  });
  assert.equal(response.status, 201);
  return { cookie: response.headers.get('set-cookie').split(';')[0], data: await response.json() };
}

test('health and seed data are served', async () => {
  await withServer(async ({ base }) => {
    const health = await fetch(`${base}/api/health`).then((r) => r.json());
    assert.equal(health.ok, true);
    assert.equal(health.service, 'patwago');
    assert.equal(typeof health.capabilities.grok, 'boolean');
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

test('smart vendor search ranks intent, region, price, rating, and verified filters', async () => {
  await withServer(async ({ base }) => {
    const response = await fetch(`${base}/api/vendors/smart-search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intent: 'beach adventure in Negril', region: 'Negril', maxPrice: 60, minRating: 4.5, verified: true }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.data.length > 0, true);
    assert.equal(payload.data[0].id, 'vendor-negril-sunsets');
    assert.equal(payload.data[0].verified, true);
    assert.equal(payload.data[0].price_from <= 60, true);
    assert.equal(Array.isArray(payload.data[0].match_reasons), true);
  });
});

test('behavioral analytics records allowlisted events and protects owner dashboard', async () => {
  const priorToken = process.env.ADMIN_ANALYTICS_TOKEN;
  process.env.ADMIN_ANALYTICS_TOKEN = 'owner-test-token';
  try {
    await withServer(async ({ base }) => {
      const event = await fetch(`${base}/api/analytics/events`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'vendor_search', session_id: 's1', anonymous_id: 'a1', properties: { region: 'Negril', intent: 'beach', result_count: 3, private_text: 'must not store' } }),
      });
      assert.equal(event.status, 202);
      assert.equal((await fetch(`${base}/api/admin/analytics/summary`)).status, 401);
      const auth = { Authorization: 'Bearer owner-test-token' };
      const summary = await fetch(`${base}/api/admin/analytics/summary`, { headers: auth }).then((r) => r.json());
      assert.equal(summary.data.counts.vendor_search, 1);
      assert.equal(summary.data.storage, 'local-json');
      const events = await fetch(`${base}/api/admin/analytics/events`, { headers: auth }).then((r) => r.json());
      assert.equal(events.data[0].properties.private_text, undefined);
      const page = await fetch(`${base}/admin/analytics`);
      assert.equal(page.status, 200);
      assert.match(await page.text(), /Growth Console/);
    });
  } finally {
    if (priorToken === undefined) delete process.env.ADMIN_ANALYTICS_TOKEN;
    else process.env.ADMIN_ANALYTICS_TOKEN = priorToken;
  }
});

test('account registration rejects short passwords server-side', async () => {
  await withServer(async ({ base }) => {
    const response = await fetch(`${base}/api/account/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Short Password', email: 'short-password@example.com', password: 'seven77' }),
    });
    assert.equal(response.status, 500);
    const payload = await response.json();
    assert.match(payload.message, /at least 8/i);
  });
});

test('login route rate-limits repeated attempts', async () => {
  const priorMax = process.env.LOGIN_RATE_MAX;
  const priorWindow = process.env.LOGIN_RATE_WINDOW_MS;
  process.env.LOGIN_RATE_MAX = '3';
  process.env.LOGIN_RATE_WINDOW_MS = '60000';
  try {
    await withServer(async ({ base }) => {
      const statuses = [];
      let retryAfter = null;
      for (let i = 0; i < 4; i++) {
        const response = await fetch(`${base}/api/account/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'missing@example.com', password: 'wrong-password' }),
        });
        statuses.push(response.status);
        if (response.status === 429) retryAfter = response.headers.get('retry-after');
      }
      assert.deepEqual(statuses, [401, 401, 401, 429]);
      assert.ok(retryAfter);
    });
  } finally {
    if (priorMax === undefined) delete process.env.LOGIN_RATE_MAX;
    else process.env.LOGIN_RATE_MAX = priorMax;
    if (priorWindow === undefined) delete process.env.LOGIN_RATE_WINDOW_MS;
    else process.env.LOGIN_RATE_WINDOW_MS = priorWindow;
  }
});

test('trips, guardian check-ins, and vendor signups persist', async () => {
  await withServer(async ({ base }) => {
    const { cookie } = await registerTrial(base, 'persistence');
    const authHeaders = { 'Content-Type': 'application/json', Cookie: cookie };
    const tripRes = await fetch(`${base}/api/trips`, {
      method: 'POST',
      headers: authHeaders,
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
      headers: authHeaders,
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
      headers: authHeaders,
      body: JSON.stringify({ traveler_name: 'Ray', contact: 'Maya', hours: 2, note: 'Beach day' }),
    }).then((r) => r.json());
    assert.equal(checkin.ok, true);

    const trips = await fetch(`${base}/api/trips`, { headers: { Cookie: cookie } }).then((r) => r.json());
    assert.equal(trips.data.length, 1);

    const signups = await fetch(`${base}/api/vendor-signups`).then((r) => r.json());
    assert.equal(signups.data.length, 1);

    const checkins = await fetch(`${base}/api/guardian/checkins`, { headers: { Cookie: cookie } }).then((r) => r.json());
    assert.equal(checkins.data.length, 1);
  });
});

test('reviews update vendor stats and checkout flow exists', async () => {
  await withServer(async ({ base }) => {
    const { cookie } = await registerTrial(base, 'checkout');
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
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ plan: 'day', amount: 9.99, description: 'Day Pass' }),
    }).then((r) => r.json());
    assert.equal(order.ok, true);
    assert.match(order.approval_url, /^\/checkout\/paypal\//);

    const checkout = await fetch(`${base}${order.approval_url}`).then((r) => r.text());
    assert.match(checkout, /Confirm checkout/);
  });
});

test('real internal app pages and assets are served', async () => {
  await withServer(async ({ base }) => {
    const routes = [
      ['/app', /Your Jamaica trip dashboard/],
      ['/app/translate', /Patois Translator/],
      ['/app/vendors', /Verified Jamaica marketplace/],
      ['/app/trips', /Build your Jamaica itinerary/],
      ['/app/trips/new', /Build my itinerary with AI/],
      ['/app/voice', /Full transcript/],
      ['/app/guardian', /Travel safety check-ins/],
      ['/app/profile', /Pass & account/],
    ];
    for (const [route, expected] of routes) {
      const response = await fetch(`${base}${route}`);
      assert.equal(response.status, 200, route);
      assert.match(await response.text(), expected, route);
    }

    const vendors = await fetch(`${base}/api/vendors?limit=1`).then((r) => r.json());
    const vendor = vendors.data[0];
    const detail = await fetch(`${base}/app/vendor/${encodeURIComponent(vendor.id)}`);
    assert.equal(detail.status, 200);
    assert.match(await detail.text(), new RegExp(vendor.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

    const css = await fetch(`${base}/app/app.css`);
    assert.equal(css.status, 200);
    assert.match(css.headers.get('content-type'), /text\/css/);
    const js = await fetch(`${base}/app/app.js`);
    assert.equal(js.status, 200);
    assert.match(js.headers.get('content-type'), /javascript/);

    const missing = await fetch(`${base}/app/does-not-exist`);
    assert.equal(missing.status, 404);
  });
});

test('sentence translation uses AI output instead of the crude word-replacement fallback', async () => {
  const previousGeminiKey = process.env.GEMINI_API_KEY;
  const previousFetch = global.fetch;
  process.env.GEMINI_API_KEY = 'test-gemini-key';
  global.fetch = async (url, options) => {
    if (String(url).includes('generativelanguage.googleapis.com')) {
      const body = JSON.parse(options.body);
      assert.match(body.contents[0].parts[0].text, /Jamaican Patois translator/);
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: '{"translation":"Weh mi can get di bes food near Negril beach?","ipa":"/wɛ mi kan ɡɛt di bɛs fuːd/"}' }] } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return previousFetch(url, options);
  };
  try {
    await withServer(async ({ base }) => {
      const response = await fetch(`${base}/api/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Where can I get the best food near Negril beach?', from: 'en', to: 'patois' }),
      });
      assert.equal(response.status, 200);
      const payload = await response.json();
      assert.equal(payload.data.source, 'gemini');
      assert.equal(payload.data.translation, 'Weh mi can get di bes food near Negril beach?');
    });
  } finally {
    global.fetch = previousFetch;
    if (previousGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousGeminiKey;
  }
});

test('voice speech uses xAI custom voice before any robotic browser fallback', async () => {
  const previousXaiKey = process.env.XAI_API_KEY;
  const previousVoiceId = process.env.XAI_VOICE_ID;
  const previousFetch = global.fetch;
  process.env.XAI_API_KEY = 'test-xai-key';
  process.env.XAI_VOICE_ID = 'jamaica1';
  global.fetch = async (url, options) => {
    if (String(url) === 'https://api.x.ai/v1/tts') {
      const body = JSON.parse(options.body);
      assert.equal(body.voice_id, 'jamaica1');
      assert.equal(body.language, 'en');
      assert.equal(body.text_normalization, true);
      return new Response(Buffer.from('ID3-test-audio'), { status: 200, headers: { 'Content-Type': 'audio/mpeg' } });
    }
    return previousFetch(url, options);
  };
  try {
    await withServer(async ({ base }) => {
      const response = await fetch(`${base}/api/voice/speech`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Wah gwaan, welcome to Jamaica!' }),
      });
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /audio\/mpeg/);
      assert.equal(Buffer.from(await response.arrayBuffer()).toString(), 'ID3-test-audio');
    });
  } finally {
    global.fetch = previousFetch;
    if (previousXaiKey === undefined) delete process.env.XAI_API_KEY; else process.env.XAI_API_KEY = previousXaiKey;
    if (previousVoiceId === undefined) delete process.env.XAI_VOICE_ID; else process.env.XAI_VOICE_ID = previousVoiceId;
  }
});

test('AI itinerary is catalog-grounded, saved as a trip, and concierge transcripts persist', async () => {
  await withServer(async ({ base }) => {
    const { cookie } = await registerTrial(base, 'ai');
    const authHeaders = { 'Content-Type': 'application/json', Cookie: cookie };
    const plannerPage = await fetch(`${base}/app/trips/new`);
    assert.equal(plannerPage.status, 200);
    assert.match(await plannerPage.text(), /Build my itinerary with AI/);
    const voicePage = await fetch(`${base}/app/voice`);
    assert.equal(voicePage.status, 200);
    assert.match(await voicePage.text(), /Full transcript/);

    const generated = await fetch(`${base}/api/ai/itinerary`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ location: 'Negril', days: 2, interests: ['beach', 'adventure'], pace: 'relaxed' }),
    }).then((r) => r.json());
    assert.equal(generated.ok, true);
    assert.equal(generated.data.days.length, 2);
    const places = await fetch(`${base}/api/places`).then((r) => r.json());
    const placeIds = new Set(places.data.map((place) => place.id));
    generated.data.days.forEach((day) => day.stops.forEach((stop) => assert.equal(placeIds.has(stop.place_id), true)));

    const saved = await fetch(`${base}/api/ai/itinerary/save`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ profile: { location: 'Negril' }, itinerary: generated.data }),
    }).then((r) => r.json());
    assert.equal(saved.ok, true);
    assert.equal(saved.data.items.length, 2);

    const sessionId = 'voice-test';
    const answer = await fetch(`${base}/api/ai/concierge`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ session_id: sessionId, message: 'Where should I go for beaches and adventure?', source: 'voice' }),
    }).then((r) => r.json());
    assert.equal(answer.ok, true);
    assert.match(answer.data.reply, /PatWaGo|consider|Jamaica/i);
    const transcript = await fetch(`${base}/api/ai/transcripts?session_id=${sessionId}`, { headers: { Cookie: cookie } }).then((r) => r.json());
    assert.equal(transcript.data.length, 2);
    assert.deepEqual(transcript.data.map((turn) => turn.role), ['user', 'assistant']);

    const unavailableStt = await fetch(`${base}/api/voice/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'audio/webm' },
      body: Buffer.from('audio'),
    });
    assert.equal(unavailableStt.status, 503);
    const unavailableTts = await fetch(`${base}/api/voice/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'hello' }),
    });
    assert.equal(unavailableTts.status, 503);
  });
});
