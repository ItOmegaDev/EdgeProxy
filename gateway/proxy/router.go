package proxy

import (
	"bufio"
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

// TunnelSession represents an active connected agent
type TunnelSession struct {
	ID         string
	Subdomain  string
	Conn       net.Conn
	WriterLock sync.Mutex
	Streams    map[uint32]chan []byte
	StreamsMu  sync.RWMutex
	NextStream uint32
	CreatedAt  time.Time
	BytesIn    uint64
	BytesOut   uint64
}

// Router maintains active subdomain mappings and proxies incoming TCP/HTTP requests
type Router struct {
	mu          sync.RWMutex
	sessions    map[string]*TunnelSession // key: subdomain
	rateLimiter *limiter.RateLimiterStore
	baseDomain  string
}

func NewRouter(baseDomain string, rps, burst float64) *Router {
	return &Router{
		sessions:    make(map[string]*TunnelSession),
		rateLimiter: limiter.NewRateLimiterStore(rps, burst),
		baseDomain:  baseDomain,
	}
}

// RegisterSession attaches a new local agent tunnel
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
	log.Printf("[ROUTER] Registered tunnel session for %s.%s (ID: %s)", subdomain, r.baseDomain, session.ID)
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

// ServeHTTP inspects the Host header and proxies the request through the binary tunnel
func (r *Router) ServeHTTP(w http.ResponseWriter, req *http.Request) {
	clientIP, _, _ := net.SplitHostPort(req.RemoteAddr)
	if !r.rateLimiter.Check(clientIP) {
		http.Error(w, "HTTP 429: Rate Limit Exceeded (DDoS Shield Activated)", http.StatusTooManyRequests)
		return
	}

	// Extract subdomain from Host header (e.g., "myapi.edgeproxy.mesh" -> "myapi")
	host := req.Host
	if colonIdx := strings.Index(host, ":"); colonIdx != -1 {
		host = host[:colonIdx]
	}

	subdomain := strings.TrimSuffix(host, "."+r.baseDomain)
	if subdomain == host {
		// Root domain hit
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		fmt.Fprintf(w, `{"service":"EdgeProxy Gateway","status":"online","tunnels_active":%d}`, len(r.sessions))
		return
	}

	r.mu.RLock()
	session, exists := r.sessions[subdomain]
	r.mu.RUnlock()

	if !exists {
		http.Error(w, fmt.Sprintf("HTTP 502: Tunnel '%s.%s' is currently offline or unreachable", subdomain, r.baseDomain), http.StatusBadGateway)
		return
	}

	// Allocate a new stream ID with buffered response channel to prevent HOL blocking
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

	// Serialize the HTTP request to send via Framed protocol
	rawReq := fmt.Sprintf("%s %s %s\r\nHost: %s\r\n", req.Method, req.URL.RequestURI(), req.Proto, req.Host)
	for k, v := range req.Header {
		rawReq += fmt.Sprintf("%s: %s\r\n", k, strings.Join(v, ", "))
	}
	rawReq += "\r\n"

	synFrame := &protocol.Frame{
		StreamID: streamID,
		Type:     protocol.FrameSyn,
		Payload:  []byte(rawReq),
	}

	session.WriterLock.Lock()
	_, err := session.Conn.Write(synFrame.Encode())
	session.WriterLock.Unlock()

	if err != nil {
		http.Error(w, "HTTP 504: Failed writing frame to tunnel wire", http.StatusGatewayTimeout)
		return
	}

	// Read and forward request body if present
	if req.Body != nil {
		buf := make([]byte, 16384)
		for {
			n, rErr := req.Body.Read(buf)
			if n > 0 {
				dataFrame := &protocol.Frame{
					StreamID: streamID,
					Type:     protocol.FrameData,
					Payload:  buf[:n],
				}
				session.WriterLock.Lock()
				session.Conn.Write(dataFrame.Encode())
				session.WriterLock.Unlock()
			}
			if rErr == io.EOF {
				break
			}
			if rErr != nil {
				break
			}
		}
	}

	// Wait for response payload from agent
	select {
	case payload := <-respChan:
		// Parse HTTP response header and stream back
		respReader := bufio.NewReader(strings.NewReader(string(payload)))
		resp, pErr := http.ReadResponse(respReader, req)
		if pErr != nil {
			w.WriteHeader(http.StatusOK)
			w.Write(payload)
			return
		}
		for k, vv := range resp.Header {
			for _, v := range vv {
				w.Header().Add(k, v)
			}
		}
		w.WriteHeader(resp.StatusCode)
		io.Copy(w, resp.Body)
	case <-time.After(15 * time.Second):
		http.Error(w, "HTTP 504: Gateway Timeout (Local Agent did not respond)", http.StatusGatewayTimeout)
	}
}
