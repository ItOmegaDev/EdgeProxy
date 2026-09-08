-- ==========================================================
-- EdgeProxy Composite & Partial Performance Indexes
-- File: 02_indexes.sql
-- ==========================================================

-- Fast subdomain lookup on every ingress packet (<0.05ms)
CREATE UNIQUE INDEX IF NOT EXISTS idx_tunnels_subdomain 
    ON tunnels (subdomain) 
    WHERE is_active = TRUE;

-- High-speed user ownership checks
CREATE INDEX IF NOT EXISTS idx_tunnels_user_id 
    ON tunnels (user_id);

-- Time-series telemetry querying for RPS charts and latency percentiles
CREATE INDEX IF NOT EXISTS idx_logs_tunnel_time 
    ON traffic_logs (tunnel_id, timestamp DESC);

-- Accelerated DDoS & Security forensic queries
CREATE INDEX IF NOT EXISTS idx_logs_shield_events 
    ON traffic_logs (client_ip, timestamp DESC) 
    WHERE blocked_by_shield = TRUE;

-- Latency anomaly monitoring
CREATE INDEX IF NOT EXISTS idx_logs_high_latency 
    ON traffic_logs (timestamp DESC) 
    WHERE latency_ms > 250.0;
