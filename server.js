const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');
const store = require('./lib/store');

const ROOT = store.ROOT;
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(ROOT, 'public');
const INDEX_PATH = path.join(ROOT, 'index.html');

function send(res, statusCode, body, headers = {}) {
  res.writeHead(statusCode, headers);
  res.end(body);
  return true;
}

function sendJson(res, statusCode, value) {
  return send(res, statusCode, JSON.stringify(value, null, 2), {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
}

function sendHtml(res, statusCode, html) {
  return send(res, statusCode, html, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
}

function sendText(res, statusCode, text, contentType = 'text/plain; charset=utf-8') {
  return send(res, statusCode, text, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => {
      chunks.push(chunk);
      if (Buffer.concat(chunks).length > 1_000_000) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function parseNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeStaticPath(urlPath) {
  const cleaned = decodeURIComponent(urlPath)
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
  const candidate = path.normalize(path.join(ROOT, cleaned));
  if (!candidate.startsWith(ROOT)) {
    return null;
  }
  return candidate;
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.html': return 'text/html; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.js': return 'application/javascript; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.svg': return 'image/svg+xml';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.webp': return 'image/webp';
    case '.ico': return 'image/x-icon';
    case '.txt': return 'text/plain; charset=utf-8';
    default: return 'application/octet-stream';
  }
}

function serveFile(res, filePath) {
  if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return false;
  }
  const body = fs.readFileSync(filePath);
  send(res, 200, body, {
    'Content-Type': contentType(filePath),
    'Cache-Control': filePath.endsWith('.html') ? 'no-store' : 'public, max-age=3600',
  });
  return true;
}

function renderCheckoutPage(order) {
  const status = order.status === 'completed' ? 'Completed' : 'Awaiting approval';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>PatWaGo checkout</title>
  <style>
    :root{color-scheme:dark;background:#0A0A0A;color:#F8F9FA;font-family:Inter,system-ui,sans-serif}
    body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(circle at top,#1b1b1b,#0A0A0A 60%);padding:24px}
    .card{max-width:540px;width:100%;background:rgba(20,20,20,.82);border:1px solid rgba(255,215,0,.24);border-radius:24px;padding:28px;box-shadow:0 30px 80px rgba(0,0,0,.4)}
    h1{font-family:Anton,Inter,sans-serif;font-size:48px;line-height:1;margin:0 0 8px;color:#FFD700}
    p{line-height:1.6;color:#ADB5BD}
    .row{display:flex;justify-content:space-between;gap:12px;margin:12px 0;padding:12px 0;border-bottom:1px solid rgba(255,255,255,.08)}
    .row strong{color:#fff}
    .btn{display:inline-flex;align-items:center;justify-content:center;border:none;border-radius:999px;padding:14px 22px;font-weight:700;font-size:16px;cursor:pointer;text-decoration:none}
    .btn-gold{background:#FFD700;color:#0A0A0A}
    .btn-ghost{background:rgba(255,255,255,.06);color:#fff;border:1px solid rgba(255,255,255,.12)}
    form{display:flex;gap:12px;flex-wrap:wrap;margin-top:20px}
    input{flex:1;min-width:200px;border-radius:12px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);padding:14px 16px;color:#fff;font:inherit}
    .status{display:inline-block;margin-top:18px;padding:6px 12px;border-radius:999px;background:rgba(45,106,79,.22);color:#8ee6b0;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
    .actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:22px}
  </style>
</head>
<body>
  <main class="card">
    <div class="status">${status}</div>
    <h1>PatWaGo</h1>
    <p>Complete your ${escapeHtml(order.plan)} pass checkout for Jamaica travel, translation, vendors, maps, and Guardian Mode.</p>
    <div class="row"><span>Order</span><strong>${escapeHtml(order.id)}</strong></div>
    <div class="row"><span>Plan</span><strong>${escapeHtml(order.plan)}</strong></div>
    <div class="row"><span>Amount</span><strong>$${Number(order.amount || 0).toFixed(2)}</strong></div>
    <div class="row"><span>Description</span><strong>${escapeHtml(order.description || '')}</strong></div>
    ${order.status === 'completed' ? '<p>Your payment is already marked complete.</p>' : ''}
    <form method="post" action="/api/paypal/orders/${encodeURIComponent(order.id)}/capture">
      <input name="buyer" placeholder="Buyer name or email (optional)" />
      <button class="btn btn-gold" type="submit">Confirm checkout</button>
      <a class="btn btn-ghost" href="/">Back to PatWaGo</a>
    </form>
    <div class="actions">
      <a class="btn btn-ghost" href="/api/health">API health</a>
    </div>
  </main>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function handleApi(req, res, url) {
  const { pathname, searchParams } = url;

  if (req.method === 'GET' && pathname === '/api/health') {
    return sendJson(res, 200, {
      ok: true,
      service: 'patwago',
      time: new Date().toISOString(),
      stats: store.dashboardStats(),
    });
  }

  if (req.method === 'GET' && pathname === '/api/vendors') {
    return sendJson(res, 200, {
      ok: true,
      data: store.listVendors({
        limit: searchParams.get('limit') || undefined,
        category: searchParams.get('category') || undefined,
        q: searchParams.get('q') || undefined,
      }),
    });
  }

  if (req.method === 'GET' && pathname === '/api/places') {
    return sendJson(res, 200, {
      ok: true,
      data: store.listPlaces({ limit: searchParams.get('limit') || undefined }),
    });
  }

  if (req.method === 'GET' && pathname === '/api/photos') {
    return sendJson(res, 200, {
      ok: true,
      data: store.listPlaces({ limit: searchParams.get('limit') || undefined }).map((place) => ({
        id: place.id,
        name: place.name,
        region: place.region,
        photo_url: place.photo_url,
        source_url: place.source_url,
        summary: place.summary,
      })),
    });
  }

  if (req.method === 'GET' && pathname === '/api/lexicon/translate') {
    const result = store.translate(searchParams.get('q') || '');
    return sendJson(res, 200, {
      ok: true,
      ...result,
      query: searchParams.get('q') || '',
    });
  }

  if (req.method === 'GET' && pathname === '/api/trips') {
    return sendJson(res, 200, {
      ok: true,
      data: store.listTrips(),
    });
  }

  if (req.method === 'POST' && pathname === '/api/trips') {
    const body = await readBody(req);
    const trip = store.createTrip(body);
    return sendJson(res, 201, { ok: true, data: trip });
  }

  if (req.method === 'POST' && /^\/api\/trips\/[^/]+\/items$/.test(pathname)) {
    const tripId = decodeURIComponent(pathname.split('/')[3]);
    const body = await readBody(req);
    const result = store.addTripItem(tripId, body);
    if (!result) return sendJson(res, 404, { ok: false, message: 'Trip not found' });
    return sendJson(res, 201, { ok: true, data: result });
  }

  if (req.method === 'GET' && pathname === '/api/reviews') {
    const vendorId = searchParams.get('vendor_id') || searchParams.get('vendorId') || undefined;
    return sendJson(res, 200, {
      ok: true,
      data: store.listReviews({ vendorId }),
    });
  }

  if (req.method === 'POST' && pathname === '/api/reviews') {
    const body = await readBody(req);
    try {
      const review = store.createReview(body);
      return sendJson(res, 201, { ok: true, data: review });
    } catch (error) {
      return sendJson(res, 400, { ok: false, message: error.message });
    }
  }

  if (req.method === 'GET' && pathname === '/api/guardian/checkins') {
    return sendJson(res, 200, {
      ok: true,
      data: store.listGuardianCheckins(),
    });
  }

  if (req.method === 'POST' && pathname === '/api/guardian/checkins') {
    const body = await readBody(req);
    const checkin = store.createGuardianCheckin(body);
    return sendJson(res, 201, { ok: true, data: checkin });
  }

  if (req.method === 'GET' && pathname === '/api/vendor-signups') {
    return sendJson(res, 200, { ok: true, data: store.listVendorSignups() });
  }

  if (req.method === 'POST' && pathname === '/api/vendor-signups') {
    const body = await readBody(req);
    const signup = store.createVendorSignup(body);
    return sendJson(res, 201, { ok: true, data: signup });
  }

  if (req.method === 'POST' && pathname === '/api/paypal/purchase-pass') {
    const body = await readBody(req);
    const order = store.createPaymentOrder(body);
    return sendJson(res, 201, {
      ok: true,
      approval_url: order.approval_url,
      approvalUrl: order.approval_url,
      order_id: order.id,
      orderId: order.id,
      data: order,
      environment: 'local-demo',
    });
  }

  if (req.method === 'POST' && /^\/api\/paypal\/orders\/[^/]+\/capture$/.test(pathname)) {
    const orderId = decodeURIComponent(pathname.split('/')[4]);
    let body = {};
    try {
      body = await readBody(req);
    } catch {
      body = {};
    }
    const order = store.capturePayment(orderId, body);
    if (!order) return sendJson(res, 404, { ok: false, message: 'Order not found' });
    if (req.headers.accept && req.headers.accept.includes('text/html')) {
      return sendHtml(res, 200, `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>PatWaGo payment complete</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0A0A0A;color:#fff;font-family:Inter,system-ui,sans-serif}.card{max-width:520px;background:rgba(20,20,20,.8);border:1px solid rgba(255,215,0,.2);border-radius:24px;padding:32px}.btn{display:inline-flex;padding:12px 18px;border-radius:999px;background:#FFD700;color:#0A0A0A;text-decoration:none;font-weight:700}</style></head><body><div class="card"><h1>Payment complete</h1><p>Your ${escapeHtml(order.plan)} pass has been captured.</p><a class="btn" href="/">Return to PatWaGo</a></div></body></html>`);
    }
    return sendJson(res, 200, { ok: true, data: order });
  }

  if (req.method === 'GET' && pathname === '/api/dashboard') {
    return sendJson(res, 200, {
      ok: true,
      data: store.dashboardStats(),
    });
  }

  return null;
}

function handleCheckout(req, res, url) {
  const match = url.pathname.match(/^\/checkout\/paypal\/([^/]+)$/);
  if (!match || req.method !== 'GET') return null;
  const order = store.getPaymentOrder(match[1]);
  if (!order) return sendText(res, 404, 'Checkout order not found');
  return sendHtml(res, 200, renderCheckoutPage(order));
}

function handleStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;

  const pathname = decodeURIComponent(url.pathname);
  if (pathname === '/' || pathname === '') {
    return serveFile(res, INDEX_PATH) || false;
  }

  const publicCandidate = path.join(PUBLIC_DIR, pathname.replace(/^\//, ''));
  if (serveFile(res, publicCandidate)) return true;

  const rootCandidate = normalizeStaticPath(pathname);
  if (rootCandidate && serveFile(res, rootCandidate)) return true;

  return false;
}

async function requestListener(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || `localhost:${PORT}`}`);

  if (url.pathname.startsWith('/api/')) {
    try {
      const handled = await handleApi(req, res, url);
      if (handled) return;
    } catch (error) {
      const status = /JSON|body too large/i.test(error.message) ? 400 : 500;
      return sendJson(res, status, { ok: false, message: error.message });
    }
    return sendJson(res, 404, { ok: false, message: 'Not found' });
  }

  const checkout = handleCheckout(req, res, url);
  if (checkout) return;

  if (handleStatic(req, res, url)) return;

  if (req.method === 'GET') {
    return serveFile(res, INDEX_PATH) || sendText(res, 404, 'Not found');
  }

  return sendJson(res, 404, { ok: false, message: 'Not found' });
}

function createServer() {
  return http.createServer(requestListener);
}

if (require.main === module) {
  const server = createServer();
  server.listen(PORT, HOST, () => {
    console.log(`PatWaGo backend listening on http://${HOST}:${PORT}`);
  });
}

module.exports = {
  createServer,
  requestListener,
};
