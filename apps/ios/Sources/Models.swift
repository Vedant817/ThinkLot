import Foundation

enum Lifecycle: String, CaseIterable, Codable, Identifiable {
    case inbox, parked, reviewing, ready, building, done
    var id: String { rawValue }
    var label: String { rawValue.capitalized }
}

struct Idea: Decodable, Identifiable {
    let _id: String
    let seq: Double
    let title: String
    let status: Lifecycle
    let tags: [String]
    let impact: Double?
    let effort: Double?
    let confidence: Double?
    let favorite: Bool
    let archived: Bool
    let description: String?
    let problem: String?
    let preview: String?
    let revisitAt: Double?
    let createdAt: Double
    let updatedAt: Double
    var id: String { _id }
    var plate: String { String(format: "LOT-%04.0f", seq) }
    var priority: Double? {
        guard let impact, let effort, let confidence, effort > 0,
              impact.isFinite, effort.isFinite, confidence.isFinite else { return nil }
        return impact * confidence / effort
    }
}
struct IdeaPage: Decodable {
    let ideas: [Idea]
    let truncated: Bool
    let total: Double
}
struct IdeaDetail: Decodable {
    let idea: Idea
    let tasks: [IdeaTask]
}
struct IdeaTask: Decodable, Identifiable {
    let _id: String
    let title: String
    let completed: Bool
    let position: Double
    var id: String { _id }
}
struct ReviewItem: Decodable, Identifiable {
    let id: String
    let seq: Double
    let title: String
    let status: Lifecycle
    let score: Double?
    let reasons: [String]
}
struct ReviewPage: Decodable {
    let items: [ReviewItem]
    let total: Double
    let truncated: Bool
}
struct SessionTokens: Codable {
    let token: String
    let refreshToken: String
}
struct SignInResult: Decodable { let tokens: SessionTokens? }

enum AppFailure: LocalizedError {
    case message(String)
    var errorDescription: String? {
        if case .message(let message) = self { return message }
        return nil
    }
}

enum Deployment {
    static func validate(_ value: String) throws -> URL {
        guard let url = URL(string: value), url.scheme == "https", let host = url.host,
              host.hasSuffix(".convex.cloud"), !host.contains("YOUR_DEPLOYMENT"),
              url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
              url.path.isEmpty || url.path == "/" else {
            throw AppFailure.message("Set THINKLOT_CONVEX_URL to your HTTPS Convex cloud deployment in Config.local.xcconfig.")
        }
        return url
    }
}
