import SwiftUI
import WebKit

/// Wraps a WKWebView pointed at the PatWaGo backend and bridges it to
/// StoreKit for pass purchases (Apple Guideline 3.1.1 requires In-App
/// Purchase for digital features unlocked inside the app — see
/// lib/paypal.js and lib/appstore.js on the server, and the
/// window.PatWaGoNative contract in public/app/account-pages.js).
struct PatWaGoWebView: UIViewRepresentable {
    let url: URL
    let iapManager: IAPManager

    func makeCoordinator() -> Coordinator {
        Coordinator(iapManager: iapManager)
    }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        let controller = WKUserContentController()

        // Injected before any page script runs, on every frame, so the web
        // app can reliably tell it's inside the native shell and hide the
        // PayPal purchase buttons in favor of requestNativePurchase().
        let bridgeScript = WKUserScript(
            source: "window.PatWaGoNative = { platform: 'ios' };",
            injectionTime: .atDocumentStart,
            forMainFrameOnly: false
        )
        controller.addUserScript(bridgeScript)
        controller.add(context.coordinator, name: "patwagoIAP")
        config.userContentController = controller

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.load(URLRequest(url: url))

        context.coordinator.webView = webView
        iapManager.onPurchaseComplete = { [coordinator = context.coordinator] plan, signedTransactionInfo in
            coordinator.notifyPurchaseComplete(plan: plan, signedTransactionInfo: signedTransactionInfo)
        }
        iapManager.onPurchaseFailed = { [coordinator = context.coordinator] plan, message in
            coordinator.notifyPurchaseFailed(plan: plan, message: message)
        }

        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {
        // Static URL for the app's lifetime; nothing to update.
    }

    @MainActor
    final class Coordinator: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
        weak var webView: WKWebView?
        private let iapManager: IAPManager

        init(iapManager: IAPManager) {
            self.iapManager = iapManager
        }

        /// Receives `window.webkit.messageHandlers.patwagoIAP.postMessage({plan})`
        /// from public/app/account-pages.js's requestNativePurchase().
        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "patwagoIAP",
                  let body = message.body as? [String: Any],
                  let plan = body["plan"] as? String else { return }
            let manager = iapManager
            Task { await manager.purchase(plan: plan) }
        }

        /// Calls back into the page's window.PatWaGoNative.onPurchaseComplete,
        /// which POSTs the signed transaction to /api/appstore/verify-purchase
        /// (the server independently re-verifies it — see lib/appstore.js).
        func notifyPurchaseComplete(plan: String, signedTransactionInfo: String) {
            let js = "window.PatWaGoNative && window.PatWaGoNative.onPurchaseComplete && "
                + "window.PatWaGoNative.onPurchaseComplete(\(jsString(plan)), \(jsString(signedTransactionInfo)));"
            webView?.evaluateJavaScript(js, completionHandler: nil)
        }

        func notifyPurchaseFailed(plan: String, message: String?) {
            let messageArg = message.map(jsString) ?? "null"
            let js = "window.PatWaGoNative && window.PatWaGoNative.onPurchaseFailed && "
                + "window.PatWaGoNative.onPurchaseFailed(\(jsString(plan)), \(messageArg));"
            webView?.evaluateJavaScript(js, completionHandler: nil)
        }

        /// JSON-encodes a Swift string into a JS string literal so purchase
        /// messages/plan names can never break out of the evaluateJavaScript call.
        private func jsString(_ value: String) -> String {
            guard let data = try? JSONEncoder().encode(value), let json = String(data: data, encoding: .utf8) else {
                return "null"
            }
            return json
        }
    }
}
