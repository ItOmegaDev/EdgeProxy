# EdgeProxy Local Agent (Go CLI)

Lightweight standalone CLI client providing NAT traversal, local port auto-discovery, and multiplexed bi-directional stream forwarding.

## Usage
```bash
# Build standalone static binary
cd agent
go build -o edgeproxy-agent main.go

# Expose local port 3000 under subdomain 'myapp'
./edgeproxy-agent --port=3000 --subdomain=myapp --gateway=gateway.edgeproxy.mesh:4242

# Auto-discover local active development servers
./edgeproxy-agent --auto
```
