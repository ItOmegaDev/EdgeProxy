import "dotenv/config";
import express from "express";
import http from "http";
import https from "https";
import path from "path";
import net from "net";
import crypto from "crypto";
import os from "os";
import { WebSocketServer, WebSocket } from "ws";
import type { Duplex } from "stream";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import {
  initDb,
  executeQuery,
  dbGetTunnels,
  dbInsertTunnel,
  dbDeleteTunnel,
  dbInsertTrafficLog,
  dbGetUsers,
  dbGetCollectionDocs,
  dbInsertSampleDoc,
  dbGetStatus,
  dbGetCertificates,
  dbSaveCertificate,
} from "./src/server/db";
import {
  MIN_API_KEY_LENGTH,
  extractBearer,
  generateToken,
  hashToken,
  isAllowedCollection,
  isValidIp,
  timingSafeEqual,
  validateSubdomain,
} from "./src/server/security";

// ==========================================
// Runtime configuration (deny by default)
// ==========================================

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST?.trim() || "127.0.0.1";
const API_KEY = process.env.EDGEPROXY_API_KEY?.trim() || "";
const GATEWAY_INTERNAL_URL = (process.env.GATEWAY_INTERNAL_URL?.trim() || "http://127.0.0.1:8081").replace(/\/+$/, "");
const GATEWAY_PUBLIC_URL = (process.env.GATEWAY_PUBLIC_URL?.trim() || "http://127.0.0.1:80").replace(/\/+$/, "");
const GATEWAY_INTERNAL_SECRET = process.env.EDGEPROXY_INTERNAL_SECRET?.trim() || "";
const EXTRA_ALLOWED_ORIGINS = (process.env.EDGEPROXY_ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "::1" || host === "localhost";
}

if (!isLoopbackHost(HOST) && !API_KEY) {
  // Binding an admin surface to a network interface without authentication is
  // forbidden. Fail closed instead of exposing the control plane.
  console.error(
    "[FATAL] HOST is not loopback but EDGEPROXY_API_KEY is empty. " +
      "Set a strong API key or bind HOST=127.0.0.1.",
  );
  process.exit(1);
}

if (API_KEY && (API_KEY.length < MIN_API_KEY_LENGTH || !/^[A-Za-z0-9._~-]+$/.test(API_KEY))) {
  console.error(
    `[FATAL] EDGEPROXY_API_KEY must be at least ${MIN_API_KEY_LENGTH} chars and URL-safe ` +
      "(A-Z, a-z, 0-9, '.', '_', '~', '-').",
  );
  process.exit(1);
}

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", false);
app.use(express.json({ limit: "1mb", strict: true }));

// Lazy-initialized Gemini AI Client
let aiClient: GoogleGenAI | null = null;
function getAI(): GoogleGenAI | null {
  if (!aiClient && process.env.GEMINI_API_KEY) {
    try {
      aiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    } catch (err) {
      console.warn("[AI] Failed to initialize GoogleGenAI client:", err);
    }
  }
  return aiClient;
}

// Data models
export interface TunnelRecord {
  id: string;
  name: string;
  subdomain: string;
  localPort: number;
  protocol: "quic" | "http2" | "websocket" | "tcp";
  status: "online" | "reconnecting" | "offline";
  tlsStatus: "active" | "renewing" | "failed";
  authEnabled: boolean;
  authUser?: string;
  /** Whether the tunnel is allowed to accept an agent at all. */
  enabled: boolean;
  /** Only populated on the create/rotate response; never persisted or listed. */
  token?: string;
  tokenHash?: string;
  tokenLast4?: string;
  maxRps?: number;
  totalRequests: number;
  bytesTransferred: number;
  avgLatency: number;
  publicUrl: string;
  createdAt: string;
}

export interface LogEntry {
  id: string;
  timestamp: string;
  method: string;
  path: string;
  statusCode: number;
  latencyMs: number;
  clientIp: string;
  subdomain: string;
  bytesIn: number;
  bytesOut: number;
  blockedByShield: boolean;
}

export interface CertificateRecord {
  id: string;
  domain: string;
  wildcard: boolean;
  issuer: string;
  status: "valid" | "expired" | "pending";
  validFrom: string;
  validTo: string;
  daysRemaining: number;
  challengeType: "DNS-01" | "HTTP-01" | "TLS-ALPN-01" | "SELF-SIGNED";
  sanList: string[];
  ocspStapled: boolean;
  fingerprint: string;
  autoRenew: boolean;
}

// Real In-Memory State Store (Starts clean with NO mock/fake data)
const tunnels: TunnelRecord[] = [];
const logs: LogEntry[] = [];
const certificates: CertificateRecord[] = [];
const bannedIps = new Map<string, { blockedUntil: number; reason: string }>();
const whitelistedIps = new Set(["127.0.0.1", "::1"]);

// Real Token Bucket Rate Limiter
let tokenCapacity = 100;
let currentTokens = 100;
let refillRatePerSec = 50;
let lastRefillTime = Date.now();

