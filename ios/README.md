# ios/PatWaGoApp

Native iOS wrapper for PatWaGo: a WKWebView pointed at `/app` on the
existing backend, bridged to real StoreKit 2 In-App Purchase for the Day/Trip
passes (Apple Guideline 3.1.1), with self-service account deletion already
reachable through the wrapped web content (Guideline 5.1.1(v)).

This was written on a Linux machine with no Xcode/Swift toolchain, so it has
**never been opened, built, or run in Xcode**. The source is correct to the
best of the author's knowledge of WKWebView/StoreKit 2, and the server-side
half it talks to (`lib/appstore.js`) has full automated test coverage — but
the Swift/Xcode side needs a first real build on a Mac before it can be
trusted.

Full build/sign/submit walkthrough: **[`../NATIVE_APP.md`](../NATIVE_APP.md)**.

Quick start on a Mac:

```bash
brew install xcodegen
cd ios/PatWaGoApp
xcodegen generate
open PatWaGo.xcodeproj
```
