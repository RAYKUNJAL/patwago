#!/usr/bin/env python3
"""PatWaGo commercial-audit fixes: credits, concierge, safety auth, paypal prices/capture."""
from pathlib import Path
import re
import sys

ROOT = Path("/opt/patwago/api/src")


def must_replace(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text(encoding="utf-8")
    if old not in text:
        # Try relaxed whitespace
        compact_old = re.sub(r"\s+", " ", old)
        compact_text = re.sub(r"\s+", " ", text)
        if compact_old not in compact_text:
            raise SystemExit(f"FAILED: block not found for {label} in {path}")
        raise SystemExit(f"FAILED: whitespace mismatch for {label} in {path}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")
    print(f"OK {label}")


def patch_credits() -> None:
    path = ROOT / "middleware" / "credits.ts"
    text = path.read_text(encoding="utf-8")
    text2 = text.replace("AND status = 'active'", "AND active = true")
    text2 = text2.replace(
        "AND status = 'active'\n           AND (expires_at IS NULL OR expires_at > NOW())",
        "AND active = true\n           AND (expires_at IS NULL OR expires_at > NOW())",
    )
    # also handle status='active'
    text2 = re.sub(
        r"AND status\s*=\s*'active'",
        "AND active = true",
        text2,
    )
    if text2 == text:
        # maybe already fixed
        if "active = true" in text:
            print("OK credits already using active=true")
            return
        raise SystemExit("FAILED credits patch")
    path.write_text(text2, encoding="utf-8")
    print("OK credits.ts")


def patch_concierge() -> None:
    path = ROOT / "routes" / "concierge.ts"
    text = path.read_text(encoding="utf-8")
    # Replace the askConcierge try/parse body by function rewrite markers
    start = text.find("async function askConcierge(")
    if start < 0:
        raise SystemExit("askConcierge not found")
    end = text.find("async function fetchRelevantVendors", start)
    if end < 0:
        end = text.find("/**\n * Pull live vendors", start)
    if end < 0:
        raise SystemExit("end of askConcierge not found")

    new_fn = r'''async function askConcierge(
  message: string,
  context?: ChatBody['context']
): Promise<{ reply: string; suggestions: string[] }> {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not configured.');
  const model = getGenAI().getGenerativeModel({ model: GEMINI_MODEL });

  const contextStr = context
    ? `\nContext:\n${
        context.location
          ? `- User location: ${context.location.label || `${context.location.lat},${context.location.lng}`}\n`
          : ''
      }${context.budget ? `- Budget: ${context.budget}\n` : ''}${
        context.interests?.length ? `- Interests: ${context.interests.join(', ')}\n` : ''
      }${context.previous?.length ? `- Earlier in this conversation: ${context.previous.join(' | ')}\n` : ''}`
    : '';

  const prompt = `${CONCIERGE_SYSTEM_PROMPT}

${contextStr}
User message: """${message}"""`;

  try {
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 1024,
        responseMimeType: 'application/json',
      },
    } as any);
    const raw = (result.response.text() || '').trim();
    const cleaned = raw
      .replace(/^```(?:json)?/i, '')
      .replace(/```$/i, '')
      .trim();

    const safeParse = (s: string): any | null => {
      try {
        return JSON.parse(s);
      } catch {
        try {
          const scrubbed = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ');
          return JSON.parse(scrubbed);
        } catch {
          const m = s.match(/\{[\s\S]*\}/);
          if (!m) return null;
          try {
            return JSON.parse(m[0].replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' '));
          } catch {
            return null;
          }
        }
      }
    };

    const parsed = safeParse(cleaned);
    if (parsed && (parsed.reply || parsed.message || parsed.text)) {
      return {
        reply: String(parsed.reply ?? parsed.message ?? parsed.text ?? cleaned),
        suggestions: Array.isArray(parsed.suggestions)
          ? parsed.suggestions.map(String).slice(0, 3)
          : [],
      };
    }

    return {
      reply: cleaned || raw || 'Sorry, mi nuh catch that. Try ask again?',
      suggestions: ['Best jerk near me?', 'Is this area safe?', 'Plan a day in Negril'],
    };
  } catch (err) {
    console.error('[concierge] Gemini error:', err);
    throw new Error('Concierge could not generate a reply.');
  }
}

'''
    path.write_text(text[:start] + new_fn + text[end:], encoding="utf-8")
    print("OK concierge.ts")


def patch_paypal() -> None:
    path = ROOT / "routes" / "paypal.ts"
    text = path.read_text(encoding="utf-8")

    # Fix prices to commercial Day $9.99 / Trip $29.99
    text2 = re.sub(
        r"const PASS_PRICES_USD: Record<'day' \| 'trip', number> = \{[\s\S]*?\};",
        "const PASS_PRICES_USD: Record<'day' | 'trip', number> = {\n  day: 9.99,\n  trip: 29.99,\n};",
        text,
        count=1,
    )

    # Fix vendors column vendor_id -> id
    text2 = text2.replace(
        "const vendorCheck = await query('SELECT vendor_id FROM vendors WHERE vendor_id = $1', [b.vendorId]);",
        "const vendorCheck = await query('SELECT id FROM vendors WHERE id = $1', [b.vendorId]);",
    )

    # Fix bookings insert columns to match schema (best-effort)
    # Look for INSERT INTO bookings block used by paypal
    old_insert = re.search(
        r"const booking = await query<\{ booking_id: string \}>\([\s\S]*?\);",
        text2,
    )
    if old_insert:
        replacement = """const booking = await query<{ id: string }>(
      `INSERT INTO bookings
         (vendor_id, user_id, booking_date, num_people, total_price, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')
       RETURNING id`,
      [
        b.vendorId,
        req.userId,
        b.bookingDetails.booking_date,
        b.bookingDetails.party_size ?? 1,
        authoritativeTotal,
      ]
    );
    const bookingId = booking.rows[0].id;"""
        # remove following bookingId line if present after replaceimid
        text2 = text2[: old_insert.start()] + replacement + text2[old_insert.end() :]
        text2 = text2.replace(
            "const bookingId = booking.rows[0].booking_id;\n\n    const bookingId = booking.rows[0].id;",
            "const bookingId = booking.rows[0].id;",
        )
        text2 = text2.replace(
            "const bookingId = booking.rows[0].booking_id;",
            "// bookingId already set",
        )

    # Harden capture: verify order belongs to payer and activate pass / mark payment
    # Replace mock/fail capture body with real verification + state change.
    capture_start = text2.find("router.post('/capture', authRequired")
    if capture_start < 0:
        raise SystemExit("capture route not found")
    webhook_start = text2.find("router.post('/webhook'", capture_start)
    if webhook_start < 0:
        raise SystemExit("webhook after capture not found")

    new_capture = r'''router.post('/capture', authRequired, async (req: Request, res: Response) => {
  try {
    const b = req.body as CaptureBody & { passType?: 'day' | 'trip' };
    if (!b?.orderId) return apiError(res, 400, 'missing_order_id', 'orderId is required.');
    if (!req.userId) return apiError(res, 401, 'unauthorized', 'Authentication required.');

    // NEVER mock success in production — that would unlock paid features for free.
    const token = await getPaypalAccessToken();
    if (!token) {
      return apiError(
        res,
        503,
        'payments_unavailable',
        'PayPal is not configured. Live payments are disabled until credentials are set.'
      );
    }

    // Inspect order before capture to recover server-side product metadata.
    const orderResp = await fetch(`${PAYPAL_BASE}/v2/checkout/orders/${encodeURIComponent(b.orderId)}`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    if (!orderResp.ok) {
      return apiError(res, 502, 'order_lookup_failed', 'Could not verify PayPal order.');
    }
    const orderData = (await orderResp.json()) as {
      id: string;
      status: string;
      purchase_units?: Array<{ amount?: { value?: string }; custom_id?: string; description?: string }>;
    };
    const unit = orderData.purchase_units?.[0];
    const amountPaid = Number(unit?.amount?.value || 0);
    const customId = unit?.custom_id || '';

    // Capture if not already completed.
    let captureId: string | null = null;
    let status = orderData.status;
    if (orderData.status !== 'COMPLETED') {
      const captured = await capturePaypalOrder(b.orderId);
      if (!captured) return apiError(res, 502, 'capture_failed', 'PayPal capture failed.');
      status = captured.status;
      captureId = captured.captureId;
    }

    if (status !== 'COMPLETED') {
      return apiError(res, 400, 'not_completed', `PayPal order status is ${status}.`);
    }

    // If this was a pass purchase, activate only when amount matches authoritative prices.
    let activatedPass: string | null = null;
    const maybePass =
      (b.passType && ['day', 'trip'].includes(b.passType) && b.passType) ||
      (customId === 'patwago_pass' ? null : null);

    // Prefer body passType if provided AND amount matches; else infer from amount.
    let passType: 'day' | 'trip' | null = null;
    if (b.passType === 'day' || b.passType === 'trip') {
      if (Math.abs(amountPaid - PASS_PRICES_USD[b.passType]) < 0.01) passType = b.passType;
    }
    if (!passType) {
      if (Math.abs(amountPaid - PASS_PRICES_USD.day) < 0.01) passType = 'day';
      else if (Math.abs(amountPaid - PASS_PRICES_USD.trip) < 0.01) passType = 'trip';
    }

    if (passType) {
      const expiresAt = new Date(
        Date.now() + (passType === 'day' ? 24 : 7 * 24) * 60 * 60 * 1000
      );
      await query('UPDATE user_passes SET active = false WHERE user_id = $1', [req.userId]);
      await query(
        `INSERT INTO user_passes (id, user_id, pass_type, purchased_at, expires_at, active)
         VALUES (gen_random_uuid(), $1, $2, NOW(), $3, true)`,
        [req.userId, passType, expiresAt]
      );
      await query(
        `INSERT INTO payments (id, user_id, amount, currency, type, status, paypal_id, metadata, created_at)
         VALUES (gen_random_uuid(), $1, $2, 'USD', 'pass', 'completed', $3, $4::jsonb, NOW())
         ON CONFLICT DO NOTHING`,
        [
          req.userId,
          PASS_PRICES_USD[passType],
          captureId || b.orderId,
          JSON.stringify({ pass_type: passType, order_id: b.orderId, provider: 'paypal' }),
        ]
      );
      activatedPass = passType;
    }

    const result: CaptureResult = {
      orderId: b.orderId,
      status,
      captureId,
    };
    res.json({ data: { ...result, activatedPass, amountPaid } });
  } catch (err) {
    safeError(res, 'capture', err);
  }
});

'''
    path.write_text(text2[:capture_start] + new_capture + text2[webhook_start:], encoding="utf-8")
    print("OK paypal.ts")


def patch_safety() -> None:
    path = ROOT / "routes" / "safety.ts"
    text = path.read_text(encoding="utf-8")

    # Require real auth for owner-scoped GETs / mutations.
    # 1) import authRequired
    if "authRequired" not in text:
        text = text.replace(
            "import { authOptional } from '../middleware/auth';",
            "import { authOptional, authRequired } from '../middleware/auth';",
        )

    # 2) Strengthen resolveUserId — when authenticated, always use JWT subject;
    # for unauth write endpoints, require auth rather than body user_id for owner data.
    old_resolve = """async function resolveUserId(
  req: Request,
  res: Response
): Promise<string | null> {
  let userId: string | undefined = req.userId;
  if (!userId) {
    const fromBody = (req.body as any)?.user_id;
    if (typeof fromBody === 'string' && fromBody.trim()) userId = fromBody.trim();
  }
  if (!userId) {
    apiError(res, 400, 'missing_user', 'user_id is required (in body or via Bearer token).');
    return null;
  }
  try {
    const r = await query<{ id: string }>('SELECT id FROM users WHERE id = $1', [userId]);
    if (r.rowCount === 0) {
      apiError(res, 404, 'user_not_found', 'No user with that id.');
      return null;
    }
    return userId;
  } catch (err) {
    safeError(res, 'resolveUserId', err);
    return null;
  }
}"""
    new_resolve = """async function resolveUserId(
  req: Request,
  res: Response,
  opts: { allowBody?: boolean } = {}
): Promise<string | null> {
  // Prefer JWT subject always. Body/param user_id is only allowed for
  // intentionally public/demo write paths when allowBody=true AND no JWT.
  let userId: string | undefined = req.userId;
  if (!userId && opts.allowBody) {
    const fromBody = (req.body as any)?.user_id;
    if (typeof fromBody === 'string' && fromBody.trim()) userId = fromBody.trim();
  }
  if (!userId) {
    apiError(res, 401, 'unauthorized', 'Authentication required.');
    return null;
  }
  // IDOR guard: authenticated users cannot act as someone else unless admin.
  if (req.userId && userId !== req.userId && req.userRole !== 'admin') {
    apiError(res, 403, 'forbidden', 'Cannot act on another user\\'s safety data.');
    return null;
  }
  try {
    const r = await query<{ id: string }>('SELECT id FROM users WHERE id = $1', [userId]);
    if (r.rowCount === 0) {
      apiError(res, 404, 'user_not_found', 'No user with that id.');
      return null;
    }
    return userId;
  } catch (err) {
    safeError(res, 'resolveUserId', err);
    return null;
  }
}

/** Require path user_id to match JWT subject (or admin). */
function assertPathUser(req: Request, res: Response, pathUserId: string): boolean {
  if (!req.userId) {
    apiError(res, 401, 'unauthorized', 'Authentication required.');
    return false;
  }
  if (req.userRole === 'admin') return true;
  if (req.userId !== pathUserId) {
    apiError(res, 403, 'forbidden', 'Cannot access another user\\'s safety data.');
    return false;
  }
  return true;
}"""
    if old_resolve not in text:
        raise SystemExit("resolveUserId block not found for safety")
    text = text.replace(old_resolve, new_resolve, 1)

    # Wrap owner-scoped routes with authRequired at declaration sites.
    replacements = [
        ("router.get('/checkin/:user_id', async (req: Request, res: Response) => {",
         "router.get('/checkin/:user_id', authRequired, async (req: Request, res: Response) => {"),
        ("router.get('/checkin/:user_id/history', async (req: Request, res: Response) => {",
         "router.get('/checkin/:user_id/history', authRequired, async (req: Request, res: Response) => {"),
        ("router.get('/sos/:user_id', async (req: Request, res: Response) => {",
         "router.get('/sos/:user_id', authRequired, async (req: Request, res: Response) => {"),
        ("router.get('/contacts/:user_id', async (req: Request, res: Response) => {",
         "router.get('/contacts/:user_id', authRequired, async (req: Request, res: Response) => {"),
        ("router.post('/sos', async (req: Request, res: Response) => {",
         "router.post('/sos', authRequired, async (req: Request, res: Response) => {"),
        ("router.post('/checkin', async (req: Request, res: Response) => {",
         "router.post('/checkin', authRequired, async (req: Request, res: Response) => {"),
        ("router.post('/contacts', async (req: Request, res: Response) => {",
         "router.post('/contacts', authRequired, async (req: Request, res: Response) => {"),
        ("router.patch('/contacts/:id', async (req: Request, res: Response) => {",
         "router.patch('/contacts/:id', authRequired, async (req: Request, res: Response) => {"),
        ("router.delete('/contacts/:id', async (req: Request, res: Response) => {",
         "router.delete('/contacts/:id', authRequired, async (req: Request, res: Response) => {"),
        ("router.patch('/sos/:id/acknowledge', async (req: Request, res: Response) => {",
         "router.patch('/sos/:id/acknowledge', authRequired, async (req: Request, res: Response) => {"),
        ("router.patch('/sos/:id/resolve', async (req: Request, res: Response) => {",
         "router.patch('/sos/:id/resolve', authRequired, async (req: Request, res: Response) => {"),
        # Alerts: keep GET public; POST should at least be authOptional or throttled - require auth for create
        ("router.post('/alerts', async (req: Request, res: Response) => {",
         "router.post('/alerts', authRequired, async (req: Request, res: Response) => {"),
    ]
    for old, new in replacements:
        if old not in text:
            print(f"WARN missing route signature: {old[:60]}")
        else:
            text = text.replace(old, new, 1)

    # Insert path-user assert after uuid validate in GET handlers
    # For checkin / sos / contacts path handlers, after uuid validate:
    text = re.sub(
        r"(router\.get\('/(?:checkin|sos|contacts)/:user_id(?:/history)?'[\s\S]{0,200}?const userId = req\.params\.user_id;\s*"
        r"if \(!/\^\\\[0-9a-fA-F-\]\\{36\\}\$/\\.test\(userId\)\) \{\s*"
        r"return apiError\(res, 400, 'invalid_user_id', 'user_id must be a valid UUID\.'\);\s*\}\s*)",
        r"\1if (!assertPathUser(req, res, userId)) return;\n    ",
        text,
    )
    # Simpler deterministic inserts
    for marker in [
        "router.get('/checkin/:user_id', authRequired, async (req: Request, res: Response) => {",
        "router.get('/checkin/:user_id/history', authRequired, async (req: Request, res: Response) => {",
        "router.get('/sos/:user_id', authRequired, async (req: Request, res: Response) => {",
        "router.get('/contacts/:user_id', authRequired, async (req: Request, res: Response) => {",
    ]:
        idx = text.find(marker)
        if idx < 0:
            continue
        # Find first uuid validation close then insert assert if missing nearby
        window = text[idx: idx + 500]
        if "assertPathUser" in window:
            continue
        # After uuid check block
        m = re.search(
            r"if \(!/\^\[0-9a-fA-F-\]\{36\}\$/\\.test\(userId\)\) \{\s*return apiError\(res, 400, 'invalid_user_id', 'user_id must be a valid UUID\.'\);\s*\}",
            window,
        )
        if not m:
            # alternate formatting
            m = re.search(r"return apiError\(res, 400, 'invalid_user_id'.*?\)\;\s*\}", window, re.S)
        if m:
            insert_at = idx + m.end()
            text = text[:insert_at] + "\n    if (!assertPathUser(req, res, userId)) return;" + text[insert_at:]

    path.write_text(text, encoding="utf-8")
    print("OK safety.ts")


def main() -> int:
    patch_credits()
    patch_concierge()
    patch_paypal()
    patch_safety()
    print("ALL PATCHES APPLIED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
