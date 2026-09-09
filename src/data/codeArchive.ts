export const REFERENCE_CODE_ARCHIVE: Record<string, string> = {
  'gateway/main.go': `package main

import (
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"time"

	"edgeproxy/gateway/limiter"
	"edgeproxy/gateway/protocol"
	"edgeproxy/gateway/proxy"
)

func main() {
	httpPort := flag.Int("http-port", 80, "Public HTTP ingress port")
	tunnelPort := flag.Int("tunnel-port", 4242, "Multiplexed TCP tunnel wire for CLI agents")
	baseDomain := flag.String("domain", "edgeproxy.mesh", "Root domain for wildcard subdomains")
	flag.Parse()

	rateLimiter := limiter.NewRateLimiterStore(150, 100)
	router := proxy.NewRouter(*baseDomain, rateLimiter)

	// Listen for CLI agents on dedicated TCP port :4242
	go func() {
		l, err := net.Listen("tcp", fmt.Sprintf("0.0.0.0:%d", *tunnelPort))
		if err != nil {
			log.Fatalf("Failed to bind TCP wire port %d: %v", *tunnelPort, err)
		}
		for {
			conn, err := l.Accept()
			if err != nil {
				continue
			}
			go handleAgentConnection(conn, router)
		}
	}()

	// Public HTTP ingress listener
	srv := &http.Server{
		Addr:         fmt.Sprintf("0.0.0.0:%d", *httpPort),
		Handler:      router,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 30 * time.Second,
	}
	log.Fatal(srv.ListenAndServe())
}

func handleAgentConnection(conn net.Conn, router *proxy.Router) {
	frame, err := protocol.ReadFrame(conn)
	if err != nil || frame.Type != protocol.FrameSyn {
		conn.Close()
		return
	}
	subdomain := string(frame.Payload)
	session := router.RegisterSession(subdomain, conn)
	defer router.UnregisterSession(subdomain)

	for {
		f, err := protocol.ReadFrame(conn)
		if err != nil {
			break
		}
		session.StreamsMu.RLock()
		ch, exists := session.Streams[f.StreamID]
		session.StreamsMu.RUnlock()

		if exists && ch != nil {
			if f.Type == protocol.FrameFin {
				session.StreamsMu.Lock()
				delete(session.Streams, f.StreamID)
				session.StreamsMu.Unlock()
				select {
				case ch <- f.Payload:
				default:
				}
				close(ch)
			} else {
				select {
				case ch <- f.Payload:
				case <-time.After(300 * time.Millisecond):
					log.Printf("[BACKPRESSURE] Frame dropped on stream %d", f.StreamID)
				}
			}
		}
	}
}`,

  'gateway/proxy/router.go': `package proxy

import (
	"bufio"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"edgeproxy/gateway/limiter"
	"edgeproxy/gateway/protocol"
)

type AgentSession struct {
	ID         string
	Subdomain  string
	Conn       net.Conn
	Streams    map[uint32]chan []byte
	StreamsMu  sync.RWMutex
	NextStream uint32
	WriterLock sync.Mutex
}

type Router struct {
	baseDomain  string
	sessions    map[string]*AgentSession
	sessionsMu  sync.RWMutex
	rateLimiter *limiter.RateLimiterStore
}

func NewRouter(baseDomain string, rl *limiter.RateLimiterStore) *Router {
	return &Router{
		baseDomain:  baseDomain,
		sessions:    make(map[string]*AgentSession),
		rateLimiter: rl,
	}
}

func (r *Router) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	clientIP, _, _ := net.SplitHostPort(req.RemoteAddr)
	if !r.rateLimiter.Check(clientIP) {
		http.Error(w, "429 Too Many Requests - EdgeProxy Shield", http.StatusTooManyRequests)
		return
	}

	host := strings.ToLower(strings.Split(req.Host, ":")[0])
	subdomain := strings.TrimSuffix(host, "."+r.baseDomain)

	r.sessionsMu.RLock()
	session, exists := r.sessions[subdomain]
	r.sessionsMu.RUnlock()

	if !exists {
		http.Error(w, fmt.Sprintf("502 Bad Gateway: Tunnel '%s' is offline", subdomain), http.StatusBadGateway)
		return
	}

	streamID := atomic.AddUint32(&session.NextStream, 1)
	respChan := make(chan []byte, 128)

	session.StreamsMu.Lock()
	session.Streams[streamID] = respChan
	session.StreamsMu.Unlock()

	defer func() {
		session.StreamsMu.Lock()
		delete(session.Streams, streamID)
		session.StreamsMu.Unlock()
	}()

	synFrame := &protocol.Frame{
		StreamID: streamID,
		Type:     protocol.FrameSyn,
		Payload:  []byte(fmt.Sprintf("%s %s %s\\r\\nHost: %s\\r\\n\\r\\n", req.Method, req.URL.RequestURI(), req.Proto, req.Host)),
	}

	session.WriterLock.Lock()
	session.Conn.Write(synFrame.Encode())
	session.WriterLock.Unlock()

	select {
	case payload := <-respChan:
		respReader := bufio.NewReader(strings.NewReader(string(payload)))
		parsedResp, err := http.ReadResponse(respReader, req)
		if err != nil {
			http.Error(w, "502 Bad Gateway from local agent", http.StatusBadGateway)
			return
		}
		for k, vv := range parsedResp.Header {
			for _, v := range vv {
				w.Header().Add(k, v)
			}
		}
		w.WriteHeader(parsedResp.StatusCode)
		io.Copy(w, parsedResp.Body)
	case <-time.After(10 * time.Second):
		http.Error(w, "504 Gateway Timeout: Agent response timed out", http.StatusGatewayTimeout)
	}
}`,

  'gateway/protocol/framing.go': `package protocol

import (
	"encoding/binary"
	"fmt"
	"io"
)

const HeaderSize = 9

const (
	FrameSyn  byte = 0x01 // New Stream
	FrameData byte = 0x02 // Data chunk
	FrameFin  byte = 0x03 // Stream closed
	FramePing byte = 0x04 // Keep-alive heartbeat
	FramePong byte = 0x05 // Keep-alive response
)

type Frame struct {
	StreamID uint32
	Type     byte
	Length   uint32
	Payload  []byte
}

func (f *Frame) Encode() []byte {
	buf := make([]byte, HeaderSize+len(f.Payload))
	binary.BigEndian.PutUint32(buf[0:4], f.StreamID)
	buf[4] = f.Type
	binary.BigEndian.PutUint32(buf[5:9], uint32(len(f.Payload)))
	copy(buf[9:], f.Payload)
	return buf
}

func ReadFrame(r io.Reader) (*Frame, error) {
	header := make([]byte, HeaderSize)
	if _, err := io.ReadFull(r, header); err != nil {
		return nil, err
	}
	f := &Frame{
		StreamID: binary.BigEndian.Uint32(header[0:4]),
		Type:     header[4],
		Length:   binary.BigEndian.Uint32(header[5:9]),
	}
	if f.Length > 65536 {
		return nil, fmt.Errorf("frame size %d exceeds 64KB safety limit", f.Length)
	}
	if f.Length > 0 {
		f.Payload = make([]byte, f.Length)
		if _, err := io.ReadFull(r, f.Payload); err != nil {
			return nil, err
		}
	}
	return f, nil
}`,

  'gateway/limiter/bucket.go': `package limiter

import (
	"sync"
	"time"
)

type TokenBucket struct {
	capacity     float64
	refillRate   float64
	tokens       float64
	lastRefilled time.Time
	mu           sync.Mutex
}

func NewTokenBucket(capacity, refillRate float64) *TokenBucket {
	return &TokenBucket{
		capacity:     capacity,
		refillRate:   refillRate,
		tokens:       capacity,
		lastRefilled: time.Now(),
	}
}

func (tb *TokenBucket) Allow() bool {
	tb.mu.Lock()
	defer tb.mu.Unlock()

	now := time.Now()
	elapsed := now.Sub(tb.lastRefilled).Seconds()
	tb.tokens = tb.tokens + elapsed*tb.refillRate
	if tb.tokens > tb.capacity {
		tb.tokens = tb.capacity
	}
	tb.lastRefilled = now

	if tb.tokens >= 1.0 {
		tb.tokens -= 1.0
		return true
	}
	return false
}

type RateLimiterStore struct {
	buckets    map[string]*TokenBucket
	violations map[string]int
	jailed     map[string]time.Time
	mu         sync.RWMutex
	capacity   float64
	refillRate float64
}

func NewRateLimiterStore(capacity, refillRate float64) *RateLimiterStore {
	return &RateLimiterStore{
		buckets:    make(map[string]*TokenBucket),
		violations: make(map[string]int),
		jailed:     make(map[string]time.Time),
		capacity:   capacity,
		refillRate: refillRate,
	}
}

func (s *RateLimiterStore) Check(ip string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()

	if jailUntil, ok := s.jailed[ip]; ok {
		if time.Now().Before(jailUntil) {
			return false
		}
		delete(s.jailed, ip)
		delete(s.violations, ip)
	}

	bucket, exists := s.buckets[ip]
	if !exists {
		bucket = NewTokenBucket(s.capacity, s.refillRate)
		s.buckets[ip] = bucket
	}

	if !bucket.Allow() {
		s.violations[ip]++
		if s.violations[ip] >= 10 {
			s.jailed[ip] = time.Now().Add(5 * time.Minute)
		}
		return false
	}
	return true
}`,

  'agent/main.go': `package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"edgeproxy/agent/client"
	"edgeproxy/agent/demux"
)

func main() {
	gatewayAddr := flag.String("gateway", "gateway.edgeproxy.mesh:4242", "Edge Gateway TCP wire address")
	subdomain := flag.String("subdomain", "", "Requested custom subdomain")
	port := flag.Int("port", 3000, "Target local port to expose")
	token := flag.String("token", "", "EdgeProxy auth token (required, or set EDGEPROXY_AUTH_TOKEN)")
	flag.Parse()

	authToken := *token
	if authToken == "" {
		authToken = os.Getenv("EDGEPROXY_AUTH_TOKEN")
	}
	if authToken == "" {
		log.Fatal("[FATAL] Missing required auth token. Pass -token <token> or set EDGEPROXY_AUTH_TOKEN.")
	}

	if *subdomain == "" {
		*subdomain = fmt.Sprintf("dev-%d", time.Now().Unix()%10000)
	}

	if !demux.IsPortOpen(*port) {
		log.Fatalf("Target port %d is not responding on 127.0.0.1", *port)
	}

	agent := client.NewTunnelClient(*gatewayAddr, *subdomain, *port, authToken)
	go agent.Start()

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)
	<-sigChan
	agent.Stop()
}`,

  'agent/client/tunnel.go': `package client

import (
	"fmt"
	"log"
	"net"
	"sync"
	"time"

	"edgeproxy/gateway/protocol"
)

type TunnelClient struct {
	gatewayAddr string
	subdomain   string
	localPort   int
	token       string
	conn        net.Conn
	mu          sync.Mutex
	running     bool
}

func NewTunnelClient(gatewayAddr, subdomain string, localPort int, token string) *TunnelClient {
	return &TunnelClient{
		gatewayAddr: gatewayAddr,
		subdomain:   subdomain,
		localPort:   localPort,
		token:       token,
		running:     true,
	}
}

func (tc *TunnelClient) Start() {
	for tc.running {
		conn, err := net.Dial("tcp", tc.gatewayAddr)
		if err != nil {
			time.Sleep(3 * time.Second)
			continue
		}
		tc.conn = conn

		// Handshake
		syn := &protocol.Frame{
			StreamID: 0,
			Type:     protocol.FrameSyn,
			Payload:  []byte(tc.subdomain),
		}
		conn.Write(syn.Encode())

		// Read multiplexed frames from gateway and forward to local port
		for tc.running {
			frame, err := protocol.ReadFrame(conn)
			if err != nil {
				break
			}
			go tc.handleVirtualStream(frame)
		}
	}
}

func (tc *TunnelClient) handleVirtualStream(f *protocol.Frame) {
	localConn, err := net.Dial("tcp", fmt.Sprintf("127.0.0.1:%d", tc.localPort))
	if err != nil {
		return
	}
	defer localConn.Close()

	localConn.Write(f.Payload)
	buf := make([]byte, 16384)
	n, _ := localConn.Read(buf)

	respFrame := &protocol.Frame{
		StreamID: f.StreamID,
		Type:     protocol.FrameData,
		Payload:  buf[:n],
	}
	tc.mu.Lock()
	tc.conn.Write(respFrame.Encode())
	tc.mu.Unlock()
}

func (tc *TunnelClient) Stop() {
	tc.running = false
	if tc.conn != nil {
		tc.conn.Close()
	}
}`,

  'agent/demux/demuxer.go': `package demux

import (
	"fmt"
	"net"
	"time"
)

func IsPortOpen(port int) bool {
	conn, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", port), 300*time.Millisecond)
	if err != nil {
		return false
	}
	conn.Close()
	return true
}

func DiscoverActivePorts() []int {
	common := []int{3000, 5173, 8000, 8080, 4200, 8888, 9000}
	var active []int
	for _, p := range common {
		if IsPortOpen(p) {
			active = append(active, p)
		}
	}
	return active
}`,

  'db/01_schema.sql': `-- ==========================================================
-- EdgeProxy Relational Database Schema (PostgreSQL 16)
-- High-throughput, partitioned schema with RBAC and quotas
-- ==========================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    api_key VARCHAR(128) UNIQUE NOT NULL,
    plan_tier VARCHAR(32) DEFAULT 'free' CHECK (plan_tier IN ('free', 'pro', 'enterprise')),
    max_tunnels INT DEFAULT 3,
    max_rps INT DEFAULT 50,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE tunnels (
    id VARCHAR(64) PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    subdomain VARCHAR(64) UNIQUE NOT NULL,
    target_port INT NOT NULL CHECK (target_port BETWEEN 1 AND 65535),
    protocol VARCHAR(16) DEFAULT 'tcp' CHECK (protocol IN ('tcp', 'quic', 'http2')),
    status VARCHAR(16) DEFAULT 'online' CHECK (status IN ('online', 'offline', 'jailed')),
    auth_enabled BOOLEAN DEFAULT FALSE,
    auth_user VARCHAR(64),
    auth_pass_hash VARCHAR(255),
    total_requests BIGINT DEFAULT 0,
    bytes_transferred BIGINT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE traffic_logs (
    id VARCHAR(64) NOT NULL,
    tunnel_id VARCHAR(64) NOT NULL,
    subdomain VARCHAR(64) NOT NULL,
    client_ip INET NOT NULL,
    method VARCHAR(16) NOT NULL,
    path TEXT NOT NULL,
    status_code INT NOT NULL,
    latency_ms DOUBLE PRECISION NOT NULL,
    bytes_in INT DEFAULT 0,
    bytes_out INT DEFAULT 0,
    blocked_by_shield BOOLEAN DEFAULT FALSE,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
) PARTITION BY RANGE (recorded_at);`,

  'db/02_indexes.sql': `-- Indexes for sub-millisecond route matching and time-series telemetry
CREATE INDEX idx_tunnels_subdomain_active ON tunnels (subdomain) WHERE status = 'online';
CREATE INDEX idx_tunnels_user_id ON tunnels (user_id);
CREATE INDEX idx_users_api_key ON users (api_key);
CREATE INDEX idx_traffic_subdomain_time ON traffic_logs (subdomain, recorded_at DESC);
CREATE INDEX idx_traffic_blocked_ip ON traffic_logs (client_ip, recorded_at DESC) WHERE blocked_by_shield = TRUE;`,

  'db/03_seed.sql': `-- Bootstrap Seed Migration
INSERT INTO users (id, email, api_key, plan_tier, max_tunnels, max_rps)
VALUES ('00000000-0000-0000-0000-000000000001', 'admin@edgeproxy.mesh', 'edg_live_sec_prod_99x', 'enterprise', 50, 1000)
ON CONFLICT (id) DO NOTHING;

INSERT INTO tunnels (id, user_id, subdomain, target_port, protocol, status)
VALUES 
    ('tun-prod-01', '00000000-0000-0000-0000-000000000001', 'api', 8080, 'quic', 'online'),
    ('tun-prod-02', '00000000-0000-0000-0000-000000000001', 'grafana', 3000, 'tcp', 'online')
ON CONFLICT (id) DO NOTHING;`,
};
