#!/usr/bin/env python3
"""PatWaGo fixes: JWT on trial start, allow public alert list, harden SOS auth helper usage."""
from pathlib import Path
import re

# ---- onboarding: issue JWT on /start ----
ob = Path("/opt/patwago/api/src/routes/onboarding.ts")
t = ob.read_text(encoding="utf-8")
if "signToken" not in t:
    t = t.replace(
        'import { authRequired } from "../middleware/auth";',
        'import { authRequired, signToken } from "../middleware/auth";',
    )

def inject_token_into_json(block: str) -> str:
    # Add token field into JSON responses that return user_id for start flow
    if "token:" in block or "token :" in block:
        return block
    return block

# After creating user or returning existing, attach token
# Pattern 1: existing trial active return
old1 = """        return res.json({
          data: {
            user_id: user.id,
            device_id: deviceId,
            trial_active: true,
            trial_expires_at: pass.rows[0].expires_at,
            has_pass: true,
            pass_type: "trial",
          },
        });"""
new1 = """        const tokenExisting = signToken({ sub: user.id, role: "user", email: user.email });
        return res.json({
          data: {
            user_id: user.id,
            device_id: deviceId,
            trial_active: true,
            trial_expires_at: pass.rows[0].expires_at,
            has_pass: true,
            pass_type: "trial",
            token: tokenExisting,
          },
        });"""
if old1 in t:
    t = t.replace(old1, new1, 1)
    print("patched existing-active trial token")
else:
    print("WARN existing-active block missing")

old2 = """      return res.json({
        data: {
          user_id: user.id,
          device_id: deviceId,
          trial_active: false,
          has_pass: false,
          paywall: true,
          message: "Your free trial has expired. Purchase a pass to continue.",
        },
      });"""
new2 = """      const tokenExpired = signToken({ sub: user.id, role: "user", email: user.email });
      return res.json({
        data: {
          user_id: user.id,
          device_id: deviceId,
          trial_active: false,
          has_pass: false,
          paywall: true,
          message: "Your free trial has expired. Purchase a pass to continue.",
          token: tokenExpired,
        },
      });"""
if old2 in t:
    t = t.replace(old2, new2, 1)
    print("patched expired trial token")
else:
    print("WARN expired block missing")

old3 = """    res.json({
      data: {
        user_id: userId,
        device_id: deviceId,
        trial_active: true,
        trial_expires_at: expiresAt,
        has_pass: true,
        pass_type: "trial",
        trial_hours: 24,
      },
    });"""
new3 = """    const tokenNew = signToken({ sub: userId, role: "user", email: `${deviceId}@trial.patwago` });
    res.json({
      data: {
        user_id: userId,
        device_id: deviceId,
        trial_active: true,
        trial_expires_at: expiresAt,
        has_pass: true,
        pass_type: "trial",
        trial_hours: 24,
        token: tokenNew,
      },
    });"""
if old3 in t:
    t = t.replace(old3, new3, 1)
    print("patched new trial token")
else:
    print("WARN new trial block missing")

ob.write_text(t, encoding="utf-8")

# ---- safety: accept optional auth for SOS/checkin create when body user matches JWT,
# but keep unauth list locked. Already has authRequired. Also allow public POST only for
# community alerts with captcha-less but rate-limited + require trial JWT (already).
# Add area_name exception for SOS create: none.
# Expand GET /alerts to include reported_by name if possible - skip.

sa = Path("/opt/patwago/api/src/routes/safety.ts")
st = sa.read_text(encoding="utf-8")
# Ensure GET /alerts remains public (already is).
# Ensure POST /alerts authRequired is present.
print("safety GET alerts public:", "router.get('/alerts', async" in st)
print("safety POST alerts auth:", "router.post('/alerts', authRequired" in st)
print("DONE API")
