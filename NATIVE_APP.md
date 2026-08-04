# Getting PatWaGo onto the Apple App Store

This document picks up where the code stops. Everything in `ios/PatWaGoApp`
and the server-side changes below were written and tested on a Linux
machine with **no Xcode, no Swift toolchain, and no Apple Developer
account** — none of that exists in this repo's dev environment. The Swift
code has never been opened in Xcode. Someone with a Mac and an Apple
Developer Program membership ($99/year) needs to do the steps below before
this can go anywhere near App Store review, and no one — not this guide, not
Apple's own pre-review tools — can guarantee a human reviewer approves it.

## What's already done and tested

- **Self-service account deletion** (Guideline 5.1.1(v)) — `/app/profile`
  in the existing web app, reachable from inside the wrapped WebView.
  Covered by `tests/api.test.js`.
- **PayPal is refused for the iOS app** (Guideline 3.1.1) —
  `POST /api/paypal/purchase-pass` returns `403 IAP_REQUIRED` for any
  client sending `X-Patwago-Client: ios-app`; `public/app/account-pages.js`
  hides the PayPal button and calls the native bridge instead when
  `window.PatWaGoNative.platform === 'ios'`.
- **Server-side StoreKit 2 receipt verification** — `lib/appstore.js`
  independently verifies the signed transaction's certificate chain and
  signature before crediting a pass (never trusts the client's own claim
  that Apple approved a purchase). Idempotent — replaying the same
  transaction (StoreKit does this) credits the pass exactly once
  (`lib/auth.js redeemAppStoreTransaction`). Full unit + integration test
  coverage using a locally generated test certificate chain
  (`tests/appstore.test.js`, `tests/fixtures/appstore/`) — no dependency on
  Apple's real certificates to test the crypto.
- **The native wrapper source** (`ios/PatWaGoApp`) — a WKWebView pointed at
  `/app`, StoreKit 2 purchase flow (`IAPManager.swift`), and the JS bridge
  contract described below. Written carefully, not compiled.

## What's still missing

