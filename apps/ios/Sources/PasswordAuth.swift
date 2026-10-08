import Foundation
import ConvexMobile

// Serializes refresh-token rotation: simultaneous SDK refresh and foreground
// restore must never spend the same one-time refresh token twice.
actor PasswordAuth: AuthProvider {
    typealias T = SessionTokens
    private let url: URL
    private let vault: any TokenVault
    private let transport: any AuthTransport
    private var pending: Task<SessionTokens, Error>?
    private var pendingId: UUID?
    private var credentials: (email: String, password: String, flow: String)?
    private var callback: (@Sendable (String?) -> Void)?
    init(url: URL, vault: any TokenVault, transport: any AuthTransport = HTTPAuthTransport()) {
        self.url = url; self.vault = vault; self.transport = transport
    }

    func prepare(email: String, password: String, signUp: Bool) {
        credentials = (email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(), password, signUp ? "signUp" : "signIn")
    }
    func login(onIdToken: @Sendable @escaping (String?) -> Void) async throws -> SessionTokens {
        // Finish any older account refresh before allowing a new account's login
        // to rotate the vault. Cached-login callers share this operation too.
        if let pending { _ = try? await pending.value }
        guard let credentials else { throw AppFailure.message("Enter your email and password.") }
        self.credentials = nil // Password stays only in memory for the login request.
        callback = onIdToken
        let id = UUID()
        let operation = Task {
            try await self.save(try await self.call("auth:signIn", args: ["provider": "password", "params": ["email": credentials.email, "password": credentials.password, "flow": credentials.flow]]))
        }
        pending = operation; pendingId = id
        defer { finish(id) }
        return try await operation.value
    }
    func loginFromCache(onIdToken: @Sendable @escaping (String?) -> Void) async throws -> SessionTokens {
        callback = onIdToken
        if let pending { return try await pending.value }
        guard let stored = try vault.read() else { throw AppFailure.message("Sign in to continue.") }
        let task = Task { try await self.call("auth:signIn", args: ["refreshToken": stored.refreshToken]) }
        // Saving is part of the shared task, before any waiter resumes.
        let rotation = Task { try await self.save(try await task.value) }
        let id = UUID()
        pending = rotation; pendingId = id
        defer { finish(id) }
        return try await rotation.value
    }
    nonisolated func extractIdToken(from authResult: SessionTokens) -> String { authResult.token }
    private func finish(_ id: UUID) {
        // A completed waiter must not clear a newer operation's serialization gate.
        if pendingId == id { pending = nil; pendingId = nil }
    }
    func logout() async throws {
        if let pending { _ = try? await pending.value }
        let token = try vault.read()?.token
        // Local sign-out must succeed even when revocation cannot reach the server.
        try vault.clear()
        callback?(nil)
        callback = nil
        if let token { _ = try? await call("auth:signOut", args: [:], bearer: token) }
    }
    private func save(_ result: SignInResult) throws -> SessionTokens {
        guard let tokens = result.tokens else {
            try vault.clear(); callback?(nil)
            throw AppFailure.message("Session expired. Sign in again.")
        }
        try vault.write(tokens)
        callback?(tokens.token)
        return tokens
    }
    private func call(_ path: String, args: [String: Any], bearer: String? = nil) async throws -> SignInResult {
        try await transport.call(url: url, path: path, args: args, bearer: bearer)
    }
}

protocol AuthTransport {
    func call(url: URL, path: String, args: [String: Any], bearer: String?) async throws -> SignInResult
}

struct HTTPAuthTransport: AuthTransport {
    func call(url: URL, path: String, args: [String: Any], bearer: String?) async throws -> SignInResult {
        var request = URLRequest(url: url.appendingPathComponent("api/action"))
        request.httpMethod = "POST"
        request.timeoutInterval = 25
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let bearer { request.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization") }
        request.httpBody = try JSONSerialization.data(withJSONObject: ["path": path, "args": args, "format": "json"])
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw AppFailure.message("No server response.") }
        struct Envelope: Decodable { let status: String; let value: SignInResult?; let errorMessage: String? }
        // auth:signOut returns null; decode it as an empty sign-in result.
        let envelope = try JSONDecoder().decode(Envelope.self, from: data)
        guard (200..<300).contains(http.statusCode), envelope.status == "success" else {
            throw AppFailure.message(path == "auth:signIn" ? "Could not sign in or refresh your session. Check your credentials and connection." : "Could not revoke session.")
        }
        return envelope.value ?? SignInResult(tokens: nil)
    }
}
