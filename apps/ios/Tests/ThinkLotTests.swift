import XCTest
import ConvexMobile
@testable import ThinkLot

final class ThinkLotTests: XCTestCase {
    func testConvexNumbersAndMissingOptionalFieldsDecode() throws {
        let json = """
        {"ideas":[{"_id":"idea-a","seq":1,"title":"Capture","status":"inbox","tags":[],"favorite":false,"archived":false,"createdAt":1700000000000,"updatedAt":1700000000000}],"truncated":true,"total":251}
        """
        let page = try JSONDecoder().decode(IdeaPage.self, from: Data(json.utf8))
        XCTAssertEqual(page.ideas.first?.id, "idea-a")
        XCTAssertNil(page.ideas.first?.priority)
        XCTAssertEqual(page.total, 251)
        XCTAssertTrue(page.truncated)
    }
    func testScoringFormulaAndTaskDecoding() throws {
        let json = """
        {"idea":{"_id":"idea-a","seq":2,"title":"Ship","status":"building","tags":["swift"],"impact":8,"effort":2,"confidence":6,"favorite":true,"archived":false,"createdAt":0,"updatedAt":0},"tasks":[{"_id":"task-a","title":"Build","completed":false,"position":0}]}
        """
        let detail = try JSONDecoder().decode(IdeaDetail.self, from: Data(json.utf8))
        XCTAssertEqual(detail.idea.priority, 24)
        XCTAssertEqual(detail.tasks.first?.id, "task-a")
        XCTAssertEqual(detail.idea.plate, "LOT-0002")
    }
    func testExplicitNullAndFloatEncodingForServerNumberValidators() throws {
        let args: [String: ConvexEncodable?] = ["impact": nil, "days": 7.0]
        let encoded = try args.convexEncode()
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(encoded.utf8)) as? [String: Any])
        XCTAssertTrue(object["impact"] is NSNull)
        XCTAssertEqual(object["days"] as? Double, 7)
        XCTAssertFalse(encoded.contains("$integer"))
    }
    func testDeploymentValidation() throws {
        XCTAssertEqual(try Deployment.validate("https://my-lot.convex.cloud").host, "my-lot.convex.cloud")
        for invalid in ["", "http://my-lot.convex.cloud", "https://evil.test", "https://my-lot.convex.cloud?token=x", "https://YOUR_DEPLOYMENT.convex.cloud"] {
            XCTAssertThrowsError(try Deployment.validate(invalid))
        }
    }
    func testEditorOmitsUntouchedFieldsAndPreservesExplicitClear() throws {
        let json = """
        {"_id":"idea-a","seq":1,"title":"Original","description":"Notes","status":"inbox","tags":["swift"],"impact":8,"favorite":false,"archived":false,"createdAt":0,"updatedAt":0}
        """
        let baseline = try JSONDecoder().decode(Idea.self, from: Data(json.utf8))
        let untouched = EditorPatch.make(baseline: baseline, title: "Original", description: "Notes", problem: "", tags: "swift",
            scored: true, impact: 8, effort: 5, confidence: 5, revisitAt: nil)
        XCTAssertEqual(Set(untouched.keys), ["ideaId"])
        let changed = EditorPatch.make(baseline: baseline, title: "Original", description: "", problem: "New problem", tags: "swift",
            scored: true, impact: 8, effort: 5, confidence: 5, revisitAt: nil)
        XCTAssertEqual(Set(changed.keys), ["ideaId", "description", "problem"])
        let data = Data(try changed.convexEncode().utf8)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertTrue(object["description"] is NSNull)
        XCTAssertEqual(object["problem"] as? String, "New problem")
        XCTAssertNil(object["impact"])
        XCTAssertNil(object["effort"])
    }
    func testRefreshRotatesPersistedTokenAndConcurrentCallsShareRequest() async throws {
        let vault = MemoryVault(SessionTokens(token: "old", refreshToken: "refresh-old"))
        let transport = TestTransport()
        let auth = PasswordAuth(url: URL(string: "https://my-lot.convex.cloud")!, vault: vault, transport: transport)
        async let first = auth.loginFromCache(onIdToken: { _ in })
        async let second = auth.loginFromCache(onIdToken: { _ in })
        let (a, b) = try await (first, second)
        XCTAssertEqual(a.token, "new")
        XCTAssertEqual(b.token, "new")
        XCTAssertEqual(try vault.read()?.refreshToken, "refresh-new")
        let count = await transport.count
        XCTAssertEqual(count, 1)
    }
    func testLogoutClearsVaultEvenWhenRevocationFails() async throws {
        let vault = MemoryVault(SessionTokens(token: "old", refreshToken: "refresh-old"))
        let auth = PasswordAuth(url: URL(string: "https://my-lot.convex.cloud")!, vault: vault, transport: TestTransport())
        try await auth.logout()
        XCTAssertNil(try vault.read())
    }
    func testNewAccountLoginWaitsForOlderRefreshAndOwnsFinalVault() async throws {
        let vault = MemoryVault(SessionTokens(token: "account-a", refreshToken: "refresh-a"))
        let transport = InterleavingTransport()
        let auth = PasswordAuth(url: URL(string: "https://my-lot.convex.cloud")!, vault: vault, transport: transport)
        let refresh = Task { try await auth.loginFromCache(onIdToken: { _ in }) }
        try await transport.waitForRefresh()
        await auth.prepare(email: "b@example.test", password: "password-b", signUp: false)
        let login = Task { try await auth.login(onIdToken: { _ in }) }
        for _ in 0..<10 { await Task.yield() }
        await transport.releaseRefresh()
        _ = try await refresh.value
        let result = try await login.value
        XCTAssertEqual(result.token, "account-b")
        XCTAssertEqual(try vault.read()?.token, "account-b")
        let events = await transport.events
        XCTAssertEqual(events, ["refresh-start", "refresh-finish", "login-b"])
    }
}

