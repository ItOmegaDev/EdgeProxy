import crypto from "crypto";

/**
 * Shared security primitives for the EdgeProxy control plane.
 *
 * Rules:
 * - Tokens are generated with a CSPRNG and never derived from user input.
 * - Only SHA-256 hashes of tunnel/agent tokens are persisted.
 * - Secret comparisons are constant-time.
 */

export const TOKEN_PREFIX = "edg_tok_";
export const MIN_API_KEY_LENGTH = 24;
export const TOKEN_HASH_LENGTH = 64; // SHA-256 hex

export const ALLOWED_COLLECTIONS = new Set([
  "tunnels",
  "traffic_logs",
  "users",
  "rate_limit_rules",
  "certificates",
]);

const SECRET_KEY_PATTERN = /(api[_-]?key|token|secret|password|passwd|private[_-]?key|auth[_-]?pass)/i;
const RESERVED_SUBDOMAINS = new Set(["www", "api", "admin", "internal", "mail", "root"]);

/** Generates a 256-bit tunnel/agent token, e.g. `edg_tok_<64 hex chars>`. */
export function generateToken(): string {
  return TOKEN_PREFIX + crypto.randomBytes(32).toString("hex");
}

/** Returns the SHA-256 hex digest used for at-rest token storage. */
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Constant-time comparison of two secrets. Both values are hashed first so the
 * comparison does not leak their length.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const left = crypto.createHash("sha256").update(a, "utf8").digest();
  const right = crypto.createHash("sha256").update(b, "utf8").digest();
  return crypto.timingSafeEqual(left, right);
}

/** Extracts a bearer token from an Authorization header. */
export function extractBearer(header: string | undefined | null): string | null {
  if (!header) return null;
  const match = /^Bearer\s+([A-Za-z0-9._~+/=-]+)$/i.exec(header.trim());
  return match ? match[1] : null;
}

/**
 * Normalizes and validates a tunnel subdomain (a single DNS label).
 * Returns null when the value is not safe to use as a routing key.
 */
export function validateSubdomain(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim().toLowerCase();
  if (candidate.length < 1 || candidate.length > 63) return null;
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(candidate)) return null;
  if (candidate.includes("--") && candidate.length > 63) return null;
  if (RESERVED_SUBDOMAINS.has(candidate)) return null;
  return candidate;
}

/** Returns true when `name` is one of the collections the control plane may touch. */
export function isAllowedCollection(name: unknown): name is string {
  return typeof name === "string" && ALLOWED_COLLECTIONS.has(name);
}

/**
 * Recursively removes credential-like fields from a document before it leaves
 * the server. Used by the read-only admin/collection APIs.
 */
export function redactSecrets<T>(value: T, depth = 0): T {
  if (depth > 6 || value === null || typeof value !== "object") return value;

  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item, depth + 1)) as unknown as T;
  }

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      if (key === "token_last4" || key === "api_key_last4") {
        output[key] = item;
      }
      continue;
    }
    output[key] = redactSecrets(item, depth + 1);
  }
  return output as T;
}

/** Validates an IP address provided by the client (for the rate-limit whitelist). */
export function isValidIp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(value) || /^[0-9a-f:]+$/i.test(value);
}
