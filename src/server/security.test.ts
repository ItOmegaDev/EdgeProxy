import test from "node:test";
import assert from "node:assert/strict";
import {
  TOKEN_PREFIX,
  generateToken,
  hashToken,
  timingSafeEqual,
  extractBearer,
  validateSubdomain,
  isAllowedCollection,
  redactSecrets,
  isValidIp,
} from "./security.ts";

test("generateToken produces unique prefixed 256-bit tokens", () => {
  const a = generateToken();
  const b = generateToken();
  assert.notEqual(a, b);
  assert.ok(a.startsWith(TOKEN_PREFIX));
  assert.equal(a.length, TOKEN_PREFIX.length + 64);
  assert.match(a, /^edg_tok_[0-9a-f]{64}$/);
});

test("hashToken is deterministic and does not contain the plaintext", () => {
  const token = generateToken();
  const hash = hashToken(token);
  assert.equal(hash, hashToken(token));
  assert.equal(hash.length, 64);
  assert.ok(!hash.includes(token));
});

test("timingSafeEqual compares values correctly", () => {
  assert.equal(timingSafeEqual("correct-horse", "correct-horse"), true);
  assert.equal(timingSafeEqual("correct-horse", "correct-horsf"), false);
  assert.equal(timingSafeEqual("short", "a-much-longer-value"), false);
  assert.equal(timingSafeEqual("", ""), true);
});

test("extractBearer accepts only Bearer credentials", () => {
  assert.equal(extractBearer("Bearer abc.DEF-123_~"), "abc.DEF-123_~");
  assert.equal(extractBearer("bearer abc"), "abc");
  assert.equal(extractBearer("Basic abc"), null);
  assert.equal(extractBearer("Bearer "), null);
  assert.equal(extractBearer(undefined), null);
  assert.equal(extractBearer("Bearer abc def"), null);
});

test("validateSubdomain accepts safe single labels", () => {
  assert.equal(validateSubdomain("  My-App  "), "my-app");
  assert.equal(validateSubdomain("a"), "a");
  assert.equal(validateSubdomain("app-01"), "app-01");
});

test("validateSubdomain rejects traversal, dots and reserved names", () => {
  assert.equal(validateSubdomain("a.b"), null);
  assert.equal(validateSubdomain("../etc"), null);
  assert.equal(validateSubdomain("-leading"), null);
  assert.equal(validateSubdomain("trailing-"), null);
  assert.equal(validateSubdomain("has space"), null);
  assert.equal(validateSubdomain("x".repeat(64)), null);
  assert.equal(validateSubdomain("admin"), null);
  assert.equal(validateSubdomain(42), null);
});

test("collection allowlist is closed", () => {
  assert.equal(isAllowedCollection("tunnels"), true);
  assert.equal(isAllowedCollection("users"), true);
  assert.equal(isAllowedCollection("__proto__"), false);
  assert.equal(isAllowedCollection("secrets"), false);
});

test("redactSecrets removes credentials recursively", () => {
  const input = {
    id: "u1",
    email: "user@example.com",
    api_key: "should-disappear",
    nested: { token: "nope", token_last4: "abcd", keep: 1 },
    list: [{ password: "nope", value: 2 }],
  };
  const output = redactSecrets(input);
  assert.equal(output.api_key, undefined);
  assert.equal(output.nested.token, undefined);
  assert.equal(output.nested.token_last4, "abcd");
  assert.equal(output.nested.keep, 1);
  assert.equal(output.list[0].password, undefined);
  assert.equal(output.list[0].value, 2);
});

test("isValidIp rejects junk", () => {
  assert.equal(isValidIp("127.0.0.1"), true);
  assert.equal(isValidIp("::1"), true);
  assert.equal(isValidIp("not-an-ip"), false);
  assert.equal(isValidIp(123), false);
});
