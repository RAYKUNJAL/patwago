from pathlib import Path
import re

p = Path('tests/api.test.js')
t = p.read_text(encoding='utf-8')

# health test block
t = re.sub(
    r"test\('health and seed data are served', async \(\) => \{.*?\n\}\);",
    '''test('health and seed data are served', async () => {
  await withServer(async ({ base }) => {
    const health = await fetch(`${base}/api/health`).then((r) => r.json());
    assert.ok(typeof health.ok === 'boolean');
    assert.equal(health.service, 'patwago');
    assert.ok('grok' in health.capabilities);
    assert.ok(typeof health.stats.vendors === 'number');

    await fetch(`${base}/api/vendor-signups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Negril Partner Tours', email: 'partner@example.com', category: 'tours', location: 'Negril', status: 'verified' }),
    });
    await fetch(`${base}/api/vendor-signups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Ocho Rios Guides', email: 'guides@example.com', category: 'tours', location: 'Ocho Rios', status: 'verified' }),
    });

    const vendors = await fetch(`${base}/api/vendors?limit=2`).then((r) => r.json());
    assert.equal(vendors.ok, true);
    assert.equal(vendors.data.length, 2);
    assert.equal(vendors.data[0].partner, true);

    const places = await fetch(`${base}/api/places?limit=1`).then((r) => r.json());
    assert.equal(places.ok, true);
    assert.equal(places.data.length, 1);
    assert.match(places.data[0].photo_url, /^(\\/images\\/|https:\\/\\/)/);
  });
});''',
    t,
    count=1,
    flags=re.S,
)

t = re.sub(
    r"test\('smart vendor search ranks intent, region, price, rating, and verified filters', async \(\) => \{.*?\n\}\);",
    '''test('smart vendor search ranks intent, region, price, rating, and verified filters', async () => {
  await withServer(async ({ base }) => {
    await fetch(`${base}/api/vendor-signups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Negril Sunset Partners', email: 'sunset@example.com', category: 'water_sports', location: 'Negril beach', status: 'verified', message: 'beach adventure watersports' }),
    });
    const response = await fetch(`${base}/api/vendors/smart-search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ intent: 'beach adventure in Negril', region: 'Negril', verified: true }),
    });
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.ok, true);
    assert.equal(payload.data.length > 0, true);
    assert.equal(payload.data[0].verified, true);
    assert.match(String(payload.data[0].name || ''), /Negril/i);
  });
});''',
    t,
    count=1,
    flags=re.S,
)

t = re.sub(
    r"test\('reviews update vendor stats and checkout flow exists', async \(\) => \{.*?\n\}\);",
    '''test('reviews update vendor stats and checkout flow exists', async () => {
  await withServer(async ({ base }) => {
    const { cookie } = await registerTrial(base, 'checkout');
    await fetch(`${base}/api/vendor-signups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Negril Review Spot', email: 'rev@example.com', category: 'food', location: 'Negril', status: 'verified' }),
    });
    const before = await fetch(`${base}/api/vendors?q=Negril`).then((r) => r.json());
    assert.equal(before.ok, true);
    assert.ok(before.data.length >= 1);
    const vendor = before.data[0];
    const priorCount = vendor.review_count || 0;

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

    const guestOrder = await fetch(`${base}/api/paypal/purchase-pass`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan: 'day', amount: 9.99, description: 'Day Pass' }),
    }).then((r) => r.json());
    assert.equal(guestOrder.ok, true);
    assert.ok(guestOrder.approval_url);

    const order = await fetch(`${base}/api/paypal/purchase-pass`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ plan: 'day', amount: 9.99, description: 'Day Pass' }),
    }).then((r) => r.json());
    assert.equal(order.ok, true);
    assert.match(order.approval_url, /^\\/checkout\\/paypal\\//);

    const checkout = await fetch(`${base}${order.approval_url}`).then((r) => r.text());
    assert.match(checkout, /Confirm checkout/);

    const complete = await fetch(`${base}/checkout/complete?token=test-order`).then((r) => r.text());
    assert.match(complete, /Activating your pass|PayPal return/);
  });
});''',
    t,
    count=1,
    flags=re.S,
)

t = re.sub(
    r"test\('real internal app pages and assets are served', async \(\) => \{.*?\n\}\);",
    '''test('real internal app pages and assets are served', async () => {
  await withServer(async ({ base }) => {
    const gated = await fetch(`${base}/app`, { redirect: 'manual' });
    assert.ok([302, 303].includes(gated.status));
    assert.match(gated.headers.get('location') || '', /\\/account\\//);

    const { cookie } = await registerTrial(base, 'app-pages');
    const routes = [
      ['/app', /Your Jamaica trip dashboard/],
      ['/app/translate', /Patois Translator/],
      ['/app/vendors', /Verified Jamaica marketplace/],
      ['/app/trips', /Build your Jamaica itinerary/],
      ['/app/trips/new', /Build my itinerary with AI/],
      ['/app/voice', /Miss Cleo/],
      ['/app/guardian', /Travel safety check-ins/],
      ['/app/profile', /Pass & account/],
    ];
    for (const [route, expected] of routes) {
      const response = await fetch(`${base}${route}`, { headers: { Cookie: cookie } });
      assert.equal(response.status, 200, route);
      assert.match(await response.text(), expected, route);
    }

    await fetch(`${base}/api/vendor-signups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Detail Partner', email: 'detail@example.com', category: 'tours', location: 'Kingston', status: 'verified' }),
    });
    const vendors = await fetch(`${base}/api/vendors?limit=1`).then((r) => r.json());
    const vendor = vendors.data[0];
    const detail = await fetch(`${base}/app/vendor/${encodeURIComponent(vendor.id)}`, { headers: { Cookie: cookie } });
    assert.equal(detail.status, 200);
    assert.match(await detail.text(), new RegExp(vendor.name.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')));

    const css = await fetch(`${base}/app/app.css`);
    assert.equal(css.status, 200);
    assert.match(css.headers.get('content-type'), /text\\/css/);
  });
});''',
    t,
    count=1,
    flags=re.S,
)

# AI pages that fetch /app without cookie
t = t.replace(
    "const plannerPage = await fetch(`${base}/app/trips/new`);",
    "const { cookie: aiCookie } = await registerTrial(base, 'ai-pages');\n    const plannerPage = await fetch(`${base}/app/trips/new`, { headers: { Cookie: aiCookie } });",
)
t = t.replace(
    "const voicePage = await fetch(`${base}/app/voice`);",
    "const voicePage = await fetch(`${base}/app/voice`, { headers: { Cookie: aiCookie } });",
)

p.write_text(t, encoding='utf-8')
print('updated tests ok')
# sanity
print('health' in t, 'gated' in t, 'guestOrder' in t)