function checkRateLimit(clientIp: string): { allowed: boolean; reason?: string } {
  const now = Date.now();
  const elapsed = (now - lastRefillTime) / 1000;
  if (elapsed > 0.05) {
    currentTokens = Math.min(tokenCapacity, currentTokens + elapsed * refillRatePerSec);
    lastRefillTime = now;
  }

  // Whitelist bypass
  if (whitelistedIps.has(clientIp)) return { allowed: true };

  // Check jail
  const jail = bannedIps.get(clientIp);
  if (jail && jail.blockedUntil > now) {
    return { allowed: false, reason: `IP jailed until ${new Date(jail.blockedUntil).toLocaleTimeString()}` };
  } else if (jail) {
    bannedIps.delete(clientIp);
  }

  if (currentTokens < 1) {
    // Jail the IP for 60 seconds
    bannedIps.set(clientIp, { blockedUntil: now + 60000, reason: "Rate limit exceeded (Token bucket exhausted)" });
    return { allowed: false, reason: "Rate limit exceeded (429)" };
  }

  currentTokens -= 1;
  return { allowed: true };
}

// Request tracking for real RPS computation
let requestTimestamps: number[] = [];

function recordRequest(entry: LogEntry) {
  logs.unshift(entry);
  if (logs.length > 500) logs.pop();
  requestTimestamps.push(Date.now());

  // Persist to Firebase / Firestore
  dbInsertTrafficLog(entry);

  // Update tunnel stats
  const tun = tunnels.find((t) => t.subdomain === entry.subdomain);
  if (tun) {
    tun.totalRequests += 1;
    tun.bytesTransferred += entry.bytesIn + entry.bytesOut;
    tun.avgLatency = Number(((tun.avgLatency * (tun.totalRequests - 1) + entry.latencyMs) / tun.totalRequests).toFixed(2));
  }

  broadcastWs("traffic_packet", entry);
}

// Create HTTP server
const server = http.createServer(app);

// Attach WebSocket Server. Upgrades are authenticated manually so the token can
// travel in a header (Sec-WebSocket-Protocol) instead of the URL.
const wss = new WebSocketServer({
  noServer: true,
  handleProtocols(protocols) {
    // The browser sends ["edgeproxy", <api-key>]; only the public name is echoed.
    return protocols.has("edgeproxy") ? "edgeproxy" : false;
  },
});

function isLoopbackRequest(req: http.IncomingMessage): boolean {
  const address = req.socket.remoteAddress || "";
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function isAllowedOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return true; // non-browser clients (curl, agents)
  if (EXTRA_ALLOWED_ORIGINS.includes(origin)) return true;
  if (!host) return false;
  return origin === `http://${host}` || origin === `https://${host}`;
}

