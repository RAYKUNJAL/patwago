import SwiftUI

struct ContentView: View {
    @ObservedObject var iapManager: IAPManager

    /// Defaults to the production app; override per-build with the
    /// PatWaGoBaseURL Info.plist key (e.g. http://localhost:3000/app while
    /// developing against a local `npm run dev` — see the ATS exception for
    /// localhost in Resources/Info.plist).
    private var baseURL: URL {
        let configured = Bundle.main.object(forInfoDictionaryKey: "PatWaGoBaseURL") as? String
        return URL(string: configured ?? "") ?? URL(string: "https://patwago.com/app")!
    }

    var body: some View {
        PatWaGoWebView(url: baseURL, iapManager: iapManager)
            .ignoresSafeArea()
    }
}
