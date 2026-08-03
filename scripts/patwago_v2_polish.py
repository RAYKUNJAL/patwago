#!/usr/bin/env python3
from pathlib import Path

p = Path("/opt/patwago/web/index.html")
html = p.read_text(encoding="utf-8")

html = html.replace("Start your free 24h trial", "Start free — no card needed")
html = html.replace(">Start free trial<", ">Start free — no card needed<")

if "Important:" not in html:
    html = html.replace(
        "<h2>Explore Jamaica with confidence</h2>",
        """<h2>Explore Jamaica with confidence</h2>
    <div class="glass" style="max-width:860px;margin:16px auto 0;padding:14px 18px;border:1px solid rgba(248,113,113,.35);color:#F8F9FA;font-size:14px;line-height:1.5;text-align:left">
      <strong style="color:#F87171">Important:</strong> PatWaGo is <strong>not</strong> an emergency service.
      In a life-threatening emergency, call <a href="tel:119" style="color:#FFD700">119</a> (Police)
      or <a href="tel:110" style="color:#FFD700">110</a> (Ambulance). Guardian Mode only helps you coordinate check-ins with people you choose.
    </div>""",
        1,
    )

if "App Store price" not in html and "Apple IAP" not in html:
    html = html.replace(
        "<h2>Pay for your trip, not a subscription</h2>",
        """<h2>Pay for your trip, not a subscription</h2>
      <p class="muted" style="max-width:640px;margin:8px auto 0;font-size:14px">Web checkout today via PayPal. When the iOS app ships, Day/Trip Passes use Apple IAP (estimated $12.99 / $39.99 after platform fees). Vendor plans stay web-only.</p>""",
        1,
    )

p.write_text(html, encoding="utf-8")
checks = {
    "Admin Center": html.count("Admin Center"),
    "Get the app": html.count("Get the app"),
    "feature-request": html.count('id="feature-request"'),
    "One-Tap SOS": html.count("One-Tap SOS"),
    "demo pass": html.lower().count("password <strong>patwago</strong>"),
    "Start free — no card needed": html.count("Start free — no card needed"),
    "Guardian Mode": html.count("Guardian Mode"),
    "Important:": html.count("Important:"),
    "Apple IAP": html.count("Apple IAP"),
}
print(checks)
print("size", p.stat().st_size)