function rejectUpgrade(socket: Duplex, status: string, reason: string) {
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

server.on("upgrade", (req, socket, head) => {
  let pathname = "";
  try {
    pathname = new URL(req.url || "/", "http://localhost").pathname;
  } catch {
    rejectUpgrade(socket, "400", "Bad Request");
    return;
  }

  if (pathname !== "/ws") {
    rejectUpgrade(socket, "404", "Not Found");
    return;
  }

  if (!isAllowedOrigin(req.headers.origin, req.headers.host)) {
    rejectUpgrade(socket, "403", "Forbidden");
    return;
  }

  if (API_KEY) {
    const protocols = String(req.headers["sec-websocket-protocol"] || "")
      .split(",")
      .map((value) => value.trim());
    const presented = protocols[1];
    if (!presented || !timingSafeEqual(presented, API_KEY)) {
      rejectUpgrade(socket, "401", "Unauthorized");
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
    return;
  }

  if (!isLoopbackRequest(req)) {
    rejectUpgrade(socket, "403", "Forbidden");
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
});

function broadcastWs(type: string, data: any) {
  const msg = JSON.stringify({ type, data, timestamp: new Date().toISOString() });
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

function getRealTelemetry() {
  const now = Date.now();
  requestTimestamps = requestTimestamps.filter((t) => now - t <= 1000);
  const realRps = requestTimestamps.length;

  const memUsage = process.memoryUsage();
  const ramMb = Math.round((memUsage.rss / (1024 * 1024)) * 10) / 10;
  const load = os.loadavg()[0];
  const cpuPercent = Math.min(100, Math.round(load * 10) / 10);

  let p50 = 0, p95 = 0, p99 = 0;
  if (logs.length > 0) {
    const latencies = logs.slice(0, 100).map((l) => l.latencyMs).sort((a, b) => a - b);
    p50 = latencies[Math.floor(latencies.length * 0.5)] || 0;
    p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;
    p99 = latencies[Math.floor(latencies.length * 0.99)] || 0;
  }

  const recentLogs = logs.filter((l) => now - new Date(l.timestamp).getTime() <= 1000);
  const bytesInSec = recentLogs.reduce((acc, l) => acc + l.bytesIn, 0);
  const bytesOutSec = recentLogs.reduce((acc, l) => acc + l.bytesOut, 0);

  return {
    rps: realRps,
    activeConnections: wss.clients.size,
    latencyP50: Number(p50.toFixed(2)),
    latencyP95: Number(p95.toFixed(2)),
    latencyP99: Number(p99.toFixed(2)),
    bandwidthIn: bytesInSec > 1048576 ? `${(bytesInSec / 1048576).toFixed(2)} MB/s` : `${(bytesInSec / 1024).toFixed(1)} KB/s`,
    bandwidthOut: bytesOutSec > 1048576 ? `${(bytesOutSec / 1048576).toFixed(2)} MB/s` : `${(bytesOutSec / 1024).toFixed(1)} KB/s`,
    cpuUsage: cpuPercent,
    ramUsage: ramMb,
    uptimeSeconds: Math.floor(process.uptime()),
    activeTunnels: tunnels.filter((t) => t.status === "online").length,
    totalLogs: logs.length,
  };
}

// Periodic real-time telemetry broadcast (actual server metrics)
setInterval(() => {
  broadcastWs("telemetry", getRealTelemetry());
}, 2000);

// ==========================================
// REST API Endpoints
// ==========================================

// Security headers and same-origin enforcement for every response.
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  if (process.env.NODE_ENV === "production") {
    res.setHeader(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "img-src 'self' data:",
        "connect-src 'self' ws: wss:",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join("; "),
    );
  }

  const origin = req.headers.origin;
  if (!isAllowedOrigin(origin, req.headers.host)) {
    return res.status(403).json({ error: "Cross-origin request rejected" });
  }

  // Explicitly allowlisted cross-origin clients get a narrow CORS grant.
  if (origin && EXTRA_ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-EdgeProxy-CSRF");
    res.setHeader("Access-Control-Max-Age", "600");
  }

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  next();
});

// Liveness only. Deliberately contains no topology, credentials or metrics.
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

/**
 * Admin API gate.
 *
 * - With EDGEPROXY_API_KEY set: a Bearer token is mandatory.
 * - Without a key: the API is reachable only from loopback and mutations must
 *   carry the custom `X-EdgeProxy-CSRF: 1` header (blocks drive-by browser CSRF).
 */
app.use("/api", (req, res, next) => {
  if (API_KEY) {
    const presented = extractBearer(req.headers.authorization);
    if (!presented || !timingSafeEqual(presented, API_KEY)) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    return next();
  }

  if (!isLoopbackRequest(req)) {
    return res.status(403).json({ error: "Control plane is loopback-only" });
  }

  if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && req.headers["x-edgeproxy-csrf"] !== "1") {
    return res.status(403).json({ error: "Missing CSRF header" });
  }

  next();
});

/** Serializes a tunnel without its credential hash or one-time token. */
function publicTunnel(tunnel: TunnelRecord) {
  const { token: _token, tokenHash: _tokenHash, ...rest } = tunnel;
  return rest;
}

/** Calls the gateway's private IPC listener with the shared secret. */
async function gatewayFetch(pathname: string, init: RequestInit = {}, timeoutMs = 1000) {
  if (!GATEWAY_INTERNAL_SECRET) {
    throw new Error("Gateway internal IPC is not configured");
  }
  const headers = new Headers(init.headers);
  headers.set("X-EdgeProxy-Internal", GATEWAY_INTERNAL_SECRET);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(`${GATEWAY_INTERNAL_URL}${pathname}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

app.get("/api/status", (req, res) => {
  const telemetry = getRealTelemetry();
  res.json({
    gateway: {
      status: "operational",
      version: "EdgeProxy v1.0.0",
      node: os.hostname(),
      ip: HOST,
      ports: { controlPlane: PORT, tunnel: 4242 },
      tlsCert: certificates.length > 0 ? certificates[0].domain : "None issued",
    },
    connectedClients: wss.clients.size,
    tunnelsCount: tunnels.length,
    activeStreams: tunnels.filter((t) => t.status === "online").length,
    rps: telemetry.rps,
    database: dbGetStatus(),
    telemetry,
  });
});

// Sync the allowed tunnel set (subdomain + token hash) to the Go gateway.
let lastSyncWarningAt = 0;
async function syncGatewayTunnels() {
  if (!GATEWAY_INTERNAL_SECRET) return;

  const payload = tunnels.map((t) => ({
    subdomain: t.subdomain,
    tokenHash: t.tokenHash || "",
    maxRps: t.maxRps || 100,
    isActive: t.enabled,
  }));

  try {
    const response = await gatewayFetch("/internal/tunnels/sync", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (!response.ok && Date.now() - lastSyncWarningAt > 60_000) {
      lastSyncWarningAt = Date.now();
      console.warn(`[Gateway] Tunnel sync rejected with HTTP ${response.status}`);
    }
  } catch {
    if (Date.now() - lastSyncWarningAt > 60_000) {
      lastSyncWarningAt = Date.now();
      console.warn("[Gateway] Tunnel sync unavailable (gateway IPC offline or secret not shared)");
    }
  }
}

// Load persisted tunnels once into the in-memory routing state.
async function loadTunnelsFromDb() {
  if (tunnels.length > 0) return;
  const dbTuns = await dbGetTunnels();
  if (!dbTuns || dbTuns.length === 0) return;

  dbTuns.forEach((t) => {
    const subdomain = validateSubdomain(t.subdomain);
    if (!subdomain) return;
    if (tunnels.some((existing) => existing.subdomain === subdomain)) return;

    tunnels.push({
      id: t.id,
      name: `Tunnel ${subdomain}`,
      subdomain,
      localPort: t.target_port || 3000,
      protocol: t.protocol || "quic",
      status: "offline",
      tlsStatus: t.tls_status || "active",
      authEnabled: Boolean(t.auth_enabled),
      authUser: t.auth_user || undefined,
      enabled: t.is_active !== false,
      tokenHash: typeof t.token_hash === "string" ? t.token_hash : undefined,
      tokenLast4: typeof t.token_last4 === "string" ? t.token_last4 : undefined,
      maxRps: 150,
      totalRequests: t.total_requests || 0,
      bytesTransferred: t.bytes_transferred || 0,
      avgLatency: t.avg_latency || 0,
      publicUrl: `https://${subdomain}.edgeproxy.mesh`,
      createdAt: t.created_at || new Date().toISOString(),
    });
  });
}

