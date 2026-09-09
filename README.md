# EdgeProxy & Traffic Mesh

High-Performance Edge Reverse Proxy, Binary Multiplexing Tunnel & DDoS Shield.

---

## 🏗️ Repository Architecture

EdgeProxy follows a clean separation of concerns between high-throughput networking, agent tunneling, and control plane management:

```
├── gateway/                 # [Go 1.22] Edge Ingress Gateway (High-Load Proxy Core)
│   ├── acme/                # Automated Let's Encrypt ACME v2 TLS manager
│   ├── limiter/             # Lock-free Token Bucket Rate Limiter with Auto-Jail
│   ├── protocol/            # Binary Framed Multiplexer (SYN, DATA, FIN, PING)
│   ├── proxy/               # Host header routing & bidirectional stream demux
│   ├── main.go              # Gateway binary entry point (:80, :443, :4242)
│   └── go.mod               # Go module definition for Gateway
│
├── agent/                   # [Go 1.22] Local CLI Agent (`edgeproxy-agent`)
│   ├── client/              # TCP Tunnel Client connecting to Gateway wire
│   ├── demux/               # Local port listener, auto-discovery & reverse forwarder
│   ├── main.go              # Agent CLI entry point (`-port 3000 -subdomain api`)
│   └── go.mod               # Go module definition for Agent
│
├── db/                      # [PostgreSQL] Database Schema & Migrations
│   ├── 01_schema.sql        # Tables: users, tunnels, traffic_logs
│   ├── 02_indexes.sql       # B-Tree, BRIN & composite indexes for high RPS
│   └── 03_seed.sql          # Bootstrap seed data
│
├── server.ts                # [Node.js / Express] Web Gateway Control Plane & REST/WS API
├── src/                     # [React 19 / Tailwind CSS] Real-Time Management Dashboard
├── go.work                  # Multi-module Go workspace
├── Makefile                 # Unified build & test commands
└── docker-compose.yml       # Production container orchestration
```

---

## 🔀 Data Flow & Separation of Planes

EdgeProxy strictly separates high-performance network data ingestion from configuration and telemetry management:

```
[Internet Users] 
      │  (Public HTTP:80 / HTTPS:443)
      ▼
┌────────────────────────────────────────────────────────┐
│  DATA PLANE: Go Edge Gateway (gateway/main.go)         │
│  - Zero-copy TCP / TLS termination                     │
│  - In-memory Host Header routing                       │
│  - Token Bucket Rate Limiting & DDoS Shield            │
│  - Binary Multiplexing Wire Protocol (TCP :4242)       │
└──────────────────────────┬─────────────────────────────┘
                           │ (Binary Framed Multiplexing: SYN/DATA/FIN)
                           ▼
┌────────────────────────────────────────────────────────┐
│  LOCAL AGENT: Go CLI Client (agent/main.go)            │
│  - Authenticated tunnel session (-token <token>)       │
│  - Demultiplexes frames to local ports (e.g. :3000)    │
│  - Reverse-forwards traffic to local dev service       │
└────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────┐
│  CONTROL PLANE: Node.js / React (server.ts & src/)     │
│  - Runs on port 3000 (isolated from edge data plane)   │
│  - Exposes REST API & WebSockets for real-time graphs  │
│  - Manages tunnel configs, certificates, & IP lists    │
│  - NEVER proxies edge customer traffic in production   │
└────────────────────────────────────────────────────────┘
```

- **Data Plane (Go Ingress)**: All incoming edge web traffic (`*.edgeproxy.mesh`) is terminated directly on the Go Edge Gateway (`gateway/main.go`) on port 80/443 and streamed over TCP port 4242 directly to the Go CLI agent via framed binary packets. Node.js never touches this high-throughput stream.
- **Control Plane (Node.js/React)**: `server.ts` provides the operational API, telemetry aggregation, rate-limit policies, and web UI.
- **Database Persistence**: Production state is backed by PostgreSQL schemas defined in `db/01_schema.sql` (partitioned traffic logs, B-tree/BRIN indexes in `db/02_indexes.sql`). For lightweight local prototyping, `server.ts` maintains an in-memory active cache that streams real-time updates over WebSocket.

---

## ⚡ Quick Start

### 1. Build Binaries (Go & Web Dashboard)
Using the unified Makefile:
```bash
# Build Go Gateway, Go Agent, and Web Dashboard
make build

# Binaries produced in ./bin/
# - bin/edgeproxy-gateway
# - bin/edgeproxy-agent
```

### 2. Run Edge Gateway (Go)
```bash
./bin/edgeproxy-gateway -http-port 8080 -tls-port 8443 -tunnel-port 4242 -domain edgeproxy.mesh
```

### 3. Expose a Local Service with the CLI Agent (Go)
```bash
./bin/edgeproxy-agent -gateway 127.0.0.1:4242 -port 3000 -subdomain demo
```

### 4. Start the Web Control Plane & Dashboard
```bash
npm install
npm run dev
# Dashboard accessible at http://localhost:3000
```

---

## 🛡️ Security & Zero-Leak Guarantee

- **No Client-Side API Keys**: Any optional AI telemetry analysis runs strictly on the Node.js backend (`/api/ai/diagnose` in `server.ts`) via server-side environment variables (`GEMINI_API_KEY`). The frontend receives only sanitised JSON diagnostics.
- **Graceful Fallback**: If no AI key is configured, the system operates seamlessly using built-in deterministic heuristic rule evaluation.
- **DDoS & Flood Protection**: Gateway enforces sub-millisecond atomic token bucket rate limiting with automatic IP jail for malicious floods.
