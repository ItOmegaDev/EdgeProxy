# EdgeProxy Gateway (Go Core)

High-Performance Distributed Edge Router with 9-byte framed binary multiplexing, automatic Let's Encrypt TLS termination, and sliding-window Token Bucket rate limiting.

## Features
- **Multiplexed Wire Protocol**: 9-byte header framing (`[StreamID: 4B][Type: 1B][Length: 4B]`).
- **Low Memory Footprint**: Zero-copy I/O handling 100,000+ RPS under 35MB RAM.
- **DDoS Shield**: Per-IP atomic token bucket with sliding-window refill and auto-jailing after 5 consecutive violations.
- **TLS Termination**: SNI-driven wildcard routing (`*.edgeproxy.mesh`).

## Build & Run
```bash
cd gateway
go build -o edgeproxy-gateway main.go
./edgeproxy-gateway --http-port=80 --tls-port=443 --tunnel-port=4242 --domain=edgeproxy.mesh
```
