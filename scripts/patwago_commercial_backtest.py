#!/usr/bin/env python3
"""PatWaGo commercial E2E backtest against live https://patwago.com"""
from __future__ import annotations
import json, time, urllib.request, urllib.error, ssl
from datetime import datetime, timezone

BASE = "https://patwago.com/api"
ctx = ssl.create_default_context()

class Result:
    def __init__(self):
        self.rows = []
    def add(self, name, ok, detail=""):
        self.rows.append((name, ok, detail))
        mark = "PASS" if ok else "FAIL"
        print(f"[{mark}] {name} :: {detail}")

R = Result()

def req(method, path, body=None, token=None, timeout=30):
    data = None if body is None else json.dumps(body).encode()
    headers = {"Accept": "application/json"}
    if body is not None:
        headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = f"Bearer {token}"
    r = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r, timeout=timeout, context=ctx) as resp:
            raw = resp.read().decode()
            try:
                j = json.loads(raw) if raw else {}
            except Exception:
                j = {"_raw": raw[:300]}
            j["_status"] = resp.status
            return j
    except urllib.error.HTTPError as e:
        raw = e.read().decode(errors="ignore")
        try:
            j = json.loads(raw) if raw else {}
        except Exception:
            j = {"_raw": raw[:300]}
        j["_status"] = e.code
        j["_error"] = True
        return j