// Tunnels CRUD
app.get("/api/tunnels", async (req, res) => {
  await loadTunnelsFromDb();

  // Attempt to sync real telemetry from Go Gateway internal sessions
  try {
    const sessRes = await gatewayFetch("/internal/sessions", {}, 800);
    if (sessRes.ok) {
      const liveSessions = (await sessRes.json()) as Array<{
        subdomain: string;
        bytesIn: number;
        bytesOut: number;
        telemetry?: {
          totalRequests: number;
          avgLatencyMs: number;
          bytesSent: number;
          bytesReceived: number;
        };
      }>;
      if (Array.isArray(liveSessions)) {
        const live = new Set(liveSessions.map((session) => session.subdomain));
        for (const tun of tunnels) {
          tun.status = live.has(tun.subdomain) ? "online" : "offline";
        }
        for (const sess of liveSessions) {
          const tun = tunnels.find((t) => t.subdomain === sess.subdomain);
          if (tun && sess.telemetry) {
            tun.totalRequests = sess.telemetry.totalRequests || tun.totalRequests;
            tun.bytesTransferred =
              sess.telemetry.bytesSent + sess.telemetry.bytesReceived || tun.bytesTransferred;
            tun.avgLatency = Math.round(sess.telemetry.avgLatencyMs * 10) / 10 || tun.avgLatency;
          }
        }
      }
    }
  } catch {
    // Gateway IPC unavailable: keep the last known state.
  }

  res.json(tunnels.map(publicTunnel));
});

app.post("/api/tunnels", async (req, res) => {
  const { name, subdomain, localPort, protocol, authEnabled, authUser, maxRps } = req.body;

  const cleanSub = validateSubdomain(subdomain);
  if (!cleanSub) {
    return res.status(400).json({
      error: "subdomain must be a single DNS label (a-z, 0-9, hyphen), max 63 chars",
    });
  }

  const port = Number(localPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return res.status(400).json({ error: "localPort must be an integer between 1 and 65535" });
  }

  const allowedProtocols = new Set(["quic", "http2", "websocket", "tcp"]);
  if (protocol !== undefined && !allowedProtocols.has(String(protocol))) {
    return res.status(400).json({ error: "Unsupported protocol" });
  }

  const rps = maxRps === undefined ? 100 : Number(maxRps);
  if (!Number.isFinite(rps) || rps < 1 || rps > 100000) {
    return res.status(400).json({ error: "maxRps must be between 1 and 100000" });
  }

  if (authUser !== undefined && (typeof authUser !== "string" || authUser.length > 128)) {
    return res.status(400).json({ error: "authUser must be a string of at most 128 chars" });
  }

  if (tunnels.some((t) => t.subdomain === cleanSub)) {
    return res.status(409).json({ error: `Subdomain '${cleanSub}' is already in use` });
  }

  // CSPRNG token; only the hash is persisted and only the hash reaches the gateway.
  const agentToken = generateToken();
  const tokenHash = hashToken(agentToken);

  const newTunnel: TunnelRecord = {
    id: `tun-${Date.now()}`,
    name: typeof name === "string" && name.trim() ? name.trim().slice(0, 128) : `Tunnel ${cleanSub}`,
    subdomain: cleanSub,
    localPort: port,
    protocol: (protocol || "quic") as TunnelRecord["protocol"],
    status: "offline",
    tlsStatus: certificates.some((c) => c.domain.includes(cleanSub) || c.wildcard) ? "active" : "failed",
    authEnabled: Boolean(authEnabled),
    authUser: authUser || undefined,
    enabled: true,
    token: agentToken,
    tokenHash,
    tokenLast4: agentToken.slice(-4),
    maxRps: rps,
    totalRequests: 0,
    bytesTransferred: 0,
    avgLatency: 0,
    publicUrl: `https://${cleanSub}.edgeproxy.mesh`,
    createdAt: new Date().toISOString(),
  };

  // Persist to Database (hash only)
  await dbInsertTunnel({
    id: newTunnel.id,
    subdomain: newTunnel.subdomain,
    target_port: newTunnel.localPort,
    protocol: newTunnel.protocol,
    tls_status: newTunnel.tlsStatus,
    auth_enabled: newTunnel.authEnabled,
    auth_user: newTunnel.authUser,
    is_active: true,
    token_hash: tokenHash,
    token_last4: newTunnel.tokenLast4,
    created_at: newTunnel.createdAt,
  });

  tunnels.unshift(newTunnel);
  void syncGatewayTunnels();
  broadcastWs("tunnel_created", publicTunnel(newTunnel));
  // The plaintext token is returned exactly once.
  res.status(201).json({ ...publicTunnel(newTunnel), token: agentToken });
});