There is no `.xcodeproj` checked in (see "Generate the Xcode project"
below for why), no App Store Connect app record, no IAP products configured
on Apple's side, and the server has no real Apple Root CA certificate
configured (`APPSTORE_ROOT_CA_PEM` is unset, so `/api/appstore/verify-purchase`
fails closed with `503` right now — that's intentional, not a bug).

---

## 1. Generate the Xcode project

`ios/PatWaGoApp/project.yml` is an [XcodeGen](https://github.com/yonaskolb/XcodeGen)
spec, not a hand-written `.xcodeproj`. A hand-authored `project.pbxproj` is
easy to corrupt in ways Xcode won't clearly explain, and there was no way to
verify one works without Xcode to open it in. XcodeGen is the standard,
low-risk way to produce a correct project file from a plain-text spec:

```bash
brew install xcodegen
cd ios/PatWaGoApp
xcodegen generate
open PatWaGo.xcodeproj
```

If `xcodegen generate` errors on some detail of `project.yml`, the fix is
almost always in the YAML, not a reason to hand-edit a `.pbxproj` — check
XcodeGen's docs for the field that changed.

## 2. Configure signing

In Xcode: select the `PatWaGo` target → **Signing & Capabilities** → choose
your Team → let Xcode manage signing. Confirm the bundle identifier reads
`com.patwago.app` (set in `project.yml`) — **it must match `APPSTORE_BUNDLE_ID`
on the server exactly**, or every purchase will be rejected with a
`bundleId does not match` error.

If you want a different bundle ID, change it in *both* `project.yml`'s
`PRODUCT_BUNDLE_IDENTIFIER` and the server's `APPSTORE_BUNDLE_ID` — they're
compared as exact strings.

## 3. Configure the server's Apple Root CA

`lib/appstore.js` verifies every StoreKit transaction's certificate chain
against a trusted root you configure — it deliberately does **not** trust
whatever root a client happens to present. Get Apple's real, current Root
CA (G3) certificate yourself (don't let an AI agent fetch and paste this —
verify it from Apple directly):

```bash
curl -O https://www.apple.com/certificateauthority/AppleRootCA-G3.cer
openssl x509 -inform der -in AppleRootCA-G3.cer -out apple-root-ca-g3.pem
openssl x509 -in apple-root-ca-g3.pem -noout -fingerprint -sha256
```

Compare the printed fingerprint against the one Apple publishes on the same
certificate authority page before trusting it. Then set on the server
(production `.env` / VPS secrets — see `CLAUDE_VPS_HANDOFF.md` for how this
repo deploys — never commit it):

```bash
APPSTORE_ROOT_CA_PEM="$(cat apple-root-ca-g3.pem)"
APPSTORE_BUNDLE_ID=com.patwago.app
```

`tests/appstore.test.js` already proves the verification *logic* is
correct using a locally generated test certificate chain — this step only
swaps in Apple's real root as the trust anchor for production.

## 4. Create the App Store Connect app record + IAP products

In [App Store Connect](https://appstoreconnect.apple.com):

1. **My Apps → +** → register a new app with bundle ID `com.patwago.app`.
2. **In-App Purchases** → create two products as **Non-Renewing
   Subscription** (Apple's recommended type for a fixed-duration pass like
   ours — not Auto-Renewable, since PatWaGo tracks and enforces the
   day/7-day duration itself, server-side, exactly like it already does for
   the PayPal flow):

   | Product ID | Reference name | Price |
   |---|---|---|
   | `com.patwago.pass.day` | Day Pass | $9.99 (matches `lib/paypal.js PLAN_PRICES.day`) |
   | `com.patwago.pass.trip` | Trip Pass | $29.99 (matches `PLAN_PRICES.trip`) |

   These IDs are hardcoded in three places that must all agree:
   `lib/appstore.js PRODUCT_TO_PLAN`, `ios/PatWaGoApp/.../IAPManager.swift`,
   and `Resources/PatWaGoApp.storekit`. If you change a product ID, change
   all three.
3. Fill in the required per-product review screenshot and localized
   description for each (App Store Connect won't let a product go live
   without them).

## 5. Test purchases locally before touching App Store Connect's sandbox

Xcode's StoreKit Testing runs entirely on-device/in-Simulator with no
network calls to Apple:

1. `ios/PatWaGoApp/Resources/PatWaGoApp.storekit` already defines both
   products. In Xcode: **Product → Scheme → Edit Scheme → Run → Options →
   StoreKit Configuration** → select `PatWaGoApp.storekit`.
   (That `.storekit` file was hand-written to match Apple's documented
   schema but never opened in Xcode — if Xcode's StoreKit Configuration
   editor complains about its format, recreating it is a two-minute fix:
   **File → New → File → StoreKit Configuration File**, then add the two
   products above with the **File → Editor → Add Storekit Test →
   Non-Renewing Subscription** menu using the exact IDs/prices in the table
   above.)
2. Point `PatWaGoBaseURL` (Info.plist) at your local dev server —
   `http://localhost:3000/app` — while running `npm run dev` from the repo
   root. The `NSExceptionDomains` entry already in `Info.plist` only opens
   up plain HTTP for `localhost`; production stays HTTPS-only.
3. Run on the Simulator, sign in, tap a pass → StoreKit shows its test
   purchase sheet → approve → the app should call
   `/api/appstore/verify-purchase` and the profile should show an active
   pass. Watch the dev server's console for `503`/`400` responses if it
   doesn't — that's `APPSTORE_ROOT_CA_PEM`/`APPSTORE_BUNDLE_ID` not being
   set in your local `.env` (StoreKit Testing signs transactions with a
   *local test certificate*, not Apple's chain — for local testing you can
   point `APPSTORE_ROOT_CA_PEM` at Xcode's StoreKit Testing root, or, more
   simply, treat a `503`/`400` here as expected until you're testing
   against a real environment; this is the one part of the flow this
   guide can't fully script, since it depends on which certificate Xcode's
   StoreKit Testing signs with in your Xcode version).

Once local purchases visibly activate a pass, move to TestFlight, which
exercises Apple's real Sandbox environment end-to-end (this *does* use
Apple's real certificate chain, so set the production `APPSTORE_ROOT_CA_PEM`
before TestFlight builds).

## 6. TestFlight

Archive (**Product → Archive**), upload to App Store Connect, add internal
testers, install via TestFlight, and repeat the purchase test against the
real Sandbox. Confirm:

- A Sandbox purchase activates a pass and `GET /api/account/me` shows
  `active_pass: true`.
- Re-launching the app doesn't double-charge or double-credit (StoreKit
  redelivers past transactions via `Transaction.updates` — the server's
  idempotent ledger should return `200`, not a second pass, the second
  time; `tests/api.test.js` already proves this server-side).
- Deleting the account in **Profile → Delete account** actually removes it
  (`GET /api/account/me` → `401` afterward).

## 7. App Store Connect submission checklist

Beyond the build itself:

- **Screenshots** for each required device size.
- **App Privacy ("nutrition label")** — must match `index.html`'s Privacy
  Policy section exactly (location, microphone/voice, account/contact info,
  payment info categories are all already disclosed there — transcribe them
  into App Store Connect's privacy questionnaire, don't guess).
- **Age rating** questionnaire (alcohol/tobacco mentions in travel content,
  location sharing, user-generated content in reviews — answer honestly
  against the actual site content).
- **Export compliance** — this app only uses HTTPS/TLS, which typically
  qualifies for the standard exemption; confirm current wording in App
  Store Connect's export compliance step.
- **Demo account for reviewers** — the app requires sign-in before showing
  anything real (translate/vendors/trips/Guardian). Create a real test
  account with an active pass and provide those credentials in App Review
  Information, or reviewers will bounce off a login wall.
- **Guideline 4.2 (Minimum Functionality) justification** — Apple
  frequently rejects thin WebView wrappers. Be ready to explain, in the
  App Review notes, what this app does that the mobile website alone
  doesn't: it's the only surface where Guardian Mode's SOS/location
  check-ins and the AI voice concierge integrate with the device's native
  location and microphone permissions, and purchases use Apple's own
  payment sheet instead of a web checkout. If Apple still rejects on 4.2,
  the next step is adding genuinely native functionality (push
  notifications for booking confirmations/SOS alerts would be the most
  natural next feature — there's no push infrastructure in this repo yet).

## Known gaps in this handoff

- **Nothing here has been compiled.** The first Mac to open this project
  may surface Swift errors this guide didn't anticipate — most likely
  around StoreKit 2 API availability if the deployment target changes, or
  minor XcodeGen YAML syntax issues.
- **`PatWaGoApp.storekit`** was hand-written to match Apple's published
  schema, not exported from Xcode. Treat it as a starting point.
- **Push notifications, native SOS integration, and other "why is this a
  native app" features** are not implemented — the wrapper today is
  functionally a WebView plus StoreKit. That's enough to fix the two
  compliance defects this work was scoped for (3.1.1, 5.1.1(v)), but it is
  the most likely place a first review still comes back with 4.2 feedback.
