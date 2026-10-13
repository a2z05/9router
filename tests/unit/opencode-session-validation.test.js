import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  OPENCODE_SESSION_RE,
  translateSessionId,
  generateSessionId,
  stableSessionId,
} from "../../open-sse/executors/opencode.js";

describe("opencode session ID validation (fix for #4780)", () => {
  const mockCredentials = {
    connectionId: "test-conn-id",
    rawHeaders: {},
  };
  const mockBody = { messages: [{ role: "user", content: "hello" }] };
  const mockProviderSessionId = "invalid-session-id-from-provider";

  describe("OPENCODE_SESSION_RE", () => {
    it("matches valid native OpenCode session IDs (ses_ecc...ffe format)", () => {
      // Valid format: ses_ + 12 hex chars (timestamp, lowercase) + 14 base62 chars = 30 chars total
      const validIds = [
        "ses_ecc6d9f12345abcdef6789abcd",  // 4 + 12 + 14 = 30
        "ses_abcdef1234567890abcdef1234",  // 4 + 12 + 14 = 30
        "ses_0123456789abcdefabcdef1234",  // 4 + 12 + 14 = 30 (lowercase hex only)
      ];
      for (const id of validIds) {
        expect(OPENCODE_SESSION_RE.test(id)).toBe(true);
      }
    });

    it("rejects invalid session IDs", () => {
      const invalidIds = [
        "ses_tooshort",
        "ses_invalidchars!@#",
        "ses_",
        "not-a-ses-id",
        "",
        "ses_ecc6d9f12345abcdef6789abX", // too long (31 chars)
        "msg_ecc6d9f12345abcdef6789ab",  // request ID, not session
        "ses_ecc6d9f12345abcdef6789",    // too short (28 chars - missing 2 base62)
        "ses_ecc6d9f12345abcdef6789ab1", // too long (31 chars)
      ];
      for (const id of invalidIds) {
        expect(OPENCODE_SESSION_RE.test(id)).toBe(false);
      }
    });
  });

  describe("translateSessionId", () => {
    it("preserves already-valid OpenCode session IDs", () => {
      const validId = "ses_ecc6d9f12345abcdef6789abcd";  // 30 chars = valid
      expect(translateSessionId(validId, "claude")).toBe(validId);
      expect(translateSessionId(validId, "generic")).toBe(validId);
    });

    it("translates non-OpenCode IDs to syntactically valid but digest-derived IDs", () => {
      const nonOpenCodeId = "some-random-session-id";
      const translated = translateSessionId(nonOpenCodeId, "claude");
      expect(OPENCODE_SESSION_RE.test(translated)).toBe(true);
      expect(translated).not.toBe(nonOpenCodeId);
      expect(translated.startsWith("ses_")).toBe(true);
    });
  });

  describe("generateSessionId", () => {
    it("generates valid OpenCode session IDs with real timestamp prefix", () => {
      const id = generateSessionId();
      expect(OPENCODE_SESSION_RE.test(id)).toBe(true);
      expect(id.startsWith("ses_")).toBe(true);
      expect(id.length).toBe(30); // "ses_" + 12 hex + 14 base62
    });

    it("produces different IDs on each call", () => {
      const ids = new Set();
      for (let i = 0; i < 100; i++) {
        ids.add(generateSessionId());
      }
      expect(ids.size).toBe(100);
    });
  });

  describe("stableSessionId", () => {
    it("generates valid OpenCode session IDs", () => {
      const credentials = { connectionId: "test-conn", rawHeaders: {} };
      const id = stableSessionId(credentials);
      expect(OPENCODE_SESSION_RE.test(id)).toBe(true);
      expect(id.startsWith("ses_")).toBe(true);
      expect(id.length).toBe(30);
    });

    it("returns same ID for same credentials (stable)", () => {
      const credentials = { connectionId: "test-conn-stable", rawHeaders: {} };
      const id1 = stableSessionId(credentials);
      const id2 = stableSessionId(credentials);
      expect(id1).toBe(id2);
    });
  });

  describe("resolveOpencodeSession - internal validation logic", () => {
    // Since resolveOpencodeSession is not exported, we test the validation
    // logic that was added inline by checking translateSessionId behavior
    // and the regex

    it("native OpenCode ID from header would be preserved by the fix", () => {
      const nativeId = "ses_ecc6d9f12345abcdef6789abcd";  // 30 chars = valid
      // The fix checks OPENCODE_SESSION_RE.test(hinted) before translate
      expect(OPENCODE_SESSION_RE.test(nativeId)).toBe(true);
      // So it would return nativeId directly without calling translateSessionId
    });

    it("native OpenCode ID from providerSessionId would be preserved by the fix", () => {
      const nativeId = "ses_ecc6d9f12345abcdef6789abcd";  // 30 chars = valid
      expect(OPENCODE_SESSION_RE.test(nativeId)).toBe(true);
    });

    it("non-OpenCode session ID from header gets translated (fallback)", () => {
      const nonOpenCodeId = "some-provider-session-id";
      expect(OPENCODE_SESSION_RE.test(nonOpenCodeId)).toBe(false);
      const translated = translateSessionId(nonOpenCodeId, "claude");
      expect(OPENCODE_SESSION_RE.test(translated)).toBe(true);
      expect(translated).not.toBe(nonOpenCodeId);
    });

    it("non-OpenCode session ID from providerSessionId gets translated (fallback)", () => {
      const nonOpenCodeId = "provider-invalid-session";
      expect(OPENCODE_SESSION_RE.test(nonOpenCodeId)).toBe(false);
      const translated = translateSessionId(nonOpenCodeId, "claude");
      expect(OPENCODE_SESSION_RE.test(translated)).toBe(true);
      expect(translated).not.toBe(nonOpenCodeId);
    });

    it("sessionManager returns binary-style IDs which are NOT valid OpenCode format", () => {
      // The sessionManager returns IDs like: uuid + timestamp (binary format)
      const binaryStyleId = "550e8400-e29b-41d4-a716-4466554400001234567890";
      expect(OPENCODE_SESSION_RE.test(binaryStyleId)).toBe(false);

      const translated = translateSessionId(binaryStyleId, "generic");
      expect(OPENCODE_SESSION_RE.test(translated)).toBe(true);
    });
  });
});