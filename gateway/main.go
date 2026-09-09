package main

import (
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"edgeproxy/gateway/acme"
	"edgeproxy/gateway/protocol"
	"edgeproxy/gateway/proxy"
)

func main() {
	httpPort := flag.Int("http-port", 80, "Public HTTP ingress port")
	tlsPort := flag.Int("tls-port", 443, "Public HTTPS ingress port")
	tunnelPort := flag.Int("tunnel-port", 4242, "Control plane tunnel port for local agents")
	baseDomain := flag.String("domain", "edgeproxy.mesh", "Base wildcard domain for tunnels")
	rateLimitRps := flag.Float64("rps", 100.0, "Per-IP allowed RPS before burst shield")
	burstCapacity := flag.Float64("burst", 150.0, "Maximum burst capacity for token bucket")
	flag.Parse()

	log.Printf("==========================================================")
	log.Printf("  EdgeProxy Gateway (v1.0.0-PROD) - High-Load Edge Router ")
	log.Printf("  Base Domain: *.%s", *baseDomain)
	log.Printf("  Ingress Ports: HTTP :%d | HTTPS :%d | Tunnel :%d", *httpPort, *tlsPort, *tunnelPort)
	log.Printf("  Shield: TokenBucket %.0f RPS / %.0f Burst with Auto-Jail", *rateLimitRps, *burstCapacity)
	log.Printf("==========================================================")

	router := proxy.NewRouter(*baseDomain, *rateLimitRps, *burstCapacity)
	_ = acme.NewCertManager(*baseDomain)

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

	// Start Public HTTP Server
	server := &http.Server{
		Addr:    fmt.Sprintf(":%d", *httpPort),
		Handler: router,
	}

	go func() {
		log.Printf("[HTTP-INGRESS] Listening on :%d (Host peek / SNI ready)", *httpPort)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("[FATAL] HTTP server error: %v", err)
		}
	}()

	// Wait for OS termination signal
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)
	<-sigChan

	log.Println("[SHUTDOWN] Gracefully shutting down EdgeProxy Gateway...")
}

func handleAgentConnection(router *proxy.Router, conn net.Conn) {
	defer conn.Close()

	// Handshake: read first SYN frame to identify requested subdomain
	frame, err := protocol.ReadFrame(conn)
	if err != nil {
		log.Printf("[AGENT-HANDSHAKE] Failed reading handshake frame: %v", err)
		return
	}

	if frame.Type != protocol.FrameSyn {
		log.Printf("[AGENT-HANDSHAKE] Expected SYN frame, received 0x%02x", frame.Type)
		return
	}

	subdomain := string(frame.Payload)
	session := router.RegisterSession(subdomain, conn)
	defer router.UnregisterSession(subdomain)

	// Read loop: receive frames from agent and demux to corresponding stream channels
	for {
		f, err := protocol.ReadFrame(conn)
		if err != nil {
			log.Printf("[AGENT] Session %s disconnected: %v", session.ID, err)
			break
		}

		session.StreamsMu.RLock()
		ch, exists := session.Streams[f.StreamID]
		session.StreamsMu.RUnlock()

		if exists && ch != nil {
			if f.Type == protocol.FrameFin {
				// Handle stream termination from agent
				session.StreamsMu.Lock()
				delete(session.Streams, f.StreamID)
				session.StreamsMu.Unlock()
				select {
				case ch <- f.Payload:
				default:
				}
				close(ch)
			} else {
				// Non-blocking write with backpressure timeout to prevent HOL blocking
				select {
				case ch <- f.Payload:
				case <-time.After(300 * time.Millisecond):
					log.Printf("[AGENT-BACKPRESSURE] Stream %d channel saturated, frame dropped to prevent head-of-line blocking", f.StreamID)
				}
			}
		}
	}
}
