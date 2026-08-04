const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');
const store = require('./lib/store');
const appPages = require('./lib/app-pages');
const aiAgent = require('./lib/ai-agent');
const translator = require('./lib/translator');
const analytics = require('./lib/analytics');
const auth = require('./lib/auth');
const { createPayPalService, PLAN_PRICES } = require('./lib/paypal');
const customerData = require('./lib/customer-data');
const payments = require('./lib/payments');
const { createRateLimiter } = require('./lib/rate-limit');
const googleMaps = require('./lib/google-maps');
const { speakWithElevenLabs } = require('./lib/elevenlabs');
// Landing demo TTS limits (per IP). Only successful audio responses count.
const demoAttempts = new Map();
const DEMO_MAX_ATTEMPTS = Number(process.env.DEMO_TTS_MAX_ATTEMPTS || 25);
const DEMO_WINDOW_MS = Number(process.env.DEMO_TTS_WINDOW_MS || 60 * 60 * 1000);
const DEMO_COOLDOWN_MS = Number(process.env.DEMO_TTS_COOLDOWN_MS || 1500);

function getDemoLimitState(ip) {
  const now = Date.now();
  const record = demoAttempts.get(ip);
  if (!record || now > record.resetAt) {
    return { allowed: true, remaining: DEMO_MAX_ATTEMPTS, retryAfter: 0, record: null, now };
  }
  if (now - record.lastAttempt < DEMO_COOLDOWN_MS) {
    return {
      allowed: false,
      remaining: Math.max(0, DEMO_MAX_ATTEMPTS - record.count),
      retryAfter: Math.ceil((DEMO_COOLDOWN_MS - (now - record.lastAttempt)) / 1000),
      record,
      now,
    };
  }
  if (record.count >= DEMO_MAX_ATTEMPTS) {
    return {
      allowed: false,
      remaining: 0,
      retryAfter: Math.ceil((record.resetAt - now) / 1000),
      record,
      now,
    };
  }
  return {
    allowed: true,
    remaining: Math.max(0, DEMO_MAX_ATTEMPTS - record.count),
    retryAfter: 0,
    record,
    now,
  };
}

function consumeDemoAttempt(ip, state) {
  const now = state?.now || Date.now();
  const record = state?.record;
  if (!record || now > record.resetAt) {
    demoAttempts.set(ip, { count: 1, resetAt: now + DEMO_WINDOW_MS, lastAttempt: now });
    return Math.max(0, DEMO_MAX_ATTEMPTS - 1);
  }
  record.count += 1;
  record.lastAttempt = now;
  return Math.max(0, DEMO_MAX_ATTEMPTS - record.count);
}

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

function readRawBody(req, maxBytes = 25_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function multipartAudio(audio, contentType) {
  const boundary = `patwago-${Date.now().toString(16)}`;
  const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="voice.webm"\r\nContent-Type: ${contentType || 'audio/webm'}\r\n\r\n`);
  const model = Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\n${process.env.WHISPER_MODEL || 'Systran/faster-whisper-small'}\r\n--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\nen\r\n--${boundary}--\r\n`);
  return { body: Buffer.concat([head, audio, model]), contentType: `multipart/form-data; boundary=${boundary}` };
}

function parseNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeStaticPath(urlPath, baseDir = ROOT) {
  const cleaned = decodeURIComponent(urlPath)
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
  const normalizedBase = path.normalize(baseDir);
  const candidate = path.normalize(path.join(normalizedBase, cleaned));
  const baseWithSep = normalizedBase.endsWith(path.sep) ? normalizedBase : `${normalizedBase}${path.sep}`;
  if (candidate !== normalizedBase && !candidate.startsWith(baseWithSep)) {
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

function renderCheckoutCompletePage(token) {
  const orderId = String(token || '').trim();
  const safeId = escapeHtml(orderId);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Checkout complete — PatWaGo</title>
  <style>
    :root{color-scheme:dark;background:#0A0A0A;color:#F8F9FA;font-family:Inter,system-ui,sans-serif}
    body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(circle at top,#1b1b1b,#0A0A0A 60%);padding:24px}
    .card{max-width:560px;width:100%;background:rgba(20,20,20,.9);border:1px solid rgba(255,215,0,.24);border-radius:24px;padding:28px;box-shadow:0 30px 80px rgba(0,0,0,.4)}
    h1{font-family:Anton,Inter,sans-serif;font-size:42px;line-height:1;margin:0 0 10px;color:#FFD700}
    p{line-height:1.6;color:#ADB5BD}
    .status{display:inline-block;margin-bottom:14px;padding:6px 12px;border-radius:999px;background:rgba(255,215,0,.12);color:#FFD700;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
    .btn{display:inline-flex;align-items:center;justify-content:center;border:none;border-radius:999px;padding:14px 22px;font-weight:700;font-size:15px;cursor:pointer;text-decoration:none}
    .btn-gold{background:#FFD700;color:#0A0A0A}
    .btn-ghost{background:rgba(255,255,255,.06);color:#fff;border:1px solid rgba(255,255,255,.12)}
    .actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:22px}
    #msg{margin-top:14px;min-height:1.4em}
    .ok{color:#8ee6b0}.err{color:#ff9090}
  </style>
</head>
<body>
  <main class="card">
    <div class="status">PayPal return</div>
    <h1>Activating your pass</h1>
    <p>We're confirming your PayPal payment and unlocking PatWaGo. Keep this page open for a moment.</p>
    <p id="msg">Confirming order${orderId ? ` <strong>${safeId}</strong>` : ''}…</p>
    <div class="actions">
      <a class="btn btn-gold" href="/account/login?next=/app">Sign in / create account</a>
      <a class="btn btn-ghost" href="/#pricing">Back to pricing</a>
    </div>
  </main>
  <script>
  (function(){
    var orderId=${JSON.stringify(orderId)};
    var msg=document.getElementById('msg');
    if(!orderId){
      msg.className='err';
      msg.textContent='Missing PayPal order token. Return to pricing and try again.';
      return;
    }
    fetch('/api/paypal/orders/'+encodeURIComponent(orderId)+'/capture',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      credentials:'include',
      body:'{}'
    }).then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j}})}).then(function(res){
      if(!res.ok || !res.j || res.j.ok===false){
        throw new Error((res.j&&res.j.message)||'Capture failed');
      }
      var data=res.j.data||{};
      if(data.pass){
        msg.className='ok';
        msg.textContent='Payment complete. Your pass is active — opening the app…';
        setTimeout(function(){ window.location.href='/app'; }, 900);
        return;
      }
      msg.className='ok';
      msg.textContent='Payment received. Sign in or create your account to attach this pass, then open the app.';
      try{ localStorage.setItem('patwago_pending_order', orderId); }catch(e){}
    }).catch(function(err){
      msg.className='err';
      msg.textContent=(err&&err.message)||'Could not confirm payment. If PayPal charged you, sign in and contact support with your order id.';
    });
  })();
  </script>
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

function timingSafeEqual(value, expected) {
  const a = Buffer.from(String(value || ''));
  const b = Buffer.from(String(expected || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requireAdmin(req, res) {
  const expected = process.env.ADMIN_ANALYTICS_TOKEN || '';
  if (!expected) {
    sendJson(res, 503, { ok: false, message: 'Admin analytics is not configured' });
    return false;
  }
  const supplied = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!timingSafeEqual(supplied, expected)) {
    sendJson(res, 401, { ok: false, message: 'Unauthorized' });
    return false;
  }
  return true;
}

function bearerToken(req) {
  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (bearer) return bearer;
  const cookies = String(req.headers.cookie || '').split(';').map((part) => part.trim().split('='));
  const found = cookies.find((pair) => pair[0] === 'patwago_session');
  return found ? decodeURIComponent(found.slice(1).join('=')) : '';
}

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `patwago_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `patwago_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
}

async function customerSession(req) {
  const token = bearerToken(req);
  if (!token) return null;
  return auth.getSession(token);
}

function publicBaseUrl(req) {
  const configured = process.env.PUBLIC_BASE_URL || process.env.APP_BASE_URL || '';
  if (configured) return configured.replace(/\/$/, '');
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'patwago.com';
  const proto = req.headers['x-forwarded-proto'] || (process.env.NODE_ENV === 'production' ? 'https' : 'http');
  return `${proto}://${host}`;
}

let googleListingCache = { at: 0, count: 0 };
async function liveGoogleListingCount() {
  const now = Date.now();
  if (now - googleListingCache.at < 30 * 60 * 1000 && googleListingCache.count > 0) return googleListingCache.count;
  try {
    const rows = await googleMaps.marketplaceSearch({ query: 'Jamaica restaurants tours attractions', region: 'Jamaica', limit: 20 });
    googleListingCache = { at: now, count: Array.isArray(rows) ? rows.length : 0 };
  } catch {
    // keep previous cache on failure
  }
  return googleListingCache.count;
}

async function requireCustomer(req, res, requirePass) {
  const session = await customerSession(req);
  if (!session) {
    sendJson(res, 401, { ok: false, message: 'Sign in required' });
    return null;
  }
  if (requirePass && !(await auth.hasActivePass(session.customer_id))) {
    sendJson(res, 402, { ok: false, message: 'An active trial or pass is required', code: 'PASS_REQUIRED' });
    return null;
  }
  return session;
}

function paypalService() {
  return createPayPalService({ env: process.env, fetch: globalThis.fetch });
}

function shouldUseLocalCheckoutFallback(error) {
  return process.env.NODE_ENV !== 'production' && /PayPal service requires/i.test(error.message || '');
}

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

const loginLimiter = createRateLimiter({
  windowMs: Number(process.env.LOGIN_RATE_WINDOW_MS || 15 * 60 * 1000),
  max: Number(process.env.LOGIN_RATE_MAX || 10),
});

const registerLimiter = createRateLimiter({
  windowMs: Number(process.env.REGISTER_RATE_WINDOW_MS || 60 * 60 * 1000),
  max: Number(process.env.REGISTER_RATE_MAX || 20),
});

function rateLimited(res, limiter, key) {
  const result = limiter.check(key);
  if (!result.allowed) {
    res.setHeader('Retry-After', String(Math.ceil(result.retryAfterMs / 1000)));
    sendJson(res, 429, { ok: false, message: 'Too many attempts. Please try again shortly.' });
    return true;
  }
  return false;
}

async function handleApi(req, res, url) {
  const { pathname, searchParams } = url;

  if (req.method === 'GET' && pathname === '/api/health') {
    const stats = store.dashboardStats();
    const googleListings = await liveGoogleListingCount();
    return sendJson(res, 200, {
      ok: true,
      service: 'patwago',
      time: new Date().toISOString(),
      stats: {
        ...stats,
        google_listings: googleListings,
        vendors: stats.verified_vendors,
      },
      capabilities: {
        grok: Boolean(process.env.XAI_API_KEY),
        google_maps: googleMaps.configured(),
        self_hosted_stt: Boolean(process.env.WHISPER_URL),
        self_hosted_tts: Boolean(process.env.TTS_BASE_URL),
      },
    });
  }

  if (req.method === 'POST' && pathname === '/api/analytics/events') {
    const body = await readBody(req);
    try {
      await analytics.record(body);
      return sendJson(res, 202, { ok: true });
    } catch (error) {
      return sendJson(res, 400, { ok: false, message: error.message });
    }
  }

  if (req.method === 'GET' && pathname === '/api/admin/analytics/summary') {
    if (!requireAdmin(req, res)) return true;
    return sendJson(res, 200, { ok: true, data: await analytics.summary(searchParams.get('days') || 30) });
  }

  if (req.method === 'GET' && pathname === '/api/admin/analytics/events') {
    if (!requireAdmin(req, res)) return true;
    return sendJson(res, 200, { ok: true, data: await analytics.list({ limit: searchParams.get('limit'), name: searchParams.get('name'), since: searchParams.get('since') }) });
  }

  if (req.method === 'POST' && pathname === '/api/account/register') {
    if (rateLimited(res, registerLimiter, `register:${clientIp(req)}`)) return true;
    const body = await readBody(req);
    const customer = await auth.registerCustomer(body);
    const session = await auth.createSession({ customer_id: customer.id });
    const trial = await auth.createPass({ customer_id: customer.id, plan: 'trial' });
    setSessionCookie(res, session.token);
    await analytics.record({ name: 'signup_complete', session_id: session.token, anonymous_id: body.anonymous_id, properties: { success: true } });
    return sendJson(res, 201, { ok: true, data: { customer, session, pass: trial } });
  }

  if (req.method === 'POST' && pathname === '/api/account/login') {
    if (rateLimited(res, loginLimiter, `login:${clientIp(req)}`)) return true;
    const body = await readBody(req);
    const customer = await auth.authenticateCustomer(body);
    if (!customer) return sendJson(res, 401, { ok: false, message: 'Invalid email or password' });
    const session = await auth.createSession({ customer_id: customer.id });
    setSessionCookie(res, session.token);
    const passes = await auth.listPasses(customer.id);
    return sendJson(res, 200, { ok: true, data: { customer, session, passes, active_pass: await auth.hasActivePass(customer.id) } });
  }

  if (req.method === 'GET' && pathname === '/api/account/me') {
    const session = await requireCustomer(req, res, false);
    if (!session) return true;
    return sendJson(res, 200, { ok: true, data: { customer: await auth.getCustomerById(session.customer_id), passes: await auth.listPasses(session.customer_id), active_pass: await auth.hasActivePass(session.customer_id) } });
  }

  if (req.method === 'POST' && pathname === '/api/account/logout') {
    const token = bearerToken(req);
    if (token) await auth.destroySession(token);
    clearSessionCookie(res);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'POST' && pathname === '/api/voice/transcribe') {
    const whisperUrl = process.env.WHISPER_URL || '';
    if (!whisperUrl) return sendJson(res, 503, { ok: false, message: 'Self-hosted transcription is not configured' });
    const audio = await readRawBody(req);
    if (!audio.length) return sendJson(res, 400, { ok: false, message: 'Audio is required' });
    const form = multipartAudio(audio, req.headers['content-type']);
    const upstream = await fetch(`${whisperUrl.replace(/\/$/, '')}/v1/audio/transcriptions`, {
      method: 'POST', headers: { 'Content-Type': form.contentType }, body: form.body, signal: AbortSignal.timeout(120_000),
    });
    const payload = await upstream.json();
    if (!upstream.ok) return sendJson(res, 502, { ok: false, message: payload.detail || payload.error?.message || 'Transcription failed' });
    return sendJson(res, 200, { ok: true, text: payload.text || '', data: payload });
  }

  if (req.method === 'POST' && pathname === '/api/voice/speech') {
    const body = await readBody(req);
    const text = String(body.text || '').trim().slice(0, 15000);
    if (!text) return sendJson(res, 400, { ok: false, message: 'text is required' });

    if (process.env.XAI_API_KEY) {
      const upstream = await fetch('https://api.x.ai/v1/tts', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.XAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          voice_id: process.env.XAI_VOICE_ID || 'castor',
          language: 'en',
          speed: Number(process.env.XAI_VOICE_SPEED || 0.96),
          text_normalization: true,
        }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!upstream.ok) {
        const detail = await upstream.text();
        return sendJson(res, 502, { ok: false, message: `xAI speech failed: ${detail.slice(0, 400)}` });
      }
      return send(res, 200, Buffer.from(await upstream.arrayBuffer()), {
        'Content-Type': upstream.headers.get('content-type') || 'audio/mpeg',
        'Cache-Control': 'no-store',
        'X-Voice-Provider': 'xai',
      });
    }

    const ttsUrl = process.env.TTS_BASE_URL || '';
    if (!ttsUrl) return sendJson(res, 503, { ok: false, message: 'Expressive voice is not configured' });
    const upstream = await fetch(`${ttsUrl.replace(/\/$/, '')}/v1/audio/speech`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.TTS_MODEL || 'chatterbox', voice: process.env.TTS_VOICE || 'jamaican-concierge', input: text, response_format: 'mp3' }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!upstream.ok) return sendJson(res, 502, { ok: false, message: 'Speech generation failed' });
    return send(res, 200, Buffer.from(await upstream.arrayBuffer()), { 'Content-Type': upstream.headers.get('content-type') || 'audio/mpeg', 'Cache-Control': 'no-store' });
  }

  // Public landing page demo TTS (ElevenLabs). Only successful audio counts against limit.
  if (req.method === 'POST' && pathname === '/api/voice/demo-tts') {
    const ip = clientIp(req);
    const limit = getDemoLimitState(ip);

    if (!limit.allowed) {
      res.setHeader('Retry-After', String(limit.retryAfter || 3600));
      return sendJson(res, 429, {
        ok: false,
        message: limit.remaining === 0
          ? 'Demo voice limit reached for now. Translation still works — start a free trial for unlimited Jamaican voice.'
          : `Please wait ${limit.retryAfter || 1}s before another voice demo.`,
      });
    }

    const body = await readBody(req);
    const text = String(body.text || '').slice(0, 2000);

    if (!text) return sendJson(res, 400, { ok: false, message: 'text is required' });

    try {
      const audio = await speakWithElevenLabs(text);
      const remaining = consumeDemoAttempt(ip, limit);
      return send(res, 200, audio, {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store',
        'X-Voice-Provider': 'elevenlabs',
        'X-Demo-Attempts-Remaining': String(remaining),
      });
    } catch (error) {
      return sendJson(res, 502, { ok: false, message: error.message });
    }
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

  if (req.method === 'POST' && pathname === '/api/vendors/smart-search') {
    const body = await readBody(req);
    const result = store.smartSearchVendors(body);
    let googleItems = [];
    try {
      googleItems = await googleMaps.marketplaceSearch({ ...body, limit: 12 });
    } catch (error) {
      googleItems = [];
    }
    const seen = new Set(result.items.map((item) => String(item.name || '').toLowerCase()));
    const merged = result.items.concat(googleItems.filter((item) => {
      const key = String(item.name || '').toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })).sort((a, b) => Number(b.smart_score || 0) - Number(a.smart_score || 0));
    return sendJson(res, 200, {
      ok: true,
      data: merged,
      meta: { total: merged.length, local_total: result.total, google_total: googleItems.length, inferred_categories: result.inferred_categories, ai: 'local-smart-ranking+google-places' },
    });
  }

  if (req.method === 'GET' && pathname === '/api/places') {
    return sendJson(res, 200, {
      ok: true,
      data: store.listPlaces({ limit: searchParams.get('limit') || undefined }),
    });
  }

  if (req.method === 'GET' && pathname === '/api/maps/config') {
    return sendJson(res, 200, { ok: true, data: googleMaps.publicConfig() });
  }

  if (req.method === 'GET' && pathname === '/api/maps/businesses') {
    const data = await googleMaps.businessSearch({
      query: searchParams.get('q') || searchParams.get('query') || 'restaurants in Jamaica',
      region: searchParams.get('region') || 'Jamaica',
      type: searchParams.get('type') || searchParams.get('category') || '',
      limit: searchParams.get('limit') || 10,
    });
    return sendJson(res, 200, { ok: true, data });
  }

  if (req.method === 'GET' && pathname === '/api/maps/nearby') {
    const data = await googleMaps.nearbySearch({
      lat: searchParams.get('lat'),
      lng: searchParams.get('lng'),
      radius: searchParams.get('radius') || 5000,
      keyword: searchParams.get('keyword') || searchParams.get('q') || '',
      type: searchParams.get('type') || 'restaurant',
      limit: searchParams.get('limit') || 10,
    });
    return sendJson(res, 200, { ok: true, data });
  }

  if (req.method === 'GET' && pathname === '/api/maps/directions') {
    const data = await googleMaps.directions({
      origin: searchParams.get('origin') || '',
      destination: searchParams.get('destination') || '',
      mode: searchParams.get('mode') || 'driving',
    });
    return sendJson(res, 200, { ok: true, data });
  }

  if (req.method === 'GET' && pathname === '/api/maps/photo') {
    const ref = String(searchParams.get('ref') || '').trim();
    if (!ref) return sendJson(res, 400, { ok: false, message: 'photo reference is required' });
    res.writeHead(302, { Location: googleMaps.photoRedirectUrl(ref, searchParams.get('maxwidth') || 640) });
    res.end();
    return true;
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

  if (req.method === 'POST' && pathname === '/api/translate') {
    const body = await readBody(req);
    const text = String(body.text || '').trim();
    if (!text) return sendJson(res, 400, { ok: false, message: 'text is required' });
    try {
      const result = await translator.translateWithGemini(text, body.from || 'en', body.to || 'patois');
      return sendJson(res, 200, { ok: true, data: result });
    } catch (error) {
      return sendJson(res, 503, {
        ok: false,
        message: `AI translation unavailable: ${error.message}`,
        fallback: store.translate(text),
      });
    }
  }

  if (req.method === 'GET' && pathname === '/api/trips') {
    const session = await requireCustomer(req, res, true);
    if (!session) return true;
    return sendJson(res, 200, { ok: true, data: await customerData.listTrips(session.customer_id) });
  }

  if (req.method === 'POST' && pathname === '/api/ai/itinerary') {
    const session = await requireCustomer(req, res, true);
    if (!session) return true;
    const body = await readBody(req);
    const itinerary = await aiAgent.generateItinerary(body);
    return sendJson(res, 200, { ok: true, data: itinerary });
  }

  if (req.method === 'POST' && pathname === '/api/ai/itinerary/save') {
    const session = await requireCustomer(req, res, true);
    if (!session) return true;
    const body = await readBody(req);
    if (!body.itinerary) return sendJson(res, 400, { ok: false, message: 'itinerary is required' });
    const trip = await customerData.createTrip(session.customer_id, { title:body.itinerary.title, destination:body.profile?.location||'Jamaica', days:body.itinerary.days?.length||1, notes:body.itinerary.overview, items:(body.itinerary.days||[]).flatMap((day)=>(day.stops||[]).map((stop)=>({title:`Day ${day.day}: ${stop.place_name}`,note:`${stop.time} · ${stop.reason}`,place_id:stop.place_id,done:false}))) });
    return sendJson(res, 201, { ok: true, data: trip });
  }

  // Public landing-page AI demo (no login). Answers traveler questions, rate-limited per IP.
  if (req.method === 'POST' && pathname === '/api/demo/concierge') {
    const ip = clientIp(req);
    const limit = getDemoLimitState(ip);
    // Share the demo budget with TTS so free traffic can't spam Grok forever.
    // Do not consume here — only successful voice plays consume; allow more Q&A.
    if (!limit.allowed && limit.remaining === 0) {
      res.setHeader('Retry-After', String(limit.retryAfter || 3600));
      return sendJson(res, 429, {
        ok: false,
        message: 'Demo limit reached for now. Start a free trial for unlimited concierge answers.',
      });
    }
    const body = await readBody(req);
    const message = String(body.message || body.text || body.q || '').trim().slice(0, 500);
    if (!message) return sendJson(res, 400, { ok: false, message: 'message is required' });
    try {
      const answer = await aiAgent.conciergeReply(message, [], { demo: true, spoken: true });
      const reply = String(answer.reply || '').trim().slice(0, 700);
      return sendJson(res, 200, {
        ok: true,
        data: {
          question: message,
          reply,
          model: answer.model,
          source: answer.source,
        },
      });
    } catch (error) {
      return sendJson(res, 502, { ok: false, message: error.message || 'Concierge unavailable' });
    }
  }

  if (req.method === 'POST' && pathname === '/api/ai/concierge') {
    const session = await requireCustomer(req, res, true);
    if (!session) return true;
    const body = await readBody(req);
    const sessionId = String(body.session_id || 'default').slice(0, 120);
    const userTurn = await customerData.saveTranscript(session.customer_id,{ session_id: sessionId, role: 'user', content: body.message, source: body.source || 'text' });
    const history = (await customerData.listTranscripts(session.customer_id,sessionId)).slice(-9);
    const answer = await aiAgent.conciergeReply(body.message, history.slice(0, -1), { spoken: body.source === 'voice' });
    const assistantTurn = await customerData.saveTranscript(session.customer_id,{ session_id: sessionId, role: 'assistant', content: answer.reply, source: answer.source });
    return sendJson(res, 200, { ok: true, data: { ...answer, turns: [userTurn, assistantTurn] } });
  }

  if (req.method === 'GET' && pathname === '/api/ai/transcripts') {
    const session = await requireCustomer(req, res, true); if (!session) return true;
    return sendJson(res, 200, { ok: true, data: await customerData.listTranscripts(session.customer_id,searchParams.get('session_id')||'default') });
  }

  if (req.method === 'POST' && pathname === '/api/trips') {
    const session = await requireCustomer(req, res, true); if (!session) return true;
    const body = await readBody(req);
    const trip = await customerData.createTrip(session.customer_id,body);
    return sendJson(res, 201, { ok: true, data: trip });
  }

  if (req.method === 'POST' && /^\/api\/trips\/[^/]+\/items$/.test(pathname)) {
    const session = await requireCustomer(req, res, true); if (!session) return true;
    const tripId = decodeURIComponent(pathname.split('/')[3]);
    const body = await readBody(req);
    const result = await customerData.addTripItem(session.customer_id,tripId,body);
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
    const session=await requireCustomer(req,res,true);if(!session)return true;
    return sendJson(res,200,{ok:true,data:await customerData.listCheckins(session.customer_id)});
  }

  if (req.method === 'POST' && pathname === '/api/guardian/checkins') {
    const session=await requireCustomer(req,res,true);if(!session)return true;
    const body = await readBody(req);
    const checkin = await customerData.createCheckin(session.customer_id,body);
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
    const session = await customerSession(req); // optional — guest checkout allowed from landing
    const body = await readBody(req);
    const plan = String(body.plan || '').trim();
    if (!Object.prototype.hasOwnProperty.call(PLAN_PRICES, plan)) {
      return sendJson(res, 400, { ok: false, message: `Unknown plan: ${plan}` });
    }
    const base = publicBaseUrl(req);
    const returnUrl = String(body.return_url || `${base}/checkout/complete`).trim();
    const cancelUrl = String(body.cancel_url || `${base}/#pricing`).trim();
    let order;
    try {
      order = await paypalService().createOrder({
        plan,
        return_url: returnUrl,
        cancel_url: cancelUrl,
        description: body.description,
      });
      await payments.recordOrderCreated({
        order_id: order.order_id,
        plan: order.plan,
        amount: order.amount,
        currency: order.currency,
        customer_id: session ? session.customer_id : null,
      });
    } catch (error) {
      if (!shouldUseLocalCheckoutFallback(error)) {
        return sendJson(res, 502, { ok: false, message: error.message || 'PayPal checkout unavailable' });
      }
      order = store.createPaymentOrder({
        plan,
        amount: PLAN_PRICES[plan],
        description: body.description || `${plan} pass`,
        buyer: session ? session.customer_id : 'guest',
      });
    }
    return sendJson(res, 201, {
      ok: true,
      approval_url: order.approval_url,
      approvalUrl: order.approval_url,
      order_id: order.order_id,
      orderId: order.order_id,
      data: order,
      environment: order.environment,
      guest: !session,
    });
  }

  if (req.method === 'POST' && /^\/api\/paypal\/orders\/[^/]+\/capture$/.test(pathname)) {
    const session = await customerSession(req); // optional for guest capture
    const orderId = decodeURIComponent(pathname.split('/')[4]);
    try {
      const payment = await paypalService().captureOrder(orderId);
      const known = await payments.getByOrderId(orderId);
      const customerId = session?.customer_id || known?.customer_id || null;
      const { wasAlreadyCompleted } = await payments.recordCapture(payment, { customer_id: customerId });
      if (payment.status !== 'completed') {
        return sendJson(res, 409, { ok: false, message: 'PayPal payment is not completed', data: payment });
      }
      let pass = null;
      if (customerId) {
        pass = wasAlreadyCompleted
          ? (await auth.listPasses(customerId)).find((p) => p.plan === payment.plan) || null
          : await auth.createPass({ customer_id: customerId, plan: payment.plan });
      }
      return sendJson(res, 200, {
        ok: true,
        data: {
          ...payment,
          pass,
          needs_account: !customerId,
          activate_hint: customerId
            ? 'Pass activated'
            : 'Payment captured. Create or sign in to your PatWaGo account to attach this pass.',
        },
      });
    } catch (error) {
      return sendJson(res, 502, { ok: false, message: error.message || 'Capture failed' });
    }
  }

  if(req.method==='POST'&&pathname==='/api/paypal/webhook'){
    const raw=await readRawBody(req,1_000_000);
    const result=await paypalService().verifyWebhook({headers:req.headers,body:raw.toString('utf8')});
    if(!result.verified)return sendJson(res,400,{ok:false,message:result.reason||'Invalid webhook signature'});
    const event=result.event||{};
    if(event.event_type==='PAYMENT.CAPTURE.COMPLETED'){
      const { orderId, captureId }=payments.extractIdsFromCaptureEvent(event);
      if(orderId){
        const known=await payments.getByOrderId(orderId);
        if(known&&known.status!=='completed'){
          const resource=event.resource||{};
          const amountValue=resource.amount?.value?Number(resource.amount.value):known.amount;
          const capturedPayment={
            status:'completed',paypal_order_id:orderId,plan:known.plan,amount:amountValue,
            currency:resource.amount?.currency_code||known.currency,capture_id:captureId,
            payer_email:known.payer_email,payer_id:known.payer_id,captured_at:new Date().toISOString(),
            pass_activated:{activated:true,plan:known.plan,pass_type:`${known.plan}_pass`,capture_id:captureId,activated_at:new Date().toISOString()},
            paypal_raw:event,
          };
          await payments.recordCapture(capturedPayment,{customer_id:known.customer_id});
          if(known.customer_id)await auth.createPass({customer_id:known.customer_id,plan:known.plan});
        }
      }
    }
    return sendJson(res,200,{ok:true});
  }

  if (req.method === 'GET' && pathname === '/api/dashboard') {
    const session = await customerSession(req);
    const stats = store.dashboardStats();
    const googleListings = await liveGoogleListingCount();
    let myTrips = 0;
    let myCheckins = 0;
    if (session) {
      try {
        myTrips = (await customerData.listTrips(session.customer_id)).length;
        myCheckins = (await customerData.listCheckins(session.customer_id)).length;
      } catch {
        myTrips = 0;
        myCheckins = 0;
      }
    }
    return sendJson(res, 200, {
      ok: true,
      data: {
        ...stats,
        google_listings: googleListings,
        vendors: stats.verified_vendors,
        trips: myTrips,
        checkins: myCheckins,
      },
    });
  }

  return null;
}

function handleCheckout(req, res, url) {
  if (req.method !== 'GET') return null;

  if (url.pathname === '/checkout/complete' || url.pathname === '/checkout/complete/') {
    const token = url.searchParams.get('token') || url.searchParams.get('order_id') || '';
    return sendHtml(res, 200, renderCheckoutCompletePage(token));
  }

  const match = url.pathname.match(/^\/checkout\/paypal\/([^/]+)$/);
  if (!match) return null;
  const order = store.getPaymentOrder(match[1]);
  if (!order) return sendText(res, 404, 'Checkout order not found');
  return sendHtml(res, 200, renderCheckoutPage(order));
}

async function handleAppPages(req, res, url) {
  if (req.method !== 'GET') return null;
  const pathname = url.pathname.replace(/\/$/, '') || '/';
  let html = null;
  if (pathname === '/admin/analytics') html = appPages.adminAnalyticsPage();
  else if (pathname === '/account' || pathname === '/account/onboarding') html = appPages.accountPage('onboarding');
  else if (pathname === '/account/login') html = appPages.accountPage('auth');
  else if (pathname === '/account/paywall') html = appPages.accountPage('trial');
  else if (pathname === '/app' || pathname.startsWith('/app/')) {
    const session = await customerSession(req);
    if (!session) {
      res.writeHead(302, {
        Location: `/account/login?next=${encodeURIComponent(pathname)}`,
        'Cache-Control': 'no-store',
      });
      res.end();
      return true;
    }
    if (!(await auth.hasActivePass(session.customer_id))) {
      res.writeHead(302, {
        Location: `/account/paywall?next=${encodeURIComponent(pathname)}`,
        'Cache-Control': 'no-store',
      });
      res.end();
      return true;
    }
    if (pathname === '/app') html = appPages.dashboard();
    else if (pathname === '/app/translate') html = appPages.translatePage();
    else if (pathname === '/app/vendors') html = appPages.vendorsPage();
    else if (pathname === '/app/trips') html = appPages.tripsPage();
    else if (pathname === '/app/trips/new') html = appPages.aiPlannerPage();
    else if (pathname === '/app/voice') html = appPages.voicePage();
    else if (pathname === '/app/guardian') html = appPages.guardianPage();
    else if (pathname === '/app/profile') html = appPages.profilePage();
    else {
      const match = pathname.match(/^\/app\/vendor\/([^/]+)$/);
      if (match) html = appPages.vendorDetailPage(decodeURIComponent(match[1]));
    }
    if (!html) return sendText(res, 404, 'App page not found');
    return sendHtml(res, 200, html);
  }
  if (html) return sendHtml(res, 200, html);
  return null;
}

function handleStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;

  const pathname = decodeURIComponent(url.pathname);
  if (pathname === '/' || pathname === '') {
    return serveFile(res, INDEX_PATH) || false;
  }

  const publicCandidate = normalizeStaticPath(pathname, PUBLIC_DIR);
  if (publicCandidate && serveFile(res, publicCandidate)) return true;

  const rootCandidate = normalizeStaticPath(pathname, ROOT);
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

  const appPage = await handleAppPages(req, res, url);
  if (appPage) return;

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
  analytics.ensureSchema().catch((error) => console.error('[analytics] schema initialization failed', error.message));
  payments.ensureSchema().catch((error) => console.error('[payments] schema initialization failed', error.message));
  server.listen(PORT, HOST, () => {
    console.log(`PatWaGo backend listening on http://${HOST}:${PORT}`);
  });
}

module.exports = {
  createServer,
  requestListener,
};
