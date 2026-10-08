import Foundation
import Security

protocol TokenVault {
    func read() throws -> SessionTokens?
    func write(_ tokens: SessionTokens) throws
    func clear() throws
}

struct KeychainVault: TokenVault {
    let service: String
    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service, kSecAttrAccount as String: "session"]
    }
    func read() throws -> SessionTokens? {
        var query = query
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        try check(status)
        guard let data = result as? Data else { throw AppFailure.message("Unable to read saved session.") }
        return try JSONDecoder().decode(SessionTokens.self, from: data)
    }
    func write(_ tokens: SessionTokens) throws {
        let data = try JSONEncoder().encode(tokens)
        let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            var entry = query
            entry[kSecValueData as String] = data
            entry[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            try check(SecItemAdd(entry as CFDictionary, nil))
        } else { try check(status) }
    }
    func clear() throws {
        let status = SecItemDelete(query as CFDictionary)
        if status != errSecItemNotFound { try check(status) }
    }
    private func check(_ status: OSStatus) throws {
        guard status == errSecSuccess else {
            throw AppFailure.message("Secure session storage failed (\(status)).")
        }
    }
}
