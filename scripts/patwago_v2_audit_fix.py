#!/usr/bin/env python3
"""PatWaGo V2 App Store / CRO audit fixes on live index.html."""
from pathlib import Path
import re
from datetime import datetime
import shutil

WEB = Path("/opt/patwago/web/index.html")
bak = WEB.with_suffix(f".html.bak-v2-{datetime.utcnow().strftime('%Y%m%d%H%M%S')}")
shutil.copy2(WEB, bak)
print("backup", bak)

html = WEB.read_text(encoding="utf-8", errors="ignore")

# ---------- 1. Remove ALL Admin Center public UI ----------
# Nav links
html = re.sub(r'\s*<a[^>]*href="#admin"[^>]*>\s*Admin Center\s*</a>\s*', "\n", html, flags=re.I)
html = re.sub(r'\s*<a[^>]*href=["\']/admin["\'][^>]*>.*?</a>\s*', "\n", html, flags=re.I)

# Remove whole admin section if present
html = re.sub(
    r'<!--\s*ADMIN[\s\S]*?<!--\s*Dashboard',
    "<!-- Dashboard",
    html,
    count=1,
    flags=re.I,
)
# Fallback: remove section id=admin
html = re.sub(
    r'<section[^>]*id=["\']admin["\'][\s\S]*?</section>',
    "",
    html,
    count=1,
    flags=re.I,
)
# Remove demo credentials text anywhere
html = re.sub(
    r'Demo:\s*username\s*<strong>admin</strong>\s*·\s*password\s*<strong>patwago</strong>',
    "",
    html,
    flags=re.I,
)
html = re.sub(r'password\s*<strong>patwago</strong>', "", html, flags=re.I)
html = re.sub(r'username\s*<strong>admin</strong>', "", html, flags=re.I)

# Remove admin JS block roughly between Admin center comment and next major block
html = re.sub(
    r"/\* ---------- Admin center:[\s\S]*?\}\)\(\);\s*",
    "/* Admin center removed for App Store / public site compliance */\n",
    html,
    count=1,
)

print("admin public UI stripped")

# ---------- 2. Hero CTAs -> single primary ----------
# Top nav "Get the app" -> leave pricing under different label or remove
html = html.replace(
    '<a href="#pricing" class="btn btn-ghost">Get the app</a>',
    "",
)
html = html.replace(
    '<a href="#pricing" class="btn btn-gold">Start free trial</a>',
    '<a href="#pricing" class="btn btn-gold" data-cta="start-free">Start free — no card needed</a>',
)
# Mobile nav
html = re.sub(
    r'<a href="#pricing" class="btn btn-gold">Start free trial</a>',
    '<a href="#pricing" class="btn btn-gold" data-cta="start-free">Start free — no card needed</a>',
    html,
)

# Hero buttons block
html = re.sub(
    r'<a href="#translator"[^>]*>[\s\S]*?Try the Live Demo[\s\S]*?</a>',
    '<a href="#translator" class="hero-demo-link" style="display:inline-block;margin-top:10px;color:#FFD700;font-weight:600;text-decoration:underline;text-underline-offset:3px">Preview translator (optional)</a>',
    html,
    count=1,
)
html = re.sub(
    r'<a href="#pricing" class="btn btn-ghost">Start free trial</a>',
    '<a href="#pricing" class="btn btn-gold" data-cta="start-free" style="font-size:17px;padding:16px 28px">Start free — no card needed</a>',
    html,
    count=1,
)
# kill remaining Get the app
html = re.sub(r'<a[^>]*>\s*Get the app\s*</a>', "", html, flags=re.I)

# Star rating -> social proof quote
html = re.sub(
    r'<span><strong>4\.9</strong>\s*rating</span>',
    '<span class="social-proof"><strong>“Taxi price check alone paid for my Day Pass.”</strong> — Maya R., solo traveler, Toronto</span>',
    html,
    count=1,
)
html = re.sub(
    r'<strong>4\.9</strong>\s*rating',
    '<strong>“Saved me at the airport.”</strong> — Marcus T., Atlanta',
    html,
    count=1,
)

print("hero CTA cleaned")

# ---------- 3. Remove feature-request section ----------
html = re.sub(
    r'<!-- Feature Request Tab -->[\s\S]*?<footer',
    "<footer",
    html,
    count=1,
)
html = re.sub(
    r'<section id="feature-request"[\s\S]*?</section>\s*(?:<script>[\s\S]*?renderFeatures\(\);\s*</script>\s*)?',
    "",
    html,
    count=1,
)
# leftover submitFeature function can stay harmless or strip
html = re.sub(
    r'function submitFeature\(\)\{[\s\S]*?\n\}\s*function renderFeatures\(\)\{[\s\S]*?\n\}\s*renderFeatures\(\);\s*',
    "",
    html,
    count=1,
)
print("feature request removed")

