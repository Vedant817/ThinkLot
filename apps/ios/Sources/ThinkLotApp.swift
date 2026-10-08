import SwiftUI

@main
struct ThinkLotApp: App {
    private let configuration: Result<URL, Error>
    init() {
        configuration = Result { try Deployment.validate(Bundle.main.object(forInfoDictionaryKey: "ThinkLotConvexURL") as? String ?? "") }
    }
    var body: some Scene {
        WindowGroup {
            switch configuration {
            case .success(let url): AppRoot(url: url)
            case .failure(let failure):
                ContentUnavailableView("Configure ThinkLot", systemImage: "gearshape", description: Text(failure.localizedDescription))
            }
        }
    }
}

struct AppRoot: View {
    @StateObject private var store: ThinkLotStore
    @Environment(\.scenePhase) private var phase
    init(url: URL) { _store = StateObject(wrappedValue: ThinkLotStore(url: url)) }
    var body: some View {
        Group {
            if store.signedIn { LotView() } else { SignInView() }
        }
        .environmentObject(store)
        .tint(.indigo)
        .task { await store.restore() }
        .onChange(of: phase) { _, value in
            if value == .active && store.signedIn { Task { await store.restore() } }
        }
        .alert("Something needs attention", isPresented: Binding(get: { store.error != nil }, set: { if !$0 { store.error = nil } })) {
            Button("OK") { store.error = nil }
        } message: { Text(store.error ?? "") }
    }
}

struct SignInView: View {
    @EnvironmentObject private var store: ThinkLotStore
    @State private var email = ""
    @State private var password = ""
    @State private var signUp = false
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("A home for your next idea.").font(.title2.bold())
                    Text("Capture a thought, decide what matters, and make it happen.").foregroundStyle(.secondary)
                }
                Section("Your account") {
                    TextField("Email", text: $email).keyboardType(.emailAddress).textContentType(.username).textInputAutocapitalization(.never).autocorrectionDisabled()
                    SecureField("Password", text: $password).textContentType(signUp ? .newPassword : .password)
                    Toggle("Create a new account", isOn: $signUp)
                    Button(signUp ? "Create account" : "Sign in") {
                        Task {
                            await store.signIn(email: email, password: password, signUp: signUp)
                            if store.signedIn { password = "" }
                        }
                    }.disabled(store.busy || email.isEmpty || password.isEmpty)
                    if store.busy { ProgressView("Signing in…") }
                }
            }.navigationTitle("ThinkLot")
        }
    }
}
