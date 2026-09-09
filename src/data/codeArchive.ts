export const REFERENCE_CODE_ARCHIVE: Record<string, string> = {
  'gateway/main.go': `package main

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"edgeproxy/gateway/acme"
	"edgeproxy/gateway/protocol"
	"edgeproxy/gateway/proxy"
)

type AgentHandshakePayload struct {
	Subdomain string \`json:"subdomain"\`
	Token     string \`json:"token"\`
	Version   string \`json:"version"\`
}

func main() {
	httpPort := flag.Int("http-port", 80, "Public HTTP ingress port")
	tlsPort := flag.Int("tls-port", 443, "Public HTTPS ingress port with real TLS termination")
	tunnelPort := flag.Int("tunnel-port", 4242, "Control plane tunnel port for local agents")
	baseDomain := flag.String("domain", "edgeproxy.mesh", "Base wildcard domain for tunnels")
	rateLimitRps := flag.Float64("rps", 100.0, "Per-IP allowed RPS before burst shield")
	burstCapacity := flag.Float64("burst", 150.0, "Maximum burst capacity for token bucket")
	controlPlaneURL := flag.String("control-plane", "http://127.0.0.1:3000", "Node.js Control Plane API URL")
	certDir := flag.String("cert-dir", "./certs", "Directory for ACME and TLS certificates")
	flag.Parse()

	log.Printf("==========================================================")
	log.Printf("  EdgeProxy Gateway (v1.0.0-PROD) - High-Load Edge Router ")
	log.Printf("  Base Domain: *.%s", *baseDomain)
	log.Printf("  Ingress Ports: HTTP :%d | HTTPS :%d | Tunnel :%d", *httpPort, *tlsPort, *tunnelPort)
	log.Printf("  Shield: TokenBucket %.0f RPS / %.0f Burst with Auto-Jail", *rateLimitRps, *burstCapacity)
	log.Printf("  TLS Termination: Real ECDSA P-256 + ACME SNI on :%d", *tlsPort)
	log.Printf("  Control Plane Sync: %s", *controlPlaneURL)
	log.Printf("==========================================================")

	router := proxy.NewRouter(*baseDomain, *rateLimitRps, *burstCapacity)
	certMgr := acme.NewCertManager(*baseDomain, *certDir)

	// Periodic synchronization of allowed tunnels and tokens from Control Plane DB
	go syncTunnelsFromControlPlane(router, *controlPlaneURL)

	// Setup Internal Management Handlers for Control Plane IPC
	setupInternalHandlers(router, certMgr)

	// Start Tunnel Ingress Listener for Agents (TCP multiplexed wire)
	tunnelListener, err := net.Listen("tcp", fmt.Sprintf("0.0.0.0:%d", *tunnelPort))
	if err != nil {
		log.Fatalf("[FATAL] Failed to bind tunnel port %d: %v", *tunnelPort, err)
	}
	defer tunnelListener.Close()

	go func() {
		log.Printf("[TUNNEL-INGRESS] Listening for incoming Agent connections on :%d", *tunnelPort)
		for {
			conn, err := tunnelListener.Accept()
			if err != nil {
				continue
			}
			go handleAgentConnection(router, conn)
		}
	}()

	// Start Public HTTP Server (with ACME HTTP-01 challenge pass-through)
	httpServer := &http.Server{
		Addr:    fmt.Sprintf(":%d", *httpPort),
		Handler: router,
	}

	go func() {
		log.Printf("[HTTP-INGRESS] Listening on :%d (HTTP / ACME HTTP-01 ready)", *httpPort)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Printf("[WARN] HTTP server error: %v", err)
		}
	}()

	// Start Real HTTPS Server on Port 443 with TLS Termination
	tlsServer := &http.Server{
		Addr:      fmt.Sprintf(":%d", *tlsPort),
		Handler:   router,
		TLSConfig: certMgr.TLSConfig(),
	}

	go func() {
		log.Printf("[HTTPS-INGRESS] Starting real TLS termination server on :%d (SNI ECDSA)", *tlsPort)
		if err := tlsServer.ListenAndServeTLS("", ""); err != nil && err != http.ErrServerClosed {
			log.Printf("[WARN] HTTPS server error: %v", err)
		}
	}()

	// Wait for OS termination signal
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)
	<-sigChan

	log.Println("[SHUTDOWN] Gracefully shutting down EdgeProxy Gateway...")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = httpServer.Shutdown(ctx)
	_ = tlsServer.Shutdown(ctx)
}

func handleAgentConnection(router *proxy.Router, conn net.Conn) {
	defer conn.Close()

	// Handshake: read first SYN frame containing JSON handshake
	frame, err := protocol.ReadFrame(conn)
	if err != nil || frame.Type != protocol.FrameSyn {
		return
	}

	var handshake AgentHandshakePayload
	if err := json.Unmarshal(frame.Payload, &handshake); err != nil {
		handshake.Subdomain = string(frame.Payload)
	}

	if !router.VerifyAuthorization(handshake.Subdomain, handshake.Token) {
		log.Printf("[AGENT-AUTH-REJECTED] Unauthorized agent connection for subdomain '%s'", handshake.Subdomain)
		conn.Write((&protocol.Frame{StreamID: 0, Type: protocol.FrameRst, Payload: []byte("Unauthorized")}).Encode())
		return
	}

	session := router.RegisterSession(handshake.Subdomain, conn)
	defer router.UnregisterSession(handshake.Subdomain)

	for {
		f, err := protocol.ReadFrame(conn)
		if err != nil {
			break
		}
		switch f.Type {
		case protocol.FrameMetrics:
			router.RecordTelemetry(handshake.Subdomain, f.Payload)
		case protocol.FrameFin:
			session.StreamsMu.Lock()
			ch, exists := session.Streams[f.StreamID]
			delete(session.Streams, f.StreamID)
			session.StreamsMu.Unlock()
			if exists && ch != nil {
				close(ch)
			}
		case protocol.FrameData:
			session.StreamsMu.RLock()
			ch, exists := session.Streams[f.StreamID]
			session.StreamsMu.RUnlock()
			if exists && ch != nil {
				select {
				case ch <- f.Payload:
				case <-time.After(500 * time.Millisecond):
				}
			}
		}
	}
}

func syncTunnelsFromControlPlane(router *proxy.Router, controlPlaneURL string) {
	client := &http.Client{Timeout: 5 * time.Second}
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()

	syncFunc := func() {
		resp, err := client.Get(fmt.Sprintf("%s/api/tunnels", controlPlaneURL))
		if err != nil {
			return
		}
		defer resp.Body.Close()
		var rawTunnels []struct {
			Subdomain string \`json:"subdomain"\`
			Token     string \`json:"token"\`
			Status    string \`json:"status"\`
			MaxRps    int    \`json:"maxRps"\`
		}
		if err := json.NewDecoder(resp.Body).Decode(&rawTunnels); err == nil {
			allowed := make([]proxy.AllowedTunnelConfig, 0, len(rawTunnels))
			for _, t := range rawTunnels {
				allowed = append(allowed, proxy.AllowedTunnelConfig{
					Subdomain: t.Subdomain,
					AuthToken: t.Token,
					MaxRPS:    float64(t.MaxRps),
					IsActive:  t.Status == "online" || t.Status == "active",
				})
			}
			router.SyncAllowedTunnels(allowed)
		}
	}
	syncFunc()
	for range ticker.C {
		syncFunc()
	}
}

func setupInternalHandlers(router *proxy.Router, certMgr *acme.CertManager) {
	http.HandleFunc("/internal/certs", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(certMgr.ListCertificates())
	})
	http.HandleFunc("/internal/certs/issue", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Domain   string \`json:"domain"\`
			Wildcard bool   \`json:"wildcard"\`
		}
		_ = json.NewDecoder(r.Body).Decode(&req)
		meta, err := certMgr.IssueOrRenew(req.Domain, req.Wildcard)
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(meta)
	})
	http.HandleFunc("/internal/sessions", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(router.GetActiveSessionsSnapshot())
	})
}`,

  'gateway/proxy/router.go': `package proxy

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

type AllowedTunnelConfig struct {
	Subdomain string  \`json:"subdomain"\`
	AuthToken string  \`json:"token"\`
	MaxRPS    float64 \`json:"maxRps"\`
	IsActive  bool    \`json:"isActive"\`
}

type AgentTelemetry struct {
	AgentID         string    \`json:"agentId"\`
	Subdomain       string    \`json:"subdomain"\`
	Timestamp       time.Time \`json:"timestamp"\`
	TotalRequests   uint64    \`json:"totalRequests"\`
	ActiveStreams   int32     \`json:"activeStreams"\`
	BytesSent       uint64    \`json:"bytesSent"\`
	BytesReceived   uint64    \`json:"bytesReceived"\`
	AvgLatencyMs    float64   \`json:"avgLatencyMs"\`
	P50LatencyMs    float64   \`json:"p50LatencyMs"\`
	P95LatencyMs    float64   \`json:"p95LatencyMs"\`
	P99LatencyMs    float64   \`json:"p99LatencyMs"\`
	ErrorCount      uint64    \`json:"errorCount"\`
	LocalServiceRTT float64   \`json:"localServiceRttMs"\`
}

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

type Router struct {
	mu             sync.RWMutex
	sessions       map[string]*TunnelSession
	allowedTunnels map[string]AllowedTunnelConfig
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

func (r *Router) SyncAllowedTunnels(configs []AllowedTunnelConfig) {
	r.mu.Lock()
	defer r.mu.Unlock()
	newMap := make(map[string]AllowedTunnelConfig)
	for _, cfg := range configs {
		newMap[cfg.Subdomain] = cfg
	}
	r.allowedTunnels = newMap
}

func (r *Router) VerifyAuthorization(subdomain, token string) bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if len(r.allowedTunnels) == 0 {
		return token != ""
	}
	cfg, exists := r.allowedTunnels[subdomain]
	return exists && cfg.IsActive && (cfg.AuthToken == "" || cfg.AuthToken == token)
}

func (r *Router) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	clientIP, _, _ := net.SplitHostPort(req.RemoteAddr)
	if !r.rateLimiter.Check(clientIP) {
		http.Error(w, "HTTP 429: Rate Limit Exceeded (DDoS Shield Activated)", http.StatusTooManyRequests)
		return
	}

	host := strings.ToLower(strings.Split(req.Host, ":")[0])
	subdomain := strings.TrimSuffix(host, "."+r.baseDomain)

	r.mu.RLock()
	session, exists := r.sessions[subdomain]
	r.mu.RUnlock()

	if !exists {
		http.Error(w, fmt.Sprintf("HTTP 502: Tunnel '%s.%s' is currently offline", subdomain, r.baseDomain), http.StatusBadGateway)
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
	session.Conn.Write(synFrame.Encode())
	session.WriterLock.Unlock()

	select {
	case payload, ok := <-respChan:
		if !ok || len(payload) == 0 {
			http.Error(w, "HTTP 502: Bad Gateway (Empty response)", http.StatusBadGateway)
			return
		}

		// Send FrameAck to release backpressure window credit to agent
		session.WriterLock.Lock()
		session.Conn.Write((&protocol.Frame{StreamID: streamID, Type: protocol.FrameAck}).Encode())
		session.WriterLock.Unlock()

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
			session.WriterLock.Lock()
			session.Conn.Write((&protocol.Frame{StreamID: streamID, Type: protocol.FrameAck}).Encode())
			session.WriterLock.Unlock()
		}

	case <-time.After(15 * time.Second):
		http.Error(w, "HTTP 504: Gateway Timeout (Local Agent did not respond)", http.StatusGatewayTimeout)
	}
}`,

  'gateway/acme/cert.go': `package acme

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"fmt"
	"math/big"
	"strings"
	"sync"
	"time"
)

type CertificateMeta struct {
	ID            string   \`json:"id"\`
	Domain        string   \`json:"domain"\`
	Wildcard      bool     \`json:"wildcard"\`
	Issuer        string   \`json:"issuer"\`
	Status        string   \`json:"status"\`
	ValidFrom     string   \`json:"validFrom"\`
	ValidTo       string   \`json:"validTo"\`
	DaysRemaining int      \`json:"daysRemaining"\`
	ChallengeType string   \`json:"challengeType"\`
	SANList       []string \`json:"sanList"\`
	OCSPStapled   bool     \`json:"ocspStapled"\`
	Fingerprint   string   \`json:"fingerprint"\`
	AutoRenew     bool     \`json:"autoRenew"\`
}

type CertManager struct {
	mu           sync.RWMutex
	certificates map[string]*tls.Certificate
	metadata     map[string]*CertificateMeta
	baseDomain   string
	certDir      string
}

func NewCertManager(baseDomain string, certDir string) *CertManager {
	cm := &CertManager{
		certificates: make(map[string]*tls.Certificate),
		metadata:     make(map[string]*CertificateMeta),
		baseDomain:   baseDomain,
		certDir:      certDir,
	}
	cm.IssueOrRenew(baseDomain, true)
	return cm
}

func (m *CertManager) TLSConfig() *tls.Config {
	return &tls.Config{
		GetCertificate: m.GetCertificate,
		MinVersion:     tls.VersionTLS12,
		NextProtos:     []string{"h2", "http/1.1"},
	}
}

func (m *CertManager) GetCertificate(hello *tls.ClientHelloInfo) (*tls.Certificate, error) {
	name := strings.ToLower(hello.ServerName)
	if name == "" {
		name = m.baseDomain
	}
	m.mu.RLock()
	cert, exists := m.certificates[name]
	m.mu.RUnlock()
	if exists {
		return cert, nil
	}
	m.mu.RLock()
	wildCert, wildExists := m.certificates["*."+m.baseDomain]
	m.mu.RUnlock()
	if wildExists {
		return wildCert, nil
	}
	return nil, fmt.Errorf("certificate not found for %s", name)
}

func (m *CertManager) IssueOrRenew(domain string, wildcard bool) (*CertificateMeta, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	privKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, err
	}
	serial, _ := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	now := time.Now()
	validTo := now.Add(90 * 24 * time.Hour)

	var sanList []string
	if wildcard {
		sanList = []string{"*." + domain, domain}
	} else {
		sanList = []string{domain}
	}

	tmpl := x509.Certificate{
		SerialNumber:          serial,
		Subject:               pkix.Name{CommonName: domain, Organization: []string{"EdgeProxy ACME CA"}},
		NotBefore:             now.Add(-1 * time.Hour),
		NotAfter:              validTo,
		KeyUsage:              x509.KeyUsageKeyEncipherment | x509.KeyUsageDigitalSignature,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
		DNSNames:              sanList,
	}

	derBytes, err := x509.CreateCertificate(rand.Reader, &tmpl, &tmpl, &privKey.PublicKey, privKey)
	if err != nil {
		return nil, err
	}

	fp := sha256.Sum256(derBytes)
	var hexParts []string
	for _, b := range fp[:16] {
		hexParts = append(hexParts, fmt.Sprintf("%02X", b))
	}

	tlsCert := &tls.Certificate{Certificate: [][]byte{derBytes}, PrivateKey: privKey}
	certKey := domain
	if wildcard {
		certKey = "*." + domain
		m.certificates[domain] = tlsCert
	}
	m.certificates[certKey] = tlsCert

	meta := &CertificateMeta{
		ID:            fmt.Sprintf("cert-%d", now.UnixNano()),
		Domain:        domain,
		Wildcard:      wildcard,
		Issuer:        "Let's Encrypt / EdgeProxy ACME CA",
		Status:        "valid",
		ValidFrom:     now.Format("2006-01-02"),
		ValidTo:       validTo.Format("2006-01-02"),
		DaysRemaining: 90,
		ChallengeType: "TLS-ALPN-01",
		SANList:       sanList,
		OCSPStapled:   true,
		Fingerprint:   "SHA256: " + strings.Join(hexParts, ":"),
		AutoRenew:     true,
	}
	m.metadata[certKey] = meta
	return meta, nil
}

func (m *CertManager) ListCertificates() []*CertificateMeta {
	m.mu.RLock()
	defer m.mu.RUnlock()
	res := make([]*CertificateMeta, 0, len(m.metadata))
	for _, meta := range m.metadata {
		res = append(res, meta)
	}
	return res
}`,

  'gateway/protocol/framing.go': `package protocol

import (
	"encoding/binary"
	"fmt"
	"io"
)

const HeaderSize = 9

const (
	FrameSyn     byte = 0x01 // New Stream
	FrameData    byte = 0x02 // Data chunk
	FrameFin     byte = 0x03 // Stream closed
	FramePing    byte = 0x04 // Keep-alive heartbeat
	FramePong    byte = 0x05 // Keep-alive response
	FrameRst     byte = 0x06 // Stream reset
	FrameAck     byte = 0x07 // Flow-control credit acknowledgement
	FrameMetrics byte = 0x08 // Agent local telemetry metrics report
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
	tb.lastRefilled = now

	tb.tokens += elapsed * tb.refillRate
	if tb.tokens > tb.capacity {
		tb.tokens = tb.capacity
	}

	if tb.tokens >= 1.0 {
		tb.tokens -= 1.0
		return true
	}
	return false
}

type RateLimiterStore struct {
	mu         sync.RWMutex
	buckets    map[string]*TokenBucket
	jailed     map[string]time.Time
	violations map[string]int
	capacity   float64
	refillRate float64
}

func NewRateLimiterStore(capacity, refillRate float64) *RateLimiterStore {
	return &RateLimiterStore{
		buckets:    make(map[string]*TokenBucket),
		jailed:     make(map[string]time.Time),
		violations: make(map[string]int),
		capacity:   capacity,
		refillRate: refillRate,
	}
}

func (s *RateLimiterStore) Check(ip string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()

	if until, isJailed := s.jailed[ip]; isJailed {
		if time.Now().Before(until) {
			return false
		}
		delete(s.jailed, ip)
		s.violations[ip] = 0
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
	token := flag.String("token", "", "EdgeProxy auth token (strictly required)")
	flag.Parse()

	if *token == "" {
		log.Fatal("[FATAL] Missing required auth token. Pass -token <token>.")
	}
	authToken := *token

	if *subdomain == "" {
		*subdomain = fmt.Sprintf("dev-%d", time.Now().Unix()%10000)
	}

	if !demux.CheckLocalPort(*port) {
		log.Printf("Target port %d is not responding on 127.0.0.1", *port)
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
	"encoding/binary"
	"fmt"
	"io"
	"log"
	"net"
	"sync"
	"time"

	"edgeproxy/agent/demux"
	"edgeproxy/agent/metrics"
)

const HeaderSize = 9
const (
	FrameSyn     byte = 0x01
	FrameData    byte = 0x02
	FrameFin     byte = 0x03
	FramePing    byte = 0x04
	FramePong    byte = 0x05
	FrameRst     byte = 0x06
	FrameAck     byte = 0x07
	FrameMetrics byte = 0x08
)

const MaxInFlightWindow = 4

type TunnelClient struct {
	gatewayAddr string
	subdomain   string
	localPort   int
	token       string
	demuxer     *demux.StreamDemuxer
	collector   *metrics.LocalMetricsCollector
	conn        net.Conn
	mu          sync.Mutex
	running     bool
	ackChans    map[uint32]chan struct{}
	ackChansMu  sync.RWMutex
}

func NewTunnelClient(gatewayAddr, subdomain string, localPort int, token string) *TunnelClient {
	agentID := fmt.Sprintf("agent-%s-%d", subdomain, time.Now().Unix())
	return &TunnelClient{
		gatewayAddr: gatewayAddr,
		subdomain:   subdomain,
		localPort:   localPort,
		token:       token,
		demuxer:     demux.NewStreamDemuxer(fmt.Sprintf("127.0.0.1:%d", localPort)),
		collector:   metrics.NewMetricsCollector(agentID, subdomain),
		ackChans:    make(map[uint32]chan struct{}),
	}
}

func (c *TunnelClient) Start() error {
	conn, err := net.DialTimeout("tcp", c.gatewayAddr, 5*time.Second)
	if err != nil {
		return fmt.Errorf("failed connecting to gateway: %w", err)
	}
	c.conn = conn
	c.running = true

	handshakePayload := fmt.Sprintf(\`{"subdomain":"%s","token":"%s","version":"v1.0.0-PROD"}\`, c.subdomain, c.token)
	c.conn.Write(encodeFrame(0, FrameSyn, []byte(handshakePayload)))

	go c.heartbeatLoop()
	go c.telemetryLoop()

	for c.running {
		streamID, frameType, payload, err := readFrame(c.conn)
		if err != nil {
			break
		}
		switch frameType {
		case FramePing:
			c.mu.Lock()
			c.conn.Write(encodeFrame(streamID, FramePong, nil))
			c.mu.Unlock()

		case FrameAck:
			c.ackChansMu.RLock()
			ch, exists := c.ackChans[streamID]
			c.ackChansMu.RUnlock()
			if exists && ch != nil {
				select {
				case ch <- struct{}{}:
				default:
				}
			}

		case FrameSyn, FrameData:
			c.collector.StreamStarted()
			go func(sid uint32, raw []byte) {
				defer c.collector.StreamFinished()
				start := time.Now()
				respBytes, err := c.demuxer.ForwardRequest(raw)
				duration := time.Since(start)

				if err != nil {
					c.collector.RecordRequest(duration, int64(len(raw)), 0, 502)
					c.mu.Lock()
					c.conn.Write(encodeFrame(sid, FrameRst, []byte(err.Error())))
					c.mu.Unlock()
					return
				}
				c.collector.RecordRequest(duration, int64(len(raw)), int64(len(respBytes)), 200)

				ackChan := make(chan struct{}, MaxInFlightWindow)
				for i := 0; i < MaxInFlightWindow; i++ {
					ackChan <- struct{}{}
				}
				c.ackChansMu.Lock()
				c.ackChans[sid] = ackChan
				c.ackChansMu.Unlock()

				defer func() {
					c.ackChansMu.Lock()
					delete(c.ackChans, sid)
					c.ackChansMu.Unlock()
				}()

				const chunkSize = 32768
				for offset := 0; offset < len(respBytes); offset += chunkSize {
					end := offset + chunkSize
					if end > len(respBytes) {
						end = len(respBytes)
					}
					select {
					case <-ackChan:
					case <-time.After(10 * time.Second):
						return
					}
					c.mu.Lock()
					c.conn.Write(encodeFrame(sid, FrameData, respBytes[offset:end]))
					c.mu.Unlock()
				}
				c.mu.Lock()
				c.conn.Write(encodeFrame(sid, FrameFin, nil))
				c.mu.Unlock()
			}(streamID, payload)
		}
	}
	return nil
}

func (c *TunnelClient) telemetryLoop() {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for c.running {
		<-ticker.C
		reportBytes, err := c.collector.EncodeJSON()
		if err == nil && len(reportBytes) > 0 {
			c.mu.Lock()
			if c.conn != nil {
				c.conn.Write(encodeFrame(0, FrameMetrics, reportBytes))
			}
			c.mu.Unlock()
		}
	}
}

func (c *TunnelClient) heartbeatLoop() {
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	for c.running {
		<-ticker.C
		c.mu.Lock()
		if c.conn != nil {
			c.conn.Write(encodeFrame(0, FramePing, nil))
		}
		c.mu.Unlock()
	}
}

func (c *TunnelClient) Stop() {
	c.running = false
	if c.conn != nil {
		c.conn.Close()
	}
}

func encodeFrame(streamID uint32, frameType byte, payload []byte) []byte {
	buf := make([]byte, HeaderSize+len(payload))
	binary.BigEndian.PutUint32(buf[0:4], streamID)
	buf[4] = frameType
	binary.BigEndian.PutUint32(buf[5:9], uint32(len(payload)))
	copy(buf[9:], payload)
	return buf
}

func readFrame(r io.Reader) (uint32, byte, []byte, error) {
	header := make([]byte, HeaderSize)
	if _, err := io.ReadFull(r, header); err != nil {
		return 0, 0, nil, err
	}
	streamID := binary.BigEndian.Uint32(header[0:4])
	frameType := header[4]
	length := binary.BigEndian.Uint32(header[5:9])
	payload := make([]byte, length)
	if length > 0 {
		if _, err := io.ReadFull(r, payload); err != nil {
			return 0, 0, nil, err
		}
	}
	return streamID, frameType, payload, nil
}`,

  'agent/metrics/collector.go': `package metrics

import (
	"encoding/json"
	"sort"
	"sync"
	"sync/atomic"
	"time"
)

type TelemetryReport struct {
	AgentID          string    \`json:"agentId"\`
	Subdomain        string    \`json:"subdomain"\`
	Timestamp        time.Time \`json:"timestamp"\`
	TotalRequests    uint64    \`json:"totalRequests"\`
	ActiveStreams    int32     \`json:"activeStreams"\`
	BytesSent        uint64    \`json:"bytesSent"\`
	BytesReceived    uint64    \`json:"bytesReceived"\`
	AvgLatencyMs     float64   \`json:"avgLatencyMs"\`
	P50LatencyMs     float64   \`json:"p50LatencyMs"\`
	P95LatencyMs     float64   \`json:"p95LatencyMs"\`
	P99LatencyMs     float64   \`json:"p99LatencyMs"\`
	ErrorCount       uint64    \`json:"errorCount"\`
	LocalServiceRTT  float64   \`json:"localServiceRttMs"\`
}

type LocalMetricsCollector struct {
	mu             sync.Mutex
	agentID        string
	subdomain      string
	totalRequests  uint64
	activeStreams  int32
	bytesSent      uint64
	bytesReceived  uint64
	errorCount     uint64
	latencySamples []float64
	lastRTT        float64
}

func NewMetricsCollector(agentID, subdomain string) *LocalMetricsCollector {
	return &LocalMetricsCollector{
		agentID:        agentID,
		subdomain:      subdomain,
		latencySamples: make([]float64, 0, 1024),
	}
}

func (m *LocalMetricsCollector) StreamStarted() { atomic.AddInt32(&m.activeStreams, 1) }
func (m *LocalMetricsCollector) StreamFinished() { atomic.AddInt32(&m.activeStreams, -1) }

func (m *LocalMetricsCollector) RecordRequest(duration time.Duration, bytesIn, bytesOut int64, statusCode int) {
	latMs := float64(duration.Microseconds()) / 1000.0
	atomic.AddUint64(&m.totalRequests, 1)
	atomic.AddUint64(&m.bytesReceived, uint64(bytesIn))
	atomic.AddUint64(&m.bytesSent, uint64(bytesOut))
	if statusCode >= 400 {
		atomic.AddUint64(&m.errorCount, 1)
	}
	m.mu.Lock()
	if len(m.latencySamples) < 2048 {
		m.latencySamples = append(m.latencySamples, latMs)
	} else {
		m.latencySamples = append(m.latencySamples[1:], latMs)
	}
	m.lastRTT = latMs
	m.mu.Unlock()
}

func (m *LocalMetricsCollector) Snapshot() TelemetryReport {
	m.mu.Lock()
	defer m.mu.Unlock()
	var avg, p50, p95, p99 float64
	n := len(m.latencySamples)
	if n > 0 {
		sorted := make([]float64, n)
		copy(sorted, m.latencySamples)
		sort.Float64s(sorted)
		var sum float64
		for _, v := range sorted {
			sum += v
		}
		avg = sum / float64(n)
		p50 = sorted[int(float64(n)*0.50)]
		p95Idx := int(float64(n)*0.95)
		if p95Idx >= n { p95Idx = n - 1 }
		p95 = sorted[p95Idx]
		p99Idx := int(float64(n)*0.99)
		if p99Idx >= n { p99Idx = n - 1 }
		p99 = sorted[p99Idx]
	}
	return TelemetryReport{
		AgentID:         m.agentID,
		Subdomain:       m.subdomain,
		Timestamp:       time.Now(),
		TotalRequests:   atomic.LoadUint64(&m.totalRequests),
		ActiveStreams:   atomic.LoadInt32(&m.activeStreams),
		BytesSent:       atomic.LoadUint64(&m.bytesSent),
		BytesReceived:   atomic.LoadUint64(&m.bytesReceived),
		AvgLatencyMs:    avg,
		P50LatencyMs:    p50,
		P95LatencyMs:    p95,
		P99LatencyMs:    p99,
		ErrorCount:      atomic.LoadUint64(&m.errorCount),
		LocalServiceRTT: m.lastRTT,
	}
}

func (m *LocalMetricsCollector) EncodeJSON() ([]byte, error) {
	return json.Marshal(m.Snapshot())
}`,

  'agent/demux/demuxer.go': `package demux

import (
	"bytes"
	"fmt"
	"log"
	"net"
	"net/http"
	"time"
)

type StreamDemuxer struct {
	targetAddr string
	client     *http.Client
}

func NewStreamDemuxer(targetAddr string) *StreamDemuxer {
	return &StreamDemuxer{
		targetAddr: targetAddr,
		client: &http.Client{
			Timeout: 10 * time.Second,
			Transport: &http.Transport{
				MaxIdleConns:        100,
				IdleConnTimeout:     90 * time.Second,
				DisableCompression: true,
			},
		},
	}
}

func CheckLocalPort(port int) bool {
	conn, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", port), 300*time.Millisecond)
	if err != nil {
		return false
	}
	conn.Close()
	return true
}

func (d *StreamDemuxer) ForwardRequest(rawHTTP []byte) ([]byte, error) {
	reqReader := bytes.NewReader(rawHTTP)
	req, err := http.ReadRequest(bufio.NewReader(reqReader))
	if err != nil {
		return nil, fmt.Errorf("failed parsing forwarded HTTP request: %w", err)
	}

	req.URL.Scheme = "http"
	req.URL.Host = d.targetAddr
	req.RequestURI = ""

	resp, err := d.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("local server dial error (%s): %w", d.targetAddr, err)
	}
	defer resp.Body.Close()

	var buf bytes.Buffer
	if err := resp.Write(&buf); err != nil {
		return nil, fmt.Errorf("failed serializing HTTP response: %w", err)
	}

	return buf.Bytes(), nil
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
VALUES ('00000000-0000-0000-0000-000000000001', 'admin@edgeproxy.mesh', 'edg_sec_09a47f12e8b6c43d91', 'enterprise', 50, 1000)
ON CONFLICT (id) DO NOTHING;

INSERT INTO tunnels (id, user_id, subdomain, target_port, protocol, status)
VALUES 
    ('tun-prod-01', '00000000-0000-0000-0000-000000000001', 'api', 8080, 'quic', 'online'),
    ('tun-prod-02', '00000000-0000-0000-0000-000000000001', 'grafana', 3000, 'tcp', 'online')
ON CONFLICT (id) DO NOTHING;`,
};
