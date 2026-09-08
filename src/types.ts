export type ProtocolType = 'http2' | 'quic' | 'ws' | 'tcp';

export type TunnelStatus = 'online' | 'degraded' | 'offline';

export interface Tunnel {
  id: string;
  name: string;
  subdomain: string;
  customDomain?: string;
  targetHost: string;
  targetPort: number;
  protocol: ProtocolType;
  status: TunnelStatus;
  createdAt: string;
  bytesIn: number;
  bytesOut: number;
  activeStreams: number;
  totalRequests: number;
  latencyMs: number;
  rateLimit: {
    enabled: boolean;
    maxRps: number;
    burst: number;
  };
  tlsStatus: 'issued' | 'pending' | 'expired' | 'renewing';
  auth: {
    enabled: boolean;
    type: 'basic' | 'token' | 'none';
    token?: string;
  };
  headersRewrite: Record<string, string>;
  tags: string[];
}

export type RateLimitDecision = 'allowed' | 'throttled' | 'rate_limited' | 'blocked_ddos';

export interface TrafficRequest {
  id: string;
  timestamp: number;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'CONNECT';
  path: string;
  host: string;
  subdomain: string;
  clientIp: string;
  countryCode: string;
  userAgent: string;
  statusCode: number;
  durationMs: number;
  edgeProcessingMs: number;
  tunnelTransitMs: number;
  localServiceMs: number;
  bytes: number;
  protocol: ProtocolType;
  tlsCipher: string;
  decision: RateLimitDecision;
  bucketRemainingTokens?: number;
  bucketCapacity?: number;
  requestHeaders: Record<string, string>;
  responseHeaders: Record<string, string>;
  payloadPreview?: string;
}

export interface TelemetryMetrics {
  currentRps: number;
  peakRps: number;
  activeConnections: number;
  bandwidthInBps: number;
  bandwidthOutBps: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  droppedRequestsCount: number;
  totalRequestsCount: number;
  edgeCpuPercent: number;
  edgeMemoryMb: number;
  tunnelJitterMs: number;
  packetLossPercent: number;
}

export interface RateLimiterConfig {
  algorithm: 'token_bucket' | 'leaky_bucket';
  capacity: number; // Max burst
  refillRate: number; // Tokens added per second
  currentTokens: number;
  ipJailDurationSec: number;
  anomalyThresholdRps: number;
  enableSynFloodShield: boolean;
  enableL7FloodShield: boolean;
  enableGeoBlocking: boolean;
  whitelistedIps: string[];
  blacklistedIps: string[];
  blockedIpRecords: { ip: string; reason: string; timestamp: number; blockedUntil: number }[];
}

export interface SSLCertificate {
  id: string;
  domain: string;
  wildcard: boolean;
  issuer: string;
  status: 'valid' | 'renewing' | 'pending_challenge' | 'revoked';
  validFrom: string;
  validTo: string;
  daysRemaining: number;
  challengeType: 'DNS-01' | 'HTTP-01';
  sanList: string[];
  ocspStapled: boolean;
  fingerprint: string;
  autoRenew: boolean;
}

export interface LocalDiscoveryItem {
  id: string;
  port: number;
  name: string;
  process: string;
  serviceType: 'Nextcloud' | 'Vite Dev' | 'PostgreSQL' | 'Minecraft' | 'Node API' | 'Home Assistant' | 'FastAPI' | 'Unknown';
  isTunneled: boolean;
  suggestedSubdomain: string;
}

// Section 3: Tunnel Binary Frame Protocol Types
export type BinaryFrameType = 'SYN' | 'DATA' | 'FIN' | 'PING';

export interface BinaryFrame {
  id: string;
  timestamp: number;
  streamId: number; // 4 Bytes (u32)
  frameType: BinaryFrameType; // 1 Byte (u8): 0x01 (SYN), 0x02 (DATA), 0x03 (FIN), 0x04 (PING)
  frameTypeCode: number; // 0x01, 0x02, 0x03, 0x04
  payloadLength: number; // 4 Bytes (u32)
  payloadData: string; // N Bytes (Headers + Body or Ping token)
  hexDump: string;
  source: 'edge_gateway' | 'local_agent';
}

// Section 4: Relational Database Schema Models (PostgreSQL)
export interface DbUser {
  id: string; // UUID
  email: string;
  api_key_hash: string;
  created_at: string;
}

export interface DbTunnel {
  id: string; // UUID
  user_id: string; // UUID FK
  subdomain: string; // VARCHAR(63)
  auth_token_hash: string;
  is_active: boolean;
  max_rate_limit: number; // INT default 100
  created_at: string;
}

export interface DbTrafficLog {
  id: number; // BIGSERIAL
  tunnel_id: string; // UUID FK
  subdomain?: string;
  client_ip: string; // VARCHAR(45)
  http_method: string; // VARCHAR(10)
  path: string; // TEXT
  status_code: number; // INT
  latency_ms: number; // INT
  bytes_sent: number; // BIGINT
  timestamp: string; // TIMESTAMP WITH TIME ZONE
}

// Section 5: Step-by-Step Implementation Roadmap Stages
export interface RoadmapStage {
  step: number;
  nameUa: string;
  nameEn: string;
  subtitleUa: string;
  subtitleEn: string;
  status: 'completed' | 'verified' | 'in_progress';
  keyComponents: string[];
  codeSampleTitle: string;
  codeSampleLanguage: string;
  codeSample: string;
  benchmarks: { label: string; value: string }[];
}
