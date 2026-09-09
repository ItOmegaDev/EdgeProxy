package demux

import (
	"bufio"
	"bytes"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"sync"
	"time"
)

// StreamDemuxer receives binary frames from the gateway and forwards HTTP requests to local services
type StreamDemuxer struct {
	targetAddr string // e.g. "127.0.0.1:3000"
	client     *http.Client
	mu         sync.Mutex
}

func NewStreamDemuxer(targetAddr string) *StreamDemuxer {
	return &StreamDemuxer{
		targetAddr: targetAddr,
		client: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// ForwardRequest takes raw HTTP request bytes from the tunnel wire, sends to local service, and returns raw HTTP response
func (d *StreamDemuxer) ForwardRequest(rawReq []byte) ([]byte, error) {
	reqReader := bufio.NewReader(bytes.NewReader(rawReq))
	req, err := http.ReadRequest(reqReader)
	if err != nil {
		return nil, fmt.Errorf("failed parsing raw HTTP request: %w", err)
	}

	// Rewrite URL to target local port
	req.URL.Scheme = "http"
	req.URL.Host = d.targetAddr
	req.RequestURI = "" // Required by Go http.Client

	start := time.Now()
	resp, err := d.client.Do(req)
	duration := time.Since(start)

	if err != nil {
		log.Printf("[DEMUX] Local port %s unreachable: %v", d.targetAddr, err)
		errResp := fmt.Sprintf("HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/plain\r\n\r\nLocal port %s is offline or rejecting connections.\n", d.targetAddr)
		return []byte(errResp), nil
	}
	defer resp.Body.Close()

	var buf bytes.Buffer
	if err := resp.Write(&buf); err != nil {
		log.Printf("[DEMUX] Error serializing HTTP response with resp.Write: %v", err)
		return nil, fmt.Errorf("failed serializing HTTP response: %w", err)
	}

	log.Printf("[DEMUX] %s %s -> %d %s (local: %v)", req.Method, req.URL.Path, resp.StatusCode, http.StatusText(resp.StatusCode), duration)
	return buf.Bytes(), nil
}

// CheckLocalPort checks if target local port is open and listening
func CheckLocalPort(port int) bool {
	conn, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", port), 300*time.Millisecond)
	if err != nil {
		return false
	}
	conn.Close()
	return true
}
