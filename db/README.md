# Optional PostgreSQL reference schema

These SQL files describe a relational model for EdgeProxy. They are **not applied
by the running control plane** — `src/server/db.ts` uses Firebase Firestore via the
Admin SDK, or in-memory state when credentials are absent.

The schema is kept as a reference for teams that want to move the control plane to
PostgreSQL. If you do:

- keep `api_key_hash` (SHA-256 hex) and `auth_pass_hash` (Argon2id/bcrypt);
- run migrations through a reviewed tool, never by hand in production;
- do not commit real seed credentials — `03_seed.sql` contains a placeholder.
