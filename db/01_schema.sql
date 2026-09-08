-- ==========================================================
-- EdgeProxy Relational Data Architecture (PostgreSQL 16)
-- File: 01_schema.sql
-- ==========================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Users & Tenant Accounts
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    api_key VARCHAR(64) UNIQUE NOT NULL,
    plan_tier VARCHAR(32) DEFAULT 'developer' CHECK (plan_tier IN ('developer', 'team', 'enterprise')),
    max_tunnels INT DEFAULT 5,
    max_rps INT DEFAULT 100,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Tunnels & Route Registry
CREATE TABLE IF NOT EXISTS tunnels (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subdomain VARCHAR(63) UNIQUE NOT NULL,
    target_host VARCHAR(255) DEFAULT '127.0.0.1',
    target_port INT NOT NULL CHECK (target_port > 0 AND target_port <= 65535),
    protocol VARCHAR(16) DEFAULT 'quic' CHECK (protocol IN ('quic', 'http2', 'websocket', 'tcp')),
    tls_status VARCHAR(32) DEFAULT 'active' CHECK (tls_status IN ('pending', 'active', 'renewing', 'failed')),
    auth_enabled BOOLEAN DEFAULT FALSE,
    auth_user VARCHAR(128),
    auth_pass VARCHAR(255),
    ip_allowlist TEXT[] DEFAULT '{}',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_ping_at TIMESTAMP WITH TIME ZONE
);

-- 3. Traffic Logs & Request Metrics (Partitioned Time-Series)
CREATE TABLE IF NOT EXISTS traffic_logs (
    id BIGSERIAL,
    tunnel_id UUID NOT NULL REFERENCES tunnels(id) ON DELETE CASCADE,
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    method VARCHAR(10) NOT NULL,
    path VARCHAR(2048) NOT NULL,
    status_code INT NOT NULL,
    latency_ms NUMERIC(8, 2) NOT NULL,
    bytes_in INT DEFAULT 0,
    bytes_out INT DEFAULT 0,
    client_ip INET NOT NULL,
    user_agent VARCHAR(512),
    blocked_by_shield BOOLEAN DEFAULT FALSE,
    PRIMARY KEY (id, timestamp)
) PARTITION BY RANGE (timestamp);

-- 4. Rate Limiter Rules
CREATE TABLE IF NOT EXISTS rate_limit_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tunnel_id UUID NOT NULL REFERENCES tunnels(id) ON DELETE CASCADE,
    max_requests_per_sec INT DEFAULT 60,
    burst_capacity INT DEFAULT 100,
    ban_duration_seconds INT DEFAULT 300,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
