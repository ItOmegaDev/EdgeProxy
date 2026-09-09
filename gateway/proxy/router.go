package proxy

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"edgeproxy/gateway/limiter"
	"edgeproxy/gateway/protocol"
)

// AllowedTunnelConfig holds tunnel permissions synchronized from Control Plane / Database
type AllowedTunnelConfig struct {
	Subdomain string  `json:"subdomain"`
	AuthToken string  `json:"token"`
	MaxRPS    float64 `json:"maxRps"`
	IsActive  bool    `json:"isActive"`
}

// AgentTelemetry represents metrics reported by the agent's local metrics collector
type AgentTelemetry struct {
	AgentID         string    `json:"agentId"`
	Subdomain       string    `json:"subdomain"`
	Timestamp       time.Time `json:"timestamp"`
	TotalRequests   uint64    `json:"totalRequests"`
	ActiveStreams   int32     `json:"activeStreams"`
	BytesSent       uint64    `json:"bytesSent"`
	BytesReceived   uint64    `json:"bytesReceived"`
	AvgLatencyMs    float64   `json:"avgLatencyMs"`
	P50LatencyMs    float64   `json:"p50LatencyMs"`
	P95LatencyMs    float64   `json:"p95LatencyMs"`
	P99LatencyMs    float64   `json:"p99LatencyMs"`
	ErrorCount      uint64    `json:"errorCount"`
	LocalServiceRTT float64   `json:"localServiceRttMs"`
}

// TunnelSession represents an active connected agent
type TunnelSession struct {
	ID              string
	Subdomain       string
	Conn            net.Conn
	WriterLock      sync.Mutex
	Streams         map[uint32]chan []byte
	StreamsMu       sync.RWMutex
	NextStream      uint32
	CreatedAt       time.Time
	BytesIn         uint64
	BytesOut        uint64
	LatestTelemetry *AgentTelemetry
}

// Router maintains active subdomain mappings and proxies incoming TCP/HTTP requests
type Router struct {
	mu             sync.RWMutex
	sessions       map[string]*TunnelSession       // key: subdomain
	allowedTunnels map[string]AllowedTunnelConfig // synchronized from Control Plane / DB
	rateLimiter    *limiter.RateLimiterStore
	baseDomain     string
}

func NewRouter(baseDomain string, rps, burst float64) *Router {
	return &Router{
		sessions:       make(map[string]*TunnelSession),
		allowedTunnels: make(map[string]AllowedTunnelConfig),
		rateLimiter:    limiter.NewRateLimiterStore(rps, burst),
		baseDomain:     baseDomain,
	}
}

// SyncAllowedTunnels loads or updates allowed tunnels from DB / Control Plane
func (r *Router) SyncAllowedTunnels(configs []AllowedTunnelConfig) {
	r.mu.Lock()
	defer r.mu.Unlock()

	newMap := make(map[string]AllowedTunnelConfig)
	for _, cfg := range configs {
		newMap[cfg.Subdomain] = cfg
	}
	r.allowedTunnels = newMap
	log.Printf("[ROUTER-SYNC] Synchronized %d authorized tunnels from Control Plane database", len(newMap))
}

// VerifyAuthorization verifies if agent's token is allowed according to DB state
func (r *Router) VerifyAuthorization(subdomain, token string) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()

	// If no tunnels configured yet in DB, allow initial bootstrap tokens
	if len(r.allowedTunnels) == 0 {
		return token != ""
	}

	cfg, exists := r.allowedTunnels[subdomain]
	if !exists {
		return false
	}
	return cfg.IsActive && (cfg.AuthToken == "" || cfg.AuthToken == token)
}

// RegisterSession attaches a new authenticated local agent tunnel
func (r *Router) RegisterSession(subdomain string, conn net.Conn) *TunnelSession {
	r.mu.Lock()
	defer r.mu.Unlock()

	session := &TunnelSession{
		ID:        fmt.Sprintf("sess_%d", time.Now().UnixNano()),
		Subdomain: subdomain,
		Conn:      conn,
		Streams:   make(map[uint32]chan []byte),
		CreatedAt: time.Now(),
	}

	r.sessions[subdomain] = session
	log.Printf("[ROUTER] Registered authenticated tunnel session for %s.%s (ID: %s)", subdomain, r.baseDomain, session.ID)
	return session
}

// UnregisterSession removes a disconnected agent
func (r *Router) UnregisterSession(subdomain string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if sess, exists := r.sessions[subdomain]; exists {
		sess.Conn.Close()
		delete(r.sessions, subdomain)
		log.Printf("[ROUTER] Unregistered tunnel session for %s", subdomain)
	}
}

// RecordTelemetry stores real agent metrics received via FrameMetrics
func (r *Router) RecordTelemetry(subdomain string, data []byte) {
	var telem AgentTelemetry
	if err := json.Unmarshal(data, &telem); err != nil {
		log.Printf("[ROUTER-METRICS] Error decoding telemetry from %s: %v", subdomain, err)
		return
	}

	r.mu.RLock()
	sess, exists := r.sessions[subdomain]
	r.mu.RUnlock()

	if exists && sess != nil {
		sess.LatestTelemetry = &telem
		atomic.StoreUint64(&sess.BytesIn, telem.BytesReceived)
		atomic.StoreUint64(&sess.BytesOut, telem.BytesSent)
		log.Printf("[AGENT-TELEMETRY] Subdomain %s: %d reqs, avg lat %.2f ms, active streams: %d",
			subdomain, telem.TotalRequests, telem.AvgLatencyMs, telem.ActiveStreams)
	}
}