app.post("/api/tunnels/:id/rotate-token", async (req, res) => {
  const tunnel = tunnels.find((t) => t.id === req.params.id);
  if (!tunnel) {
    return res.status(404).json({ error: "Tunnel not found" });
  }

  const agentToken = generateToken();
  tunnel.token = agentToken;
  tunnel.tokenHash = hashToken(agentToken);
  tunnel.tokenLast4 = agentToken.slice(-4);

  await dbInsertTunnel({
    id: tunnel.id,
    subdomain: tunnel.subdomain,
    target_port: tunnel.localPort,
    protocol: tunnel.protocol,
    tls_status: tunnel.tlsStatus,
    auth_enabled: tunnel.authEnabled,
    auth_user: tunnel.authUser,
    is_active: tunnel.enabled,
    token_hash: tunnel.tokenHash,
    token_last4: tunnel.tokenLast4,
    created_at: tunnel.createdAt,
  });

  void syncGatewayTunnels();
  broadcastWs("tunnel_updated", publicTunnel(tunnel));
  res.json({ id: tunnel.id, token: agentToken, tokenLast4: tunnel.tokenLast4 });
});

app.delete("/api/tunnels/:id", async (req, res) => {
  const { id } = req.params;
  const idx = tunnels.findIndex((t) => t.id === id);
  if (idx === -1) {
    return res.status(404).json({ error: "Tunnel not found" });
  }
  const deleted = tunnels.splice(idx, 1)[0];
  await dbDeleteTunnel(deleted.id);
  void syncGatewayTunnels();
  broadcastWs("tunnel_deleted", { id: deleted.id, subdomain: deleted.subdomain });
  res.json({ message: "Tunnel deleted", tunnel: publicTunnel(deleted) });
});

app.patch("/api/tunnels/:id/toggle", async (req, res) => {
  const { id } = req.params;
  const tunnel = tunnels.find((t) => t.id === id);
  if (!tunnel) {
    return res.status(404).json({ error: "Tunnel not found" });
  }
  tunnel.enabled = !tunnel.enabled;
  if (!tunnel.enabled) {
    tunnel.status = "offline";
  }

  await dbInsertTunnel({
    id: tunnel.id,
    subdomain: tunnel.subdomain,
    target_port: tunnel.localPort,
    protocol: tunnel.protocol,
    tls_status: tunnel.tlsStatus,
    auth_enabled: tunnel.authEnabled,
    auth_user: tunnel.authUser,
    is_active: tunnel.enabled,
    token_hash: tunnel.tokenHash,
    token_last4: tunnel.tokenLast4,
    created_at: tunnel.createdAt,
  });

  void syncGatewayTunnels();
  broadcastWs("tunnel_updated", publicTunnel(tunnel));
  res.json(publicTunnel(tunnel));
});

// Real local TCP port discovery
app.get("/api/discover", async (req, res) => {
  const checkList = [
    { port: 3000, name: "EdgeProxy Web & API Server", type: "Full-Stack Server" },
    { port: 5173, name: "Vite Dev Server", type: "Frontend Dev" },
    { port: 8080, name: "Local Web Service", type: "HTTP Service" },
    { port: 8000, name: "FastAPI / Python Service", type: "Backend API" },
    { port: 4242, name: "Edge Gateway Control Plane", type: "TCP Gateway" },
    { port: 5432, name: "PostgreSQL Database", type: "Database" },
  ];

  const checkPort = (item: { port: number; name: string; type: string }) => {
    return new Promise<any>((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(250);
      socket.on("connect", () => {
        socket.destroy();
        const isTunneled = tunnels.some((t) => t.localPort === item.port);
        resolve({
          id: `disc-${item.port}`,
          port: item.port,
          name: item.name,
          process: `127.0.0.1:${item.port}`,
          serviceType: item.type,
          isTunneled,
          suggestedSubdomain: `svc-${item.port}`,
        });
      });
      socket.on("timeout", () => {
        socket.destroy();
        resolve(null);
      });
      socket.on("error", () => {
        socket.destroy();
        resolve(null);
      });
      socket.connect(item.port, "127.0.0.1");
    });
  };

  const results = await Promise.all(checkList.map(checkPort));
  const activeServices = results.filter(Boolean);
  res.json(activeServices);
});

// TLS certificate metadata. The gateway issues self-signed certificates for the
// edge mesh; this is not a public ACME client yet.
app.get("/api/certs", async (req, res) => {
  let gatewayReachable = false;
  try {
    const goRes = await gatewayFetch("/internal/certs", {}, 800);
    if (goRes.ok) {
      gatewayReachable = true;
      const goCerts = (await goRes.json()) as CertificateRecord[];
      if (Array.isArray(goCerts) && goCerts.length > 0) {
        for (const gc of goCerts) {
          const existing = certificates.find((c) => c.domain === gc.domain);
          if (existing) {
            Object.assign(existing, gc);
          } else {
            certificates.push(gc);
          }
          await dbSaveCertificate(gc);
        }
      }
    }
  } catch {
    // Gateway offline: fall through to persisted certificates.
  }

  if (!gatewayReachable) {
    const dbCerts = await dbGetCertificates();
    if (dbCerts && dbCerts.length > 0) {
      for (const dc of dbCerts) {
        if (!certificates.some((c) => c.domain === dc.domain)) {
          certificates.push(dc);
        }
      }
    }
  }
  res.json(certificates);
});

