.PHONY: all build build-gateway build-agent build-dashboard test clean run-gateway run-agent docker-build

SHELL := /bin/bash
BIN_DIR := bin

all: build

build: build-gateway build-agent build-dashboard

build-gateway:
	@echo "==> Compiling EdgeProxy Gateway (Go high-load binary)..."
	@mkdir -p $(BIN_DIR)
	cd gateway && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o ../$(BIN_DIR)/edgeproxy-gateway .
	@echo "    Compiled: $(BIN_DIR)/edgeproxy-gateway"

build-agent:
	@echo "==> Compiling EdgeProxy Local Agent (CLI binary)..."
	@mkdir -p $(BIN_DIR)
	cd agent && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o ../$(BIN_DIR)/edgeproxy-agent .
	@echo "    Compiled: $(BIN_DIR)/edgeproxy-agent"

build-dashboard:
	@echo "==> Building Web Control Plane & Telemetry Dashboard..."
	npm run build

test:
	@echo "==> Running Go unit tests..."
	cd gateway && go test -v ./...
	cd agent && go test -v ./...
	@echo "==> Linting TypeScript Dashboard..."
	npm run lint

run-gateway:
	./$(BIN_DIR)/edgeproxy-gateway -http-port 8080 -tls-port 8443 -tunnel-port 4242 -domain edgeproxy.mesh

run-agent:
	./$(BIN_DIR)/edgeproxy-agent -gateway 127.0.0.1:4242 -port 3000 -subdomain demo

docker-build:
	docker compose build

clean:
	rm -rf $(BIN_DIR) dist/
