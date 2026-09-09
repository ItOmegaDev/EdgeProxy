package main

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
	gatewayAddr := flag.String("gateway", "gateway.edgeproxy.mesh:4242", "Edge Gateway TCP control plane address")
	subdomain := flag.String("subdomain", "", "Requested custom subdomain (e.g. 'myapi')")
	port := flag.Int("port", 3000, "Target local port to expose (e.g. 3000, 8080)")
	token := flag.String("token", "", "EdgeProxy auth token (strictly required)")
	autoDiscover := flag.Bool("auto", true, "Auto-discover active listening ports if port is closed")
	flag.Parse()

	// Strict token enforcement: flag is strictly mandatory
	if *token == "" {
		log.Fatal("[FATAL] Missing required auth token. Pass -token <token>.")
	}
	authToken := *token

	if *subdomain == "" {
		*subdomain = fmt.Sprintf("dev-%d", time.Now().Unix()%10000)
	}

	fmt.Println("================================================================")
	fmt.Println("  EdgeProxy Local Agent (CLI v1.0.0-PROD) - Zero-Config Tunnel  ")
	fmt.Println("================================================================")
	fmt.Printf("  Target Port     : http://127.0.0.1:%d\n", *port)
	fmt.Printf("  Assigned Domain : https://%s.edgeproxy.mesh\n", *subdomain)
	fmt.Printf("  Gateway Remote  : %s\n", *gatewayAddr)
	fmt.Println("----------------------------------------------------------------")

	// Verify if local port is active
	if !demux.CheckLocalPort(*port) {
		fmt.Printf("⚠️  Warning: Port %d is not actively listening.\n", *port)
		if *autoDiscover {
			for _, testPort := range []int{3000, 5173, 8080, 8000, 4200} {
				if demux.CheckLocalPort(testPort) {
					fmt.Printf("🔍 Auto-discovered active local service on port :%d! Switching target.\n", testPort)
					*port = testPort
					break
				}
			}
		}
	} else {
		fmt.Printf("✅ Local service verified on port :%d\n", *port)
	}

	agent := client.NewTunnelClient(*gatewayAddr, *subdomain, *port, authToken)

	// Graceful termination handling
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, os.Interrupt, syscall.SIGTERM)

	go func() {
		<-sigChan
		fmt.Println("\n[AGENT] Terminating tunnel session...")
		agent.Stop()
		os.Exit(0)
	}()

	if err := agent.Start(); err != nil {
		log.Fatalf("[FATAL] Agent failed: %v", err)
	}
}