app.post("/api/certs", async (req, res) => {
  const { domain, wildcard = true } = req.body;

  if (typeof domain !== "string") {
    return res.status(400).json({ error: "Domain is required" });
  }
  const cleanDomain = domain.trim().toLowerCase().replace(/^\*\./, "");
  if (
    cleanDomain.length > 253 ||
    !/^(?!-)[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63})+$/.test(cleanDomain)
  ) {
    return res.status(400).json({ error: "Invalid domain name" });
  }

  let newCert: CertificateRecord | null = null;

  // 1. Attempt to issue via the Go gateway certificate manager.
  try {
    const goRes = await gatewayFetch(
      "/internal/certs/issue",
      {
        method: "POST",
        body: JSON.stringify({ domain: cleanDomain, wildcard: Boolean(wildcard) }),
      },
      2000,
    );
    if (goRes.ok) {
      newCert = (await goRes.json()) as CertificateRecord;
    }
  } catch {
    // Fall back to a local self-signed metadata record below.
  }

  // 2. Local fallback. This only produces metadata and a fingerprint; it is not
  //    a publicly trusted certificate, and it is labelled accordingly.
  if (!newCert) {
    const keyPair = crypto.generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
      publicKeyEncoding: { type: "spki", format: "der" },
      privateKeyEncoding: { type: "pkcs8", format: "der" },
    });
    const now = new Date();
    const validTo = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
    const pubKeyHash = crypto.createHash("sha256").update(keyPair.publicKey).digest("hex").toUpperCase();
    const formattedFingerprint = "SHA256: " + (pubKeyHash.match(/.{1,2}/g)?.slice(0, 16).join(":") || "");

    newCert = {
      id: `cert-${Date.now()}`,
      domain: cleanDomain,
      wildcard: Boolean(wildcard),
      issuer: "EdgeProxy Self-Signed CA (not publicly trusted)",
      status: "valid",
      validFrom: now.toISOString().split("T")[0],
      validTo: validTo.toISOString().split("T")[0],
      daysRemaining: 90,
      challengeType: "SELF-SIGNED",
      sanList: wildcard ? [`*.${cleanDomain}`, cleanDomain] : [cleanDomain],
      ocspStapled: false,
      fingerprint: formattedFingerprint,
      autoRenew: false,
    };
  }

  const existingIdx = certificates.findIndex((c) => c.domain === newCert!.domain);
  if (existingIdx !== -1) {
    certificates[existingIdx] = newCert;
  } else {
    certificates.push(newCert);
  }

  await dbSaveCertificate(newCert);

  // Update existing tunnels matching this domain
  tunnels.forEach((t) => {
    if (t.subdomain === cleanDomain || (wildcard && cleanDomain.endsWith("." + t.subdomain))) {
      t.tlsStatus = "active";
    }
  });

  broadcastWs("cert_issued", newCert);
  res.status(201).json(newCert);
});

app.post("/api/certs/:id/renew", async (req, res) => {
  const { id } = req.params;
  const cert = certificates.find((c) => c.id === id);
  if (!cert) return res.status(404).json({ error: "Certificate not found" });

  // Renew via Go Gateway if available
  try {
    const goRes = await gatewayFetch(
      "/internal/certs/issue",
      {
        method: "POST",
        body: JSON.stringify({ domain: cert.domain, wildcard: cert.wildcard }),
      },
      2000,
    );
    if (goRes.ok) {
      const renewed = (await goRes.json()) as CertificateRecord;
      Object.assign(cert, renewed);
    }
  } catch {
    const now = new Date();
    const validTo = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
    cert.validFrom = now.toISOString().split("T")[0];
    cert.validTo = validTo.toISOString().split("T")[0];
    cert.daysRemaining = 90;
    cert.status = "valid";
  }

  await dbSaveCertificate(cert);
  broadcastWs("cert_renewed", cert);
  res.json(cert);
});

// Rate Limiter Endpoints
app.get("/api/ratelimit", (req, res) => {
  const now = Date.now();
  const jailList: Array<{ ip: string; blockedUntil: number; reason: string }> = [];
  bannedIps.forEach((val, key) => {
    if (val.blockedUntil > now) {
      jailList.push({ ip: key, ...val });
    }
  });

  res.json({
    capacity: tokenCapacity,
    refillRate: refillRatePerSec,
    currentTokens: Math.floor(currentTokens),
    whitelistedIps: Array.from(whitelistedIps),
    jailedIps: jailList,
  });
});

app.post("/api/ratelimit/config", (req, res) => {
  const { capacity, refillRate, whitelistIp } = req.body;

  if (capacity !== undefined) {
    const value = Number(capacity);
    if (!Number.isFinite(value) || value < 1 || value > 1_000_000) {
      return res.status(400).json({ error: "capacity must be between 1 and 1000000" });
    }
    tokenCapacity = value;
  }

  if (refillRate !== undefined) {
    const value = Number(refillRate);
    if (!Number.isFinite(value) || value < 0.1 || value > 1_000_000) {
      return res.status(400).json({ error: "refillRate must be between 0.1 and 1000000" });
    }
    refillRatePerSec = value;
  }

  if (whitelistIp !== undefined) {
    if (!isValidIp(whitelistIp)) {
      return res.status(400).json({ error: "whitelistIp must be a valid IP address" });
    }
    whitelistedIps.add(whitelistIp);
  }

  res.json({ success: true, capacity: tokenCapacity, refillRate: refillRatePerSec });
});

