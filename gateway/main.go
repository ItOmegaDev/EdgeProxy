package main

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
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
	Subdomain string `json:"subdomain"`
	Token     string `json:"token"`
	Version   string `json:"version"`
}

func main() {
	httpPort := flag.Int("http-port", 80, "Public HTTP ingress port")
	tlsPort := flag.Int("tls-port", 443, "Public HTTPS ingress port with real TLS termination")
	tunnelPort := flag.Int("tunnel-port", 4242, "Control plane tunnel port for local agents")
	baseDomain := flag.String("domain", "edgeproxy.mesh", "Base wildcard domain for tunnels")
	rateLimitRps := flag.Float64("rps", 100.0, "Per-IP allowed RPS before burst shield")
	burstCapacity := flag.Float64("burst", 150.0, "Maximum burst capacity for token bucket")
	internalAddr := flag.String("internal-addr", envOrDefault("EDGEPROXY_INTERNAL_ADDR", "127.0.0.1:8081"), "Private control-plane IPC address")
	internalSecret := flag.String("internal-secret", os.Getenv("EDGEPROXY_INTERNAL_SECRET"), "Shared secret for private control-plane IPC (required to enable it)")
	certDir := flag.String("cert-dir", "./certs", "Directory for TLS certificates")
	flag.Parse()

	if *internalSecret != "" && len(*internalSecret) < 24 {
		log.Fatalf("[FATAL] EDGEPROXY_INTERNAL_SECRET must be at least 24 characters")
	}
	if _, _, err := net.SplitHostPort(*internalAddr); err != nil {
		log.Fatalf("[FATAL] Invalid -internal-addr %q: %v", *internalAddr, err)
	}

	log.Printf("==========================================================")
	log.Printf("  EdgeProxy Gateway (v1.0.0) - High-Load Edge Router ")
	log.Printf("  Base Domain: *.%s", *baseDomain)
	log.Printf("  Ingress Ports: HTTP :%d | HTTPS :%d | Tunnel :%d", *httpPort, *tlsPort, *tunnelPort)
	log.Printf("  Shield: TokenBucket %.0f RPS / %.0f Burst with Auto-Jail", *rateLimitRps, *burstCapacity)
	log.Printf("  TLS: Self-signed ECDSA P-256 with SNI on :%d (not publicly trusted)", *tlsPort)
	log.Printf("  Internal IPC: %s (secret configured: %t)", *internalAddr, *internalSecret != "")
	log.Printf("==========================================================")

	router := proxy.NewRouter(*baseDomain, *rateLimitRps, *burstCapacity)
	certMgr := acme.NewCertManager(*baseDomain, *certDir)

	// Private IPC for the control plane. It is never attached to the public
	// listener and is disabled unless a shared secret is configured.
	var internalServer *http.Server
	if *internalSecret != "" {
		internalMux := http.NewServeMux()
		setupInternalHandlers(internalMux, router, certMgr)
		internalServer = &http.Server{
			Addr:              *internalAddr,
			Handler:           internalAuth(*internalSecret, internalMux),
			ReadHeaderTimeout: 5 * time.Second,
			ReadTimeout:       10 * time.Second,
			WriteTimeout:      10 * time.Second,
		}
		go func() {
			log.Printf("[INTERNAL] Listening on %s (shared-secret auth)", *internalAddr)
			if err := internalServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
				log.Printf("[WARN] Internal IPC server error: %v", err)
			}
		}()
	} else {
		log.Printf("[INTERNAL] Disabled: EDGEPROXY_INTERNAL_SECRET is not set")
	}

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
				log.Printf("[TUNNEL-INGRESS] Accept error: %v", err)
				continue
			}
			go handleAgentConnection(router, conn)
		}
	}()

	// Start public HTTP server.
	httpServer := &http.Server{
		Addr:              fmt.Sprintf(":%d", *httpPort),
		Handler:           router,
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Printf("[HTTP-INGRESS] Listening on :%d", *httpPort)
		if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Printf("[WARN] HTTP server error: %v", err)
		}
	}()

	// Start HTTPS server with SNI-based TLS termination.
	tlsServer := &http.Server{
		Addr:              fmt.Sprintf(":%d", *tlsPort),
		Handler:           router,
		TLSConfig:         certMgr.TLSConfig(),
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Printf("[HTTPS-INGRESS] Starting TLS termination on :%d (self-signed SNI)", *tlsPort)
		// ListenAndServeTLS with empty strings uses TLSConfig.GetCertificate
		if err := tlsServer.ListenAndServeTLS("", ""); err != nil && err != http.ErrServerClosed {
			log.Printf("[WARN] HTTPS server error (port %d may require elevated privileges): %v", *tlsPort, err)
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
	if internalServer != nil {
		_ = internalServer.Shutdown(ctx)
	}
}

func handleAgentConnection(router *proxy.Router, conn net.Conn) {
	defer conn.Close()

	// The handshake must complete quickly; slow clients cannot hold a slot open.
	_ = conn.SetDeadline(time.Now().Add(10 * time.Second))

	// Handshake: read first SYN frame containing JSON handshake
	frame, err := protocol.ReadFrame(conn)
	if err != nil {
		log.Printf("[AGENT-HANDSHAKE] Failed reading handshake frame: %v", err)
		return
	}

	if frame.Type != protocol.FrameSyn {
		log.Printf("[AGENT-HANDSHAKE] Expected SYN frame, received 0x%02x", frame.Type)
		return
	}

	var handshake AgentHandshakePayload
	payloadStr := strings.TrimSpace(string(frame.Payload))

	if strings.HasPrefix(payloadStr, "{") {
		if err := json.Unmarshal(frame.Payload, &handshake); err != nil {
			log.Printf("[AGENT-HANDSHAKE] Invalid JSON handshake: %v", err)
			return
		}
	} else {
		// Legacy plain subdomain fallback (token is still required separately).
		handshake.Subdomain = payloadStr
	}

	handshake.Subdomain = strings.ToLower(strings.TrimSpace(handshake.Subdomain))
	if !proxy.ValidSubdomain(handshake.Subdomain) {
		log.Printf("[AGENT-HANDSHAKE] Invalid subdomain %q", handshake.Subdomain)
		return
	}

	// Verify authorization token against Control Plane / DB state. Deny by default.
	if !router.VerifyAuthorization(handshake.Subdomain, handshake.Token) {
		log.Printf("[AGENT-AUTH-REJECTED] Unauthorized agent connection for subdomain '%s'", handshake.Subdomain)
		rstFrame := &protocol.Frame{
			StreamID: 0,
			Type:     protocol.FrameRst,
			Payload:  []byte("HTTP 401: Unauthorized tunnel agent token"),
		}
		_, _ = conn.Write(rstFrame.Encode())
		return
	}

	_ = conn.SetDeadline(time.Time{})

	session := router.RegisterSession(handshake.Subdomain, conn)
	defer router.UnregisterSession(handshake.Subdomain)

	// Acknowledge the handshake so the agent can fail fast on a rejected token
	// instead of assuming the tunnel is online.
	session.WriterLock.Lock()
	_, _ = session.Conn.Write((&protocol.Frame{
		StreamID: 0,
		Type:     protocol.FrameAck,
		Payload:  []byte(`{"status":"ready"}`),
	}).Encode())
	session.WriterLock.Unlock()

	// Demux loop: read frames from agent wire
	for {
		f, err := protocol.ReadFrame(conn)
		if err != nil {
			log.Printf("[AGENT] Session %s disconnected: %v", session.ID, err)
			break
		}

		switch f.Type {
		case protocol.FramePing:
			session.WriterLock.Lock()
			_, _ = session.Conn.Write((&protocol.Frame{
				StreamID: f.StreamID,
				Type:     protocol.FramePong,
			}).Encode())
			session.WriterLock.Unlock()

		case protocol.FrameMetrics:
			// Record real agent telemetry
			router.RecordTelemetry(handshake.Subdomain, f.Payload)

		case protocol.FrameFin:
			session.StreamsMu.Lock()
			ch, exists := session.Streams[f.StreamID]
			delete(session.Streams, f.StreamID)
			session.StreamsMu.Unlock()
			if exists && ch != nil {
				select {
				case ch <- f.Payload:
				default:
				}
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
					log.Printf("[AGENT-BACKPRESSURE] Stream %d channel saturated, backpressure active", f.StreamID)
				}
			}
		}
	}
}

