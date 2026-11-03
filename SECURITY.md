# Security Policy

## Reporting a vulnerability

Please use GitHub's **private vulnerability reporting** (Security → Advisories → Report a vulnerability) for this repository. Do not open a public issue for a live vulnerability and do not include real credentials, tokens or customer data.

Include:

- affected component and version/commit;
- a minimal reproduction (mask secrets as `prefix…suffix`);
- impact and preconditions;
- a suggested fix, if known.

## Threat model

EdgeProxy has three trust zones:

| Zone | Components | Trust |
| --- | --- | --- |
| Public | Go gateway `:80`, `:443`, tunnel listener `:4242` | Untrusted clients and agents; every request and handshake is authenticated or routed by explicit allowlist. |
| Private IPC | Gateway `:8081` | Trusted control plane only; shared secret + Docker network. Never published to the host. |
| Admin | Node control plane/dashboard `:3000` | Administrative surface. Loopback by default; bearer key required otherwise. |

Data at rest lives in Firestore and is accessed only through the Firebase Admin SDK.

## Implemented controls

- **Default deny** for tunnel registration: a tunnel must exist, be enabled and present a token whose SHA-256 hash matches.
- **Token handling:** 256-bit CSPRNG tokens; plaintext is returned once on create/rotate; only hashes are persisted and synchronized.
- **Constant-time comparisons** for API keys, IPC secrets and tunnel token hashes.
- **Firestore rules** deny all direct client reads/writes.
- **Internal IPC isolation:** separate listener, shared secret, method checks, body limits, no public route.
- **Admin API:** bearer key for remote access, loopback + CSRF header in local mode, origin validation.
- **Input validation:** subdomains, ports, protocols, IPs, paths, query shape, document collections.
- **Output hygiene:** credentials redacted from users/collections; generic error messages.
- **Limits:** 1 MB JSON bodies, 64 KB tunnel frames, 10 s handshake deadline.
- **Transport hardening:** TLS 1.2 minimum, SNI certificate manager, security headers/CSP in production.
- **Supply chain:** committed lockfiles, pinned Go module set, CI secret scanning and tests.

## Deployment checklist

- [ ] `EDGEPROXY_API_KEY` is at least 32 random bytes (`openssl rand -hex 32`).
- [ ] `EDGEPROXY_INTERNAL_SECRET` is independent from the API key and at least 32 random bytes.
- [ ] The dashboard is not published on `0.0.0.0`; use loopback + SSH tunnel or an authenticated reverse proxy.
- [ ] Firestore rules are deployed from this repository and still deny all client access.
- [ ] Service-account JSON is mounted as a secret, never committed or baked into an image.
- [ ] The tunnel port `:4242` is restricted to trusted networks or protected by WireGuard/mTLS.
- [ ] TLS certificates are replaced with publicly trusted ones if browsers must connect without warnings.
- [ ] `gitleaks dir . --redact --no-banner` is clean before release.
- [ ] Logs do not contain `Authorization` headers, tokens or full service-account data.

## Known limitations

- The gateway issues **self-signed** certificates and has no public ACME client.
- The tunnel protocol is **plain TCP**; the token authenticates but does not encrypt.
- There is a single admin credential; no multi-user login, MFA or per-tenant authorization.
- No DAST/fuzzing or external audit has been performed yet.

## Incident response

If a token or key is exposed:

1. Rotate it first (`POST /api/tunnels/:id/rotate-token`, or replace the env key and restart).
2. Remove it from the working tree and history.
3. Review gateway/control-plane logs and provider billing for abuse.
4. Document the root cause and add a regression test.
