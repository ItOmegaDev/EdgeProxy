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
