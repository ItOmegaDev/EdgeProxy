package main

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
				log.Printf("[TUNNEL-INGRESS] Accept error: %v", err)
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
}

func handleAgentConnection(router *proxy.Router, conn net.Conn) {
	defer conn.Close()

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
	payloadStr := string(frame.Payload)

	if strings.HasPrefix(payloadStr, "{") {
		_ = json.Unmarshal(frame.Payload, &handshake)
	} else {
		// Legacy plain subdomain fallback
		handshake.Subdomain = payloadStr
	}

	if handshake.Subdomain == "" {
		log.Printf("[AGENT-HANDSHAKE] Handshake missing requested subdomain")
		return
	}

	// Verify authorization token against Control Plane / DB state
	if !router.VerifyAuthorization(handshake.Subdomain, handshake.Token) {
		log.Printf("[AGENT-AUTH-REJECTED] Unauthorized agent connection for subdomain '%s' (token invalid)", handshake.Subdomain)
		// Send RST frame and close
		rstFrame := &protocol.Frame{
			StreamID: 0,
			Type:     protocol.FrameRst,
			Payload:  []byte("HTTP 401: Unauthorized tunnel agent token"),
		}
		_, _ = conn.Write(rstFrame.Encode())
		return
	}

	session := router.RegisterSession(handshake.Subdomain, conn)
	defer router.UnregisterSession(handshake.Subdomain)

	// Demux loop: read frames from agent wire
	for {
		f, err := protocol.ReadFrame(conn)
		if err != nil {
			log.Printf("[AGENT] Session %s disconnected: %v", session.ID, err)
			break
		}

		switch f.Type {
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

// syncTunnelsFromControlPlane polls Control Plane database periodically to keep Data Plane synced
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
			Subdomain string `json:"subdomain"`
			Token     string `json:"token"`
			Status    string `json:"status"`
			MaxRps    int    `json:"maxRps"`
		}

		if err := json.NewDecoder(resp.Body).Decode(&rawTunnels); err != nil {
			return
		}

		allowed := make([]proxy.AllowedTunnelConfig, 0, len(rawTunnels))
		for _, t := range rawTunnels {
			allowed = append(allowed, proxy.AllowedTunnelConfig{
				Subdomain: t.Subdomain,
				AuthToken: t.Token,
				MaxRPS:    float64(t.MaxRps),
				IsActive:  t.Status == "active",
			})
		}
		router.SyncAllowedTunnels(allowed)
	}

	// Initial sync
	syncFunc()

	for range ticker.C {
		syncFunc()
	}
}

// setupInternalHandlers binds internal IPC endpoints on standard HTTP mux for Control Plane
func setupInternalHandlers(router *proxy.Router, certMgr *acme.CertManager) {
	http.HandleFunc("/internal/certs", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(certMgr.ListCertificates())
	})

	http.HandleFunc("/internal/certs/issue", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Domain   string `json:"domain"`
			Wildcard bool   `json:"wildcard"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
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

	http.HandleFunc("/internal/tunnels/sync", func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		var configs []proxy.AllowedTunnelConfig
		if err := json.Unmarshal(body, &configs); err != nil {
			http.Error(w, err.Error(), 400)
			return
		}
		router.SyncAllowedTunnels(configs)
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"synced"}`))
	})
}