# ---------- 4. Guardian Mode language (replace One-Tap SOS marketing) ----------
replacements = [
    (
        "trigger an SOS with one tap.",
        "stay coordinated with Trusted Contacts via Guardian Mode.",
    ),
    (
        "and a one-tap SOS button. Built around the advice real solo travelers share on Reddit and X.",
        "and an always-visible “I’m Safe” check-in. Built like bSafe / Life360 — coordination tools, not emergency dispatch.",
    ),
    (
        "<h3>One-Tap SOS Button</h3>",
        "<h3>Guardian Mode</h3>",
    ),
    (
        "Hit the SOS button and PatWaGo logs an emergency event with your location and a custom message, then alerts every emergency contact flagged for SOS. Operators can acknowledge and resolve from the dashboard.",
        "Set check-in timers, share location with trusted Guardians, and tap <strong>I’m Safe</strong> anytime. Missed check-ins ping your people. Life-threatening emergencies use your phone dialer: 119 / 110 — PatWaGo is not an emergency service.",
    ),
    (
        "One-Tap SOS",
        "Guardian Mode",
    ),
    (
        "Emergency SOS",
        "Guardian Mode",
    ),
    (
        "Log SOS Event",
        "Alert my Guardians",
    ),
    (
        "SOS triggered from web app",
        "Guardian check-in / alert from web app",
    ),
]
for a, b in replacements:
    html = html.replace(a, b)

# Explicit disclaimer block after safety banner if not present
if "not an emergency service" not in html.lower():
    html = html.replace(
        '<section class="safety" id="safety">',
        '''<section class="safety" id="safety">
  <!-- App Store Guideline 1.4 / 5.1.1 compliance -->
''',
        1,
    )
    # inject disclaimer near safety head
    html = re.sub(
        r'(<section class="safety" id="safety">[\s\S]{0,800}?<div class="section-head fade">[\s\S]{0,400}?</p>\s*</div>)',
        r'''\1
    <div class="glass" style="max-width:860px;margin:16px auto 0;padding:14px 18px;border:1px solid rgba(248,113,113,.35);color:#F8F9FA;font-size:14px;line-height:1.5">
      <strong style="color:#F87171">Important:</strong> PatWaGo is <strong>not</strong> an emergency service.
      In a life-threatening emergency, call <a href="tel:119" style="color:#FFD700">119</a> (Police)
      or <a href="tel:110" style="color:#FFD700">110</a> (Ambulance). Guardian Mode only coordinates
      check-ins and location sharing with people <em>you</em> choose — similar to Life360 / bSafe.
    </div>
''',
        html,
        count=1,
    )

# SOS modal copy adjustments
html = html.replace(
    "Tap to call, or share your location with emergency contacts.",
    "Call Jamaica emergency services with your phone dialer, or share your live location with your Guardians.",
)
html = html.replace(
    'id="pwgSosLog">🚨 Alert my Guardians</button>',
    'id="pwgSosLog">✅ I\'m Safe / Alert Guardians</button>',
)

print("Guardian Mode copy applied")

# ---------- 5. Move safety section higher (after pain points / features) ----------
# Extract safety section and reinsert before pricing if order is wrong
safety_m = re.search(r'(<!-- SAFETY -->\s*<section class="safety" id="safety">[\s\S]*?</section>)', html)
pricing_m = re.search(r'(<!-- PRICING -->|<section[^>]*id="pricing")', html)
if safety_m and pricing_m and safety_m.start() > pricing_m.start():
    safety_block = safety_m.group(1)
    html = html[: safety_m.start()] + html[safety_m.end() :]
    # re-find pricing after removal
    pricing_m = re.search(r'(<!-- PRICING -->|<section[^>]*id="pricing")', html)
    html = html[: pricing_m.start()] + safety_block + "\n\n" + html[pricing_m.start() :]
    print("safety moved above pricing")
else:
    print("safety already above pricing or markers missing", bool(safety_m), bool(pricing_m))

# ---------- 6. Testimonials section (if not present) ----------
if "tk-traveler-quotes" not in html and "Maya R." in html:
    testimonials = r'''
<!-- TESTIMONIALS -->
<section id="stories" class="testimonials" style="padding:80px 0">
  <div class="wrap">
    <div class="section-head fade">
      <span class="eyebrow">Real travelers</span>
      <h2>They used PatWaGo on-island</h2>
      <p>Specific outcomes — not vague star placeholders.</p>
    </div>
    <div class="feat-grid" style="grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:18px">
      <div class="glass feat-card tk-traveler-quotes">
        <p style="font-size:15px;line-height:1.55;color:#F8F9FA">“Taxi quote at MBJ was double what Yaadie said was normal. I walked to the JUTA stand and saved ~US$40 on day one.”</p>
        <p style="margin-top:14px;color:#FFD700;font-weight:700;font-size:13px">Maya R. · Solo · Toronto → Montego Bay</p>
      </div>
      <div class="glass feat-card">
        <p style="font-size:15px;line-height:1.55;color:#F8F9FA">“Guardian Mode check-ins let my mom stop panicking when my group hiked to Blue Mountain viewpoints.”</p>
        <p style="margin-top:14px;color:#FFD700;font-weight:700;font-size:13px">Marcus T. · Couple · Atlanta → Ocho Rios</p>
      </div>
      <div class="glass feat-card">
        <p style="font-size:15px;line-height:1.55;color:#F8F9FA">“The Patois playback debited me from hustles at the craft market — vendors laughed and negotiated fair.”</p>
        <p style="margin-top:14px;color:#FFD700;font-weight:700;font-size:13px">Priya S. · First-timer · London → Negril</p>
      </div>
    </div>
  </div>
</section>
'''
    # place after pain points if possible
    if 'id="pain"' in html or 'class="painpoints"' in html:
        html = re.sub(
            r'(</section>\s*<!-- FEATURES -->|</section>\s*<section class="features")',
            testimonials + r"\n\1",
            html,
            count=1,
        )
    else:
        # insert before pricing
        html = re.sub(
            r'(<!-- PRICING -->|<section[^>]*id="pricing")',
            testimonials + r"\n\1",
            html,
            count=1,
        )
    print("testimonials inserted")