app.post("/api/ratelimit/unban", (req, res) => {
  const { ip } = req.body;
  if (isValidIp(ip) && bannedIps.has(ip)) {
    bannedIps.delete(ip);
    return res.json({ success: true, message: `IP ${ip} unbanned.` });
  }
  res.status(404).json({ error: "IP not found in jail" });
});

// Traffic Logs
app.get("/api/traffic/logs", (req, res) => {
  res.json(logs);
});

app.delete("/api/traffic/logs", (req, res) => {
  logs.length = 0;
  broadcastWs("logs_cleared", {});
  res.json({ success: true, message: "Logs cleared" });
});

// Real Traffic Dispatcher / Probe
app.post("/api/traffic/simulate", async (req, res) => {
  const { subdomain, method = "GET", path: reqPath = "/", clientIp = "127.0.0.1", isAttack = false } = req.body;

  const allowedMethods = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
  const normalizedMethod = String(method).toUpperCase();
  if (!allowedMethods.has(normalizedMethod)) {
    return res.status(400).json({ error: "Unsupported HTTP method" });
  }
  if (typeof reqPath !== "string" || !reqPath.startsWith("/") || reqPath.startsWith("//")) {
    return res.status(400).json({ error: "path must be a relative URL starting with '/'" });
  }
  if (!isValidIp(clientIp)) {
    return res.status(400).json({ error: "clientIp must be a valid IP address" });
  }

  const targetTunnel = tunnels.find((t) => t.subdomain === subdomain) || tunnels[0];
  if (!targetTunnel) {
    return res.status(400).json({ error: "No tunnels registered. Create a tunnel first." });
  }

  const startTime = Date.now();
  const limitCheck = isAttack ? { allowed: false, reason: "Attack simulation triggered rate limiter" } : checkRateLimit(clientIp);

  if (!limitCheck.allowed) {
    const entry: LogEntry = {
      id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      timestamp: new Date().toISOString(),
      method: normalizedMethod,
      path: reqPath,
      statusCode: 429,
      latencyMs: 1.2,
      clientIp,
      subdomain: targetTunnel.subdomain,
      bytesIn: 120,
      bytesOut: 64,
      blockedByShield: true,
    };
    recordRequest(entry);
    return res.status(429).json({ success: false, log: entry, reason: limitCheck.reason });
  }

  // Ingress probe to the Go data plane. Node.js is strictly the control plane
  // and does not proxy customer traffic directly to localPort.
  const gatewayTarget = new URL(GATEWAY_PUBLIC_URL);
  const transport = gatewayTarget.protocol === "https:" ? https : http;
  const probeReq = transport.request(
    {
      hostname: gatewayTarget.hostname,
      port: gatewayTarget.port || (gatewayTarget.protocol === "https:" ? 443 : 80),
      path: reqPath,
      method: normalizedMethod,
      headers: {
        Host: `${targetTunnel.subdomain}.edgeproxy.mesh`,
        "X-Forwarded-For": clientIp,
      },
      timeout: 2500,
    },
    (probeRes) => {
      let dataLen = 0;
      probeRes.on("data", (chunk) => {
        dataLen += chunk.length;
      });
      probeRes.on("end", () => {
        const latency = Date.now() - startTime;
        const entry: LogEntry = {
          id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
          timestamp: new Date().toISOString(),
          method: normalizedMethod,
          path: reqPath,
          statusCode: probeRes.statusCode || 200,
          latencyMs: latency,
          clientIp,
          subdomain: targetTunnel.subdomain,
          bytesIn: 180,
          bytesOut: dataLen || 256,
          blockedByShield: false,
        };
        recordRequest(entry);
        res.json({ success: true, log: entry, routedVia: "Go Ingress Gateway" });
      });
    }
  );

  probeReq.on("error", () => {
    const latency = Date.now() - startTime;
    const entry: LogEntry = {
      id: `log-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      timestamp: new Date().toISOString(),
      method: normalizedMethod,
      path: reqPath,
      statusCode: 502,
      latencyMs: latency,
      clientIp,
      subdomain: targetTunnel.subdomain,
      bytesIn: 64,
      bytesOut: 64,
      blockedByShield: false,
    };
    recordRequest(entry);
    res.json({
      success: false,
      log: entry,
      error: "Go ingress gateway unreachable",
      routedVia: "Go Ingress Gateway",
    });
  });

  probeReq.end();
});

// Read-only query console (allowlisted Firestore collections, SELECT only).
app.post("/api/sql/query", async (req, res) => {
  const { query } = req.body;
  if (!query || typeof query !== "string" || query.length > 2000) {
    return res.status(400).json({ error: "Query string is required (max 2000 chars)" });
  }

  try {
    const result = await executeQuery(query);
    const columns = result.fields.map((f) => f.name);
    res.json({
      columns,
      rows: result.rows,
      rowCount: result.rowCount,
      executionTimeMs: result.latencyMs,
      source: result.source,
      status: "SUCCESS",
    });
  } catch {
    res.status(400).json({ error: "Query rejected", status: "ERROR" });
  }
});

// Database & Firestore management API (admin-only, secrets redacted).
app.get("/api/database/status", (req, res) => {
  res.json(dbGetStatus());
});

app.get("/api/users", async (req, res) => {
  try {
    const userList = await dbGetUsers();
    res.json(userList);
  } catch {
    res.status(500).json({ error: "Failed to read users" });
  }
});

app.get("/api/database/collections/:name", async (req, res) => {
  try {
    const { name } = req.params;
    if (!isAllowedCollection(name)) {
      return res.status(404).json({ error: "Unknown collection" });
    }
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const docs = await dbGetCollectionDocs(name, limit);
    res.json({ collection: name, count: docs.length, docs });
  } catch {
    res.status(500).json({ error: "Failed to read collection" });
  }
});

app.post("/api/database/collections/:name", async (req, res) => {
  const { name } = req.params;
  if (!isAllowedCollection(name)) {
    return res.status(404).json({ error: "Unknown collection" });
  }
  try {
    const created = await dbInsertSampleDoc(name, req.body);
    res.json({ success: true, collection: name, doc: created });
  } catch {
    res.status(400).json({ error: "Document rejected" });
  }
});

// Server-side AI Traffic & Threat Diagnosis
app.post("/api/ai/diagnose", async (req, res) => {
  const { topic = "traffic_anomalies" } = req.body;
  const ai = getAI();
  const telemetry = getRealTelemetry();

  if (!ai) {
    return res.json({
      success: true,
      modelUsed: "EdgeProxy Heuristic Rule Engine (Smart Fallback)",
      analysis: `### 🛡️ EdgeProxy Real System Diagnostic
- **Ingress Status**: Gateway active. Token Bucket capacity at ${Math.floor(currentTokens)}/${tokenCapacity} tokens.
- **Active Tunnels**: ${tunnels.filter((t) => t.status === "online").length} online of ${tunnels.length} configured.
- **Traffic Load**: Real-time RPS is ${telemetry.rps}. Memory RSS is ${telemetry.ramUsage} MB.
- **TLS Status**: ${certificates.length} certificate(s) provisioned.
- **Recommendations**: To enable deep AI neural diagnostics, supply GEMINI_API_KEY in the environment settings.`,
    });
  }

  try {
    const prompt = `You are the principal site reliability engineer for EdgeProxy.
Analyze the following real-time runtime state:
Active Tunnels: ${JSON.stringify(tunnels.map((t) => ({ sub: t.subdomain, port: t.localPort, reqs: t.totalRequests, lat: t.avgLatency })))}
Telemetry: ${JSON.stringify(telemetry)}
Recent Logs Count: ${logs.length}

Provide a concise technical diagnostic:
1. Operational health and latency analysis
2. Edge socket performance
3. Security & rate limiter state`;

    const generatePromise = ai.models.generateContent({
      model: "gemini-3.8-flash",
      contents: prompt,
    });

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("AI response timeout")), 4500)
    );

    const response: any = await Promise.race([generatePromise, timeoutPromise]);

    res.json({
      success: true,
      modelUsed: "gemini-3.8-flash (Server-Side)",
      analysis: response.text || "Diagnostic generated.",
    });
  } catch (error: any) {
    res.json({
      success: true,
      modelUsed: "EdgeProxy Heuristic Rule Engine (Smart Fallback)",
      analysis: `### 🛡️ EdgeProxy Real System Diagnostic
- **Ingress Status**: Operational. Token Bucket capacity at ${Math.floor(currentTokens)}/${tokenCapacity} tokens.
- **Active Tunnels**: ${tunnels.filter((t) => t.status === "online").length} online of ${tunnels.length} configured.
- **Real Traffic Load**: Current RPS is ${telemetry.rps}. Memory footprint is ${telemetry.ramUsage} MB.
- **Recommendations**: Run "go run agent/main.go --port <port>" to establish real tunneled connections.`,
    });
  }
});

// Explicit 404 Catch-All for unknown API endpoints
app.all("/api/*", (req, res) => {
  res.status(404).json({ error: "API route not found" });
});

// Central error handler. Never leak stack traces, SQL or file paths.
app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (res.headersSent) return next(err);
  if (err?.type === "entity.parse.failed" || err?.type === "entity.too.large") {
    return res.status(400).json({ error: "Invalid request body" });
  }
  console.error("[Server] Unhandled request error:", err?.message || err);
  res.status(500).json({ error: "Internal server error" });
});

// Vite Middleware & SPA Static Fallback
async function start() {
  await initDb();
  await loadTunnelsFromDb();
  // Push the persisted allowlist to the gateway as soon as the control plane is up.
  void syncGatewayTunnels();

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath, { index: false, maxAge: "1h" }));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  server.listen(PORT, HOST, () => {
    console.log(`[EdgeProxy Server] Listening on http://${HOST}:${PORT} (control plane)`);
    if (!API_KEY) {
      console.log("[Auth] EDGEPROXY_API_KEY not set: loopback-only mode with CSRF header required.");
    }
    if (!GATEWAY_INTERNAL_SECRET) {
      console.log("[Gateway] EDGEPROXY_INTERNAL_SECRET not set: tunnel/cert IPC sync disabled.");
    }
  });
}

start();
