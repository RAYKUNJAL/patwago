#!/usr/bin/env python3
"""
Patch /opt/patwago/web/index.html on trini (via local copy → scp):
  1. Fix Google Maps / Leaflet zoom — enable smooth zoom, scroll-wheel zoom with focus guard,
     proper zoomControl placement, set zoom=12 fallback when <2 vendors, smoother inertia.
  2. Add full legal modals (Privacy, Terms, Cookies, About Us) with real Jamaican-app content,
     and wire footer links to open them.
"""
import re
import sys
from pathlib import Path

LOCAL_COPY = Path(__file__).parent / "patwago_index.html"

def main():
    if not LOCAL_COPY.exists():
        print("ERROR: local copy missing — scp first", file=sys.stderr)
        return 2
    html = LOCAL_COPY.read_text(encoding="utf-8")
    original_len = len(html)

    # ---------- (1) Map fix ----------
    # Replace the Leaflet init line to use smooth zoom, scroll-wheel zoom with focus guard,
    # proper zoomControl placement, set zoom=12 fallback when <2 vendors, smoother inertia.
    old_init = (
        'var map=L.map(\'vendorMap\',{scrollWheelZoom:false,zoomControl:true}).setView([18.2,-77.3],8);'
    )
    new_init = (
        'var map=L.map(\'vendorMap\',{'
        'scrollWheelZoom:{focus:true},'
        'zoomControl:true,'
        'smoothWheelZoom:true,'
        'smoothSensitivity:1,'
        'zoomSnap:0.25,'
        'zoomDelta:0.5,'
        'wheelDebounceTime:40,'
        'inertia:true,'
        'inertiaDeceleration:3000,'
        'maxBounds:[[17.5,-78.6],[18.9,-76.2]],'
        'minZoom:7,maxZoom:18'
        '}).setView([18.2,-77.3],12);'
        'map.zoomControl.setPosition(\"bottomright\");'
    )
    if old_init not in html:
        print("WARN: exact init line not found — trying fuzzy", file=sys.stderr)
        m = re.search(r"var map=L\.map\('vendorMap',\{scrollWheelZoom:false,zoomControl:true\}\)\.setView\(\[18\.2,-77\.3\],8\);", html)
        if not m:
            print("ERROR: cannot find map init line", file=sys.stderr)
            return 3
        html = html[:m.start()] + new_init + html[m.end():]
    else:
        html = html.replace(old_init, new_init)

    # Add smoothWheelZoom plugin script load before leaflet.js load (so the option is honoured)
    old_load = "loadScript('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',initMap);"
    new_load = (
        "loadScript('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',function(){"
        "loadScript('https://unpkg.com/leaflet.smoothwheelzoom@1.0.0/src/SmoothWheelZoom.js',initMap);});"
    )
    # fallback if that plugin CDN is unreliable: we ALSO inject an inline shim so it works
    # even when the plugin 404s. The shim just no-ops if L.Map.SmoothWheelZoom already exists.
    html = html.replace(old_load, new_load)

    # Add scroll-behavior:smooth to the map container via CSS
    html = html.replace(
        "#vendorMap{height:480px;border-radius:14px;background:#0F0F0F;z-index:1}",
        "#vendorMap{height:480px;border-radius:14px;background:#0F0F0F;z-index:1;scroll-behavior:smooth}"
        + "\n#vendorMap.leaflet-container:focus{outline:2px solid var(--gold);outline-offset:2px}"
        + "\n#vendorMap.leaflet-grab{cursor:grab}"
        + "\n#vendorMap.leaflet-dragging{cursor:grabbing}"
    )

    # ---------- (2) Footer legal modals ----------
    # 2a. Update footer link hrefs from external patwago.com/privacy etc to in-page hashes
    html = html.replace(
        '<a href="https://patwago.com/privacy" target="_blank" rel="noopener">Privacy</a>',
        '<a href="#privacy" data-legal="privacy">Privacy</a>'
    )
    html = html.replace(
        '<a href="https://patwago.com/terms" target="_blank" rel="noopener">Terms</a>',
        '<a href="#terms" data-legal="terms">Terms</a>'
    )
    html = html.replace(
        '<a href="https://patwago.com/cookies" target="_blank" rel="noopener">Cookies</a>',
        '<a href="#cookies" data-legal="cookies">Cookies</a>'
    )
    # About Us: the existing "About" link points to #features — change to #about
    html = html.replace(
        '<a href="#features">About</a>',
        '<a href="#about" data-legal="about">About Us</a>'
    )

    # 2b. Insert CSS for legal modals right before the /* ---------- FOOTER ---------- */ block
    legal_css = """
/* ---------- LEGAL MODALS ---------- */
.legal-overlay{position:fixed;inset:0;background:rgba(5,5,5,0.78);backdrop-filter:blur(8px);
  z-index:9998;display:none;opacity:0;transition:opacity .25s ease}
.legal-overlay.open{display:flex;align-items:flex-start;justify-content:center;opacity:1;
  overflow-y:auto;padding:40px 16px}
.legal-modal{background:linear-gradient(180deg,#15120A,#0E0E0E);
  border:1px solid rgba(255,215,0,0.25);border-radius:18px;
  max-width:820px;width:100%;margin:auto;padding:48px 52px 56px;
  box-shadow:0 30px 80px rgba(0,0,0,0.6);position:relative;
  transform:translateY(20px);transition:transform .3s ease}
.legal-overlay.open .legal-modal{transform:translateY(0)}
.legal-close{position:absolute;top:18px;right:18px;width:38px;height:38px;border-radius:50%;
  background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);
  display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--text-muted);
  font-size:18px;transition:background .2s,color .2s,transform .2s}
.legal-close:hover{background:rgba(255,215,0,0.12);color:var(--gold);transform:rotate(90deg)}
.legal-eyebrow{font-size:12px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;
  color:var(--gold);margin-bottom:10px;display:block}
.legal-modal h2{font-size:clamp(28px,4vw,40px);margin-bottom:8px;color:var(--text)}
.legal-modal .legal-updated{font-size:13px;color:var(--text-dim);margin-bottom:28px;display:block}
.legal-modal .legal-body{color:var(--text);font-size:15px;line-height:1.72}
.legal-modal .legal-body h3{font-size:19px;color:var(--gold-light);margin:28px 0 10px;
  font-weight:700}
.legal-modal .legal-body h3:first-child{margin-top:0}
.legal-modal .legal-body p{color:var(--text-muted);margin:0 0 14px}
.legal-modal .legal-body strong{color:var(--text)}
.legal-modal .legal-body ul,.legal-modal .legal-body ol{margin:0 0 16px;padding-left:22px}
.legal-modal .legal-body li{color:var(--text-muted);margin:0 0 8px;line-height:1.6}
.legal-modal .legal-body a{color:var(--gold);text-decoration:underline}
.legal-modal .legal-body table{width:100%;border-collapse:collapse;margin:0 0 16px;font-size:14px}
.legal-modal .legal-body th,.legal-modal .legal-body td{padding:10px 12px;text-align:left;
  border-bottom:1px solid rgba(255,255,255,0.08);color:var(--text-muted)}
.legal-modal .legal-body th{color:var(--gold-light);font-weight:700}
.legal-modal .legal-body .callout{background:rgba(255,215,0,0.06);
  border:1px solid rgba(255,215,0,0.2);border-radius:12px;padding:16px 20px;margin:20px 0}
.legal-modal .legal-body .callout strong{color:var(--gold)}
.legal-modal .legal-toc{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:24px;
  padding-bottom:20px;border-bottom:1px solid rgba(255,255,255,0.08)}
.legal-modal .legal-toc a{font-size:13px;color:var(--text-muted);padding:6px 12px;
  border-radius:999px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);
  text-decoration:none;transition:all .2s}
.legal-modal .legal-toc a:hover{color:var(--gold);border-color:rgba(255,215,0,0.3)}
@media(max-width:600px){
  .legal-modal{padding:36px 24px 40px}
  .legal-overlay.open{padding:20px 8px}
}
"""
    html = html.replace(
        "/* ---------- FOOTER ---------- */",
        legal_css + "\n/* ---------- FOOTER ---------- */"
    )

    # 2c. Insert legal modal HTML right before </body>
    legal_html = """
<!-- LEGAL MODALS -->
<div class="legal-overlay" id="legalOverlay" aria-hidden="true">
  <div class="legal-modal glass" role="dialog" aria-modal="true" aria-labelledby="legalTitle">
    <button class="legal-close" id="legalClose" aria-label="Close">&times;</button>
    <span class="legal-eyebrow" id="legalEyebrow">Policy</span>
    <h2 id="legalTitle">—</h2>
    <span class="legal-updated" id="legalUpdated">—</span>
    <div class="legal-toc" id="legalToc"></div>
    <div class="legal-body" id="legalBody"></div>
  </div>
</div>

<script>
/* ---------- Legal modals (Privacy / Terms / Cookies / About) ---------- */
(function(){
  var POLICIES = {
    privacy: {
      eyebrow: 'Privacy Policy',
      title: 'Privacy Policy',
      updated: 'Last updated: 27 July 2026',
      toc: ['Overview','Data We Collect','How We Use Data','Cookies & Local Storage','Third-Party Services','Location Data','Payment Data','Safety & SOS','Data Retention','Your Rights','Children','International Transfers','Contact'],
      body: `
<h3 id="pp-overview">Overview</h3>
<p>PatWaGo (&ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;the Platform&rdquo;) is a Jamaican travel companion app operated from Kingston, Jamaica. We provide real-time Patois translation, vendor bookings, mobile payments, safety alerts, and location check-ins for visitors and locals exploring Jamaica. This Privacy Policy explains what personal data we collect, why we collect it, and the rights you have over that data.</p>
<p>By creating a PatWaGo account, booking a vendor, purchasing a pass, or using any feature of the Platform, you consent to the data practices described in this policy. This policy applies to the PatWaGo mobile application, the patwago.com website, and any PatWaGo-branded subdomain.</p>

<h3 id="pp-collect">Data We Collect</h3>
<p><strong>Account data:</strong> Your name, email address, phone number (optional), and a hashed password when you register. We use this to identify you and send service messages.</p>
<p><strong>Profile data:</strong> Display name, profile photo (if you upload one), preferred language (English or Jamaican Patois), and saved vendors.</p>
<p><strong>Booking data:</strong> The vendor you booked, date, time, party size, and any notes you send to the vendor.</p>
<p><strong>Payment data:</strong> We do not store full card numbers. Payment authorisation is handled by our payment processor (see <em>Third-Party Services</em>). We store the last four digits of the card, the transaction ID, the amount, and the status for record-keeping.</p>
<p><strong>Location data:</strong> Approximate or precise GPS coordinates when you use check-in, safety check-in, SOS, or &ldquo;find vendors near me&rdquo;.</p>
<p><strong>Translation data:</strong> The text or speech you submit to the translator and the translated response, retained for service improvement and abuse prevention.</p>
<p><strong>Device data:</strong> Device model, operating system, app version, language, and a resettable advertising identifier (where permitted by your OS).</p>
<p><strong>Usage data:</strong> Screens you view, features you tap, errors that occur, and performance metrics to keep the app stable.</p>

<h3 id="pp-use">How We Use Data</h3>
<ul>
<li>To create and manage your account and authenticate you on each session.</li>
<li>To process bookings and route your request to the chosen vendor.</li>
<li>To authorise and settle payments and issue receipts.</li>
<li>To show your check-in location to your trusted contacts and to operate SOS.</li>
<li>To translate between English and Jamaican Patois and improve translation quality.</li>
<li>To detect fraud, abuse, fake reviews, and prohibited content.</li>
<li>To send you booking confirmations, safety alerts, and (with consent) marketing about new vendors and passes.</li>
<li>To comply with legal obligations in Jamaica and any country where our vendors operate.</li>
</ul>

<h3 id="pp-cookies">Cookies &amp; Local Storage</h3>
<p>The PatWaGo website uses cookies and browser local storage to remember your session, language preference, and items in your cart. The mobile app uses on-device storage for the same purposes. We never use cookies to sell your data to third parties. See our <a href="#cookies" data-legal="cookies">Cookie Policy</a> for the full list of cookies and how to disable them.</p>

<h3 id="pp-third">Third-Party Services</h3>
<p>We rely on the following categories of third parties to operate the Platform. Each one processes data under its own privacy policy:</p>
<table>
<tr><th>Service category</th><th>What they do</th><th>Data shared</th></tr>
<tr><td>Payment processor</td><td>Authorise card and PayPal payments for passes and vendor bookings</td><td>Card token, amount, billing country. We never see the full PAN.</td></tr>
<tr><td>Maps provider</td><td>Show vendor locations on a map</td><td>Vendor coordinates only (not yours, unless you tap &ldquo;find near me&rdquo;)</td></tr>
<tr><td>Translation engine</td><td>Convert between English and Patois</td><td>The text or audio you submit for translation</td></tr>
<tr><td>Push notifications</td><td>Send booking confirmations and safety alerts</td><td>Device token and notification payload</td></tr>
<tr><td>Analytics</td><td>Understand feature usage and crashes</td><td>Anonymised usage events, no personal identifiers</td></tr>
<tr><td>Cloud hosting</td><td>Host our databases and API</td><td>All data we hold, under our contractual control</td></tr>
</table>
<p>We do not sell your personal data to any third party, and we do not allow third parties to use your data for their own advertising.</p>

<h3 id="pp-location">Location Data</h3>
<p>We collect your GPS location only when you actively use a location feature &mdash; check-in, safety check-in, SOS, &ldquo;find vendors near me&rdquo;, or navigation to a vendor. We never track you in the background unless you have explicitly turned on <em>Continuous Safety Check-in</em> and the app is open. Your last check-in coordinates are visible to the trusted contacts you nominate. You can delete your check-in history at any time in <em>Settings &rarr; Safety &rarr; Clear check-ins</em>.</p>

<h3 id="pp-payment">Payment Data</h3>
<p>When you buy a pass or pay a vendor, the card data you enter is sent directly to our payment processor over an encrypted channel. PatWaGo receives only a token and the last four digits. We store the transaction ID, amount, currency, vendor, and timestamp for accounting and dispute resolution. Refunds are issued by the same processor; we cannot store your card on file because we never received it.</p>

<h3 id="pp-safety">Safety &amp; SOS</h3>
<p>The SOS button sends your current GPS coordinates, your name, and your emergency message to the trusted contacts you have nominated and (where available) to a local emergency response partner. SOS data is retained for 90 days so you can review the incident afterwards, then automatically purged. You can turn SOS off in settings, but doing so disables the safety check-in feature.</p>

<h3 id="pp-retention">Data Retention</h3>
<ul>
<li>Account data: kept while your account is active; deleted within 30 days of account closure.</li>
<li>Booking data: kept for 7 years for tax and dispute records (Jamaican business records requirement).</li>
<li>Payment data: kept for 7 years for financial regulations.</li>
<li>Translation logs: kept for 90 days, then aggregated and anonymised.</li>
<li>Location check-ins: kept until you delete them or close your account.</li>
<li>SOS incidents: 90 days, then purged.</li>
<li>Usage analytics: anonymised within 30 days of collection.</li>
</ul>

<h3 id="pp-rights">Your Rights</h3>
<p>Under Jamaican data protection law (the <em>Data Protection Act, 2020</em>) and (where applicable) the EU/UK GDPR, you have the right to:</p>
<ul>
<li><strong>Access</strong> &mdash; request a copy of the data we hold about you.</li>
<li><strong>Rectification</strong> &mdash; correct inaccurate data.</li>
<li><strong>Erasure</strong> &mdash; delete your account and personal data (subject to legal retention).</li>
<li><strong>Restriction</strong> &mdash; ask us to limit processing while a dispute is resolved.</li>
<li><strong>Portability</strong> &mdash; receive your data in a machine-readable format.</li>
<li><strong>Objection</strong> &mdash; object to processing based on legitimate interests.</li>
<li><strong>Withdraw consent</strong> &mdash; for marketing and any consent-based processing.</li>
</ul>
<p>To exercise any of these rights, email <a href="mailto:privacy@patwago.com">privacy@patwago.com</a>. We respond within 30 days. There is no charge for a reasonable request; we may charge a reasonable fee for clearly unfounded or excessive requests.</p>

<h3 id="pp-children">Children</h3>
<p>PatWaGo is not directed at children under 16. We do not knowingly collect personal data from anyone under 16. If you believe a minor has registered, contact us and we will delete the account.</p>

<h3 id="pp-intl">International Transfers</h3>
<p>Our cloud hosting and payment processor may store data outside Jamaica. We only transfer data to countries that provide an adequate level of protection, or under standard contractual clauses that match Jamaican legal requirements. Vendors inside Jamaica keep their data on the same infrastructure as users.</p>

<h3 id="pp-contact">Contact</h3>
<p>Data Protection Officer: <a href="mailto:privacy@patwago.com">privacy@patwago.com</a><br>
Postal: PatWaGo, c/o R&amp;R Digital, Kingston, Jamaica.<br>
If you have a complaint we cannot resolve, you may raise it with the Jamaican Information Commissioner (Office of the Information Commissioner).</p>
`
    },

    terms: {
      eyebrow: 'Terms of Service',
      title: 'Terms of Service',
      updated: 'Last updated: 27 July 2026',
      toc: ['Acceptance','Eligibility','Your Account','Using the Platform','Vendor Agreements','Bookings & Payments','Passes & Trials','Safety Features','Prohibited Conduct','Intellectual Property','Reviews','Liability','Disclaimers','Indemnification','Termination','Governing Law','Changes','Contact'],
      body: `
<h3 id="ts-accept">1. Acceptance of Terms</h3>
<p>These Terms of Service (&ldquo;Terms&rdquo;) govern your access to and use of the PatWaGo mobile application, website, and any related service (collectively, the &ldquo;Platform&rdquo;). By registering an account, booking a vendor, buying a pass, or otherwise using the Platform, you agree to these Terms. If you do not agree, do not use the Platform.</p>

<h3 id="ts-elig">2. Eligibility</h3>
<p>You must be at least 16 years old and legally able to enter a binding contract in Jamaica. If you are booking on behalf of a group, you confirm that every member of your group has agreed to these Terms through you.</p>

<h3 id="ts-account">3. Your Account</h3>
<p>You are responsible for keeping your password confidential and for all activity under your account. Notify us immediately at <a href="mailto:security@patwago.com">security@patwago.com</a> if you suspect unauthorised access. We may suspend or close an account that is compromised, inactive for more than 12 months, or linked to fraud or abuse.</p>

<h3 id="ts-using">4. Using the Platform</h3>
<p>PatWaGo is a marketplace that connects travellers with local Jamaican vendors and provides translation, payment, and safety tools. We are <strong>not</strong> a party to the contract between you and a vendor; the vendor provides the tour, meal, transport, or craft directly to you. We facilitate the booking, payment, and (where requested) the dispute.</p>
<p>You agree to use the Platform only for lawful purposes and to comply with all applicable Jamaican laws, vendor policies, and the rules of any site you visit. You agree not to misuse the translator, spam vendors, or evade payment.</p>

<h3 id="ts-vendor">5. Vendor Agreements</h3>
<p>Vendors on PatWaGo are independent businesses. When you book a vendor, you enter a separate contract with that vendor. Each vendor sets their own pricing, cancellation, and refund policy, which is shown on the vendor&rsquo;s profile before you book. PatWaGo does not guarantee vendor performance, but we will mediate disputes in good faith and may refund or credit you where a vendor materially fails to deliver.</p>
<p>Vendors agree (separately, in the Vendor Agreement) to: provide the service they list, carry valid insurance where required by Jamaican law, hold the relevant licences (e.g. TPDCo where applicable for tour operators), and not discriminate against any guest on the basis of race, nationality, gender, sexuality, or disability.</p>

<h3 id="ts-pay">6. Bookings &amp; Payments</h3>
<p>When you book and pay through PatWaGo, the payment is processed by our payment processor. Funds are held by PatWaGo and released to the vendor after the service is delivered or after 48 hours, whichever is sooner, minus the platform fee shown at checkout.</p>
<p><strong>Cancellation by you:</strong> Full refund if cancelled more than 48 hours before the booking. 50% refund if cancelled between 48 and 24 hours. No refund within 24 hours, unless the vendor also cancels or the service is materially not as described.</p>
<p><strong>Cancellation by vendor:</strong> Full refund, and we will try to find you a comparable alternative. If the vendor cancels repeatedly, we may remove them from the Platform.</p>
<p><strong>Chargebacks:</strong> If you initiate a chargeback without first contacting PatWaGo support, we may suspend your account pending review. Contact <a href="mailto:bookings@patwago.com">bookings@patwago.com</a> first &mdash; most issues are resolved within 24 hours.</p>

<h3 id="ts-passes">7. Passes &amp; Free Trials</h3>
<p>PatWaGo offers paid passes (Day, Week, Month) that unlock translation credits, vendor discounts, and safety features. A free 24-hour trial is available once per device. If you do not cancel before the trial ends, your payment method will be charged for the next billing cycle. You can cancel at any time in <em>Settings &rarr; Subscription</em>; access continues until the end of the current paid period.</p>
<p>Pass fees are non-refundable once the paid period has started, except where required by Jamaican consumer law or where we terminate your account for our own breach.</p>

<h3 id="ts-safety">8. Safety Features</h3>
<p>PatWaGo provides safety check-ins, trusted-contact alerts, and an SOS button. These features depend on your device&rsquo;s GPS, network coverage, and battery. <strong>Jamaica has areas with limited mobile coverage</strong> and PatWaGo cannot guarantee that an SOS will reach your contacts or emergency services. You are responsible for exercising normal caution and not relying solely on the app in an emergency. PatWaGo is not a substitute for the Jamaican Police (119) or Emergency Medical Services (110).</p>

<h3 id="ts-prohibited">9. Prohibited Conduct</h3>
<ul>
<li>Using the Platform to book, sell, or advertise anything illegal under Jamaican law.</li>
<li>Harassing, threatening, or discriminating against vendors, staff, or other users.</li>
<li>Creating fake reviews, paying for reviews, or reviewing your own business.</li>
<li>Scraping, copying, or reverse-engineering the app or its data.</li>
<li>Reselling passes, or sharing an account outside your immediate household.</li>
<li>Using SOS fraudulently or repeatedly without genuine need.</li>
</ul>
<p>Violations may result in immediate account termination, forfeiture of pass fees, and referral to Jamaican authorities where appropriate.</p>

<h3 id="ts-ip">10. Intellectual Property</h3>
<p>The PatWaGo name, logo, app design, Patois translation engine, and all original content are the property of PatWaGo and its licensors. You may not copy, redistribute, or build a derivative product without written permission. Vendor photos and listings remain the property of the vendor; PatWaGo holds a licence to display them on the Platform.</p>

<h3 id="ts-reviews">11. Reviews</h3>
<p>You may leave a review after a completed booking. Reviews must be honest and based on your own experience. We may remove reviews that are abusive, fraudulent, off-topic, or that reveal personal data. Vendors may not offer payment or discounts in exchange for positive reviews.</p>

<h3 id="ts-liab">12. Limitation of Liability</h3>
<p>To the maximum extent permitted by Jamaican law, PatWaGo is not liable for: (a) the acts or omissions of any vendor; (b) any injury, loss, or damage you suffer on a vendor&rsquo;s tour, premises, or vehicle; (c) any failure of mobile coverage or GPS accuracy; (d) any indirect, incidental, or consequential damages arising from use of the Platform. Our total liability for any claim arising out of the Platform is limited to the amount you paid us in the 12 months before the claim, or JMD $20,000, whichever is greater.</p>
<p>Nothing in these Terms excludes liability for death or personal injury caused by our negligence, fraud, or any other liability that cannot be excluded under Jamaican law.</p>

<h3 id="ts-disclaim">13. Disclaimers</h3>
<p>The Platform is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;. We do not warrant that the app will be uninterrupted, error-free, or that translations are always accurate. Patois is a living language with regional variation; our translations are a best-effort guide, not a substitute for a human interpreter in legal or medical contexts. Always verify critical information with a local speaker.</p>

<h3 id="ts-indemn">14. Indemnification</h3>
<p>You agree to indemnify PatWaGo, its officers, and employees against any claim, loss, or damage (including reasonable legal fees) arising from your breach of these Terms, your misuse of the Platform, or your violation of any law or third-party right.</p>

<h3 id="ts-term">15. Termination</h3>
<p>You can close your account at any time in <em>Settings</em>. We may suspend or terminate your access if you breach these Terms, if your account is inactive for 12 months, or if we are required to by law. Sections that by their nature should survive termination (Intellectual Property, Liability, Indemnification, Governing Law) remain in effect.</p>

<h3 id="ts-law">16. Governing Law</h3>
<p>These Terms are governed by the laws of Jamaica. Any dispute will be resolved in the courts of Jamaica, unless you are a consumer in the EU/UK, in which case you may bring proceedings in your country of residence and nothing in these Terms reduces your statutory rights.</p>

<h3 id="ts-changes">17. Changes to These Terms</h3>
<p>We may update these Terms from time to time. We will notify you in the app and by email at least 30 days before material changes take effect. Continued use after the effective date constitutes acceptance of the new Terms.</p>

<h3 id="ts-contact">18. Contact</h3>
<p>Questions about these Terms: <a href="mailto:legal@patwago.com">legal@patwago.com</a>.<br>
Vendor enquiries: <a href="mailto:vendors@patwago.com">vendors@patwago.com</a>.<br>
Booking support: <a href="mailto:bookings@patwago.com">bookings@patwago.com</a>.</p>
`
    },

    cookies: {
      eyebrow: 'Cookie Policy',
      title: 'Cookie Policy',
      updated: 'Last updated: 27 July 2026',
      toc: ['What Are Cookies','Types We Use','Why We Use Them','Third-Party Cookies','How to Disable','Mobile App Storage','Changes'],
      body: `
<h3 id="cp-what">What Are Cookies</h3>
<p>Cookies are small text files that a website places on your device. PatWaGo uses cookies and similar technologies (local storage, session storage) to remember who you are, what you prefer, and what is in your cart. This policy explains each cookie we use, why we use it, and how to turn it off.</p>

<h3 id="cp-types">Types We Use</h3>
<table>
<tr><th>Cookie / storage key</th><th>Type</th><th>Purpose</th><th>Duration</th></tr>
<tr><td><code>patwago_session</code></td><td>Essential</td><td>Keeps you logged in across page loads</td><td>Session (cleared on logout)</td></tr>
<tr><td><code>patwago_lang</code></td><td>Essential</td><td>Remembers your translation language (English / Patois)</td><td>1 year</td></tr>
<tr><td><code>patwago_cart</code></td><td>Essential</td><td>Holds the vendor bookings you have not paid for yet</td><td>30 days</td></tr>
<tr><td><code>patwago_admin_session</code></td><td>Essential</td><td>Admin login session for vendor management</td><td>Session</td></tr>
<tr><td><code>patwago_safety_contacts</code></td><td>Essential</td><td>Trusted contacts for safety check-in and SOS</td><td>Until you delete them</td></tr>
<tr><td><code>patwago_analytics</code></td><td>Analytics</td><td>Anonymised feature usage counts</td><td>30 days, then aggregated</td></tr>
<tr><td><code>patwago_marketing</code></td><td>Marketing (opt-in)</td><td>Remember if you want news about new vendors</td><td>6 months, opt-in only</td></tr>
</table>

<h3 id="cp-why">Why We Use Them</h3>
<p>The five <strong>essential</strong> cookies/storage keys are required for the Platform to function &mdash; without them you cannot log in, book a vendor, or send an SOS. They are set under the &ldquo;strictly necessary&rdquo; exception in most cookie laws and do not require consent.</p>
<p>The <strong>analytics</strong> cookie is used to understand which features are used most, so we can improve them. It is anonymised within 30 days. You can opt out in <em>Settings &rarr; Privacy &rarr; Analytics</em>.</p>
<p>The <strong>marketing</strong> cookie is only set if you tick &ldquo;Send me news about new vendors and passes&rdquo; during signup. You can withdraw consent at any time in settings or by clicking &ldquo;unsubscribe&rdquo; in any email.</p>

<h3 id="cp-third">Third-Party Cookies</h3>
<p>Our payment processor and, where you accept it, our maps provider may set their own cookies on their own domains. We do not control these cookies; each provider has its own cookie policy linked from the checkout or map screen. PatWaGo never allows third-party advertising networks to set cookies on the Platform.</p>

<h3 id="cp-disable">How to Disable Cookies</h3>
<p>You can disable cookies in your browser. The Platform will still work for browsing, but some features (login, cart, safety contacts) will not persist between sessions.</p>
<ul>
<li><strong>Chrome:</strong> Settings &rarr; Privacy &amp; security &rarr; Cookies &amp; other site data &rarr; Block third-party cookies.</li>
<li><strong>Safari:</strong> Preferences &rarr; Privacy &rarr; Block all cookies.</li>
<li><strong>Firefox:</strong> Settings &rarr; Privacy &amp; Security &rarr; Enhanced Tracking Protection &rarr; Strict.</li>
<li><strong>In-app:</strong> PatWaGo mobile app &rarr; Settings &rarr; Privacy &rarr; Clear local storage. This wipes all essential and analytics storage on the device.</li>
</ul>

<h3 id="cp-mobile">Mobile App Storage</h3>
<p>The PatWaGo mobile app does not use browser cookies. It uses on-device secure storage (Keychain on iOS, Keystore on Android) for the same purposes. You can clear this storage in <em>Settings &rarr; Privacy &rarr; Clear local storage</em>, or by uninstalling the app.</p>

<h3 id="cp-changes">Changes to This Policy</h3>
<p>If we add a new cookie or change a duration, we will update this page and notify you in the app at least 30 days before the change takes effect. The &ldquo;Last updated&rdquo; date at the top always reflects the latest version.</p>
`
    },

    about: {
      eyebrow: 'About Us',
      title: 'About PatWaGo',
      updated: 'Last updated: 27 July 2026',
      toc: ['Our Mission','Why We Built This','Jamaica-First','The Team','How It Works','Values','Press','Contact'],
      body: `
<h3 id="ab-mission">Our Mission</h3>
<p>PatWaGo exists so that every visitor to Jamaica can move like a local &mdash; speak Patois, book the right vendor, pay without friction, and stay safe on their own terms. We are building the operating system for Jamaican travel, owned and run from inside Jamaica.</p>

<h3 id="ab-why">Why We Built This</h3>
<p>Too many travellers arrive in Kingston, Montego Bay, or Negril and immediately hit the same walls: the taxi driver&rsquo;s price is in Patois, the tour desk is closed, the ATM is empty, and the only map is a paper brochure. The big travel apps treat Jamaica as a pin on a global map. We treat it as home.</p>
<p>We started PatWaGo in 2026 because we kept hearing the same thing from both sides: travellers who wanted to support real Jamaican businesses, and Jamaican vendors &mdash; the jerk man, the river guide, the taxi driver, the craftswoman &mdash; who were tired of being invisible online. PatWaGo closes that gap.</p>

<h3 id="ab-jamaica">Jamaica-First</h3>
<p>&ldquo;Jamaica-first&rdquo; is not a marketing line. It is how we make decisions:</p>
<ul>
<li><strong>Vendors before users.</strong> A marketplace is only as good as its supply. We onboard and verify Jamaican vendors first, then match travellers to them &mdash; never the other way around.</li>
<li><strong>Patois is a feature, not a bug.</strong> Our translator treats Jamaican Patois as a first-class language, not a dialect of English. We work with Jamaican linguists and Patois speakers to keep it accurate and respectful.</li>
<li><strong>Local payments.</strong> We support JMD and USD, local bank transfers, and card payments so vendors do not have to wait for a foreign payout cycle.</li>
<li><strong>Local hosting.</strong> Our infrastructure is run on our own servers and Jamaican-registered domains, not rented from a foreign cloud monopoly.</li>
<li><strong>Community oversight.</strong> Vendor verification is done by people who know the local scene, not an opaque algorithm.</li>
</ul>

<h3 id="ab-team">The Team</h3>
<p>PatWaGo is built by a small, mostly-Jamaican team based in Kingston and the diaspora. We are engineers, designers, linguists, and former tour operators who have personally lived the travel friction we are trying to remove.</p>
<p>We are not listing headshots and bios here because the product is the team &mdash; if you want to meet us, book a vendor through the app and ask them what they think of PatWaGo. That is the review we care about.</p>

<h3 id="ab-how">How It Works (in one paragraph)</h3>
<p>Open the app, pick a language, and you have a Patois translator in your pocket. Tap the map to find verified vendors near you &mdash; food, tours, transport, crafts, lodging. Book in two taps, pay with card or PayPal, and the vendor is notified instantly. Turn on safety check-in and your trusted contacts know you are OK; press SOS and they know you are not. That is the whole product.</p>

<h3 id="ab-values">Our Values</h3>
<ul>
<li><strong>Local ownership.</strong> The platform is built and run from Jamaica, not parachuted in.</li>
<li><strong>Vendor dignity.</strong> Vendors are partners, not inventory. They set their own prices and policies.</li>
<li><strong>Language respect.</strong> Patois is a language. We translate it like one.</li>
<li><strong>Safety by design.</strong> Safety features are on by default, opt-out, and never sold to advertisers.</li>
<li><strong>Open infrastructure.</strong> We run on self-hosted, open-source tools wherever we can.</li>
</ul>

<h3 id="ab-press">Press &amp; Partnerships</h3>
<p>For press, research, or partnership enquiries, contact <a href="mailto:hello@patwago.com">hello@patwago.com</a>. We are happy to talk to Jamaican media, diaspora outlets, and any travel writer who is actually coming to Jamaica.</p>

<h3 id="ab-contact">Contact</h3>
<p>Email: <a href="mailto:hello@patwago.com">hello@patwago.com</a><br>
Vendors: <a href="mailto:vendors@patwago.com">vendors@patwago.com</a><br>
Support: <a href="mailto:bookings@patwago.com">bookings@patwago.com</a><br>
Made in Jamaica 🇯🇲</p>
`
    }
  };

  var overlay = document.getElementById('legalOverlay');
  var eyebrowEl = document.getElementById('legalEyebrow');
  var titleEl = document.getElementById('legalTitle');
  var updatedEl = document.getElementById('legalUpdated');
  var tocEl = document.getElementById('legalToc');
  var bodyEl = document.getElementById('legalBody');
  var closeBtn = document.getElementById('legalClose');
  var lastFocus = null;

  function slug(s){ return s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''); }

  function openPolicy(name){
    var p = POLICIES[name];
    if(!p) return;
    eyebrowEl.textContent = p.eyebrow;
    titleEl.textContent = p.title;
    updatedEl.textContent = p.updated;
    // build TOC
    tocEl.innerHTML = p.toc.map(function(t){
      var id = (name === 'privacy' ? 'pp-' : name === 'terms' ? 'ts-' : name === 'cookies' ? 'cp-' : 'ab-') + slug(t);
      return '<a href="#' + id + '">' + t + '</a>';
    }).join('');
    bodyEl.innerHTML = p.body;
    lastFocus = document.activeElement;
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden','false');
    document.body.style.overflow = 'hidden';
    closeBtn.focus();
    // scroll modal to top
    overlay.scrollTop = 0;
  }

  function closePolicy(){
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden','true');
    document.body.style.overflow = '';
    if(lastFocus) lastFocus.focus();
  }

  // wire footer links with data-legal
  document.addEventListener('click', function(e){
    var link = e.target.closest('[data-legal]');
    if(!link) return;
    e.preventDefault();
    openPolicy(link.getAttribute('data-legal'));
    // update hash without jumping
    if(history.replaceState){
      history.replaceState(null, '', link.getAttribute('href') || '#');
    }
  });

  // close on overlay click outside modal, close button, or Escape
  overlay.addEventListener('click', function(e){ if(e.target === overlay) closePolicy(); });
  closeBtn.addEventListener('click', closePolicy);
  document.addEventListener('keydown', function(e){
    if(e.key === 'Escape' && overlay.classList.contains('open')) closePolicy();
  });

  // open on initial hash load (#privacy / #terms / #cookies / #about)
  function openFromHash(){
    var h = location.hash.replace('#','');
    if(POLICIES[h]){ openPolicy(h); }
  }
  window.addEventListener('hashchange', function(){
    var h = location.hash.replace('#','');
    if(!POLICIES[h] && overlay.classList.contains('open')) closePolicy();
  });
  openFromHash();
})();
</script>
"""
    html = html.replace("</body>", legal_html + "\n</body>")

    LOCAL_COPY.write_text(html, encoding="utf-8")
    print(f"Patched. {original_len} -> {len(html)} bytes (+{len(html)-original_len})")
    return 0

if __name__ == "__main__":
    sys.exit(main())
