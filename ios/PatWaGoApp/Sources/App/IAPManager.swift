import Foundation
import StoreKit

/// Real StoreKit 2 purchase flow for PatWaGo's Day/Trip passes.
///
/// Product type: configure both as "Non-Renewing Subscription" in App Store
/// Connect (Apple's recommended type for a fixed-duration entitlement like
/// ours — see server-side lib/auth.js PLAN_DURATIONS_MS, which applies the
/// day/trip duration itself; Apple does not track expiry for this type).
///
/// This class never marks a purchase "done" on its own claim — it hands the
/// signed transaction (JWS) to the web page, which POSTs it to
/// /api/appstore/verify-purchase; the server independently verifies the
/// signature and certificate chain (lib/appstore.js) before crediting a
/// pass. A compromised or jailbroken client cannot forge a purchase this way.
@MainActor
final class IAPManager: ObservableObject {
    /// Must exactly match lib/appstore.js PRODUCT_TO_PLAN and the products
    /// created in App Store Connect.
    static let productIDs: Set<String> = ["com.patwago.pass.day", "com.patwago.pass.trip"]

    @Published private(set) var products: [String: Product] = [:]

    /// plan ("day" | "trip"), the verified JWS transaction string.
    var onPurchaseComplete: ((String, String) -> Void)?
    /// plan, an optional human-readable reason (nil for a plain user cancel).
    var onPurchaseFailed: ((String, String?) -> Void)?

    private var updatesTask: Task<Void, Never>?

    init() {
        // Transaction.updates redelivers purchases made outside this exact
        // purchase() call (restored on another device, Ask to Buy approval
        // arriving later, a relaunch after a purchase that didn't finish).
        // Routing those through the same verified path keeps the server's
        // idempotent redemption ledger (auth_appstore_transactions) as the
        // single source of truth — see lib/auth.js redeemAppStoreTransaction.
        updatesTask = Task { [weak self] in
            for await update in Transaction.updates {
                await self?.handle(update: update)
            }
        }
    }

    deinit {
        updatesTask?.cancel()
    }

    func loadProducts() async {
        do {
            let fetched = try await Product.products(for: Self.productIDs)
            for product in fetched {
                products[product.id] = product
            }
        } catch {
            NSLog("PatWaGo: failed to load StoreKit products: \(error.localizedDescription)")
        }
    }

    func purchase(plan: String) async {
        guard let productID = Self.productID(forPlan: plan) else {
            onPurchaseFailed?(plan, "Unknown pass: \(plan)")
            return
        }
        guard let product = products[productID] else {
            onPurchaseFailed?(plan, "This pass isn't available for purchase right now. Please try again shortly.")
            return
        }

        do {
            let result = try await product.purchase()
            switch result {
            case .success(let verification):
                await handlePurchased(verification: verification, plan: plan)
            case .userCancelled:
                onPurchaseFailed?(plan, nil)
            case .pending:
                onPurchaseFailed?(plan, "Your purchase is pending approval (e.g. Ask to Buy).")
            @unknown default:
                onPurchaseFailed?(plan, "Purchase did not complete.")
            }
        } catch {
            onPurchaseFailed?(plan, error.localizedDescription)
        }
    }

    private func handlePurchased(verification: VerificationResult<Transaction>, plan: String) async {
        switch verification {
        case .verified(let transaction):
            onPurchaseComplete?(plan, verification.jwsRepresentation)
            await transaction.finish()
        case .unverified(_, let error):
            // StoreKit itself could not verify this locally — do not treat
            // it as a purchase and do not finish the transaction.
            onPurchaseFailed?(plan, "Apple could not verify this purchase: \(error.localizedDescription)")
        }
    }

    private func handle(update: VerificationResult<Transaction>) async {
        guard case .verified(let transaction) = update,
              let plan = Self.plan(forProductID: transaction.productID) else {
            return
        }
        onPurchaseComplete?(plan, update.jwsRepresentation)
        await transaction.finish()
    }

    static func productID(forPlan plan: String) -> String? {
        switch plan {
        case "day": return "com.patwago.pass.day"
        case "trip": return "com.patwago.pass.trip"
        default: return nil
        }
    }

    static func plan(forProductID productID: String) -> String? {
        switch productID {
        case "com.patwago.pass.day": return "day"
        case "com.patwago.pass.trip": return "trip"
        default: return nil
        }
    }
}
