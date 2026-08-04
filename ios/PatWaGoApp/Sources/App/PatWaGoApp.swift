import SwiftUI

@main
struct PatWaGoApp: App {
    @StateObject private var iapManager = IAPManager()

    var body: some Scene {
        WindowGroup {
            ContentView(iapManager: iapManager)
                .task {
                    await iapManager.loadProducts()
                }
        }
    }
}