func envOrDefault(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}

func internalAuth(secret string, next http.Handler) http.Handler {
	expected := sha256.Sum256([]byte(secret))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		presented := r.Header.Get("X-EdgeProxy-Internal")
		actual := sha256.Sum256([]byte(presented))
		if presented == "" || subtle.ConstantTimeCompare(expected[:], actual[:]) != 1 {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// setupInternalHandlers binds private IPC endpoints for the control plane.
// The caller mounts them on a separate listener that is not the public ingress.
func setupInternalHandlers(mux *http.ServeMux, router *proxy.Router, certMgr *acme.CertManager) {
	mux.HandleFunc("/internal/certs", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		_ = json.NewEncoder(w).Encode(certMgr.ListCertificates())
	})

	mux.HandleFunc("/internal/certs/issue", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
		var req struct {
			Domain   string `json:"domain"`
			Wildcard bool   `json:"wildcard"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		meta, err := certMgr.IssueOrRenew(req.Domain, req.Wildcard)
		if err != nil {
			http.Error(w, "certificate issuance failed", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		_ = json.NewEncoder(w).Encode(meta)
	})

	mux.HandleFunc("/internal/sessions", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		_ = json.NewEncoder(w).Encode(router.GetActiveSessionsSnapshot())
	})

	mux.HandleFunc("/internal/tunnels/sync", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
		var configs []proxy.AllowedTunnelConfig
		if err := json.NewDecoder(r.Body).Decode(&configs); err != nil {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}
		router.SyncAllowedTunnels(configs)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"synced"}`))
	})
}