private final class MemoryVault: TokenVault {
    private let lock = NSLock()
    private var tokens: SessionTokens?
    init(_ tokens: SessionTokens?) { self.tokens = tokens }
    func read() throws -> SessionTokens? { lock.lock(); defer { lock.unlock() }; return tokens }
    func write(_ tokens: SessionTokens) throws { lock.lock(); defer { lock.unlock() }; self.tokens = tokens }
    func clear() throws { lock.lock(); defer { lock.unlock() }; tokens = nil }
}
private actor TestTransport: AuthTransport {
    var count = 0
    func call(url: URL, path: String, args: [String: Any], bearer: String?) async throws -> SignInResult {
        if path == "auth:signOut" { throw URLError(.notConnectedToInternet) }
        count += 1
        try await Task.sleep(for: .milliseconds(50))
        return SignInResult(tokens: SessionTokens(token: "new", refreshToken: "refresh-new"))
    }
}

private actor InterleavingTransport: AuthTransport {
    var events: [String] = []
    private var gate: CheckedContinuation<Void, Never>?
    func call(url: URL, path: String, args: [String: Any], bearer: String?) async throws -> SignInResult {
        if args["refreshToken"] != nil {
            events.append("refresh-start")
            await withCheckedContinuation { gate = $0 }
            events.append("refresh-finish")
            return SignInResult(tokens: SessionTokens(token: "account-a-refreshed", refreshToken: "refresh-a-new"))
        }
        events.append("login-b")
        return SignInResult(tokens: SessionTokens(token: "account-b", refreshToken: "refresh-b"))
    }
    func waitForRefresh() async throws {
        for _ in 0..<100 {
            if gate != nil { return }
            try await Task.sleep(for: .milliseconds(10))
        }
        throw AppFailure.message("Refresh did not reach test gate.")
    }
    func releaseRefresh() { gate?.resume(); gate = nil }
}