// GetActiveSessionsSnapshot returns real telemetry for Control Plane synchronization
func (r *Router) GetActiveSessionsSnapshot() []map[string]interface{} {
	r.mu.RLock()
	defer r.mu.RUnlock()

	out := make([]map[string]interface{}, 0, len(r.sessions))
	for sub, sess := range r.sessions {
		entry := map[string]interface{}{
			"subdomain": sub,
			"sessionId": sess.ID,
			"createdAt": sess.CreatedAt,
			"bytesIn":   atomic.LoadUint64(&sess.BytesIn),
			"bytesOut":  atomic.LoadUint64(&sess.BytesOut),
		}
		if sess.LatestTelemetry != nil {
			entry["telemetry"] = sess.LatestTelemetry
		}
		out = append(out, entry)
	}
	return out
}

// ServeHTTP inspects Host header and proxies request through the binary tunnel
func (r *Router) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	clientIP, _, _ := net.SplitHostPort(req.RemoteAddr)
	if !r.rateLimiter.Check(clientIP) {
		http.Error(w, "HTTP 429: Rate Limit Exceeded (DDoS Shield Activated)", http.StatusTooManyRequests)
		return
	}

	host := req.Host
	if colonIdx := strings.Index(host, ":"); colonIdx != -1 {
		host = host[:colonIdx]
	}

	subdomain := strings.TrimSuffix(host, "."+r.baseDomain)
	if subdomain == host {
		// Root domain hit
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		r.mu.RLock()
		activeCount := len(r.sessions)
		r.mu.RUnlock()
		fmt.Fprintf(w, `{"service":"EdgeProxy Gateway","status":"online","tunnels_active":%d,"base_domain":"%s"}`, activeCount, r.baseDomain)
		return
	}

	r.mu.RLock()
	session, exists := r.sessions[subdomain]
	r.mu.RUnlock()

	if !exists {
		http.Error(w, fmt.Sprintf("HTTP 502: Tunnel '%s.%s' is currently offline or unreachable", subdomain, r.baseDomain), http.StatusBadGateway)
		return
	}

	// Allocate stream ID with buffered channel and explicit credit-based flow control
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

	// 100% RFC-compliant serialization using standard Go req.Write(&reqBuf)
	var reqBuf bytes.Buffer
	if err := req.Write(&reqBuf); err != nil {
		http.Error(w, "HTTP 500: Failed serializing HTTP request", http.StatusInternalServerError)
		return
	}

	synFrame := &protocol.Frame{
		StreamID: streamID,
		Type:     protocol.FrameSyn,
		Payload:  reqBuf.Bytes(),
	}

	session.WriterLock.Lock()
	_, err := session.Conn.Write(synFrame.Encode())
	session.WriterLock.Unlock()

	if err != nil {
		http.Error(w, "HTTP 504: Failed writing frame to tunnel wire", http.StatusGatewayTimeout)
		return
	}

	// Wait for first response chunk from agent
	select {
	case payload, ok := <-respChan:
		if !ok || len(payload) == 0 {
			http.Error(w, "HTTP 502: Bad Gateway (Empty response from agent)", http.StatusBadGateway)
			return
		}

		// Send FrameAck to release backpressure window credit to agent
		session.WriterLock.Lock()
		session.Conn.Write((&protocol.Frame{
			StreamID: streamID,
			Type:     protocol.FrameAck,
		}).Encode())
		session.WriterLock.Unlock()

		// Parse HTTP headers
		respReader := bufio.NewReader(bytes.NewReader(payload))
		resp, pErr := http.ReadResponse(respReader, req)
		if pErr != nil {
			w.WriteHeader(http.StatusOK)
			w.Write(payload)
		} else {
			for k, vv := range resp.Header {
				for _, v := range vv {
					w.Header().Add(k, v)
				}
			}
			w.WriteHeader(resp.StatusCode)
			io.Copy(w, resp.Body)
			if f, ok := w.(http.Flusher); ok {
				f.Flush()
			}
		}

		// Stream subsequent data chunks with windowed FrameAck backpressure
		for chunk := range respChan {
			if len(chunk) > 0 {
				w.Write(chunk)
				if f, ok := w.(http.Flusher); ok {
					f.Flush()
				}
			}
			// Acknowledge chunk consumption immediately to maintain window credit without deadlock
			session.WriterLock.Lock()
			session.Conn.Write((&protocol.Frame{
				StreamID: streamID,
				Type:     protocol.FrameAck,
			}).Encode())
			session.WriterLock.Unlock()
		}

	case <-time.After(15 * time.Second):
		http.Error(w, "HTTP 504: Gateway Timeout (Local Agent did not respond)", http.StatusGatewayTimeout)
	}
}