def main():
    print("=== PatWaGo commercial backtest", datetime.now(timezone.utc).isoformat(), "===")

    h = req("GET", "/health")
    R.add("health", h.get("_status") == 200 and h.get("status") == "ok", str(h)[:120])

    # Customer onboarding
    device = f"backtest-{int(time.time())}"
    o = req("POST", "/onboarding/start", {"device_id": device})
    token = (o.get("data") or {}).get("token")
    uid = (o.get("data") or {}).get("user_id")
    R.add("customer trial+JWT", bool(token and uid), f"uid={uid} token_len={len(token or '')}")

    st = req("GET", f"/onboarding/status/{uid}")
    R.add("trial status", (st.get("data") or {}).get("has_pass") is True, str(st.get("data"))[:120])

    lex = req("GET", "/lexicon/translate?q=irie")
    R.add("lexicon", bool(lex.get("translation") or (lex.get("data") or {}).get("translation")), str(lex)[:100])

    conc = req("POST", "/concierge/chat", {"message": "Taxi fare from MBJ airport to Negril?"}, token=token)
    reply = ((conc.get("data") or {}).get("reply") or "")
    R.add("concierge weather/taxi aware", bool(reply), reply[:140])

    # Vendors
    v = req("GET", "/vendors?limit=5")
    vendors = v.get("data") or []
    R.add("vendor list", len(vendors) > 0, f"n={len(vendors)}")
    vid = vendors[0]["id"] if vendors else None

    # Reviews
    if vid and token:
        rev = req("POST", f"/vendors/{vid}/reviews", {"rating": 5, "comment": "Backtest review — great vibe!"}, token=token)
        R.add("post review", rev.get("_status") in (200, 201) and not rev.get("error"), str(rev)[:160])
        det = req("GET", f"/vendors/{vid}")
        revs = (det.get("data") or det).get("reviews") if isinstance(det.get("data") or det, dict) else None
        if revs is None and isinstance(det.get("data"), dict):
            revs = det["data"].get("reviews")
        R.add("reviews visible", isinstance(revs, list), f"count={len(revs) if isinstance(revs, list) else 'n/a'}")

    # PayPal pass checkout create
    if token:
        pp = req("POST", "/paypal/purchase-pass", {"passType": "day"}, token=token)
        data = pp.get("data") or {}
        ok = pp.get("_status") == 200 and data.get("orderId") and "mock" not in str(data.get("orderId")).lower() and data.get("approveUrl")
        R.add("PayPal live pass order", bool(ok), f"status={pp.get('_status')} order={str(data.get('orderId'))[:24]} approve_host={(data.get('approveUrl') or '')[:40]}")

    # Booking money create (needs service)
    if token and vid:
        det = req("GET", f"/vendors/{vid}")
        payload = det.get("data") or det
        services = payload.get("services") if isinstance(payload, dict) else []
        if not services:
            # try dedicated services route
            sv = req("GET", f"/vendors/{vid}/services")
            services = sv.get("data") or sv.get("services") or []
        if services:
            sid = services[0].get("id") or services[0].get("service_id")
            book = req(
                "POST",
                "/paypal/booking",
                {
                    "vendorId": vid,
                    "serviceId": sid,
                    "bookingDetails": {
                        "booking_date": "2026-08-15",
                        "party_size": 2,
                        "contact_name": "Backtest Traveler",
                        "contact_phone": "8765550000",
                    },
                    "priceQuoted": 0,
                },
                token=token,
            )
            bd = book.get("data") or {}
            okb = book.get("_status") == 200 and bd.get("orderId") and "mock" not in str(bd.get("orderId")).lower()
            R.add("PayPal booking order", bool(okb), f"status={book.get('_status')} booking={str(bd.get('bookingId'))[:18]} order={str(bd.get('orderId'))[:18]}")
        else:
            R.add("PayPal booking order", False, "no services on sample vendor")

    # Trips
    if token:
        trip = req("POST", "/trips", {"title": "Negril Day Trip"}, token=token)
        tid = (trip.get("data") or {}).get("id") or (trip.get("data") or {}).get("board_id")
        R.add("create trip board", bool(tid) or trip.get("_status") in (200, 201), str(trip)[:160])
        if tid and vid:
            item = req("POST", f"/trips/{tid}/items", {"vendor_id": vid, "title": "Vendor stop", "day_index": 1}, token=token)
            R.add("add trip item", item.get("_status") in (200, 201), str(item)[:140])
            plan = req("POST", f"/trips/{tid}/plan", {}, token=token)
            R.add("AI trip plan", plan.get("_status") in (200, 201), str(plan)[:160])

    # Offline pack
    off = req("GET", "/offline/pack")
    R.add("offline pack", off.get("_status") == 200 and (off.get("data") or off.get("phrases") or off.get("pack")), str(list((off.get("data") or off).keys())[:12]) if isinstance(off.get("data") or off, dict) else str(off)[:120])

    # Vendor dashboard path
    vs = req(
        "POST",
        "/vendor-signup",
        {
            "email": f"bt-vendor-{int(time.time())}@patwago.test",
            "name": "Backtest Vendor",
            "vendorName": f"BT Tours {int(time.time())%10000}",
            "category": "tours",
            "location": "Montego Bay",
            "plan": "free",
            "description": "Backtest listing",
        },
    )
    vtoken = (vs.get("data") or {}).get("token")
    vendor_id = (vs.get("data") or {}).get("vendorId")
    R.add("vendor signup", bool(vtoken and vendor_id), str(vs.get("data") or vs)[:160])
    if vtoken:
        me = req("GET", "/vendor-signup/me", token=vtoken)
        R.add("vendor me", me.get("_status") == 200, str(me)[:140])
        dash = req("GET", "/vendor-dashboard/overview", token=vtoken)
        if dash.get("_status") == 404:
            dash = req("GET", "/vendor-dashboard", token=vtoken)
        R.add("vendor dashboard", dash.get("_status") == 200, str(dash)[:160])

    # SOS dispatch fields
    if token:
        sos = req("POST", "/safety/sos", {"location": "Backtest location", "lat": 18.1, "lng": -77.3, "message": "e2e"}, token=token)
        R.add("SOS create", sos.get("_status") in (200, 201) and (sos.get("sos") or sos.get("data")), str(sos)[:180])

    # Maps
    mp = req("GET", "/maps/config")
    R.add("maps config", mp.get("_status") == 200 and (mp.get("data") or {}).get("browserKey"), "browserKey present" if (mp.get("data") or {}).get("browserKey") else str(mp)[:100])

    print("\n=== SUMMARY ===")
    passed = sum(1 for _, ok, _ in R.rows if ok)
    failed = sum(1 for _, ok, _ in R.rows if not ok)
    print(f"passed={passed} failed={failed} total={len(R.rows)}")
    if failed:
        print("FAILURES:")
        for name, ok, detail in R.rows:
            if not ok:
                print(" -", name, detail)
    return 0 if failed == 0 else 1

if __name__ == "__main__":
    raise SystemExit(main())
