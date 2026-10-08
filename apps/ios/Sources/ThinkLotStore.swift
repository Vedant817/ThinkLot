import Combine
import ConvexMobile
import Foundation

@MainActor
final class ThinkLotStore: ObservableObject {
    @Published var signedIn = false
    @Published var busy = false
    @Published var error: String?
    @Published var page: IdeaPage?
    @Published var review: ReviewPage?
    @Published var connection = "Connecting"
    @Published var search = ""
    @Published var status: Lifecycle?
    @Published var tag = ""
    @Published var archived = false
    @Published var favorites = false
    @Published var prioritySort = false
    let client: ConvexClientWithAuth<SessionTokens>
    private let provider: PasswordAuth
    private var listSubscription: AnyCancellable?
    private var reviewSubscription: AnyCancellable?
    private var subscriptions = Set<AnyCancellable>()
    private var generation = 0
    private var restoring = false

    init(url: URL) {
        provider = PasswordAuth(url: url, vault: KeychainVault(service: "com.thinklot.native.\(url.host ?? "")"))
        client = ConvexClientWithAuth(deploymentUrl: url.absoluteString, authProvider: provider)
        client.authState.receive(on: DispatchQueue.main).sink { [weak self] state in
            guard let self else { return }
            switch state {
            case .authenticated:
                self.signedIn = true
            case .unauthenticated:
                self.signedIn = false
                self.cancelData()
            case .loading: break
            }
        }.store(in: &subscriptions)
        client.watchWebSocketState().receive(on: DispatchQueue.main).sink { [weak self] state in
            self?.connection = state == .connected ? "Connected" : "Reconnecting"
        }.store(in: &subscriptions)
    }
    var filterKey: String { "\(search)|\(status?.rawValue ?? "")|\(tag)|\(archived)" }
    var visibleIdeas: [Idea] {
        var ideas = (page?.ideas ?? []).filter { $0.archived == archived && (!favorites || $0.favorite) }
        if prioritySort { ideas.sort { ($0.priority ?? -1) > ($1.priority ?? -1) } }
        return ideas
    }
    func restore() async {
        guard !busy, !restoring else { return }
        restoring = true
        defer { restoring = false }
        let result = await client.loginFromCache()
        switch result {
        case .success: signedIn = true; load()
        case .failure(let failure):
            // Missing cache is expected on first launch; network failure remains visible.
            if failure.localizedDescription != "Sign in to continue." { error = failure.localizedDescription }
        }
    }
    func signIn(email: String, password: String, signUp: Bool) async {
        guard !busy else { return }
        busy = true; error = nil
        defer { busy = false }
        await provider.prepare(email: email, password: password, signUp: signUp)
        switch await client.login() {
        case .success: signedIn = true; load()
        case .failure(let failure): error = failure.localizedDescription
        }
    }
    func signOut() async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        do {
            // The SDK's logout swallows provider errors. Check secure removal
            // directly first so a Keychain failure cannot claim signed-out success.
            try await provider.logout()
            cancelData(); signedIn = false
            await client.logout()
        } catch { self.error = error.localizedDescription }
    }
    func cancelData() {
        generation += 1
        listSubscription = nil; reviewSubscription = nil
        page = nil; review = nil
    }
    func load() {
        guard signedIn else { return }
        generation += 1
        let current = generation
        page = nil; review = nil
        var args: [String: ConvexEncodable?] = ["includeArchived": archived, "search": search]
        if let status { args["status"] = status.rawValue }
        if !tag.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            args["tags"] = [tag.lowercased()] as [ConvexEncodable?]
        }
        listSubscription = client.subscribe(to: "ideas:list", with: args, yielding: IdeaPage.self)
            .receive(on: DispatchQueue.main).sink(receiveCompletion: { [weak self] result in
                guard let self, self.generation == current else { return }
                if case .failure(let failure) = result { self.error = failure.localizedDescription }
            }, receiveValue: { [weak self] page in
                guard let self, self.generation == current else { return }
                self.page = page
            })
        reviewSubscription = client.subscribe(to: "review:queue", yielding: ReviewPage.self)
            .receive(on: DispatchQueue.main).sink(receiveCompletion: { [weak self] result in
                guard let self, self.generation == current else { return }
                if case .failure(let failure) = result { self.error = failure.localizedDescription }
            }, receiveValue: { [weak self] review in
                guard let self, self.generation == current else { return }
                self.review = review
            })
    }
    @discardableResult
    func mutate(_ name: String, _ args: [String: ConvexEncodable?]) async -> Bool {
        guard !busy, signedIn else { return false }
        busy = true; error = nil
        defer { busy = false }
        do {
            // Decode String ids and null/void alike without guessing return types.
            let _: String? = try await client.mutation(name, with: args)
            return true
        } catch { self.error = error.localizedDescription; return false }
    }
}