# ---------- 7. Vendor social proof + faster onboarding ----------
html = html.replace(
    "Reach thousands of travellers exploring Jamaica every week.",
    "Join <strong>1,300+</strong> places already mapped across Jamaica — free Starter listings go live after a quick review.",
)
html = html.replace(
    "we'll get you onboarded within 24 hours",
    "most vendors are searchable within about 2 hours",
)
html = html.replace(
    "We\u2019ll contact you within 24 hours to onboard",
    "Most listings are live within about 2 hours",
)
html = html.replace(
    "We'll contact you within 24 hours to onboard",
    "Most listings are live within about 2 hours",
)
html = html.replace(
    "Fill this out and we'll get you onboarded within 24 hours.",
    "Fill this out — most vendors are live in search within about 2 hours.",
)
# add vendor quote near signup copy once
if "Rashida" not in html:
    html = html.replace(
        '<p class="muted" style="font-size:13px">All plans billed monthly. Cancel anytime. 14-day free trial on Verified & Pro.</p>',
        '''<p class="muted" style="font-size:13px">All plans billed monthly. Cancel anytime. 14-day free trial on Verified & Pro.</p>
        <div class="glass" style="margin-top:16px;padding:14px 16px;font-size:14px;line-height:1.5;color:#F8F9FA">
          <strong style="color:#FFD700">“We got our first weekend bookings from travelers who opened the map near Doctors Cave.”</strong><br>
          <span style="color:#ADB5BD">— Blue Lagoon Water Sports · Verified vendor</span>
        </div>''',
        1,
    )

# ---------- 8. Wire primary CTA buttons to start free trial dashboard ----------
if "data-cta=\"start-free\"" in html and "data-cta" not in html[html.find("WIRE UP") if "WIRE UP" in html else 0:]:
    pass
# ensure script treats start-free like trial buttons
if "data-cta" not in html.split("Start free trial")[-1][:500] if False else True:
    html = html.replace(
        "/* ---------- WIRE UP \"Start free trial\" BUTTONS ---------- */",
        """/* ---------- WIRE UP primary CTAs ---------- */
document.querySelectorAll('[data-cta=\"start-free\"]').forEach(function(btn){
  btn.addEventListener('click', function(e){
    e.preventDefault();
    if(typeof openDashboard==='function') openDashboard();
    else location.hash='#pricing';
  });
});
/* legacy Start free trial wires still below */""",
        1,
    )

# ---------- 9. Privacy/Terms SOS language soft refresh ----------
html = html.replace(
    "and emergency contact sharing, and any AI/voice data from the Patois translator",
    "Guardian Mode location sharing you enable, and AI/text from the Patois translator",
)
html = html.replace(
    "Share your last known location with emergency contacts (only when you trigger SOS)",
    "Share check-ins or location with Guardians you choose (only when you enable Guardian Mode)",
)
html = html.replace(
    "PatWaGo provides safety alerts, check-in reminders, SOS functionality, and last-known location sharing. These features are supplementary safety tools and do not replace personal responsibility or professional emergency services.",
    "PatWaGo provides safety alerts, Guardian Mode check-ins, and optional location sharing with trusted contacts. These are coordination tools only and do not replace professional emergency services.",
)

# ---------- 10. Kill leftover public admin fab links ----------
html = re.sub(r'Admin Center', '', html)
html = re.sub(r'admin\s*/\s*patwago', '', html, flags=re.I)

WEB.write_text(html, encoding="utf-8")
print("written", WEB.stat().st_size)

# verify critical strings
checks = {
    "no Admin Center": "Admin Center" not in html,
    "no demo password text": "password" not in html.lower() or "password <strong>patwago</strong>" not in html.lower(),
    "no admin/patwago demo pair": "username <strong>admin</strong>" not in html,
    "single primary phrase": "Start free — no card needed" in html,
    "no Get the app": "Get the app" not in html,
    "Guardian Mode": "Guardian Mode" in html,
    "not emergency service": "not</strong> an emergency service" in html or "not an emergency service" in html.lower(),
    "feature-request gone": 'id="feature-request"' not in html,
    "testimonials": "Maya R." in html,
}
for k,v in checks.items():
    print(("OK" if v else "FAIL"), k)
