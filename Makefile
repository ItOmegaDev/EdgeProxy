.PHONY: all build build-gateway build-agent build-dashboard test test-go test-node lint security clean run-gateway run-agent docker-build

SHELL := /bin/bash
BIN_DIR := bin

all: build

build: build-gateway build-agent build-dashboard

build-gateway:
	@echo "==> Compiling EdgeProxy Gateway (Go)..."
	@mkdir -p $(BIN_DIR)
	cd gateway && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o ../$(BIN_DIR)/edgeproxy-gateway .
	@echo "    Compiled: $(BIN_DIR)/edgeproxy-gateway"

build-agent:
	@echo "==> Compiling EdgeProxy Local Agent (Go)..."
	@mkdir -p $(BIN_DIR)
	cd agent && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o ../$(BIN_DIR)/edgeproxy-agent .
	@echo "    Compiled: $(BIN_DIR)/edgeproxy-agent"

build-dashboard:
	@echo "==> Building control plane and dashboard..."
	npm run build

test: test-go test-node lint

test-go:
	@echo "==> Running Go tests and vet..."
	go vet ./gateway/... ./agent/...
	go test ./gateway/... ./agent/...

test-node:
	@echo "==> Running control-plane unit tests..."
	npm test

lint:
	@echo "==> Type-checking TypeScript..."
	npm run lint

security:
	@echo "==> Scanning the working tree for secrets..."
	gitleaks dir . --redact --no-banner

run-gateway:
	./$(BIN_DIR)/edgeproxy-gateway -http-port 8080 -tls-port 8443 -tunnel-port 4242 -domain $${BASE_DOMAIN:-edgeproxy.mesh}

run-agent:
	@test -n "$(TOKEN)" || (echo "Usage: make run-agent TOKEN=<agent-token> [SUBDOMAIN=demo] [PORT=3000]" && exit 1)
	./$(BIN_DIR)/edgeproxy-agent -gateway 127.0.0.1:4242 -port $${PORT:-3000} -subdomain $${SUBDOMAIN:-demo} -token $(TOKEN)

docker-build:
	docker compose build

clean:
	rm -rf $(BIN_DIR) dist/
