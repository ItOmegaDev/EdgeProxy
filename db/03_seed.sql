-- ==========================================================
-- EdgeProxy Staging & Dev Seed Data
-- File: 03_seed.sql
-- ==========================================================

-- Development-only seed data. Replace the placeholder hash before use and never
-- commit a real API key. Generate a hash with:
--   printf '%s' "$EDGEPROXY_API_KEY" | sha256sum
INSERT INTO users (id, email, api_key_hash, plan_tier, max_tunnels, max_rps)
VALUES 
    ('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'dev@edgeproxy.mesh', 'REPLACE_WITH_SHA256_HEX_OF_API_KEY', 'enterprise', 20, 500)
ON CONFLICT (email) DO NOTHING;

INSERT INTO tunnels (id, user_id, subdomain, target_host, target_port, protocol, tls_status, is_active)
VALUES
    ('b1eebc99-9c0b-4ef8-bb6d-6bb9bd380b22', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'cloud', '127.0.0.1', 8080, 'quic', 'active', TRUE),
    ('c2eebc99-9c0b-4ef8-bb6d-6bb9bd380c33', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'api', '127.0.0.1', 3000, 'http2', 'active', TRUE),
    ('d3eebc99-9c0b-4ef8-bb6d-6bb9bd380d44', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'grafana', '127.0.0.1', 5173, 'websocket', 'active', TRUE),
    ('e4eebc99-9c0b-4ef8-bb6d-6bb9bd380e55', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', 'staging', '127.0.0.1', 8000, 'tcp', 'active', TRUE)
ON CONFLICT (subdomain) DO NOTHING;
